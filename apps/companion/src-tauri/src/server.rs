use std::{
    io,
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use serde_json::Value;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpSocket, TcpStream},
    sync::{Semaphore, oneshot},
    task::JoinHandle,
    time::{Instant, timeout, timeout_at},
};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::{
    http_dispatch::{
        AuthError, AuthPermit, AuthPort, AuthRequest, HandlerContext, HandlerError, HandlerPort,
        HandlerRequest, OwnershipTarget, RequestObservedAt,
    },
    http_response::{ResponseFactory, ValidatedOrigin, write_prepared},
    origin::OriginPolicy,
    pairing::BearerSecret,
    protocol::{
        JobCreateRequest, OwnedSchemaName, PackActionRequest, PairingChallengeRequest, ProblemCode,
        RedeemRequest, RequestMessage, negotiate_version,
    },
    rate::{
        RateClass, RateLimitError, RateLimitPort, RatePermit, RateRequest, RateSubject,
        RetryAfterSeconds,
    },
    router::{
        AllowSet, AuthClass, MatchedConcreteRoute, MatchedPreflightRoute, OperationId,
        OwnershipClass, PREFLIGHT_ALLOWED_HEADERS, PathParameters, PreflightTarget, RouteMatch,
        resolve_route,
    },
    scheduler::Clock,
    schema::{OpenApiSchemas, SchemaError},
};

pub const LISTENER_PORT: u16 = 17_843;
pub const MAX_CONNECTIONS: usize = 32;
pub const MAX_IN_FLIGHT: usize = 8;
pub const MAX_REQUEST_LINE_BYTES: usize = 2 * 1024;
pub const MAX_HEADER_BYTES: usize = 8 * 1024;
pub const MAX_BODY_BYTES: usize = 16 * 1024;
pub const HEADER_TIMEOUT: Duration = Duration::from_secs(5);
pub const BODY_TIMEOUT: Duration = Duration::from_secs(10);
pub const HANDLER_TIMEOUT: Duration = Duration::from_secs(30);

const LISTENER_ADDR: SocketAddrV4 = SocketAddrV4::new(Ipv4Addr::LOCALHOST, LISTENER_PORT);

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ListenerError {
    #[error("the fixed loopback port is already in use")]
    Conflict,
    #[error("the fixed loopback listener is unavailable")]
    Unavailable,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ServerMetrics {
    pub active_connections: usize,
    pub peak_connections: usize,
    pub active_in_flight: usize,
    pub peak_in_flight: usize,
    pub body_reads: usize,
}

#[derive(Default)]
struct Metrics {
    active_connections: AtomicUsize,
    peak_connections: AtomicUsize,
    active_in_flight: AtomicUsize,
    peak_in_flight: AtomicUsize,
    body_reads: AtomicUsize,
}

impl Metrics {
    fn connection_started(&self) {
        let current = self.active_connections.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak_connections.fetch_max(current, Ordering::SeqCst);
    }

    fn connection_finished(&self) {
        self.active_connections.fetch_sub(1, Ordering::SeqCst);
    }

    fn request_started(&self) {
        let current = self.active_in_flight.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak_in_flight.fetch_max(current, Ordering::SeqCst);
    }

    fn request_finished(&self) {
        self.active_in_flight.fetch_sub(1, Ordering::SeqCst);
    }

    fn snapshot(&self) -> ServerMetrics {
        ServerMetrics {
            active_connections: self.active_connections.load(Ordering::SeqCst),
            peak_connections: self.peak_connections.load(Ordering::SeqCst),
            active_in_flight: self.active_in_flight.load(Ordering::SeqCst),
            peak_in_flight: self.peak_in_flight.load(Ordering::SeqCst),
            body_reads: self.body_reads.load(Ordering::SeqCst),
        }
    }
}

struct ActivityGuard {
    metrics: Arc<Metrics>,
    kind: ActivityKind,
}

enum ActivityKind {
    Connection,
    Request,
}

impl ActivityGuard {
    fn connection(metrics: Arc<Metrics>) -> Self {
        metrics.connection_started();
        Self {
            metrics,
            kind: ActivityKind::Connection,
        }
    }

    fn request(metrics: Arc<Metrics>) -> Self {
        metrics.request_started();
        Self {
            metrics,
            kind: ActivityKind::Request,
        }
    }
}

impl Drop for ActivityGuard {
    fn drop(&mut self) {
        match self.kind {
            ActivityKind::Connection => self.metrics.connection_finished(),
            ActivityKind::Request => self.metrics.request_finished(),
        }
    }
}

pub struct CompanionServer;

#[derive(Clone)]
pub struct ServerPorts {
    handler: Arc<dyn HandlerPort>,
    auth: Arc<dyn AuthPort>,
    rate: Arc<dyn RateLimitPort>,
    clock: Arc<dyn Clock>,
}

impl ServerPorts {
    pub fn new(
        handler: Arc<dyn HandlerPort>,
        auth: Arc<dyn AuthPort>,
        rate: Arc<dyn RateLimitPort>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            handler,
            auth,
            rate,
            clock,
        }
    }
}

pub struct ServerHandle {
    local_addr: SocketAddr,
    metrics: Arc<Metrics>,
    shutdown: Option<oneshot::Sender<()>>,
    accept_task: Option<JoinHandle<()>>,
}

impl std::fmt::Debug for ServerHandle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ServerHandle")
            .field("local_addr", &self.local_addr)
            .finish_non_exhaustive()
    }
}

