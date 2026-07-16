use std::{
    future::Future,
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
    io::{AsyncRead, AsyncReadExt},
    net::{TcpListener, TcpStream},
    sync::{OwnedSemaphorePermit, Semaphore, oneshot, watch},
    task::{JoinHandle, JoinSet},
    time::{Instant, sleep_until},
};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::{
    http_dispatch::{
        AuthError, AuthPermit, AuthPort, AuthRequest, HandlerContext, HandlerError, HandlerPort,
        HandlerRequest, OwnershipTarget, RequestObservedAt,
    },
    http_response::{PreparedResponse, ResponseFactory, ValidatedOrigin, write_prepared},
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
pub const FIXED_LISTENER_ADDR: SocketAddrV4 = SocketAddrV4::new(Ipv4Addr::LOCALHOST, LISTENER_PORT);
pub const LISTENER_BACKLOG: u32 = 32;
pub const MAX_CONNECTIONS: usize = 32;
pub const MAX_ACTIVE_HANDLERS: usize = 8;
pub const MAX_REQUEST_LINE_BYTES: usize = 2 * 1024;
pub const MAX_HEADER_BYTES: usize = 8 * 1024;
pub const MAX_BODY_BYTES: usize = 16 * 1024;
pub const HEADER_TIMEOUT: Duration = Duration::from_secs(5);
pub const BODY_IDLE_TIMEOUT: Duration = Duration::from_secs(10);
pub const BODY_OVERALL_TIMEOUT: Duration = Duration::from_secs(30);
pub const HANDLER_TIMEOUT: Duration = Duration::from_secs(30);
pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ListenerError {
    #[error("the fixed loopback port is already in use")]
    Conflict,
    #[error("the fixed loopback listener is unavailable")]
    Unavailable,
}

pub trait FixedListenerPort: Send + Sync {
    fn bind_fixed(&self) -> Result<TcpListener, ListenerError>;
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ServerMetrics {
    pub active_connections: usize,
    pub peak_connections: usize,
    pub tracked_connection_tasks: usize,
    pub occupied_handler_slots: usize,
    pub peak_handler_slots: usize,
    pub rejected_connections: usize,
    pub rejected_handlers: usize,
    pub body_reads: usize,
}

#[derive(Default)]
struct Metrics {
    active_connections: AtomicUsize,
    peak_connections: AtomicUsize,
    tracked_connection_tasks: AtomicUsize,
    occupied_handler_slots: AtomicUsize,
    peak_handler_slots: AtomicUsize,
    rejected_connections: AtomicUsize,
    rejected_handlers: AtomicUsize,
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

    fn task_started(&self) {
        self.tracked_connection_tasks.fetch_add(1, Ordering::SeqCst);
    }

    fn task_finished(&self) {
        self.tracked_connection_tasks.fetch_sub(1, Ordering::SeqCst);
    }

    fn handler_started(&self) {
        let current = self.occupied_handler_slots.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak_handler_slots.fetch_max(current, Ordering::SeqCst);
    }

    fn handler_finished(&self) {
        self.occupied_handler_slots.fetch_sub(1, Ordering::SeqCst);
    }

    fn snapshot(&self) -> ServerMetrics {
        ServerMetrics {
            active_connections: self.active_connections.load(Ordering::SeqCst),
            peak_connections: self.peak_connections.load(Ordering::SeqCst),
            tracked_connection_tasks: self.tracked_connection_tasks.load(Ordering::SeqCst),
            occupied_handler_slots: self.occupied_handler_slots.load(Ordering::SeqCst),
            peak_handler_slots: self.peak_handler_slots.load(Ordering::SeqCst),
            rejected_connections: self.rejected_connections.load(Ordering::SeqCst),
            rejected_handlers: self.rejected_handlers.load(Ordering::SeqCst),
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
    Task,
    Handler,
}

impl ActivityGuard {
    fn connection(metrics: Arc<Metrics>) -> Self {
        metrics.connection_started();
        Self {
            metrics,
            kind: ActivityKind::Connection,
        }
    }

    fn task(metrics: Arc<Metrics>) -> Self {
        metrics.task_started();
        Self {
            metrics,
            kind: ActivityKind::Task,
        }
    }

    fn handler(metrics: Arc<Metrics>) -> Self {
        metrics.handler_started();
        Self {
            metrics,
            kind: ActivityKind::Handler,
        }
    }
}

impl Drop for ActivityGuard {
    fn drop(&mut self) {
        match self.kind {
            ActivityKind::Connection => self.metrics.connection_finished(),
            ActivityKind::Task => self.metrics.task_finished(),
            ActivityKind::Handler => self.metrics.handler_finished(),
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
    listener: Arc<dyn FixedListenerPort>,
}

impl ServerPorts {
    pub fn new(
        handler: Arc<dyn HandlerPort>,
        auth: Arc<dyn AuthPort>,
        rate: Arc<dyn RateLimitPort>,
        clock: Arc<dyn Clock>,
        listener: Arc<dyn FixedListenerPort>,
    ) -> Self {
        Self {
            handler,
            auth,
            rate,
            clock,
            listener,
        }
    }
}

pub struct ServerHandle {
    local_addr: SocketAddr,
    metrics: Arc<Metrics>,
    shutdown: Option<oneshot::Sender<()>>,
    supervisor_task: Option<JoinHandle<ServerMetrics>>,
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

    pub async fn shutdown(mut self) -> ServerMetrics {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        self.supervisor_task
            .take()
            .expect("server supervisor handle is present")
            .await
            .unwrap_or_else(|_| panic!("server supervisor failed"))
    }
}

impl Drop for ServerHandle {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(task) = self.supervisor_task.take() {
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
        let listener = ports.listener.bind_fixed()?;
        let local_addr = listener
            .local_addr()
            .map_err(|_| ListenerError::Unavailable)?;
        if local_addr != SocketAddr::V4(FIXED_LISTENER_ADDR) {
            return Err(ListenerError::Unavailable);
        }

        let metrics = Arc::new(Metrics::default());
        let connections = Arc::new(Semaphore::new(MAX_CONNECTIONS));
        let handlers = Arc::new(Semaphore::new(MAX_ACTIVE_HANDLERS));
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let supervisor_task = tokio::spawn(run_accept_loop(
            listener,
            AcceptLoopContext {
                origin_policy,
                connections,
                handlers,
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
            supervisor_task: Some(supervisor_task),
        })
    }
}

struct AcceptLoopContext {
    origin_policy: OriginPolicy,
    connections: Arc<Semaphore>,
    handlers: Arc<Semaphore>,
    metrics: Arc<Metrics>,
    ports: ServerPorts,
    schemas: Arc<OpenApiSchemas>,
    responses: Arc<ResponseFactory>,
}

async fn run_accept_loop(
    listener: TcpListener,
    context: AcceptLoopContext,
    mut shutdown: oneshot::Receiver<()>,
) -> ServerMetrics {
    let AcceptLoopContext {
        origin_policy,
        connections,
        handlers,
        metrics,
        ports,
        schemas,
        responses,
    } = context;
    let (cancel_tx, _) = watch::channel(false);
    let mut connection_tasks = JoinSet::new();
    loop {
        tokio::select! {
            biased;
            _ = &mut shutdown => break,
            _ = connection_tasks.join_next(), if !connection_tasks.is_empty() => {}
            accepted = listener.accept() => {
                let Ok((stream, peer)) = accepted else { break };
                if !peer_is_admissible(peer) {
                    let _ = stream.set_zero_linger();
                    continue;
                }
                let Ok(connection_permit) = Arc::clone(&connections).try_acquire_owned() else {
                    metrics.rejected_connections.fetch_add(1, Ordering::SeqCst);
                    let _ = stream.set_zero_linger();
                    continue;
                };
                let admitted_at = Instant::now();
                let policy = origin_policy.clone();
                let handler_semaphore = Arc::clone(&handlers);
                let connection_metrics = Arc::clone(&metrics);
                let connection_ports = ports.clone();
                let connection_schemas = Arc::clone(&schemas);
                let connection_responses = Arc::clone(&responses);
                let cancel_rx = cancel_tx.subscribe();
                let guards = ConnectionTaskGuards {
                    _permit: connection_permit,
                    _connection: ActivityGuard::connection(Arc::clone(&connection_metrics)),
                    _task: ActivityGuard::task(Arc::clone(&connection_metrics)),
                };
                let stream = ShutdownStreamGuard::new(stream, cancel_rx.clone());
                connection_tasks.spawn(async move {
                    let _guards = guards;
                    let mut stream = stream;
                    let operation_cancel = cancel_rx.clone();
                    let _ = cancel_on_shutdown(
                        cancel_rx,
                        handle_connection(
                            stream.stream_mut(),
                            ConnectionContext {
                                admitted_at,
                                cancel: &operation_cancel,
                                handler_slots: &handler_semaphore,
                                origin_policy: &policy,
                                metrics: &connection_metrics,
                                ports: &connection_ports,
                                schemas: &connection_schemas,
                                responses: &connection_responses,
                            },
                        ),
                    )
                    .await;
                });
            }
        }
    }

    drop(listener);
    let cancelled_at = Instant::now();
    cancel_tx.send_replace(true);
    drain_connection_tasks(&mut connection_tasks, cancelled_at + SHUTDOWN_GRACE).await;
    drop(cancel_tx);
    let final_metrics = metrics.snapshot();
    assert_eq!(
        final_metrics.active_connections, 0,
        "server shutdown left active connections"
    );
    assert_eq!(
        final_metrics.tracked_connection_tasks, 0,
        "server shutdown left tracked connection tasks"
    );
    assert_eq!(
        final_metrics.occupied_handler_slots, 0,
        "server shutdown left occupied handler slots"
    );
    final_metrics
}

fn peer_is_admissible(peer: SocketAddr) -> bool {
    peer.is_ipv4() && peer.ip().is_loopback()
}

async fn drain_connection_tasks(connection_tasks: &mut JoinSet<()>, grace_deadline: Instant) {
    while !connection_tasks.is_empty() {
        tokio::select! {
            biased;
            _ = sleep_until(grace_deadline) => {
                connection_tasks.shutdown().await;
                break;
            }
            _ = connection_tasks.join_next() => {}
        }
    }
}

struct ConnectionTaskGuards {
    _connection: ActivityGuard,
    _task: ActivityGuard,
    _permit: OwnedSemaphorePermit,
}

struct ShutdownStreamGuard {
    stream: TcpStream,
    cancel: watch::Receiver<bool>,
}

impl ShutdownStreamGuard {
    const fn new(stream: TcpStream, cancel: watch::Receiver<bool>) -> Self {
        Self { stream, cancel }
    }

    fn stream_mut(&mut self) -> &mut TcpStream {
        &mut self.stream
    }
}

impl Drop for ShutdownStreamGuard {
    fn drop(&mut self) {
        if cancellation_requested(&self.cancel) {
            let _ = self.stream.set_zero_linger();
        }
    }
}

fn cancellation_requested(cancel: &watch::Receiver<bool>) -> bool {
    if cancel.has_changed().is_err() {
        true
    } else {
        *cancel.borrow()
    }
}

async fn wait_for_shutdown(mut cancel: watch::Receiver<bool>) {
    if cancellation_requested(&cancel) {
        return;
    }
    loop {
        match cancel.changed().await {
            Ok(()) if *cancel.borrow() => return,
            Ok(()) => {}
            Err(_) => return,
        }
    }
}

async fn cancel_on_shutdown<F>(cancel: watch::Receiver<bool>, future: F) -> Option<F::Output>
where
    F: Future,
{
    tokio::pin!(future);
    tokio::select! {
        biased;
        _ = wait_for_shutdown(cancel) => None,
        result = &mut future => Some(result),
    }
}

struct ParsedRequest {
    method: Zeroizing<String>,
    target: Zeroizing<String>,
    headers: Vec<(String, Zeroizing<String>)>,
    body_prefix: Zeroizing<Vec<u8>>,
}

type HeadBuffer = [u8; MAX_HEADER_BYTES + 1];

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
    cancel: &watch::Receiver<bool>,
    responses: &ResponseFactory,
    target: ActualProblemTarget<'_>,
    code: ProblemCode,
    retry_after: Option<RetryAfterSeconds>,
) -> io::Result<()> {
    let ActualProblemTarget {
        origin,
        operation,
        allow,
    } = target;
    let origin = origin.map(|origin| ValidatedOrigin::from_allowed(origin.to_owned()));
    let response = responses
        .actual_problem(origin.as_ref(), operation, allow, code, retry_after)
        .unwrap_or_else(|_| responses.fallback_actual(origin.as_ref(), operation, allow));
    write_prepared_cancellable(stream, cancel, response).await
}

#[derive(Clone, Copy)]
struct ActualProblemTarget<'a> {
    origin: Option<&'a str>,
    operation: Option<OperationId>,
    allow: Option<AllowSet>,
}

impl<'a> ActualProblemTarget<'a> {
    const fn new(
        origin: Option<&'a str>,
        operation: Option<OperationId>,
        allow: Option<AllowSet>,
    ) -> Self {
        Self {
            origin,
            operation,
            allow,
        }
    }
}

async fn write_preflight_problem(
    stream: &mut TcpStream,
    cancel: &watch::Receiver<bool>,
    responses: &ResponseFactory,
    operation: Option<OperationId>,
    allow: Option<AllowSet>,
    code: ProblemCode,
    retry_after: Option<RetryAfterSeconds>,
) -> io::Result<()> {
    let response = responses
        .preflight_problem(operation, allow, code, retry_after)
        .unwrap_or_else(|_| responses.fallback_preflight(operation, allow));
    write_prepared_cancellable(stream, cancel, response).await
}

async fn write_prepared_cancellable(
    stream: &mut TcpStream,
    cancel: &watch::Receiver<bool>,
    response: PreparedResponse,
) -> io::Result<()> {
    if cancellation_requested(cancel) {
        return Ok(());
    }
    match cancel_on_shutdown(cancel.clone(), write_prepared(stream, response)).await {
        Some(result) => result,
        None => Ok(()),
    }
}

struct ConnectionContext<'a> {
    admitted_at: Instant,
    cancel: &'a watch::Receiver<bool>,
    handler_slots: &'a Arc<Semaphore>,
    origin_policy: &'a OriginPolicy,
    metrics: &'a Arc<Metrics>,
    ports: &'a ServerPorts,
    schemas: &'a OpenApiSchemas,
    responses: &'a ResponseFactory,
}

async fn handle_connection(
    stream: &mut TcpStream,
    context: ConnectionContext<'_>,
) -> io::Result<()> {
    let ConnectionContext {
        admitted_at,
        cancel,
        handler_slots,
        origin_policy,
        metrics,
        ports,
        schemas,
        responses,
    } = context;
    let mut parsed = match read_and_parse_headers(stream, admitted_at).await {
        Ok(parsed) => parsed,
        Err(failure) => {
            return write_actual_problem(
                stream,
                cancel,
                responses,
                ActualProblemTarget::new(failure.origin.as_deref(), None, failure.allow),
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
                write_preflight_problem(
                    stream,
                    cancel,
                    responses,
                    None,
                    failure.allow,
                    failure.code,
                    None,
                )
                .await
            } else {
                write_actual_problem(
                    stream,
                    cancel,
                    responses,
                    ActualProblemTarget::new(failure.origin.as_deref(), None, failure.allow),
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
                    cancel,
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
        return write_prepared_cancellable(stream, cancel, response).await;
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
                cancel,
                responses,
                ActualProblemTarget::new(Some(&origin), Some(route.operation()), None),
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
                cancel,
                responses,
                ActualProblemTarget::new(Some(&origin), Some(route.operation()), None),
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
                cancel,
                responses,
                ActualProblemTarget::new(Some(&origin), Some(route.operation()), None),
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
                cancel,
                responses,
                ActualProblemTarget::new(Some(&origin), Some(route.operation()), None),
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
                cancel,
                responses,
                ActualProblemTarget::new(Some(&origin), Some(route.operation()), None),
                code,
                None,
            )
            .await;
        }
    };
    let handler_permit = match Arc::clone(handler_slots).try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            metrics.rejected_handlers.fetch_add(1, Ordering::SeqCst);
            drop(auth_permit);
            drop(rate_permit);
            let delay = RetryAfterSeconds::new(1).expect("the fixed admission delay is in range");
            return write_actual_problem(
                stream,
                cancel,
                responses,
                ActualProblemTarget::new(Some(&origin), Some(route.operation()), None),
                ProblemCode::QueueFull,
                Some(delay),
            )
            .await;
        }
    };

    let handler_result = {
        let _handler_permit = handler_permit;
        let _handler_activity = ActivityGuard::handler(Arc::clone(metrics));
        if cancellation_requested(cancel) {
            return Ok(());
        }
        let pairing = match auth_permit {
            Some(permit) => match permit.commit().await {
                Ok(pairing) => Some(pairing),
                Err(error) => {
                    drop(_handler_activity);
                    drop(_handler_permit);
                    return write_actual_problem(
                        stream,
                        cancel,
                        responses,
                        ActualProblemTarget::new(Some(&origin), Some(route.operation()), None),
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
        if cancellation_requested(cancel) {
            return Ok(());
        }
        let handler_context = HandlerContext::new(
            origin.clone(),
            RequestObservedAt::new(monotonic, utc),
            pairing,
        );
        run_handler_with_deadline(ports.handler.handle(handler_context, request)).await
    };

    let prepared = match handler_result {
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
        Err(DeadlineElapsed) => {
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
    write_prepared_cancellable(stream, cancel, prepared).await
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct DeadlineElapsed;

async fn run_handler_with_deadline<F>(future: F) -> Result<F::Output, DeadlineElapsed>
where
    F: Future,
{
    deadline_first(Instant::now() + HANDLER_TIMEOUT, future).await
}

async fn deadline_first<F>(deadline: Instant, future: F) -> Result<F::Output, DeadlineElapsed>
where
    F: Future,
{
    tokio::pin!(future);
    let sleep = sleep_until(deadline);
    tokio::pin!(sleep);
    tokio::select! {
        biased;
        _ = &mut sleep => Err(DeadlineElapsed),
        output = &mut future => Ok(output),
    }
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

async fn read_and_parse_headers<R>(
    stream: &mut R,
    admitted_at: Instant,
) -> Result<ParsedRequest, BoundaryFailure>
where
    R: AsyncRead + Unpin,
{
    let deadline = admitted_at + HEADER_TIMEOUT;
    let mut bytes: Zeroizing<HeadBuffer> = Zeroizing::new([0_u8; MAX_HEADER_BYTES + 1]);
    let mut bytes_len = 0;
    let header_end = loop {
        let received = &bytes[..bytes_len];
        if request_line_exceeds_limit(received) {
            return Err(BoundaryFailure::new(ProblemCode::RequestLineTooLarge));
        }
        if let Some(end) = find_header_end(received) {
            if end > MAX_HEADER_BYTES {
                return Err(BoundaryFailure::new(ProblemCode::HeadersTooLarge));
            }
            break end;
        }
        if bytes_len > MAX_HEADER_BYTES {
            return Err(BoundaryFailure::new(ProblemCode::HeadersTooLarge));
        }
        let remaining_budget = MAX_HEADER_BYTES + 1 - bytes_len;
        let read_limit = remaining_budget.min(1024);
        let read = deadline_first(
            deadline,
            stream.read(&mut bytes[bytes_len..bytes_len + read_limit]),
        )
        .await
        .map_err(|_| BoundaryFailure::new(ProblemCode::HeaderTimeout))?
        .map_err(|_| BoundaryFailure::new(ProblemCode::SchemaInvalid))?;
        if read == 0 {
            return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid));
        }
        bytes_len += read;
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
        body_prefix: Zeroizing::new(bytes[header_end..bytes_len].to_vec()),
    })
}

fn request_line_len(bytes: &[u8]) -> Option<usize> {
    bytes.windows(2).position(|window| window == b"\r\n")
}

fn request_line_exceeds_limit(bytes: &[u8]) -> bool {
    match request_line_len(bytes) {
        Some(length) => length > MAX_REQUEST_LINE_BYTES,
        None => {
            let possible_half_terminator = usize::from(bytes.last() == Some(&b'\r'));
            bytes.len().saturating_sub(possible_half_terminator) > MAX_REQUEST_LINE_BYTES
        }
    }
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

async fn read_body<R>(
    stream: &mut R,
    mut body: Zeroizing<Vec<u8>>,
    content_length: usize,
    metrics: &Arc<Metrics>,
) -> Result<Zeroizing<Vec<u8>>, BoundaryFailure>
where
    R: AsyncRead + Unpin,
{
    if body.len() > content_length {
        return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid));
    }
    let body_started_at = Instant::now();
    let mut idle_deadline = body_started_at + BODY_IDLE_TIMEOUT;
    let overall_deadline = body_started_at + BODY_OVERALL_TIMEOUT;
    while body.len() < content_length {
        let remaining = content_length - body.len();
        let mut chunk = Zeroizing::new([0_u8; 1024]);
        let read_limit = remaining.min(chunk.len());
        metrics.body_reads.fetch_add(1, Ordering::SeqCst);
        let idle_sleep = sleep_until(idle_deadline);
        let overall_sleep = sleep_until(overall_deadline);
        tokio::pin!(idle_sleep);
        tokio::pin!(overall_sleep);
        let read = tokio::select! {
            biased;
            _ = &mut overall_sleep => {
                return Err(BoundaryFailure::new(ProblemCode::BodyTimeout));
            }
            _ = &mut idle_sleep => {
                return Err(BoundaryFailure::new(ProblemCode::BodyTimeout));
            }
            read = stream.read(&mut chunk[..read_limit]) => {
                read.map_err(|_| BoundaryFailure::new(ProblemCode::SchemaInvalid))?
            }
        };
        if read == 0 {
            return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid));
        }
        body.extend_from_slice(&chunk[..read]);
        idle_deadline = Instant::now() + BODY_IDLE_TIMEOUT;
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

#[cfg(test)]
mod c9_deadline_tests {
    use std::{
        future::pending,
        net::{Ipv4Addr, Ipv6Addr, SocketAddr},
        pin::Pin,
        sync::{
            Arc,
            atomic::{AtomicBool, AtomicUsize, Ordering},
        },
        task::{Context, Poll},
        time::Duration,
    };

    use tokio::{
        io::{AsyncRead, AsyncWriteExt, ReadBuf, duplex},
        task::JoinSet,
        time::{advance, sleep, sleep_until},
    };
    use zeroize::Zeroizing;

    use super::{
        BODY_IDLE_TIMEOUT, BODY_OVERALL_TIMEOUT, DeadlineElapsed, HANDLER_TIMEOUT, HEADER_TIMEOUT,
        HeadBuffer, Metrics, OriginPolicy, ProblemCode, SHUTDOWN_GRACE, cancel_on_shutdown,
        deadline_first, drain_connection_tasks, peer_is_admissible, read_and_parse_headers,
        read_body, run_handler_with_deadline, validate_pre_body,
    };

    struct DropFlag(Arc<AtomicBool>);

    impl Drop for DropFlag {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    struct RecordingReader {
        bytes: Vec<u8>,
        cursor: usize,
        bytes_read: Arc<AtomicUsize>,
    }

    #[test]
    fn c9_only_ipv4_loopback_peers_are_admissible() {
        assert!(peer_is_admissible(SocketAddr::from((
            Ipv4Addr::LOCALHOST,
            42_000,
        ))));
        assert!(!peer_is_admissible(SocketAddr::from((
            Ipv4Addr::new(192, 0, 2, 1),
            42_000,
        ))));
        assert!(!peer_is_admissible(SocketAddr::from((
            Ipv6Addr::LOCALHOST,
            42_000,
        ))));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn c9_connection_metrics_drop_before_capacity_is_republished() {
        for _ in 0..2_000 {
            let metrics = Arc::new(Metrics::default());
            let semaphore = Arc::new(tokio::sync::Semaphore::new(1));
            let permit = Arc::clone(&semaphore).try_acquire_owned().unwrap();
            let guards = super::ConnectionTaskGuards {
                _connection: super::ActivityGuard::connection(Arc::clone(&metrics)),
                _task: super::ActivityGuard::task(Arc::clone(&metrics)),
                _permit: permit,
            };
            let waiter_metrics = Arc::clone(&metrics);
            let waiter_semaphore = Arc::clone(&semaphore);
            let waiter = tokio::spawn(async move {
                let _permit = waiter_semaphore.acquire_owned().await.unwrap();
                waiter_metrics.snapshot()
            });
            tokio::task::yield_now().await;

            drop(guards);
            let snapshot = waiter.await.unwrap();
            assert_eq!(snapshot.active_connections, 0);
            assert_eq!(snapshot.tracked_connection_tasks, 0);
            assert_eq!(snapshot.peak_connections, 1);
        }
    }

    impl AsyncRead for RecordingReader {
        fn poll_read(
            mut self: Pin<&mut Self>,
            _context: &mut Context<'_>,
            buffer: &mut ReadBuf<'_>,
        ) -> Poll<std::io::Result<()>> {
            let remaining = &self.bytes[self.cursor..];
            if remaining.is_empty() {
                return Poll::Ready(Ok(()));
            }
            let read = remaining.len().min(buffer.remaining());
            buffer.put_slice(&remaining[..read]);
            self.cursor += read;
            self.bytes_read.fetch_add(read, Ordering::SeqCst);
            Poll::Ready(Ok(()))
        }
    }

    #[tokio::test(start_paused = true)]
    async fn c9_header_deadline_is_absolute_at_4_999_and_5_000() {
        let admitted_at = tokio::time::Instant::now();
        let (mut writer, mut reader) = duplex(64);
        writer.write_all(b"G").await.unwrap();
        let task =
            tokio::spawn(async move { read_and_parse_headers(&mut reader, admitted_at).await });
        tokio::task::yield_now().await;

        advance(Duration::from_secs(4)).await;
        writer.write_all(b"E").await.unwrap();
        tokio::task::yield_now().await;
        advance(Duration::from_millis(999)).await;
        tokio::task::yield_now().await;
        assert!(!task.is_finished(), "header expired before 4.999 seconds");

        advance(Duration::from_millis(1)).await;
        let failure = match task.await.unwrap() {
            Ok(_) => panic!("partial header completed"),
            Err(failure) => failure,
        };
        assert_eq!(failure.code, ProblemCode::HeaderTimeout);
        assert_eq!(HEADER_TIMEOUT, Duration::from_secs(5));
    }

    #[tokio::test(start_paused = true)]
    async fn c9_request_line_2048_with_trailing_half_crlf_remains_admissible() {
        let admitted_at = tokio::time::Instant::now();
        let (mut writer, mut reader) = duplex(4_096);
        let mut prefix = vec![b'G'; 2_048];
        prefix.push(b'\r');
        writer.write_all(&prefix).await.unwrap();
        let task =
            tokio::spawn(async move { read_and_parse_headers(&mut reader, admitted_at).await });
        tokio::task::yield_now().await;
        assert!(
            !task.is_finished(),
            "a trailing CR was counted as a 2,049-byte request line"
        );

        writer.write_all(b"\n\r\n").await.unwrap();
        let result = task.await.unwrap();
        if let Err(failure) = result {
            assert_ne!(failure.code, ProblemCode::RequestLineTooLarge);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn c9_head_reader_never_consumes_beyond_the_8193_sentinel() {
        let bytes_read = Arc::new(AtomicUsize::new(0));
        let mut bytes = b"GET /v1/health HTTP/1.1\r\n".to_vec();
        bytes.resize(10_000, b'X');
        let mut reader = RecordingReader {
            bytes,
            cursor: 0,
            bytes_read: Arc::clone(&bytes_read),
        };
        let result = read_and_parse_headers(&mut reader, tokio::time::Instant::now()).await;
        let failure = match result {
            Ok(_) => panic!("unterminated oversized head completed"),
            Err(failure) => failure,
        };
        assert_eq!(failure.code, ProblemCode::HeadersTooLarge);
        assert_eq!(
            std::mem::size_of::<HeadBuffer>(),
            8_193,
            "the fixed zeroizing head buffer is exactly max plus one sentinel"
        );
        assert!(
            bytes_read.load(Ordering::SeqCst) <= 8_193,
            "head reader consumed beyond its one-byte sentinel"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn c9_body_prefix_exact_overdeclared_and_early_eof_are_closed() {
        let raw = concat!(
            "POST /v1/pairings/challenges HTTP/1.1\r\n",
            "Host: 127.0.0.1:17843\r\n",
            "Origin: http://127.0.0.1:5173\r\n",
            "X-OVP-Client-Version: 1.0.0\r\n",
            "Content-Type: application/json\r\n",
            "Content-Length: 2\r\n\r\n{}"
        );
        let bytes_read = Arc::new(AtomicUsize::new(0));
        let mut reader = RecordingReader {
            bytes: raw.as_bytes().to_vec(),
            cursor: 0,
            bytes_read,
        };
        let mut parsed = read_and_parse_headers(&mut reader, tokio::time::Instant::now())
            .await
            .expect("co-read exact body prefix parses");
        assert_eq!(parsed.body_prefix.as_slice(), b"{}");
        let context = validate_pre_body(&parsed, &OriginPolicy::debug_local())
            .expect("exact declared prefix passes framing");
        let metrics = Arc::new(Metrics::default());
        let mut eof = RecordingReader {
            bytes: Vec::new(),
            cursor: 0,
            bytes_read: Arc::new(AtomicUsize::new(0)),
        };
        let body = read_body(
            &mut eof,
            std::mem::take(&mut parsed.body_prefix),
            context.content_length,
            &metrics,
        )
        .await
        .expect("an exact co-read prefix needs no later byte");
        assert_eq!(body.as_slice(), b"{}");
        assert_eq!(metrics.snapshot().body_reads, 0);

        let over = format!("{raw}X");
        let mut reader = RecordingReader {
            bytes: over.into_bytes(),
            cursor: 0,
            bytes_read: Arc::new(AtomicUsize::new(0)),
        };
        let parsed = read_and_parse_headers(&mut reader, tokio::time::Instant::now())
            .await
            .expect("co-read over-declaration reaches framing validation");
        assert_eq!(parsed.body_prefix.as_slice(), b"{}X");
        let failure = match validate_pre_body(&parsed, &OriginPolicy::debug_local()) {
            Ok(_) => panic!("one co-read byte beyond the declaration was accepted"),
            Err(failure) => failure,
        };
        assert_eq!(failure.code, ProblemCode::SchemaInvalid);

        let metrics = Arc::new(Metrics::default());
        let mut eof = RecordingReader {
            bytes: Vec::new(),
            cursor: 0,
            bytes_read: Arc::new(AtomicUsize::new(0)),
        };
        let failure = match read_body(&mut eof, Zeroizing::new(Vec::new()), 1, &metrics).await {
            Ok(_) => panic!("EOF before the declared byte count completed"),
            Err(failure) => failure,
        };
        assert_eq!(failure.code, ProblemCode::SchemaInvalid);
        assert_eq!(metrics.snapshot().body_reads, 1);
    }

    #[tokio::test(start_paused = true)]
    async fn c9_body_idle_resets_before_10_but_expires_at_10() {
        let (mut writer, mut reader) = duplex(64);
        let metrics = Arc::new(Metrics::default());
        let task = tokio::spawn(async move {
            read_body(&mut reader, Zeroizing::new(Vec::new()), 2, &metrics).await
        });
        tokio::task::yield_now().await;

        advance(Duration::from_secs(9)).await;
        writer.write_all(&[1]).await.unwrap();
        tokio::task::yield_now().await;
        advance(Duration::from_secs(1)).await;
        tokio::task::yield_now().await;
        assert!(
            !task.is_finished(),
            "body idle deadline did not reset after positive progress"
        );

        advance(Duration::from_millis(8_999)).await;
        tokio::task::yield_now().await;
        assert!(
            !task.is_finished(),
            "body expired before 9.999 idle seconds"
        );
        advance(Duration::from_millis(1)).await;
        let failure = match task.await.unwrap() {
            Ok(_) => panic!("incomplete body completed"),
            Err(failure) => failure,
        };
        assert_eq!(failure.code, ProblemCode::BodyTimeout);
        assert_eq!(BODY_IDLE_TIMEOUT, Duration::from_secs(10));
    }

    #[tokio::test(start_paused = true)]
    async fn c9_body_overall_expires_at_30_despite_trickle() {
        let (mut writer, mut reader) = duplex(64);
        let metrics = Arc::new(Metrics::default());
        let task = tokio::spawn(async move {
            read_body(&mut reader, Zeroizing::new(Vec::new()), 4, &metrics).await
        });
        tokio::task::yield_now().await;

        for elapsed in [9_u64, 18, 27] {
            let now = tokio::time::Instant::now();
            let target = now + Duration::from_secs(9);
            advance(target.saturating_duration_since(now)).await;
            tokio::task::yield_now().await;
            assert!(
                !task.is_finished(),
                "body expired before overall deadline at {elapsed} seconds"
            );
            writer.write_all(&[elapsed as u8]).await.unwrap();
            tokio::task::yield_now().await;
        }

        advance(Duration::from_millis(2_999)).await;
        tokio::task::yield_now().await;
        assert!(!task.is_finished(), "body expired before 29.999 seconds");
        advance(Duration::from_millis(1)).await;
        let failure = match task.await.unwrap() {
            Ok(_) => panic!("incomplete trickle body completed"),
            Err(failure) => failure,
        };
        assert_eq!(failure.code, ProblemCode::BodyTimeout);
        assert_eq!(BODY_OVERALL_TIMEOUT, Duration::from_secs(30));
    }

    #[tokio::test(start_paused = true)]
    async fn c9_deadline_first_wins_simultaneous_handler_completion_at_30() {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        let result = deadline_first(deadline, async move {
            sleep_until(deadline).await;
            7_u8
        })
        .await;
        assert_eq!(result, Err(DeadlineElapsed));
    }

    #[tokio::test(start_paused = true)]
    async fn c9_handler_timeout_drops_future_metric_and_permit_at_30() {
        let handler_future_dropped = Arc::new(AtomicBool::new(false));
        let semaphore = Arc::new(tokio::sync::Semaphore::new(1));
        let permit = Arc::clone(&semaphore).try_acquire_owned().unwrap();
        let metrics = Arc::new(Metrics::default());
        let activity = super::ActivityGuard::handler(Arc::clone(&metrics));
        let dropped = Arc::clone(&handler_future_dropped);
        let task = tokio::spawn(async move {
            let _permit = permit;
            let _activity = activity;
            let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
            deadline_first(deadline, async move {
                let _drop = DropFlag(dropped);
                pending::<()>().await;
            })
            .await
        });
        tokio::task::yield_now().await;
        assert_eq!(metrics.snapshot().occupied_handler_slots, 1);

        advance(Duration::from_millis(29_999)).await;
        tokio::task::yield_now().await;
        assert!(!task.is_finished());
        assert!(!handler_future_dropped.load(Ordering::SeqCst));
        assert_eq!(semaphore.available_permits(), 0);

        advance(Duration::from_millis(1)).await;
        assert_eq!(task.await.unwrap(), Err(DeadlineElapsed));
        assert!(handler_future_dropped.load(Ordering::SeqCst));
        assert_eq!(metrics.snapshot().occupied_handler_slots, 0);
        assert_eq!(semaphore.available_permits(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn c9_handler_clock_starts_after_preprocessing_finishes() {
        advance(Duration::from_secs(120)).await;
        let task = tokio::spawn(run_handler_with_deadline(pending::<u8>()));
        tokio::task::yield_now().await;

        advance(Duration::from_millis(29_999)).await;
        tokio::task::yield_now().await;
        assert!(
            !task.is_finished(),
            "preprocessing time leaked into the handler deadline"
        );
        advance(Duration::from_millis(1)).await;
        assert_eq!(task.await.unwrap(), Err(DeadlineElapsed));
        assert_eq!(HANDLER_TIMEOUT, Duration::from_secs(30));
    }

    #[tokio::test(start_paused = true)]
    async fn c9_shutdown_wins_handler_at_29_999_and_30_000_without_timeout_mapping() {
        let dropped = Arc::new(AtomicBool::new(false));
        let timeout_mapped = Arc::new(AtomicBool::new(false));
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        let future_dropped = Arc::clone(&dropped);
        let mapped = Arc::clone(&timeout_mapped);
        let task = tokio::spawn(async move {
            cancel_on_shutdown(cancel_rx, async move {
                let outcome = run_handler_with_deadline(async move {
                    let _drop = DropFlag(future_dropped);
                    pending::<u8>().await
                })
                .await;
                mapped.store(outcome.is_err(), Ordering::SeqCst);
                outcome
            })
            .await
        });
        tokio::task::yield_now().await;
        advance(Duration::from_millis(29_999)).await;
        tokio::task::yield_now().await;
        assert!(!task.is_finished());
        cancel_tx.send_replace(true);
        assert_eq!(task.await.unwrap(), None, "shutdown lost at 29.999 s");
        assert!(dropped.load(Ordering::SeqCst));
        assert!(!timeout_mapped.load(Ordering::SeqCst));

        let dropped = Arc::new(AtomicBool::new(false));
        let timeout_mapped = Arc::new(AtomicBool::new(false));
        let probe = DropFlag(Arc::clone(&dropped));
        let mapped = Arc::clone(&timeout_mapped);
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        cancel_tx.send_replace(true);
        let ready_deadline = tokio::time::Instant::now();
        let result = cancel_on_shutdown(cancel_rx, async move {
            let outcome = deadline_first(ready_deadline, async move {
                let _probe = probe;
                pending::<u8>().await
            })
            .await;
            mapped.store(outcome.is_err(), Ordering::SeqCst);
            outcome
        })
        .await;
        assert_eq!(result, None, "shutdown lost at the simultaneous boundary");
        assert!(dropped.load(Ordering::SeqCst));
        assert!(!timeout_mapped.load(Ordering::SeqCst));
    }

    #[tokio::test(start_paused = true)]
    async fn c9_shutdown_grace_allows_1_999_and_forces_at_2_000() {
        let cooperative_finished = Arc::new(AtomicBool::new(false));
        let straggler_dropped = Arc::new(AtomicBool::new(false));
        let mut tasks = JoinSet::new();
        let cooperative_flag = Arc::clone(&cooperative_finished);
        tasks.spawn(async move {
            sleep(Duration::from_millis(1_999)).await;
            cooperative_flag.store(true, Ordering::SeqCst);
        });
        let straggler_flag = Arc::clone(&straggler_dropped);
        tasks.spawn(async move {
            let _drop = DropFlag(straggler_flag);
            pending::<()>().await;
        });
        let drain = tokio::spawn(async move {
            let deadline = tokio::time::Instant::now() + SHUTDOWN_GRACE;
            drain_connection_tasks(&mut tasks, deadline).await;
            tasks.len()
        });
        tokio::task::yield_now().await;

        advance(Duration::from_millis(1_999)).await;
        tokio::task::yield_now().await;
        assert!(cooperative_finished.load(Ordering::SeqCst));
        assert!(!straggler_dropped.load(Ordering::SeqCst));
        assert!(!drain.is_finished());

        advance(Duration::from_millis(1)).await;
        assert_eq!(drain.await.unwrap(), 0);
        assert!(straggler_dropped.load(Ordering::SeqCst));
        assert_eq!(SHUTDOWN_GRACE, Duration::from_secs(2));
    }

    #[tokio::test(start_paused = true)]
    async fn c9_retained_cancellation_drops_a_not_yet_completed_operation() {
        let dropped = Arc::new(AtomicBool::new(false));
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        let operation_drop = Arc::clone(&dropped);
        let task = tokio::spawn(async move {
            cancel_on_shutdown(cancel_rx, async move {
                let _drop = DropFlag(operation_drop);
                pending::<()>().await;
            })
            .await
        });
        tokio::task::yield_now().await;
        cancel_tx.send_replace(true);
        assert_eq!(task.await.unwrap(), None);
        assert!(dropped.load(Ordering::SeqCst));
    }

    #[tokio::test(start_paused = true)]
    async fn c9_retained_cancellation_wins_before_first_poll_and_ready_deadline() {
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        cancel_tx.send_replace(true);
        let deadline = tokio::time::Instant::now();
        let result = cancel_on_shutdown(cancel_rx, deadline_first(deadline, async { 7_u8 })).await;
        assert_eq!(result, None);
    }
}
