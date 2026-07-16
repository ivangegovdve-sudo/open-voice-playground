use std::{
    io,
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use serde_json::json;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpSocket, TcpStream},
    sync::{Semaphore, oneshot},
    task::JoinHandle,
    time::{Instant, timeout, timeout_at},
};
use url::Url;
use uuid::Uuid;

use crate::{
    origin::OriginPolicy,
    protocol::{Problem, ProblemCode, negotiate_version},
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
const ALLOWED_METHODS: &str = "GET, POST, DELETE, OPTIONS";
const ALLOWED_HEADERS: &str = "Authorization, Content-Type, X-OVP-Client-Version";
const EXPOSED_HEADERS: &str = "ETag, Location, Retry-After, X-Request-Id";

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
    pub async fn start(origin_policy: OriginPolicy) -> Result<ServerHandle, ListenerError> {
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
        let accept_metrics = Arc::clone(&metrics);
        let accept_task = tokio::spawn(run_accept_loop(
            listener,
            origin_policy,
            connections,
            requests,
            Arc::clone(&accept_metrics),
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

fn map_bind_error(error: io::Error) -> ListenerError {
    if error.kind() == io::ErrorKind::AddrInUse {
        ListenerError::Conflict
    } else {
        ListenerError::Unavailable
    }
}

async fn run_accept_loop(
    listener: TcpListener,
    origin_policy: OriginPolicy,
    connections: Arc<Semaphore>,
    requests: Arc<Semaphore>,
    metrics: Arc<Metrics>,
    mut shutdown: oneshot::Receiver<()>,
) {
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
                tokio::spawn(async move {
                    let _connection_permit = connection_permit;
                    let _connection_activity = ActivityGuard::connection(Arc::clone(&connection_metrics));
                    let Ok(request_permit) = request_semaphore.try_acquire_owned() else {
                        let response = Response::problem(ProblemCode::QueueFull, 503);
                        let _ = write_response(&mut stream, response, None).await;
                        return;
                    };
                    let _request_permit = request_permit;
                    let _request_activity = ActivityGuard::request(Arc::clone(&connection_metrics));
                    let _ = handle_connection(&mut stream, &policy, &connection_metrics).await;
                });
            }
        }
    }
}

#[derive(Debug)]
struct ParsedRequest {
    method: String,
    target: String,
    headers: Vec<(String, String)>,
    body_prefix: Vec<u8>,
}

impl ParsedRequest {
    fn values(&self, name: &str) -> Vec<&str> {
        self.headers
            .iter()
            .filter(|(candidate, _)| candidate == name)
            .map(|(_, value)| value.as_str())
            .collect()
    }

    fn one(&self, name: &str) -> Option<&str> {
        let values = self.values(name);
        (values.len() == 1).then_some(values[0])
    }
}

#[derive(Debug)]
struct BoundaryFailure {
    code: ProblemCode,
    status: u16,
    origin: Option<String>,
}

impl BoundaryFailure {
    const fn new(code: ProblemCode, status: u16) -> Self {
        Self {
            code,
            status,
            origin: None,
        }
    }

    fn with_origin(mut self, origin: &str) -> Self {
        self.origin = Some(origin.to_owned());
        self
    }
}

async fn handle_connection(
    stream: &mut TcpStream,
    origin_policy: &OriginPolicy,
    metrics: &Arc<Metrics>,
) -> io::Result<()> {
    let mut parsed = match read_and_parse_headers(stream).await {
        Ok(parsed) => parsed,
        Err(failure) => {
            return write_response(
                stream,
                Response::problem(failure.code, failure.status),
                failure.origin.as_deref(),
            )
            .await;
        }
    };

    let context = match validate_pre_body(&parsed, origin_policy) {
        Ok(context) => context,
        Err(failure) => {
            return write_response(
                stream,
                Response::problem(failure.code, failure.status),
                failure.origin.as_deref(),
            )
            .await;
        }
    };

    if parsed.method == "OPTIONS" {
        let response = match validate_preflight(&parsed, &context.origin) {
            Ok(response) => response,
            Err(failure) => {
                return write_response(
                    stream,
                    Response::problem(failure.code, failure.status),
                    None,
                )
                .await;
            }
        };
        return write_response(stream, response, Some(&context.origin)).await;
    }

    let body_prefix = std::mem::take(&mut parsed.body_prefix);
    let body = match read_body(stream, body_prefix, context.content_length, metrics).await {
        Ok(body) => body,
        Err(failure) => {
            return write_response(
                stream,
                Response::problem(failure.code, failure.status),
                Some(&context.origin),
            )
            .await;
        }
    };

    let response = match timeout(HANDLER_TIMEOUT, dispatch(&parsed, &body)).await {
        Ok(response) => response,
        Err(_) => Response::problem(ProblemCode::HandlerTimeout, 504),
    };
    write_response(stream, response, Some(&context.origin)).await
}

async fn read_and_parse_headers(stream: &mut TcpStream) -> Result<ParsedRequest, BoundaryFailure> {
    let deadline = Instant::now() + HEADER_TIMEOUT;
    let mut bytes = Vec::with_capacity(1024);
    let header_end = loop {
        if let Some(end) = find_header_end(&bytes) {
            if end > MAX_HEADER_BYTES {
                return Err(BoundaryFailure::new(ProblemCode::HeadersTooLarge, 431));
            }
            break end;
        }
        if request_line_len(&bytes).is_none() && bytes.len() > MAX_REQUEST_LINE_BYTES {
            return Err(BoundaryFailure::new(ProblemCode::RequestLineTooLarge, 414));
        }
        if bytes.len() > MAX_HEADER_BYTES {
            return Err(BoundaryFailure::new(ProblemCode::HeadersTooLarge, 431));
        }
        let mut chunk = [0_u8; 1024];
        let read = timeout_at(deadline, stream.read(&mut chunk))
            .await
            .map_err(|_| BoundaryFailure::new(ProblemCode::HeaderTimeout, 408))?
            .map_err(|_| BoundaryFailure::new(ProblemCode::SchemaInvalid, 400))?;
        if read == 0 {
            return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid, 400));
        }
        bytes.extend_from_slice(&chunk[..read]);
        if let Some(line_len) = request_line_len(&bytes)
            && line_len > MAX_REQUEST_LINE_BYTES
        {
            return Err(BoundaryFailure::new(ProblemCode::RequestLineTooLarge, 414));
        }
    };

    let mut headers = [httparse::EMPTY_HEADER; 128];
    let mut request = httparse::Request::new(&mut headers);
    match request.parse(&bytes[..header_end]) {
        Ok(httparse::Status::Complete(_)) => {}
        Ok(httparse::Status::Partial) | Err(_) => {
            return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid, 400));
        }
    }
    if request.version != Some(1) {
        return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid, 400));
    }
    let method = request
        .method
        .ok_or_else(|| BoundaryFailure::new(ProblemCode::SchemaInvalid, 400))?
        .to_owned();
    let target = request
        .path
        .ok_or_else(|| BoundaryFailure::new(ProblemCode::SchemaInvalid, 400))?
        .to_owned();
    let mut parsed_headers = Vec::with_capacity(request.headers.len());
    for header in request.headers {
        let value = std::str::from_utf8(header.value)
            .map_err(|_| BoundaryFailure::new(ProblemCode::SchemaInvalid, 400))?
            .trim_matches([' ', '\t'])
            .to_owned();
        parsed_headers.push((header.name.to_ascii_lowercase(), value));
    }

    Ok(ParsedRequest {
        method,
        target,
        headers: parsed_headers,
        body_prefix: bytes[header_end..].to_vec(),
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
}

fn validate_pre_body(
    request: &ParsedRequest,
    origin_policy: &OriginPolicy,
) -> Result<RequestContext, BoundaryFailure> {
    let hosts = request.values("host");
    if hosts.len() != 1 || hosts[0] != "127.0.0.1:17843" {
        return Err(BoundaryFailure::new(ProblemCode::HostInvalid, 400));
    }
    validate_target_authority(&request.target)?;

    let origins = request.values("origin");
    if origins.is_empty() {
        return Err(BoundaryFailure::new(ProblemCode::OriginMissing, 400));
    }
    if origins.len() != 1 || !origin_policy.allows(origins[0]) {
        return Err(BoundaryFailure::new(ProblemCode::OriginDenied, 403));
    }
    let origin = origins[0].to_owned();

    if request.values("authorization").len() > 1 {
        return Err(BoundaryFailure::new(ProblemCode::DuplicateHeader, 400).with_origin(&origin));
    }
    let content_lengths = request.values("content-length");
    if content_lengths.len() > 1 {
        return Err(BoundaryFailure::new(ProblemCode::DuplicateHeader, 400).with_origin(&origin));
    }
    if !request.values("transfer-encoding").is_empty() {
        return Err(
            BoundaryFailure::new(ProblemCode::TransferEncodingInvalid, 400).with_origin(&origin),
        );
    }
    let content_length = match content_lengths.first() {
        Some(value) if !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()) => {
            value.parse::<usize>().map_err(|_| {
                BoundaryFailure::new(ProblemCode::BodyTooLarge, 413).with_origin(&origin)
            })?
        }
        Some(_) => {
            return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid, 400).with_origin(&origin));
        }
        None => 0,
    };
    if content_length > MAX_BODY_BYTES {
        return Err(BoundaryFailure::new(ProblemCode::BodyTooLarge, 413).with_origin(&origin));
    }

    if request.method == "OPTIONS" {
        return Ok(RequestContext {
            origin,
            content_length,
        });
    }

    let versions = request.values("x-ovp-client-version");
    if versions.len() > 1 {
        return Err(BoundaryFailure::new(ProblemCode::DuplicateHeader, 400).with_origin(&origin));
    }
    negotiate_version(versions.first().copied()).map_err(|code| {
        BoundaryFailure::new(
            code,
            if code == ProblemCode::VersionMissing {
                400
            } else {
                426
            },
        )
        .with_origin(&origin)
    })?;

    if !matches!(request.method.as_str(), "GET" | "POST" | "DELETE") {
        return Err(BoundaryFailure::new(ProblemCode::MethodNotAllowed, 405).with_origin(&origin));
    }
    if request.method == "POST" {
        let content_types = request.values("content-type");
        if content_types.len() != 1
            || !matches!(
                content_types[0].to_ascii_lowercase().as_str(),
                "application/json" | "application/json; charset=utf-8"
            )
        {
            return Err(
                BoundaryFailure::new(ProblemCode::ContentTypeUnsupported, 415).with_origin(&origin),
            );
        }
    } else if content_length != 0 {
        return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid, 400).with_origin(&origin));
    }

    if is_protected_route(&request.method, &request.target) {
        let authorization = request.one("authorization").ok_or_else(|| {
            BoundaryFailure::new(ProblemCode::AuthMissing, 401).with_origin(&origin)
        })?;
        if !authorization.starts_with("Bearer ") || authorization.len() != 50 {
            return Err(BoundaryFailure::new(ProblemCode::AuthInvalid, 401).with_origin(&origin));
        }
        return Err(BoundaryFailure::new(ProblemCode::AuthInvalid, 401).with_origin(&origin));
    }

    Ok(RequestContext {
        origin,
        content_length,
    })
}