impl ServerHandle {
    pub const fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    pub fn metrics(&self) -> ServerMetrics {
        self.metrics.snapshot()
    }

    pub async fn shutdown(mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(task) = self.accept_task.take() {
            let _ = task.await;
        }
    }
}

impl Drop for ServerHandle {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(task) = self.accept_task.take() {
            task.abort();
        }
    }
}

impl CompanionServer {
    pub async fn start(
        origin_policy: OriginPolicy,
        ports: ServerPorts,
    ) -> Result<ServerHandle, ListenerError> {
        let schemas = Arc::new(OpenApiSchemas::embedded().map_err(|_| ListenerError::Unavailable)?);
        let responses = Arc::new(ResponseFactory::new(Arc::clone(&schemas)));
        let socket = TcpSocket::new_v4().map_err(|_| ListenerError::Unavailable)?;
        socket
            .set_reuseaddr(false)
            .map_err(|_| ListenerError::Unavailable)?;
        socket
            .bind(SocketAddr::V4(LISTENER_ADDR))
            .map_err(map_bind_error)?;
        let listener = socket
            .listen(MAX_CONNECTIONS as u32)
            .map_err(map_bind_error)?;
        let local_addr = listener
            .local_addr()
            .map_err(|_| ListenerError::Unavailable)?;
        if local_addr != SocketAddr::V4(LISTENER_ADDR) {
            return Err(ListenerError::Unavailable);
        }

        let metrics = Arc::new(Metrics::default());
        let connections = Arc::new(Semaphore::new(MAX_CONNECTIONS));
        let requests = Arc::new(Semaphore::new(MAX_IN_FLIGHT));
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let accept_task = tokio::spawn(run_accept_loop(
            listener,
            AcceptLoopContext {
                origin_policy,
                connections,
                requests,
                metrics: Arc::clone(&metrics),
                ports,
                schemas,
                responses,
            },
            shutdown_rx,
        ));

        Ok(ServerHandle {
            local_addr,
            metrics,
            shutdown: Some(shutdown_tx),
            accept_task: Some(accept_task),
        })
    }
}

struct AcceptLoopContext {
    origin_policy: OriginPolicy,
    connections: Arc<Semaphore>,
    requests: Arc<Semaphore>,
    metrics: Arc<Metrics>,
    ports: ServerPorts,
    schemas: Arc<OpenApiSchemas>,
    responses: Arc<ResponseFactory>,
}

fn map_bind_error(error: io::Error) -> ListenerError {
    if error.kind() == io::ErrorKind::AddrInUse {
        ListenerError::Conflict
    } else {
        ListenerError::Unavailable
    }
}

async fn run_accept_loop(
    listener: TcpListener,
    context: AcceptLoopContext,
    mut shutdown: oneshot::Receiver<()>,
) {
    let AcceptLoopContext {
        origin_policy,
        connections,
        requests,
        metrics,
        ports,
        schemas,
        responses,
    } = context;
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            accepted = listener.accept() => {
                let Ok((mut stream, peer)) = accepted else { break };
                if !peer.ip().is_loopback() || !peer.is_ipv4() {
                    let _ = stream.shutdown().await;
                    continue;
                }
                let Ok(connection_permit) = Arc::clone(&connections).try_acquire_owned() else {
                    let _ = stream.shutdown().await;
                    continue;
                };
                let policy = origin_policy.clone();
                let request_semaphore = Arc::clone(&requests);
                let connection_metrics = Arc::clone(&metrics);
                let connection_ports = ports.clone();
                let connection_schemas = Arc::clone(&schemas);
                let connection_responses = Arc::clone(&responses);
                tokio::spawn(async move {
                    let _connection_permit = connection_permit;
                    let _connection_activity = ActivityGuard::connection(Arc::clone(&connection_metrics));
                    let Ok(request_permit) = request_semaphore.try_acquire_owned() else {
                        let delay = RetryAfterSeconds::new(1)
                            .expect("the fixed admission delay is in range");
                        let response = connection_responses
                            .actual_problem(
                                None,
                                None,
                                None,
                                ProblemCode::QueueFull,
                                Some(delay),
                            )
                            .unwrap_or_else(|_| {
                                connection_responses.fallback_actual(None, None, None)
                            });
                        let _ = write_prepared(&mut stream, response).await;
                        return;
                    };
                    let _request_permit = request_permit;
                    let _request_activity = ActivityGuard::request(Arc::clone(&connection_metrics));
                    let _ = handle_connection(
                        &mut stream,
                        &policy,
                        &connection_metrics,
                        &connection_ports,
                        &connection_schemas,
                        &connection_responses,
                    )
                    .await;
                });
            }
        }
    }
}

struct ParsedRequest {
    method: Zeroizing<String>,
    target: Zeroizing<String>,
    headers: Vec<(String, Zeroizing<String>)>,
    body_prefix: Zeroizing<Vec<u8>>,
}

impl ParsedRequest {
    fn values(&self, name: &str) -> Vec<&str> {
        header_values(&self.headers, name)
    }

    fn one(&self, name: &str) -> Option<&str> {
        let values = self.values(name);
        if values.len() == 1 {
            Some(values[0])
        } else {
            None
        }
    }
}

fn header_values<'a>(headers: &'a [(String, Zeroizing<String>)], name: &str) -> Vec<&'a str> {
    headers
        .iter()
        .filter(|(candidate, _)| candidate == name)
        .map(|(_, value)| value.as_str())
        .collect()
}

#[derive(Debug)]
struct BoundaryFailure {
    code: ProblemCode,
    origin: Option<String>,
    allow: Option<AllowSet>,
}

impl BoundaryFailure {
    const fn new(code: ProblemCode) -> Self {
        Self {
            code,
            origin: None,
            allow: None,
        }
    }

    fn with_origin(mut self, origin: &str) -> Self {
        self.origin = Some(origin.to_owned());
        self
    }

    fn from_route(error: crate::router::RouteError) -> Self {
        Self {
            code: error.problem_code(),
            origin: None,
            allow: error.allow(),
        }
    }
}

async fn write_actual_problem(
    stream: &mut TcpStream,
    responses: &ResponseFactory,
    origin: Option<&str>,
    operation: Option<OperationId>,
    allow: Option<AllowSet>,
    code: ProblemCode,
    retry_after: Option<RetryAfterSeconds>,
) -> io::Result<()> {
    let origin = origin.map(|origin| ValidatedOrigin::from_allowed(origin.to_owned()));
    let response = responses
        .actual_problem(origin.as_ref(), operation, allow, code, retry_after)
        .unwrap_or_else(|_| responses.fallback_actual(origin.as_ref(), operation, allow));
    write_prepared(stream, response).await
}

async fn write_preflight_problem(
    stream: &mut TcpStream,
    responses: &ResponseFactory,
    operation: Option<OperationId>,
    allow: Option<AllowSet>,
    code: ProblemCode,
    retry_after: Option<RetryAfterSeconds>,
) -> io::Result<()> {
    let response = responses
        .preflight_problem(operation, allow, code, retry_after)
        .unwrap_or_else(|_| responses.fallback_preflight(operation, allow));
    write_prepared(stream, response).await
}

async fn handle_connection(
    stream: &mut TcpStream,
    origin_policy: &OriginPolicy,
    metrics: &Arc<Metrics>,
    ports: &ServerPorts,
    schemas: &OpenApiSchemas,
    responses: &ResponseFactory,
) -> io::Result<()> {
    let mut parsed = match read_and_parse_headers(stream).await {
        Ok(parsed) => parsed,
        Err(failure) => {
            return write_actual_problem(
                stream,
                responses,
                failure.origin.as_deref(),
                None,
                failure.allow,
                failure.code,
                None,
            )
            .await;
        }
    };

    let context = match validate_pre_body(&parsed, origin_policy) {
        Ok(context) => context,
        Err(failure) => {
            return if parsed.method.as_str() == "OPTIONS" {
                write_preflight_problem(stream, responses, None, failure.allow, failure.code, None)
                    .await
            } else {
                write_actual_problem(
                    stream,
                    responses,
                    failure.origin.as_deref(),
                    None,
                    failure.allow,
                    failure.code,
                    None,
                )
                .await
            };
        }
    };

    if let RouteMatch::Preflight(preflight) = context.route {
        let (target, legacy_private_network) = match validate_preflight(
            &parsed.headers,
            &parsed.body_prefix,
            preflight,
            context.content_length,
        ) {
            Ok(response) => response,
            Err(failure) => {
                return write_preflight_problem(
                    stream,
                    responses,
                    Some(preflight.operation()),
                    failure.allow,
                    failure.code,
                    None,
                )
                .await;
            }
        };
        let origin = ValidatedOrigin::from_allowed(context.origin);
        let response = responses
            .preflight_success(&origin, &preflight, &target, legacy_private_network)
            .unwrap_or_else(|_| responses.fallback_preflight(Some(preflight.operation()), None));
        return write_prepared(stream, response).await;
    }

    let RequestContext {
        origin,
        content_length,
        route,
        bearer,
    } = context;
    let RouteMatch::Concrete(route) = route else {
        unreachable!("preflight returned before concrete admission")
    };
    let monotonic = ports.clock.monotonic();
    let utc = ports.clock.utc();
    let auth_permit = match reserve_auth(ports, &route, bearer, &origin, utc).await {
        Ok(permit) => permit,
        Err(code) => {
            return write_actual_problem(
                stream,
                responses,
                Some(&origin),
                Some(route.operation()),
                None,
                code,
                None,
            )
            .await;
        }
    };
    let rate_permit = match reserve_rate(ports, &route, &origin, auth_permit.as_deref(), monotonic)
    {
        Ok(permit) => permit,
        Err((code, retry_after)) => {
            return write_actual_problem(
                stream,
                responses,
                Some(&origin),
                Some(route.operation()),
                None,
                code,
                retry_after,
            )
            .await;
        }
    };

    let body_prefix = std::mem::take(&mut parsed.body_prefix);
    let body = match read_body(stream, body_prefix, content_length, metrics).await {
        Ok(body) => body,
        Err(failure) => {
            return write_actual_problem(
                stream,
                responses,
                Some(&origin),
                Some(route.operation()),
                None,
                failure.code,
                None,
            )
            .await;
        }
    };

    let validated_body = match validate_request_body(&route, &body, schemas) {
        Ok(body) => body,
        Err(code) => {
            return write_actual_problem(
                stream,
                responses,
                Some(&origin),
                Some(route.operation()),
                None,
                code,
                None,
            )
            .await;
        }
    };
    let request = match validated_body.into_handler_request(&route) {
        Ok(request) => request,
        Err(code) => {
            return write_actual_problem(
                stream,
                responses,
                Some(&origin),
                Some(route.operation()),
                None,
                code,
                None,
            )
            .await;
        }
    };
    let pairing = match auth_permit {
        Some(permit) => match permit.commit().await {
            Ok(pairing) => Some(pairing),
            Err(error) => {
                return write_actual_problem(
                    stream,
                    responses,
                    Some(&origin),
                    Some(route.operation()),
                    None,
                    map_auth_error(error),
                    None,
                )
                .await;
            }
        },
        None => None,
    };
    if let Some(permit) = rate_permit {
        permit.commit();
    }
    let handler_context = HandlerContext::new(
        origin.clone(),
        RequestObservedAt::new(monotonic, utc),
        pairing,
    );
    let prepared = match timeout(
        HANDLER_TIMEOUT,
        ports.handler.handle(handler_context, request),
    )
    .await
    {
        Ok(Ok(success)) => {
            let checked_origin = ValidatedOrigin::from_allowed(origin.clone());
            responses
                .success(&checked_origin, &route, success)
                .unwrap_or_else(|_| {
                    responses.fallback_actual(Some(&checked_origin), Some(route.operation()), None)
                })
        }
        Ok(Err(error)) => {
            let (code, retry_after) = map_handler_error(route.operation(), error);
            let checked_origin = ValidatedOrigin::from_allowed(origin.clone());
            responses
                .actual_problem(
                    Some(&checked_origin),
                    Some(route.operation()),
                    None,
                    code,
                    retry_after,
                )
                .unwrap_or_else(|_| {
                    responses.fallback_actual(Some(&checked_origin), Some(route.operation()), None)
                })
        }
        Err(_) => {
            let checked_origin = ValidatedOrigin::from_allowed(origin.clone());
            responses
                .actual_problem(
                    Some(&checked_origin),
                    Some(route.operation()),
                    None,
                    ProblemCode::HandlerTimeout,
                    None,
                )
                .unwrap_or_else(|_| {
                    responses.fallback_actual(Some(&checked_origin), Some(route.operation()), None)
                })
        }
    };
    write_prepared(stream, prepared).await
}