fn validate_target_authority(target: &str) -> Result<(), BoundaryFailure> {
    if target.starts_with('/') {
        return Ok(());
    }
    let url =
        Url::parse(target).map_err(|_| BoundaryFailure::new(ProblemCode::HostInvalid, 400))?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(LISTENER_PORT)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(BoundaryFailure::new(ProblemCode::HostInvalid, 400));
    }
    Ok(())
}

fn is_protected_route(method: &str, target: &str) -> bool {
    let path = target.split('?').next().unwrap_or(target);
    let public = (method == "GET" && path == "/v1/health")
        || (method == "POST" && path == "/v1/pairings/challenges")
        || (method == "POST"
            && path.starts_with("/v1/pairings/challenges/")
            && path.ends_with("/redeem"));
    !public
}

fn validate_preflight(request: &ParsedRequest, _origin: &str) -> Result<Response, BoundaryFailure> {
    let methods = request.values("access-control-request-method");
    if methods.len() != 1 || !matches!(methods[0], "GET" | "POST" | "DELETE" | "OPTIONS") {
        return Err(BoundaryFailure::new(ProblemCode::OriginDenied, 403));
    }

    let requested_headers = request.values("access-control-request-headers");
    if requested_headers.len() > 1 {
        return Err(BoundaryFailure::new(ProblemCode::OriginDenied, 403));
    }
    if let Some(value) = requested_headers.first() {
        let mut seen = Vec::new();
        for header in value.split(',').map(str::trim) {
            let lower = header.to_ascii_lowercase();
            if !matches!(
                lower.as_str(),
                "authorization" | "content-type" | "x-ovp-client-version"
            ) || seen.contains(&lower)
            {
                return Err(BoundaryFailure::new(ProblemCode::OriginDenied, 403));
            }
            seen.push(lower);
        }
    }

    let private_network = request.values("access-control-request-private-network");
    if private_network.len() > 1
        || private_network
            .first()
            .is_some_and(|value| *value != "true")
    {
        return Err(BoundaryFailure::new(ProblemCode::OriginDenied, 403));
    }
    Ok(Response::preflight(!private_network.is_empty()))
}