fn map_auth_error(error: AuthError) -> ProblemCode {
    match error {
        AuthError::Invalid => ProblemCode::AuthInvalid,
        AuthError::OriginMismatch => ProblemCode::AuthOriginMismatch,
        AuthError::ScopeDenied => ProblemCode::ScopeDenied,
        AuthError::NotFound => ProblemCode::ResourceNotFound,
        AuthError::Unavailable => ProblemCode::RuntimeUnavailable,
    }
}

fn map_handler_error(
    operation: OperationId,
    error: HandlerError,
) -> (ProblemCode, Option<RetryAfterSeconds>) {
    if operation == OperationId::GetJobAudio && error == HandlerError::PairingExpired {
        return (ProblemCode::ResourceNotFound, None);
    }
    match error {
        HandlerError::ResourceNotFound => (ProblemCode::ResourceNotFound, None),
        HandlerError::Conflict => (ProblemCode::Conflict, None),
        HandlerError::PairingNotFound => (ProblemCode::PairingNotFound, None),
        HandlerError::PairingDenied => (ProblemCode::PairingDenied, None),
        HandlerError::PairingExpired => (ProblemCode::PairingExpired, None),
        HandlerError::PairingConsumed => (ProblemCode::PairingConsumed, None),
        HandlerError::PairingAttemptsExhausted => (ProblemCode::PairingAttemptsExhausted, None),
        HandlerError::QueueFull(delay) => (ProblemCode::QueueFull, Some(delay)),
        HandlerError::PackUnverified => (ProblemCode::PackUnverified, None),
        HandlerError::RuntimeUnavailable => (ProblemCode::RuntimeUnavailable, None),
    }
}

fn ownership_target(route: &MatchedConcreteRoute) -> Result<OwnershipTarget, ProblemCode> {
    match (route.contract().access.ownership, route.parameters()) {
        (OwnershipClass::None, _) => Ok(OwnershipTarget::None),
        (OwnershipClass::TokenSelf, PathParameters::None) => Ok(OwnershipTarget::TokenSelf),
        (OwnershipClass::JobOwner, PathParameters::CanonicalUuid(id)) => {
            Ok(OwnershipTarget::Job(id))
        }
        (OwnershipClass::TokenSelf | OwnershipClass::JobOwner, _) => {
            Err(ProblemCode::RuntimeUnavailable)
        }
    }
}

async fn reserve_auth(
    ports: &ServerPorts,
    route: &MatchedConcreteRoute,
    bearer: Option<BearerSecret>,
    origin: &str,
    now_utc: time::OffsetDateTime,
) -> Result<Option<Box<dyn AuthPermit>>, ProblemCode> {
    match route.contract().access.auth {
        AuthClass::OriginOnly => {
            if bearer.is_some() {
                Err(ProblemCode::RuntimeUnavailable)
            } else {
                Ok(None)
            }
        }
        AuthClass::Bearer => {
            let token = bearer.ok_or(ProblemCode::RuntimeUnavailable)?;
            let request = AuthRequest::new(
                token,
                origin.to_owned(),
                route.contract().access.scope.map(|scope| scope.as_scope()),
                ownership_target(route)?,
                now_utc,
            );
            ports
                .auth
                .reserve(request)
                .await
                .map(Some)
                .map_err(map_auth_error)
        }
        AuthClass::Preflight => Err(ProblemCode::RuntimeUnavailable),
    }
}

fn rate_projection(
    route: &MatchedConcreteRoute,
    origin: &str,
    pairing_id: Option<Uuid>,
    now: std::time::Instant,
) -> Result<Option<RateRequest>, ProblemCode> {
    let pairing_subject = || {
        pairing_id
            .map(|id| RateSubject::Pairing(id.into()))
            .ok_or(ProblemCode::RuntimeUnavailable)
    };
    let projection = match route.operation() {
        OperationId::GetHealth => Some((RateClass::Health, RateSubject::Origin(origin.to_owned()))),
        OperationId::CreatePairingChallenge => Some((
            RateClass::PairingCreate,
            RateSubject::Origin(origin.to_owned()),
        )),
        OperationId::RedeemPairingChallenge => match route.parameters() {
            PathParameters::CanonicalUuid(id) => {
                Some((RateClass::PairingRedeem, RateSubject::Challenge(id)))
            }
            _ => return Err(ProblemCode::RuntimeUnavailable),
        },
        OperationId::GetCurrentPairing
        | OperationId::GetRuntime
        | OperationId::ListEngines
        | OperationId::ListVoices
        | OperationId::ListPacks
        | OperationId::GetJob
        | OperationId::GetJobAudio => Some((RateClass::AuthenticatedRead, pairing_subject()?)),
        OperationId::CreateJob => Some((RateClass::JobCreate, pairing_subject()?)),
        OperationId::RequestPackAction => Some((RateClass::PackAction, pairing_subject()?)),
        OperationId::RevokeCurrentPairing | OperationId::CancelJob => None,
        OperationId::PreflightHealth
        | OperationId::PreflightPairingChallenges
        | OperationId::PreflightPairingChallengeRedeem
        | OperationId::PreflightCurrentPairing
        | OperationId::PreflightRuntime
        | OperationId::PreflightEngines
        | OperationId::PreflightVoices
        | OperationId::PreflightPacks
        | OperationId::PreflightJobs
        | OperationId::PreflightJob
        | OperationId::PreflightJobAudio
        | OperationId::PreflightPackActions => return Err(ProblemCode::RuntimeUnavailable),
    };
    projection
        .map(|(class, subject)| {
            RateRequest::new(class, subject, now).map_err(|_| ProblemCode::RuntimeUnavailable)
        })
        .transpose()
}

type RateReservationError = (ProblemCode, Option<RetryAfterSeconds>);
type RateReservationResult = Result<Option<Box<dyn RatePermit>>, RateReservationError>;

fn reserve_rate(
    ports: &ServerPorts,
    route: &MatchedConcreteRoute,
    origin: &str,
    auth_permit: Option<&dyn AuthPermit>,
    now: std::time::Instant,
) -> RateReservationResult {
    let pairing_id = auth_permit.map(|permit| permit.pairing_id());
    let Some(request) =
        rate_projection(route, origin, pairing_id, now).map_err(|code| (code, None))?
    else {
        return Ok(None);
    };
    ports
        .rate
        .reserve(request)
        .map(Some)
        .map_err(|error| match error {
            RateLimitError::Limited(delay) => (ProblemCode::RateLimited, Some(delay)),
            RateLimitError::Unavailable => (ProblemCode::RuntimeUnavailable, None),
        })
}

async fn read_and_parse_headers(stream: &mut TcpStream) -> Result<ParsedRequest, BoundaryFailure> {
    let deadline = Instant::now() + HEADER_TIMEOUT;
    let mut bytes = Zeroizing::new(Vec::with_capacity(1024));
    let header_end = loop {
        if let Some(end) = find_header_end(&bytes) {
            if end > MAX_HEADER_BYTES {
                return Err(BoundaryFailure::new(ProblemCode::HeadersTooLarge));
            }
            break end;
        }
        if request_line_len(&bytes).is_none() && bytes.len() > MAX_REQUEST_LINE_BYTES {
            return Err(BoundaryFailure::new(ProblemCode::RequestLineTooLarge));
        }
        if bytes.len() > MAX_HEADER_BYTES {
            return Err(BoundaryFailure::new(ProblemCode::HeadersTooLarge));
        }
        let mut chunk = Zeroizing::new([0_u8; 1024]);
        let read = timeout_at(deadline, stream.read(&mut chunk[..]))
            .await
            .map_err(|_| BoundaryFailure::new(ProblemCode::HeaderTimeout))?
            .map_err(|_| BoundaryFailure::new(ProblemCode::SchemaInvalid))?;
        if read == 0 {
            return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid));
        }
        bytes.extend_from_slice(&chunk[..read]);
        if let Some(line_len) = request_line_len(&bytes)
            && line_len > MAX_REQUEST_LINE_BYTES
        {
            return Err(BoundaryFailure::new(ProblemCode::RequestLineTooLarge));
        }
    };

    let mut headers = [httparse::EMPTY_HEADER; 128];
    let mut request = httparse::Request::new(&mut headers);
    match request.parse(&bytes[..header_end]) {
        Ok(httparse::Status::Complete(_)) => {}
        Ok(httparse::Status::Partial) | Err(_) => {
            return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid));
        }
    }
    if request.version != Some(1) {
        return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid));
    }
    let method = request
        .method
        .ok_or_else(|| BoundaryFailure::new(ProblemCode::SchemaInvalid))?
        .to_owned();
    let target = request
        .path
        .ok_or_else(|| BoundaryFailure::new(ProblemCode::SchemaInvalid))?
        .to_owned();
    let mut parsed_headers = Vec::with_capacity(request.headers.len());
    for header in request.headers {
        let value = std::str::from_utf8(header.value)
            .map_err(|_| BoundaryFailure::new(ProblemCode::SchemaInvalid))?
            .trim_matches([' ', '\t'])
            .to_owned();
        parsed_headers.push((header.name.to_ascii_lowercase(), Zeroizing::new(value)));
    }

    Ok(ParsedRequest {
        method: Zeroizing::new(method),
        target: Zeroizing::new(target),
        headers: parsed_headers,
        body_prefix: Zeroizing::new(bytes[header_end..].to_vec()),
    })
}