async fn read_body(
    stream: &mut TcpStream,
    mut body: Vec<u8>,
    content_length: usize,
    metrics: &Arc<Metrics>,
) -> Result<Vec<u8>, BoundaryFailure> {
    if body.len() > content_length {
        return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid, 400));
    }
    let deadline = Instant::now() + BODY_TIMEOUT;
    while body.len() < content_length {
        let remaining = content_length - body.len();
        let mut chunk = [0_u8; 1024];
        let read_limit = remaining.min(chunk.len());
        metrics.body_reads.fetch_add(1, Ordering::SeqCst);
        let read = timeout_at(deadline, stream.read(&mut chunk[..read_limit]))
            .await
            .map_err(|_| BoundaryFailure::new(ProblemCode::BodyTimeout, 408))?
            .map_err(|_| BoundaryFailure::new(ProblemCode::SchemaInvalid, 400))?;
        if read == 0 {
            return Err(BoundaryFailure::new(ProblemCode::SchemaInvalid, 400));
        }
        body.extend_from_slice(&chunk[..read]);
    }
    Ok(body)
}

async fn dispatch(request: &ParsedRequest, body: &[u8]) -> Response {
    let path = request.target.split('?').next().unwrap_or(&request.target);
    match (request.method.as_str(), path) {
        ("GET", "/v1/health") => Response::json(
            200,
            json!({
                "app": "open-voice-companion",
                "protocolMajor": 1,
                "listenerState": "listening"
            }),
        ),
        ("POST", "/v1/pairings/challenges") => {
            if serde_json::from_slice::<serde_json::Value>(body).is_err() {
                Response::problem(ProblemCode::SchemaInvalid, 400)
            } else {
                Response::problem(ProblemCode::PairingNotFound, 404)
            }
        }
        _ => Response::problem(ProblemCode::ResourceNotFound, 404),
    }
}