fn request_line_len(bytes: &[u8]) -> Option<usize> {
    bytes.windows(2).position(|window| window == b"\r\n")
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|position| position + 4)
}

struct RequestContext {
    origin: String,
    content_length: usize,
    route: RouteMatch,
    bearer: Option<BearerSecret>,
}

fn validate_pre_body(
    request: &ParsedRequest,
    origin_policy: &OriginPolicy,
) -> Result<RequestContext, BoundaryFailure> {
    let hosts = request.values("host");
    if hosts.len() != 1 || hosts[0] != "127.0.0.1:17843" {
        return Err(BoundaryFailure::new(ProblemCode::HostInvalid));
    }

    let origins = request.values("origin");
    if origins.is_empty() {
        return Err(BoundaryFailure::new(ProblemCode::OriginMissing));
    }
    if origins.len() != 1 || !origin_policy.allows(origins[0]) {
        return Err(BoundaryFailure::new(ProblemCode::OriginDenied));
    }
    let origin = origins[0].to_owned();

    if request.values("authorization").len() > 1 {
        return Err(BoundaryFailure::new(ProblemCode::DuplicateHeader).with_origin(&origin));
    }
    let content_lengths = request.values("content-length");
    if content_lengths.len() > 1 {
        return Err(BoundaryFailure::new(ProblemCode::DuplicateHeader).with_origin(&origin));
    }
    if !request.values("transfer-encoding").is_empty() {
        return Err(BoundaryFailure::new(ProblemCode::TransferEncodingInvalid).with_origin(&origin));
    }
    if !request.values("content-encoding").is_empty() {
        return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid).with_origin(&origin));
    }
    let content_length = match content_lengths.first() {
        Some(value)
            if *value == "0"
                || (value
                    .as_bytes()
                    .first()
                    .is_some_and(|byte| matches!(byte, b'1'..=b'9'))
                    && value.as_bytes()[1..].iter().all(u8::is_ascii_digit)) =>
        {
            value
                .parse::<usize>()
                .map_err(|_| BoundaryFailure::new(ProblemCode::BodyTooLarge).with_origin(&origin))?
        }
        Some(_) => {
            return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid).with_origin(&origin));
        }
        None => 0,
    };
    if content_length > MAX_BODY_BYTES {
        return Err(BoundaryFailure::new(ProblemCode::BodyTooLarge).with_origin(&origin));
    }
    if request.body_prefix.len() > content_length {
        return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid).with_origin(&origin));
    }

    if request.method.as_str() == "OPTIONS" {
        let route = resolve_route(request.method.as_str(), request.target.as_str())
            .map_err(BoundaryFailure::from_route)?;
        return Ok(RequestContext {
            origin,
            content_length,
            route,
            bearer: None,
        });
    }

    let versions = request.values("x-ovp-client-version");
    if versions.len() > 1 {
        return Err(BoundaryFailure::new(ProblemCode::DuplicateHeader).with_origin(&origin));
    }
    negotiate_version(versions.first().copied())
        .map_err(|code| BoundaryFailure::new(code).with_origin(&origin))?;

    let route = resolve_route(request.method.as_str(), request.target.as_str())
        .map_err(|error| BoundaryFailure::from_route(error).with_origin(&origin))?;
    let RouteMatch::Concrete(concrete) = route else {
        unreachable!("non-OPTIONS method cannot resolve as preflight")
    };

    match concrete.contract().messages.request {
        RequestMessage::Json {
            required: true,
            media_type,
            ..
        } => {
            let content_types = request.values("content-type");
            if content_types.len() > 1 {
                return Err(BoundaryFailure::new(ProblemCode::DuplicateHeader).with_origin(&origin));
            }
            if content_types.len() != 1 || !content_types[0].eq_ignore_ascii_case(media_type) {
                return Err(
                    BoundaryFailure::new(ProblemCode::ContentTypeUnsupported).with_origin(&origin)
                );
            }
        }
        RequestMessage::None => {
            if !request.values("content-type").is_empty()
                || content_length != 0
                || !request.body_prefix.is_empty()
            {
                return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid).with_origin(&origin));
            }
        }
        RequestMessage::Json {
            required: false, ..
        } => unreachable!("closed C5 requests never declare an optional JSON body"),
    }

    if !request.values("cookie").is_empty() {
        return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid).with_origin(&origin));
    }

    let bearer = match concrete.contract().access.auth {
        AuthClass::OriginOnly => {
            if !request.values("authorization").is_empty() {
                return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid).with_origin(&origin));
            }
            None
        }
        AuthClass::Bearer => {
            let authorization = request.one("authorization").ok_or_else(|| {
                BoundaryFailure::new(ProblemCode::AuthMissing).with_origin(&origin)
            })?;
            let encoded = authorization.strip_prefix("Bearer ").ok_or_else(|| {
                BoundaryFailure::new(ProblemCode::AuthInvalid).with_origin(&origin)
            })?;
            let token = BearerSecret::from_encoded(encoded.to_owned())
                .map_err(|_| BoundaryFailure::new(ProblemCode::AuthInvalid).with_origin(&origin))?;
            Some(token)
        }
        AuthClass::Preflight => unreachable!("concrete route cannot have preflight access"),
    };

    Ok(RequestContext {
        origin,
        content_length,
        route,
        bearer,
    })
}

fn validate_preflight(
    headers: &[(String, Zeroizing<String>)],
    body_prefix: &[u8],
    route: MatchedPreflightRoute,
    content_length: usize,
) -> Result<(PreflightTarget, bool), BoundaryFailure> {
    if content_length != 0 || !body_prefix.is_empty() {
        return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid));
    }
    if [
        "authorization",
        "cookie",
        "content-type",
        "x-ovp-client-version",
    ]
    .iter()
    .any(|name| !header_values(headers, name).is_empty())
    {
        return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid));
    }

    let methods = header_values(headers, "access-control-request-method");
    if methods.len() > 1 {
        return Err(BoundaryFailure::new(ProblemCode::DuplicateHeader));
    }
    let method = methods
        .first()
        .ok_or_else(|| BoundaryFailure::new(ProblemCode::SchemaInvalid))?;
    let target = route
        .resolve_requested_method(method)
        .map_err(BoundaryFailure::from_route)?;

    let header_fields = header_values(headers, "access-control-request-headers");
    if header_fields.len() > 1 {
        return Err(BoundaryFailure::new(ProblemCode::DuplicateHeader));
    }
    let header_field = header_fields
        .first()
        .ok_or_else(|| BoundaryFailure::new(ProblemCode::SchemaInvalid))?;
    let mut seen = Vec::new();
    for header in header_field
        .split(',')
        .map(|header| header.trim_matches([' ', '\t']))
    {
        if header.is_empty() || header == "*" {
            return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid));
        }
        let lower = header.to_ascii_lowercase();
        if !PREFLIGHT_ALLOWED_HEADERS
            .iter()
            .any(|allowed| allowed.as_str().eq_ignore_ascii_case(header))
            || seen.contains(&lower)
        {
            return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid));
        }
        seen.push(lower);
    }
    if seen.len() != target.requested_headers().len()
        || !target.requested_headers().iter().all(|expected| {
            seen.iter()
                .any(|actual| expected.as_str().eq_ignore_ascii_case(actual))
        })
    {
        return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid));
    }

    let private_network = header_values(headers, "access-control-request-private-network");
    if private_network.len() > 1 {
        return Err(BoundaryFailure::new(ProblemCode::DuplicateHeader));
    }
    if private_network
        .first()
        .is_some_and(|value| *value != "true")
    {
        return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid));
    }
    Ok((target, !private_network.is_empty()))
}

async fn read_body(
    stream: &mut TcpStream,
    mut body: Zeroizing<Vec<u8>>,
    content_length: usize,
    metrics: &Arc<Metrics>,
) -> Result<Zeroizing<Vec<u8>>, BoundaryFailure> {
    if body.len() > content_length {
        return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid));
    }
    let deadline = Instant::now() + BODY_TIMEOUT;
    while body.len() < content_length {
        let remaining = content_length - body.len();
        let mut chunk = Zeroizing::new([0_u8; 1024]);
        let read_limit = remaining.min(chunk.len());
        metrics.body_reads.fetch_add(1, Ordering::SeqCst);
        let read = timeout_at(deadline, stream.read(&mut chunk[..read_limit]))
            .await
            .map_err(|_| BoundaryFailure::new(ProblemCode::BodyTimeout))?
            .map_err(|_| BoundaryFailure::new(ProblemCode::SchemaInvalid))?;
        if read == 0 {
            return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid));
        }
        body.extend_from_slice(&chunk[..read]);
    }
    Ok(body)
}

enum ValidatedBody {
    None,
    PairingChallenge(PairingChallengeRequest),
    Redeem(RedeemRequest),
    JobCreate(JobCreateRequest),
    PackAction(PackActionRequest),
}