struct Response {
    status: u16,
    content_type: Option<&'static str>,
    body: Vec<u8>,
    headers: Vec<(&'static str, String)>,
    request_id: Uuid,
}

impl Response {
    fn json(status: u16, body: serde_json::Value) -> Self {
        Self {
            status,
            content_type: Some("application/json"),
            body: serde_json::to_vec(&body).expect("serializing static response cannot fail"),
            headers: Vec::new(),
            request_id: Uuid::new_v4(),
        }
    }

    fn problem(code: ProblemCode, status: u16) -> Self {
        let problem = Problem::new(code, status);
        let request_id = problem.request_id;
        Self {
            status,
            content_type: Some("application/problem+json"),
            body: serde_json::to_vec(&problem).expect("serializing Problem cannot fail"),
            headers: Vec::new(),
            request_id,
        }
    }

    fn preflight(private_network: bool) -> Self {
        let mut headers = vec![
            ("Access-Control-Allow-Methods", ALLOWED_METHODS.to_owned()),
            ("Access-Control-Allow-Headers", ALLOWED_HEADERS.to_owned()),
            ("Access-Control-Max-Age", "600".to_owned()),
            (
                "Vary",
                "Origin, Access-Control-Request-Method, Access-Control-Request-Headers".to_owned(),
            ),
        ];
        if private_network {
            headers.push(("Access-Control-Allow-Private-Network", "true".to_owned()));
            headers[3]
                .1
                .push_str(", Access-Control-Request-Private-Network");
        }
        Self {
            status: 204,
            content_type: None,
            body: Vec::new(),
            headers,
            request_id: Uuid::new_v4(),
        }
    }
}

async fn write_response(
    stream: &mut TcpStream,
    response: Response,
    origin: Option<&str>,
) -> io::Result<()> {
    let mut bytes = format!(
        "HTTP/1.1 {} {}\r\nConnection: close\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Request-Id: {}\r\n",
        response.status,
        reason_phrase(response.status),
        response.body.len(),
        response.request_id
    );
    if let Some(content_type) = response.content_type {
        bytes.push_str(&format!("Content-Type: {content_type}\r\n"));
    }
    if let Some(origin) = origin {
        bytes.push_str(&format!("Access-Control-Allow-Origin: {origin}\r\n"));
        bytes.push_str(&format!(
            "Access-Control-Expose-Headers: {EXPOSED_HEADERS}\r\n"
        ));
        if !response.headers.iter().any(|(name, _)| *name == "Vary") {
            bytes.push_str("Vary: Origin\r\n");
        }
    }
    for (name, value) in response.headers {
        bytes.push_str(name);
        bytes.push_str(": ");
        bytes.push_str(&value);
        bytes.push_str("\r\n");
    }
    bytes.push_str("\r\n");
    stream.write_all(bytes.as_bytes()).await?;
    stream.write_all(&response.body).await?;
    stream.shutdown().await
}

const fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        409 => "Conflict",
        410 => "Gone",
        413 => "Payload Too Large",
        414 => "URI Too Long",
        415 => "Unsupported Media Type",
        426 => "Upgrade Required",
        429 => "Too Many Requests",
        431 => "Request Header Fields Too Large",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Error",
    }
}