impl ValidatedBody {
    fn into_handler_request(
        self,
        route: &MatchedConcreteRoute,
    ) -> Result<HandlerRequest, ProblemCode> {
        let parameters = route.parameters();
        match route.operation() {
            OperationId::GetHealth => match (parameters, self) {
                (PathParameters::None, Self::None) => Ok(HandlerRequest::GetHealth),
                _ => Err(ProblemCode::RuntimeUnavailable),
            },
            OperationId::CreatePairingChallenge => match (parameters, self) {
                (PathParameters::None, Self::PairingChallenge(body)) => {
                    Ok(HandlerRequest::CreatePairingChallenge { body })
                }
                _ => Err(ProblemCode::RuntimeUnavailable),
            },
            OperationId::RedeemPairingChallenge => match (parameters, self) {
                (PathParameters::CanonicalUuid(id), Self::Redeem(body)) => {
                    Ok(HandlerRequest::RedeemPairingChallenge { id, body })
                }
                _ => Err(ProblemCode::RuntimeUnavailable),
            },
            OperationId::GetCurrentPairing => match (parameters, self) {
                (PathParameters::None, Self::None) => Ok(HandlerRequest::GetCurrentPairing),
                _ => Err(ProblemCode::RuntimeUnavailable),
            },
            OperationId::RevokeCurrentPairing => match (parameters, self) {
                (PathParameters::None, Self::None) => Ok(HandlerRequest::RevokeCurrentPairing),
                _ => Err(ProblemCode::RuntimeUnavailable),
            },
            OperationId::GetRuntime => match (parameters, self) {
                (PathParameters::None, Self::None) => Ok(HandlerRequest::GetRuntime),
                _ => Err(ProblemCode::RuntimeUnavailable),
            },
            OperationId::ListEngines => match (parameters, self) {
                (PathParameters::None, Self::None) => Ok(HandlerRequest::ListEngines),
                _ => Err(ProblemCode::RuntimeUnavailable),
            },
            OperationId::ListVoices => match (parameters, self) {
                (PathParameters::None, Self::None) => Ok(HandlerRequest::ListVoices),
                _ => Err(ProblemCode::RuntimeUnavailable),
            },
            OperationId::ListPacks => match (parameters, self) {
                (PathParameters::None, Self::None) => Ok(HandlerRequest::ListPacks),
                _ => Err(ProblemCode::RuntimeUnavailable),
            },
            OperationId::CreateJob => match (parameters, self) {
                (PathParameters::None, Self::JobCreate(body)) => {
                    Ok(HandlerRequest::CreateJob { body })
                }
                _ => Err(ProblemCode::RuntimeUnavailable),
            },
            OperationId::GetJob => match (parameters, self) {
                (PathParameters::CanonicalUuid(id), Self::None) => {
                    Ok(HandlerRequest::GetJob { id })
                }
                _ => Err(ProblemCode::RuntimeUnavailable),
            },
            OperationId::CancelJob => match (parameters, self) {
                (PathParameters::CanonicalUuid(id), Self::None) => {
                    Ok(HandlerRequest::CancelJob { id })
                }
                _ => Err(ProblemCode::RuntimeUnavailable),
            },
            OperationId::GetJobAudio => match (parameters, self) {
                (PathParameters::CanonicalUuid(id), Self::None) => {
                    Ok(HandlerRequest::GetJobAudio { id })
                }
                _ => Err(ProblemCode::RuntimeUnavailable),
            },
            OperationId::RequestPackAction => match (parameters, self) {
                (PathParameters::PackId(id), Self::PackAction(body)) => {
                    Ok(HandlerRequest::RequestPackAction { id, body })
                }
                _ => Err(ProblemCode::RuntimeUnavailable),
            },
            OperationId::PreflightHealth
            | OperationId::PreflightPairingChallenges
            | OperationId::PreflightPairingChallengeRedeem
            | OperationId::PreflightCurrentPairing
            | OperationId::PreflightRuntime
            | OperationId::PreflightEngines
            | OperationId::PreflightVoices
            | OperationId::PreflightPacks
            | OperationId::PreflightJobs
            | OperationId::PreflightJob
            | OperationId::PreflightJobAudio
            | OperationId::PreflightPackActions => Err(ProblemCode::RuntimeUnavailable),
        }
    }
}

fn scrub_json_strings(value: &mut Value) {
    match value {
        Value::Object(object) => {
            for (mut key, mut child) in std::mem::take(object) {
                key.zeroize();
                scrub_json_strings(&mut child);
            }
        }
        Value::Array(array) => {
            for mut child in std::mem::take(array) {
                scrub_json_strings(&mut child);
            }
        }
        Value::String(string) => string.zeroize(),
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

fn map_schema_validation(error: SchemaError) -> ProblemCode {
    match error {
        SchemaError::InvalidInstance => ProblemCode::SchemaInvalid,
        SchemaError::InvalidDocument | SchemaError::UnknownSchema => {
            ProblemCode::RuntimeUnavailable
        }
    }
}

fn validate_json_schema(
    schemas: &OpenApiSchemas,
    schema: OwnedSchemaName,
    bytes: &[u8],
) -> Result<(), ProblemCode> {
    let mut value =
        serde_json::from_slice::<Value>(bytes).map_err(|_| ProblemCode::SchemaInvalid)?;
    let result = schemas
        .validate_owned(schema, &value)
        .map_err(map_schema_validation);
    scrub_json_strings(&mut value);
    result
}

fn validate_request_body(
    route: &MatchedConcreteRoute,
    bytes: &[u8],
    schemas: &OpenApiSchemas,
) -> Result<ValidatedBody, ProblemCode> {
    match route.contract().messages.request {
        RequestMessage::None => {
            if bytes.is_empty() {
                Ok(ValidatedBody::None)
            } else {
                Err(ProblemCode::SchemaInvalid)
            }
        }
        RequestMessage::Json {
            required: true,
            media_type: _,
            schema,
        } => {
            validate_json_schema(schemas, schema, bytes)?;
            match schema {
                OwnedSchemaName::PairingChallengeRequest => serde_json::from_slice(bytes)
                    .map(ValidatedBody::PairingChallenge)
                    .map_err(|_| ProblemCode::SchemaInvalid),
                OwnedSchemaName::RedeemRequest => serde_json::from_slice(bytes)
                    .map(ValidatedBody::Redeem)
                    .map_err(|_| ProblemCode::SchemaInvalid),
                OwnedSchemaName::JobCreateRequest => serde_json::from_slice(bytes)
                    .map(ValidatedBody::JobCreate)
                    .map_err(|_| ProblemCode::SchemaInvalid),
                OwnedSchemaName::PackActionRequest => serde_json::from_slice(bytes)
                    .map(ValidatedBody::PackAction)
                    .map_err(|_| ProblemCode::SchemaInvalid),
                _ => Err(ProblemCode::RuntimeUnavailable),
            }
        }
        RequestMessage::Json {
            required: false, ..
        } => Err(ProblemCode::RuntimeUnavailable),
    }
}
