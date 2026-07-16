use std::{
    collections::BTreeMap,
    net::SocketAddr,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use async_trait::async_trait;
use open_voice_companion::{
    http_dispatch::{
        AuthError, AuthPermit, AuthPort, AuthRequest, AuthenticatedPairing, EntityTag,
        HandlerContext, HandlerError, HandlerPort, HandlerRequest, HandlerSuccess,
        ResponseLocation, WavBody,
    },
    origin::OriginPolicy,
    pairing::PairingRecord,
    protocol::{
        CanonicalUuid, EngineListResponse, HealthResponse, JobResponse, PackActionResponse,
        PackListResponse, PairingChallengeResponse, PairingResponse, RedeemResponse,
        RuntimeResponse, VoiceListResponse,
    },
    rate::{
        RateClass, RateLimitError, RateLimitPort, RatePermit, RateRequest, RateSubject,
        RetryAfterSeconds,
    },
    scheduler::Clock,
    server::{
        CompanionServer, FIXED_LISTENER_ADDR, FixedListenerPort, LISTENER_BACKLOG, ListenerError,
        ServerPorts,
    },
};
use serde::{Deserialize, de::DeserializeOwned};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpSocket, TcpStream},
    sync::{Notify, Semaphore},
    time::{sleep, timeout},
};

const GOOD_ORIGIN: &str = "http://127.0.0.1:5173";
const PROTOCOL_CORPUS: &str = include_str!("../../openapi/fixtures/protocol-corpus.json");
static FIXED_PORT: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct BoundaryFixedListener;

impl FixedListenerPort for BoundaryFixedListener {
    fn bind_fixed(&self) -> Result<TcpListener, ListenerError> {
        let socket = TcpSocket::new_v4().map_err(|_| ListenerError::Unavailable)?;
        socket
            .bind(SocketAddr::V4(FIXED_LISTENER_ADDR))
            .map_err(|_| ListenerError::Conflict)?;
        socket
            .listen(LISTENER_BACKLOG)
            .map_err(|_| ListenerError::Unavailable)
    }
}

struct SmallSendBufferFixedListener;

impl FixedListenerPort for SmallSendBufferFixedListener {
    fn bind_fixed(&self) -> Result<TcpListener, ListenerError> {
        let socket = TcpSocket::new_v4().map_err(|_| ListenerError::Unavailable)?;
        socket
            .set_send_buffer_size(1_024)
            .map_err(|_| ListenerError::Unavailable)?;
        socket
            .bind(SocketAddr::V4(FIXED_LISTENER_ADDR))
            .map_err(|_| ListenerError::Conflict)?;
        socket
            .listen(LISTENER_BACKLOG)
            .map_err(|_| ListenerError::Unavailable)
    }
}

fn fixed_listener_port() -> Arc<dyn FixedListenerPort> {
    Arc::new(BoundaryFixedListener)
}

#[derive(Deserialize)]
struct RequestCorpus {
    cases: Vec<RequestCorpusCase>,
}

#[derive(Deserialize)]
struct RequestCorpusCase {
    id: String,
    schema: String,
    valid: bool,
    value: serde_json::Value,
}

#[derive(Default)]
struct BoundaryState {
    auth_reservations: AtomicUsize,
    auth_commits: AtomicUsize,
    rate_reservations: AtomicUsize,
    rate_commits: AtomicUsize,
    handler_calls: AtomicUsize,
    monotonic_calls: AtomicUsize,
    utc_calls: AtomicUsize,
    rate_requests: Mutex<Vec<(RateClass, RateSubject)>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct BoundarySnapshot {
    auth_reservations: usize,
    auth_commits: usize,
    rate_reservations: usize,
    rate_commits: usize,
    handler_calls: usize,
    monotonic_calls: usize,
    utc_calls: usize,
    rate_requests: usize,
}

impl BoundaryState {
    fn snapshot(&self) -> BoundarySnapshot {
        BoundarySnapshot {
            auth_reservations: self.auth_reservations.load(Ordering::SeqCst),
            auth_commits: self.auth_commits.load(Ordering::SeqCst),
            rate_reservations: self.rate_reservations.load(Ordering::SeqCst),
            rate_commits: self.rate_commits.load(Ordering::SeqCst),
            handler_calls: self.handler_calls.load(Ordering::SeqCst),
            monotonic_calls: self.monotonic_calls.load(Ordering::SeqCst),
            utc_calls: self.utc_calls.load(Ordering::SeqCst),
            rate_requests: self.rate_requests.lock().unwrap().len(),
        }
    }
}

struct BoundaryAuth {
    state: Arc<BoundaryState>,
    accept: bool,
}

struct BoundaryAuthPermit {
    state: Arc<BoundaryState>,
    pairing: PairingRecord,
}

struct BlockingCommitAuth {
    state: Arc<BoundaryState>,
    entered: Arc<AtomicUsize>,
    release: Arc<Notify>,
}

struct BlockingCommitAuthPermit {
    state: Arc<BoundaryState>,
    pairing: PairingRecord,
    entered: Arc<AtomicUsize>,
    release: Arc<Notify>,
}

#[async_trait]
impl AuthPermit for BoundaryAuthPermit {
    fn pairing_id(&self) -> uuid::Uuid {
        self.pairing.id
    }

    async fn commit(self: Box<Self>) -> Result<AuthenticatedPairing, AuthError> {
        self.state.auth_commits.fetch_add(1, Ordering::SeqCst);
        Ok(AuthenticatedPairing::from_record(self.pairing))
    }
}

#[async_trait]
impl AuthPermit for BlockingCommitAuthPermit {
    fn pairing_id(&self) -> uuid::Uuid {
        self.pairing.id
    }

    async fn commit(self: Box<Self>) -> Result<AuthenticatedPairing, AuthError> {
        self.entered.fetch_add(1, Ordering::SeqCst);
        self.release.notified().await;
        self.state.auth_commits.fetch_add(1, Ordering::SeqCst);
        Ok(AuthenticatedPairing::from_record(self.pairing))
    }
}

#[async_trait]
impl AuthPort for BoundaryAuth {
    async fn reserve(&self, request: AuthRequest) -> Result<Box<dyn AuthPermit>, AuthError> {
        self.state.auth_reservations.fetch_add(1, Ordering::SeqCst);
        if !self.accept {
            return Err(AuthError::Invalid);
        }
        let (token, origin, _scope, _ownership, now) = request.into_parts();
        assert_eq!(token.expose().len(), 43);
        Ok(Box::new(BoundaryAuthPermit {
            state: Arc::clone(&self.state),
            pairing: PairingRecord {
                id: uuid::Uuid::from_u128(0xc8),
                origin,
                client_label: "HTTP boundary fake".to_owned(),
                scopes: Vec::new(),
                created_at: now,
                last_used_at: now,
            },
        }))
    }
}

#[async_trait]
impl AuthPort for BlockingCommitAuth {
    async fn reserve(&self, request: AuthRequest) -> Result<Box<dyn AuthPermit>, AuthError> {
        self.state.auth_reservations.fetch_add(1, Ordering::SeqCst);
        let (token, origin, _scope, _ownership, now) = request.into_parts();
        assert_eq!(token.expose().len(), 43);
        Ok(Box::new(BlockingCommitAuthPermit {
            state: Arc::clone(&self.state),
            pairing: PairingRecord {
                id: uuid::Uuid::from_u128(0xc9),
                origin,
                client_label: "C9 blocking commit fake".to_owned(),
                scopes: Vec::new(),
                created_at: now,
                last_used_at: now,
            },
            entered: Arc::clone(&self.entered),
            release: Arc::clone(&self.release),
        }))
    }
}

struct BoundaryRate {
    state: Arc<BoundaryState>,
    error: Option<RateLimitError>,
}

struct BoundaryRatePermit {
    state: Arc<BoundaryState>,
}

impl RatePermit for BoundaryRatePermit {
    fn commit(self: Box<Self>) {
        self.state.rate_commits.fetch_add(1, Ordering::SeqCst);
    }
}

impl RateLimitPort for BoundaryRate {
    fn reserve(&self, request: RateRequest) -> Result<Box<dyn RatePermit>, RateLimitError> {
        self.state.rate_reservations.fetch_add(1, Ordering::SeqCst);
        self.state
            .rate_requests
            .lock()
            .unwrap()
            .push((request.class(), request.subject().clone()));
        if let Some(error) = self.error {
            return Err(error);
        }
        Ok(Box::new(BoundaryRatePermit {
            state: Arc::clone(&self.state),
        }))
    }
}

struct BoundaryClock {
    state: Arc<BoundaryState>,
}

impl Clock for BoundaryClock {
    fn monotonic(&self) -> Instant {
        self.state.monotonic_calls.fetch_add(1, Ordering::SeqCst);
        Instant::now()
    }

    fn utc(&self) -> time::OffsetDateTime {
        self.state.utc_calls.fetch_add(1, Ordering::SeqCst);
        time::OffsetDateTime::now_utc()
    }
}

struct BoundaryHandler {
    state: Arc<BoundaryState>,
}

#[async_trait]
impl HandlerPort for BoundaryHandler {
    async fn handle(
        &self,
        _context: HandlerContext,
        request: HandlerRequest,
    ) -> Result<HandlerSuccess, HandlerError> {
        self.state.handler_calls.fetch_add(1, Ordering::SeqCst);
        match request {
            HandlerRequest::GetHealth => Ok(HandlerSuccess::Health(HealthResponse::listening())),
            HandlerRequest::CreatePairingChallenge { .. } => Err(HandlerError::PairingNotFound),
            _ => Err(HandlerError::ResourceNotFound),
        }
    }
}

fn decode<T: DeserializeOwned>(value: serde_json::Value) -> T {
    serde_json::from_value(value).expect("checked response fixture")
}

fn pairing_response() -> PairingResponse {
    decode(serde_json::json!({
        "id": "55555555-5555-4555-8555-555555555555",
        "clientLabel": "HTTP boundary fake",
        "scopes": [
            "health:read",
            "runtime:read",
            "synthesis:create",
            "jobs:read",
            "jobs:cancel",
            "audio:read",
            "packs:request"
        ],
        "createdAt": "2026-01-02T03:04:05Z",
        "lastUsedAt": "2026-01-02T03:04:05Z"
    }))
}

fn job_response() -> JobResponse {
    decode(serde_json::json!({
        "id": "66666666-6666-4666-8666-666666666666",
        "voiceId": "pocket:alba",
        "state": "queued",
        "audioAvailable": false,
        "createdAt": "2026-01-02T03:04:05Z"
    }))
}

struct SuccessHandler {
    redeem_pending: bool,
}

#[async_trait]
impl HandlerPort for SuccessHandler {
    async fn handle(
        &self,
        _context: HandlerContext,
        request: HandlerRequest,
    ) -> Result<HandlerSuccess, HandlerError> {
        let etag = |value: &str| EntityTag::new(value.to_owned()).unwrap();
        let location = |value: &str| ResponseLocation::new(value.to_owned()).unwrap();
        match request {
            HandlerRequest::GetHealth => Ok(HandlerSuccess::Health(HealthResponse::listening())),
            HandlerRequest::CreatePairingChallenge { body: _ } => {
                let body: PairingChallengeResponse = decode(serde_json::json!({
                    "id": "11111111-1111-4111-8111-111111111111",
                    "state": "pending",
                    "expiresAt": "2026-01-02T03:06:05Z"
                }));
                Ok(HandlerSuccess::PairingChallengeCreated {
                    body,
                    location: location("/v1/pairings/challenges/opaque"),
                })
            }
            HandlerRequest::RedeemPairingChallenge { id: _, body: _ } => {
                if self.redeem_pending {
                    Ok(HandlerSuccess::RedeemPending {
                        retry_after: RetryAfterSeconds::new(2).unwrap(),
                    })
                } else {
                    let body: RedeemResponse = decode(serde_json::json!({
                        "token": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                        "pairing": {
                            "id": "55555555-5555-4555-8555-555555555555",
                            "clientLabel": "HTTP boundary fake",
                            "scopes": [
                                "health:read",
                                "runtime:read",
                                "synthesis:create",
                                "jobs:read",
                                "jobs:cancel",
                                "audio:read",
                                "packs:request"
                            ],
                            "createdAt": "2026-01-02T03:04:05Z",
                            "lastUsedAt": "2026-01-02T03:04:05Z"
                        }
                    }));
                    Ok(HandlerSuccess::RedeemComplete(body))
                }
            }
            HandlerRequest::GetCurrentPairing => {
                Ok(HandlerSuccess::CurrentPairing(pairing_response()))
            }
            HandlerRequest::RevokeCurrentPairing => Ok(HandlerSuccess::PairingRevoked),
            HandlerRequest::GetRuntime => Ok(HandlerSuccess::Runtime {
                body: RuntimeResponse::non_operational(),
                etag: etag("\"runtime-v1\""),
            }),
            HandlerRequest::ListEngines => Ok(HandlerSuccess::Engines {
                body: EngineListResponse::non_operational(),
                etag: etag("\"engines-v1\""),
            }),
            HandlerRequest::ListVoices => Ok(HandlerSuccess::Voices {
                body: VoiceListResponse::non_operational(),
                etag: etag("\"voices-v1\""),
            }),
            HandlerRequest::ListPacks => Ok(HandlerSuccess::Packs {
                body: PackListResponse::non_operational(),
                etag: etag("\"packs-v1\""),
            }),
            HandlerRequest::CreateJob { body: _ } => Ok(HandlerSuccess::JobCreated {
                body: job_response(),
                location: location("/v1/jobs/opaque"),
            }),
            HandlerRequest::GetJob { id: _ } => Ok(HandlerSuccess::Job(job_response())),
            HandlerRequest::CancelJob { id: _ } => {
                Ok(HandlerSuccess::JobCancellationAccepted(job_response()))
            }
            HandlerRequest::GetJobAudio { id: _ } => Ok(HandlerSuccess::JobAudio {
                body: WavBody::new(vec![0, 0xff, b'R', b'I', b'F', b'F', 0x80]).unwrap(),
                etag: etag("\"audio-v1\""),
            }),
            HandlerRequest::RequestPackAction { id: _, body } => {
                Ok(HandlerSuccess::PackActionAccepted {
                    body: PackActionResponse::pending(
                        uuid::Uuid::from_u128(0x7777).into(),
                        body.into_action(),
                    ),
                    location: location("/v1/pack-actions/opaque"),
                })
            }
        }
    }
}

struct ErrorHandler(HandlerError);

#[async_trait]
impl HandlerPort for ErrorHandler {
    async fn handle(
        &self,
        _context: HandlerContext,
        _request: HandlerRequest,
    ) -> Result<HandlerSuccess, HandlerError> {
        Err(self.0)
    }
}

struct BlockingHealthHandler {
    state: Arc<BoundaryState>,
    entered: Arc<Notify>,
    release: Arc<Notify>,
}

struct SaturatingHandler {
    state: Arc<BoundaryState>,
    release: Arc<Semaphore>,
}

struct PanicHandler;

#[async_trait]
impl HandlerPort for PanicHandler {
    async fn handle(
        &self,
        _context: HandlerContext,
        _request: HandlerRequest,
    ) -> Result<HandlerSuccess, HandlerError> {
        panic!("controlled C9 handler panic")
    }
}

struct LargeWavHandler {
    calls: Arc<AtomicUsize>,
}

#[async_trait]
impl HandlerPort for LargeWavHandler {
    async fn handle(
        &self,
        _context: HandlerContext,
        request: HandlerRequest,
    ) -> Result<HandlerSuccess, HandlerError> {
        assert!(matches!(request, HandlerRequest::GetJobAudio { .. }));
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(HandlerSuccess::JobAudio {
            body: WavBody::new(vec![0x55; 64 * 1024 * 1024]).unwrap(),
            etag: EntityTag::new("\"large-c9-writer\"".to_owned()).unwrap(),
        })
    }
}

#[async_trait]
impl HandlerPort for SaturatingHandler {
    async fn handle(
        &self,
        _context: HandlerContext,
        _request: HandlerRequest,
    ) -> Result<HandlerSuccess, HandlerError> {
        self.state.handler_calls.fetch_add(1, Ordering::SeqCst);
        self.release
            .acquire()
            .await
            .expect("release semaphore remains open")
            .forget();
        Err(HandlerError::ResourceNotFound)
    }
}

#[async_trait]
impl HandlerPort for BlockingHealthHandler {
    async fn handle(
        &self,
        _context: HandlerContext,
        request: HandlerRequest,
    ) -> Result<HandlerSuccess, HandlerError> {
        assert!(matches!(request, HandlerRequest::GetHealth));
        self.state.handler_calls.fetch_add(1, Ordering::SeqCst);
        self.entered.notify_one();
        self.release.notified().await;
        Ok(HandlerSuccess::Health(HealthResponse::listening()))
    }
}

struct WireErrorCase {
    handler: Arc<dyn HandlerPort>,
    raw: Vec<u8>,
    status: &'static str,
    retry_after: Option<&'static str>,
}

struct CorpusHandler {
    state: Arc<BoundaryState>,
    schemas: Arc<Mutex<Vec<&'static str>>>,
}

#[async_trait]
impl HandlerPort for CorpusHandler {
    async fn handle(
        &self,
        _context: HandlerContext,
        request: HandlerRequest,
    ) -> Result<HandlerSuccess, HandlerError> {
        let schema = match request {
            HandlerRequest::CreatePairingChallenge { body: _ } => "PairingChallengeRequest",
            HandlerRequest::RedeemPairingChallenge { id: _, body: _ } => "RedeemRequest",
            HandlerRequest::CreateJob { body: _ } => "JobCreateRequest",
            HandlerRequest::RequestPackAction { id: _, body: _ } => "PackActionRequest",
            _ => panic!("request corpus reached the wrong typed handler variant"),
        };
        self.state.handler_calls.fetch_add(1, Ordering::SeqCst);
        self.schemas.lock().unwrap().push(schema);
        Err(HandlerError::ResourceNotFound)
    }
}

fn ports_with_handler(
    handler: Arc<dyn HandlerPort>,
    rate_error: Option<RateLimitError>,
) -> (ServerPorts, Arc<BoundaryState>) {
    let state = Arc::new(BoundaryState::default());
    let ports = ServerPorts::new(
        handler,
        Arc::new(BoundaryAuth {
            state: Arc::clone(&state),
            accept: true,
        }),
        Arc::new(BoundaryRate {
            state: Arc::clone(&state),
            error: rate_error,
        }),
        Arc::new(BoundaryClock {
            state: Arc::clone(&state),
        }),
        fixed_listener_port(),
    );
    (ports, state)
}

fn test_ports(accept_auth: bool) -> (ServerPorts, Arc<BoundaryState>) {
    test_ports_with_rate(accept_auth, None)
}

fn test_ports_with_rate(
    accept_auth: bool,
    rate_error: Option<RateLimitError>,
) -> (ServerPorts, Arc<BoundaryState>) {
    let state = Arc::new(BoundaryState::default());
    let ports = ServerPorts::new(
        Arc::new(BoundaryHandler {
            state: Arc::clone(&state),
        }),
        Arc::new(BoundaryAuth {
            state: Arc::clone(&state),
            accept: accept_auth,
        }),
        Arc::new(BoundaryRate {
            state: Arc::clone(&state),
            error: rate_error,
        }),
        Arc::new(BoundaryClock {
            state: Arc::clone(&state),
        }),
        fixed_listener_port(),
    );
    (ports, state)
}

fn request(method: &str, target: &str, extra: &str) -> String {
    format!(
        "{method} {target} HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nX-OVP-Client-Version: 1.0.0\r\n{extra}\r\n"
    )
}

async fn roundtrip(raw: impl AsRef<[u8]>) -> String {
    String::from_utf8(roundtrip_bytes(raw).await).unwrap()
}

async fn roundtrip_bytes(raw: impl AsRef<[u8]>) -> Vec<u8> {
    let mut stream = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, 17_843))
        .await
        .unwrap();
    stream.write_all(raw.as_ref()).await.unwrap();
    let mut response = Vec::new();
    timeout(Duration::from_secs(2), stream.read_to_end(&mut response))
        .await
        .expect("server must close one-request connection")
        .unwrap();
    response
}

async fn wait_until(mut predicate: impl FnMut() -> bool) {
    timeout(Duration::from_secs(2), async {
        while !predicate() {
            tokio::task::yield_now().await;
            sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("bounded state transition");
}

async fn assert_closed_without_bytes(stream: &mut TcpStream) {
    let mut byte = [0_u8; 1];
    match timeout(Duration::from_millis(500), stream.read(&mut byte)).await {
        Ok(Ok(0)) => {}
        Ok(Err(error))
            if matches!(
                error.kind(),
                std::io::ErrorKind::ConnectionReset
                    | std::io::ErrorKind::ConnectionAborted
                    | std::io::ErrorKind::BrokenPipe
            ) => {}
        Ok(Ok(read)) => panic!("shutdown peer wrote {read} response byte(s)"),
        Ok(Err(error)) => panic!("unexpected shutdown read failure: {error:?}"),
        Err(_) => panic!("shutdown peer remained open"),
    }
}

async fn assert_eventually_closed(stream: &mut TcpStream) {
    timeout(Duration::from_secs(2), async {
        let mut bytes = [0_u8; 8 * 1024];
        loop {
            match stream.read(&mut bytes).await {
                Ok(0) => return,
                Ok(_) => {}
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::ConnectionReset
                            | std::io::ErrorKind::ConnectionAborted
                            | std::io::ErrorKind::BrokenPipe
                    ) =>
                {
                    return;
                }
                Err(error) => panic!("unexpected shutdown read failure: {error:?}"),
            }
        }
    })
    .await
    .expect("shutdown peer remained open");
}

struct ParsedWireResponse {
    status: String,
    headers: BTreeMap<String, Vec<String>>,
    body: Vec<u8>,
}

impl ParsedWireResponse {
    fn parse(bytes: Vec<u8>) -> Self {
        let end = bytes
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("wire response has a header terminator");
        let header = std::str::from_utf8(&bytes[..end]).expect("response headers are ASCII");
        let mut lines = header.split("\r\n");
        let status = lines.next().expect("status line").to_owned();
        let mut headers = BTreeMap::<String, Vec<String>>::new();
        for line in lines {
            let (name, value) = line.split_once(": ").expect("canonical response header");
            headers
                .entry(name.to_ascii_lowercase())
                .or_default()
                .push(value.to_owned());
        }
        let body = bytes[end + 4..].to_vec();
        let declared = headers["content-length"][0].parse::<usize>().unwrap();
        assert_eq!(declared, body.len(), "wire Content-Length/EOF identity");
        Self {
            status,
            headers,
            body,
        }
    }

    fn one(&self, name: &str) -> &str {
        let values = self
            .headers
            .get(&name.to_ascii_lowercase())
            .unwrap_or_else(|| panic!("missing header {name}"));
        assert_eq!(values.len(), 1, "header multiplicity for {name}");
        &values[0]
    }

    fn absent(&self, name: &str) {
        assert!(
            !self.headers.contains_key(&name.to_ascii_lowercase()),
            "forbidden header {name}"
        );
    }
}

fn assert_common_wire(response: &ParsedWireResponse) {
    assert_eq!(response.one("connection"), "close");
    assert_eq!(response.one("cache-control"), "no-store");
    assert_eq!(response.one("x-content-type-options"), "nosniff");
    uuid::Uuid::parse_str(response.one("x-request-id")).expect("canonical request ID");
    for (name, values) in &response.headers {
        assert_eq!(values.len(), 1, "duplicate response header {name}");
    }
    response.absent("content-encoding");
    response.absent("transfer-encoding");
    response.absent("set-cookie");
    response.absent("access-control-allow-credentials");
}

fn assert_security_headers(response: &str) {
    assert!(response.contains("\r\nCache-Control: no-store\r\n"));
    assert!(response.contains("\r\nX-Content-Type-Options: nosniff\r\n"));
    assert!(!response.to_ascii_lowercase().contains("set-cookie"));
    assert!(
        !response
            .to_ascii_lowercase()
            .contains("access-control-allow-credentials")
    );
}

fn assert_problem(response: &str, status: &str, code: &str) {
    assert!(
        response.starts_with(&format!("HTTP/1.1 {status}\r\n")),
        "expected {status} for {code}, got {response:?}"
    );
    assert!(
        response.contains(&format!("\"code\":\"{code}\"")),
        "expected {code}, got {response:?}"
    );
    assert_security_headers(response);
}

fn json_request(method: &str, target: &str, authorization: bool, body: &str) -> Vec<u8> {
    let authorization = if authorization {
        format!("Authorization: Bearer {}\r\n", "A".repeat(43))
    } else {
        String::new()
    };
    format!(
        "{method} {target} HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nX-OVP-Client-Version: 1.0.0\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{authorization}\r\n{body}",
        body.len()
    )
    .into_bytes()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c8_json_schema_and_concrete_serde_precede_every_effect() {
    let _fixed_port = FIXED_PORT.lock().await;
    let (ports, state) = test_ports(true);
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");

    let secret = "A".repeat(43);
    let scopes = r#"["health:read","runtime:read","synthesis:create","jobs:read","jobs:cancel","audio:read","packs:request"]"#;
    let common = format!(
        r#""verifierHash":"{secret}","clientLabel":"Browser playground","scopes":{scopes}"#
    );
    let invalid_cases = vec![
        (
            "challenge-empty",
            "/v1/pairings/challenges",
            false,
            "{}".to_owned(),
        ),
        (
            "challenge-array",
            "/v1/pairings/challenges",
            false,
            "[]".to_owned(),
        ),
        (
            "challenge-unknown",
            "/v1/pairings/challenges",
            false,
            format!(r#"{{"state":"{secret}",{common},"unexpected":true}}"#),
        ),
        (
            "challenge-duplicate",
            "/v1/pairings/challenges",
            false,
            format!(r#"{{"state":"{secret}","state":"{secret}",{common}}}"#),
        ),
        (
            "challenge-hybrid",
            "/v1/pairings/challenges",
            false,
            format!(r#"{{"state":"{secret}","code":"12345678",{common}}}"#),
        ),
        (
            "challenge-neither-variant",
            "/v1/pairings/challenges",
            false,
            format!(r#"{{{common}}}"#),
        ),
        (
            "challenge-bad-secret",
            "/v1/pairings/challenges",
            false,
            format!(r#"{{"state":"short",{common}}}"#),
        ),
        (
            "challenge-bad-scope",
            "/v1/pairings/challenges",
            false,
            format!(
                r#"{{"state":"{secret}","verifierHash":"{secret}","clientLabel":"Browser playground","scopes":["root"]}}"#
            ),
        ),
        (
            "redeem-empty",
            "/v1/pairings/challenges/11111111-1111-4111-8111-111111111111/redeem",
            false,
            "{}".to_owned(),
        ),
        (
            "redeem-array",
            "/v1/pairings/challenges/11111111-1111-4111-8111-111111111111/redeem",
            false,
            "[]".to_owned(),
        ),
        (
            "redeem-unknown",
            "/v1/pairings/challenges/11111111-1111-4111-8111-111111111111/redeem",
            false,
            format!(r#"{{"verifier":"{secret}","unexpected":true}}"#),
        ),
        (
            "redeem-duplicate",
            "/v1/pairings/challenges/11111111-1111-4111-8111-111111111111/redeem",
            false,
            format!(r#"{{"verifier":"{secret}","verifier":"{secret}"}}"#),
        ),
        (
            "redeem-bad-secret",
            "/v1/pairings/challenges/11111111-1111-4111-8111-111111111111/redeem",
            false,
            r#"{"verifier":"short"}"#.to_owned(),
        ),
        ("job-empty", "/v1/jobs", true, "{}".to_owned()),
        ("job-array", "/v1/jobs", true, "[]".to_owned()),
        (
            "job-unknown",
            "/v1/jobs",
            true,
            r#"{"voiceId":"pocket:alba","text":"hello","unexpected":true}"#.to_owned(),
        ),
        (
            "job-duplicate",
            "/v1/jobs",
            true,
            r#"{"voiceId":"pocket:alba","voiceId":"pocket:alba","text":"hello"}"#.to_owned(),
        ),
        (
            "job-bad-voice",
            "/v1/jobs",
            true,
            r#"{"voiceId":"not:a-voice","text":"hello"}"#.to_owned(),
        ),
        (
            "job-empty-text",
            "/v1/jobs",
            true,
            r#"{"voiceId":"pocket:alba","text":""}"#.to_owned(),
        ),
        (
            "job-control-text",
            "/v1/jobs",
            true,
            r#"{"voiceId":"pocket:alba","text":"bad\u0000text"}"#.to_owned(),
        ),
        (
            "job-text-limit",
            "/v1/jobs",
            true,
            format!(
                r#"{{"voiceId":"pocket:alba","text":"{}"}}"#,
                "x".repeat(8_001)
            ),
        ),
        (
            "pack-empty",
            "/v1/packs/pocket-companion-pack/actions",
            true,
            "{}".to_owned(),
        ),
        (
            "pack-array",
            "/v1/packs/pocket-companion-pack/actions",
            true,
            "[]".to_owned(),
        ),
        (
            "pack-unknown",
            "/v1/packs/pocket-companion-pack/actions",
            true,
            r#"{"action":"install","unexpected":true}"#.to_owned(),
        ),
        (
            "pack-duplicate",
            "/v1/packs/pocket-companion-pack/actions",
            true,
            r#"{"action":"install","action":"install"}"#.to_owned(),
        ),
        (
            "pack-bad-action",
            "/v1/packs/pocket-companion-pack/actions",
            true,
            r#"{"action":"execute"}"#.to_owned(),
        ),
    ];

    let mut mismatches = Vec::new();
    for (label, target, authorization, body) in invalid_cases {
        let response = roundtrip(json_request("POST", target, authorization, &body)).await;
        if !response.contains("\"code\":\"schema-invalid\"") {
            let observed = response.lines().next().unwrap_or("missing status");
            let code = response
                .split("\"code\":\"")
                .nth(1)
                .and_then(|tail| tail.split('"').next())
                .unwrap_or("missing-code");
            mismatches.push(format!("{label}: {observed} ({code})"));
        }
    }

    let invalid_path = roundtrip(json_request(
        "POST",
        "/v1/pairings/challenges/not-a-uuid/redeem",
        false,
        &format!(r#"{{"verifier":"{secret}"}}"#),
    ))
    .await;
    if !invalid_path.contains("\"code\":\"schema-invalid\"") {
        mismatches.push("redeem-bad-uuid did not fail schema validation".to_owned());
    }

    server.shutdown().await;
    assert_eq!(state.auth_commits.load(Ordering::SeqCst), 0);
    assert_eq!(state.rate_commits.load(Ordering::SeqCst), 0);
    assert_eq!(state.handler_calls.load(Ordering::SeqCst), 0);
    assert!(
        mismatches.is_empty(),
        "invalid concrete requests crossed the C8 boundary: {}",
        mismatches.join("; ")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c8_all_four_request_schema_corpora_cross_the_live_typed_boundary_exactly() {
    let _fixed_port = FIXED_PORT.lock().await;
    let corpus: RequestCorpus = serde_json::from_str(PROTOCOL_CORPUS).unwrap();
    let selected = corpus
        .cases
        .into_iter()
        .filter(|case| {
            matches!(
                case.schema.as_str(),
                "PairingChallengeRequest"
                    | "RedeemRequest"
                    | "JobCreateRequest"
                    | "PackActionRequest"
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(selected.len(), 40);
    assert_eq!(selected.iter().filter(|case| case.valid).count(), 8);
    assert_eq!(selected.iter().filter(|case| !case.valid).count(), 32);

    let state = Arc::new(BoundaryState::default());
    let typed_schemas = Arc::new(Mutex::new(Vec::new()));
    let ports = ServerPorts::new(
        Arc::new(CorpusHandler {
            state: Arc::clone(&state),
            schemas: Arc::clone(&typed_schemas),
        }),
        Arc::new(BoundaryAuth {
            state: Arc::clone(&state),
            accept: true,
        }),
        Arc::new(BoundaryRate {
            state: Arc::clone(&state),
            error: None,
        }),
        Arc::new(BoundaryClock {
            state: Arc::clone(&state),
        }),
        fixed_listener_port(),
    );
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");

    for case in &selected {
        let (target, authorization) = match case.schema.as_str() {
            "PairingChallengeRequest" => ("/v1/pairings/challenges", false),
            "RedeemRequest" => (
                "/v1/pairings/challenges/11111111-1111-4111-8111-111111111111/redeem",
                false,
            ),
            "JobCreateRequest" => ("/v1/jobs", true),
            "PackActionRequest" => ("/v1/packs/pocket-companion-pack/actions", true),
            _ => unreachable!(),
        };
        let before_handler = state.handler_calls.load(Ordering::SeqCst);
        let before_auth = state.auth_commits.load(Ordering::SeqCst);
        let before_rate = state.rate_commits.load(Ordering::SeqCst);
        let before_typed = typed_schemas.lock().unwrap().len();
        let body = serde_json::to_string(&case.value).unwrap();
        let response = ParsedWireResponse::parse(
            roundtrip_bytes(json_request("POST", target, authorization, &body)).await,
        );

        let expected_delta = usize::from(case.valid);
        assert_eq!(
            state.handler_calls.load(Ordering::SeqCst) - before_handler,
            expected_delta,
            "handler effect for corpus case {}",
            case.id
        );
        assert_eq!(
            state.rate_commits.load(Ordering::SeqCst) - before_rate,
            expected_delta,
            "rate effect for corpus case {}",
            case.id
        );
        assert_eq!(
            state.auth_commits.load(Ordering::SeqCst) - before_auth,
            usize::from(case.valid && authorization),
            "auth effect for corpus case {}",
            case.id
        );
        assert_eq!(
            typed_schemas.lock().unwrap().len() - before_typed,
            expected_delta,
            "typed dispatch for corpus case {}",
            case.id
        );
        if case.valid {
            assert_eq!(
                typed_schemas.lock().unwrap().last().copied(),
                Some(case.schema.as_str()),
                "typed schema for corpus case {}",
                case.id
            );
        } else {
            assert_eq!(response.status, "HTTP/1.1 400 Bad Request", "{}", case.id);
            let problem: serde_json::Value = serde_json::from_slice(&response.body).unwrap();
            assert_eq!(problem["code"], "schema-invalid", "{}", case.id);
        }
    }
    server.shutdown().await;
    assert_eq!(state.handler_calls.load(Ordering::SeqCst), 8);
    assert_eq!(state.rate_commits.load(Ordering::SeqCst), 8);
    assert_eq!(state.auth_commits.load(Ordering::SeqCst), 5);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c8_actual_and_preflight_response_profiles_are_exact() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local(), test_ports(false).0)
        .await
        .expect("fixed listener should bind");

    let unauthorized = roundtrip(request("GET", "/v1/runtime", "")).await;
    let wrong_method = roundtrip(request("POST", "/v1/health", "")).await;
    let preflight = roundtrip(preflight_request(
        "/v1/health",
        "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n",
        "",
    ))
    .await;
    let failed_preflight = roundtrip(preflight_request(
        "/v1/health",
        "Access-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: Content-Type, X-OVP-Client-Version\r\n",
        "",
    ))
    .await;

    let mut mismatches = Vec::new();
    if !unauthorized.contains("\r\nWWW-Authenticate: Bearer realm=\"open-voice-companion\"\r\n") {
        mismatches.push("401 missing exact WWW-Authenticate");
    }
    if !wrong_method.contains("\r\nAllow: GET, OPTIONS\r\n") {
        mismatches.push("known-path 405 missing exact Allow");
    }
    if preflight.contains("Access-Control-Expose-Headers") {
        mismatches.push("successful preflight exposed actual-response headers");
    }
    if !failed_preflight.contains(
        "\r\nVary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers\r\n",
    ) {
        mismatches.push("failed preflight missing base Vary");
    }
    if failed_preflight.contains("Access-Control-Allow-") {
        mismatches.push("failed preflight emitted Access-Control-Allow-* headers");
    }

    server.shutdown().await;
    assert!(
        mismatches.is_empty(),
        "response profile drift: {}",
        mismatches.join("; ")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c8_rejects_public_authorization_cookie_encoding_and_parameterized_content_type_before_body()
 {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local(), test_ports(false).0)
        .await
        .expect("fixed listener should bind");

    let cases = [
        (
            "public authorization",
            request(
                "GET",
                "/v1/health",
                &format!("Authorization: Bearer {}\r\n", "A".repeat(43)),
            ),
            "schema-invalid",
        ),
        (
            "cookie",
            request("GET", "/v1/health", "Cookie: session=forbidden\r\n"),
            "schema-invalid",
        ),
        (
            "content encoding",
            request("GET", "/v1/health", "Content-Encoding: identity\r\n"),
            "schema-invalid",
        ),
        (
            "bodyless content type",
            request("GET", "/v1/health", "Content-Type: application/json\r\n"),
            "schema-invalid",
        ),
        (
            "parameterized json",
            format!(
                "POST /v1/pairings/challenges HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nX-OVP-Client-Version: 1.0.0\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 2\r\n\r\n{{}}"
            ),
            "content-type-unsupported",
        ),
    ];

    let before = server.metrics().body_reads;
    let mut mismatches = Vec::new();
    for (label, raw, expected) in cases {
        let response = roundtrip(raw).await;
        if !response.contains(&format!("\"code\":\"{expected}\"")) {
            let status = response.lines().next().unwrap_or("missing status");
            mismatches.push(format!("{label}: {status}"));
        }
    }
    let after = server.metrics().body_reads;

    server.shutdown().await;
    assert_eq!(before, after, "pre-body rejections polled request bodies");
    assert!(
        mismatches.is_empty(),
        "forbidden public headers/media crossed admission: {}",
        mismatches.join("; ")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c8_auth_and_rate_rejections_precede_declared_body_polling() {
    let _fixed_port = FIXED_PORT.lock().await;
    let authorization = format!("Authorization: Bearer {}\r\n", "A".repeat(43));
    let held_headers = format!(
        "POST /v1/jobs HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nX-OVP-Client-Version: 1.0.0\r\nContent-Type: application/json\r\nContent-Length: 10\r\n{authorization}\r\n"
    );

    let (ports, state) = test_ports(false);
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");
    let auth_response = roundtrip(&held_headers).await;
    assert_problem(&auth_response, "401 Unauthorized", "auth-invalid");
    assert_eq!(server.metrics().body_reads, 0);
    assert_eq!(state.auth_reservations.load(Ordering::SeqCst), 1);
    assert_eq!(state.rate_reservations.load(Ordering::SeqCst), 0);
    assert_eq!(state.auth_commits.load(Ordering::SeqCst), 0);
    assert_eq!(state.handler_calls.load(Ordering::SeqCst), 0);
    server.shutdown().await;

    let limited = RateLimitError::Limited(RetryAfterSeconds::new(7).unwrap());
    let (ports, state) = test_ports_with_rate(true, Some(limited));
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");
    let rate_response = roundtrip(&held_headers).await;
    assert_problem(&rate_response, "429 Too Many Requests", "rate-limited");
    assert_eq!(server.metrics().body_reads, 0);
    assert_eq!(state.auth_reservations.load(Ordering::SeqCst), 1);
    assert_eq!(state.rate_reservations.load(Ordering::SeqCst), 1);
    assert_eq!(state.auth_commits.load(Ordering::SeqCst), 0);
    assert_eq!(state.rate_commits.load(Ordering::SeqCst), 0);
    assert_eq!(state.handler_calls.load(Ordering::SeqCst), 0);
    server.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c8_projects_exact_rate_subjects_and_skips_auth_rate_clock_for_preflight() {
    let _fixed_port = FIXED_PORT.lock().await;
    let (ports, state) = test_ports(true);
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");
    let bearer = format!("Authorization: Bearer {}\r\n", "A".repeat(43));
    let secret = "A".repeat(43);
    let challenge = format!(
        r#"{{"state":"{secret}","verifierHash":"{secret}","clientLabel":"Browser playground","scopes":["health:read","runtime:read","synthesis:create","jobs:read","jobs:cancel","audio:read","packs:request"]}}"#
    );

    let requests = vec![
        request("GET", "/v1/health", "").into_bytes(),
        json_request("POST", "/v1/pairings/challenges", false, &challenge),
        json_request(
            "POST",
            "/v1/pairings/challenges/11111111-1111-4111-8111-111111111111/redeem",
            false,
            &format!(r#"{{"verifier":"{secret}"}}"#),
        ),
        request("GET", "/v1/pairings/current", &bearer).into_bytes(),
        request("DELETE", "/v1/pairings/current", &bearer).into_bytes(),
        request("GET", "/v1/runtime", &bearer).into_bytes(),
        request("GET", "/v1/engines", &bearer).into_bytes(),
        request("GET", "/v1/voices", &bearer).into_bytes(),
        request("GET", "/v1/packs", &bearer).into_bytes(),
        json_request(
            "POST",
            "/v1/jobs",
            true,
            r#"{"voiceId":"pocket:alba","text":"hello"}"#,
        ),
        request(
            "GET",
            "/v1/jobs/22222222-2222-4222-8222-222222222222",
            &bearer,
        )
        .into_bytes(),
        request(
            "DELETE",
            "/v1/jobs/33333333-3333-4333-8333-333333333333",
            &bearer,
        )
        .into_bytes(),
        request(
            "GET",
            "/v1/jobs/44444444-4444-4444-8444-444444444444/audio",
            &bearer,
        )
        .into_bytes(),
        json_request(
            "POST",
            "/v1/packs/pocket-companion-pack/actions",
            true,
            r#"{"action":"install"}"#,
        ),
    ];
    for raw in requests {
        let _ = roundtrip(raw).await;
    }

    let pairing = CanonicalUuid::from(uuid::Uuid::from_u128(0xc8));
    let challenge_id = CanonicalUuid::parse("11111111-1111-4111-8111-111111111111").unwrap();
    assert_eq!(
        *state.rate_requests.lock().unwrap(),
        vec![
            (
                RateClass::Health,
                RateSubject::Origin(GOOD_ORIGIN.to_owned()),
            ),
            (
                RateClass::PairingCreate,
                RateSubject::Origin(GOOD_ORIGIN.to_owned()),
            ),
            (
                RateClass::PairingRedeem,
                RateSubject::Challenge(challenge_id),
            ),
            (RateClass::AuthenticatedRead, RateSubject::Pairing(pairing)),
            (RateClass::AuthenticatedRead, RateSubject::Pairing(pairing)),
            (RateClass::AuthenticatedRead, RateSubject::Pairing(pairing)),
            (RateClass::AuthenticatedRead, RateSubject::Pairing(pairing)),
            (RateClass::AuthenticatedRead, RateSubject::Pairing(pairing)),
            (RateClass::JobCreate, RateSubject::Pairing(pairing)),
            (RateClass::AuthenticatedRead, RateSubject::Pairing(pairing)),
            (RateClass::AuthenticatedRead, RateSubject::Pairing(pairing)),
            (RateClass::PackAction, RateSubject::Pairing(pairing)),
        ]
    );
    assert_eq!(state.auth_reservations.load(Ordering::SeqCst), 11);
    assert_eq!(state.monotonic_calls.load(Ordering::SeqCst), 14);
    assert_eq!(state.utc_calls.load(Ordering::SeqCst), 14);
    server.shutdown().await;

    let (ports, state) = test_ports(true);
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");
    let response = roundtrip(preflight_request(
        "/v1/health",
        "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n",
        "",
    ))
    .await;
    assert!(response.starts_with("HTTP/1.1 204 No Content\r\n"));
    assert_eq!(state.auth_reservations.load(Ordering::SeqCst), 0);
    assert_eq!(state.rate_reservations.load(Ordering::SeqCst), 0);
    assert_eq!(state.monotonic_calls.load(Ordering::SeqCst), 0);
    assert_eq!(state.utc_calls.load(Ordering::SeqCst), 0);
    assert_eq!(state.handler_calls.load(Ordering::SeqCst), 0);
    server.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c8_raw_json_problem_preflight_and_204_profiles_are_identity_exact() {
    let _fixed_port = FIXED_PORT.lock().await;
    let (ports, _state) = ports_with_handler(
        Arc::new(SuccessHandler {
            redeem_pending: true,
        }),
        None,
    );
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");

    let health = ParsedWireResponse::parse(roundtrip_bytes(request("GET", "/v1/health", "")).await);
    assert_eq!(health.status, "HTTP/1.1 200 OK");
    assert_common_wire(&health);
    assert_eq!(health.one("content-type"), "application/json");
    assert_eq!(health.one("access-control-allow-origin"), GOOD_ORIGIN);
    assert_eq!(
        health.one("access-control-expose-headers"),
        "ETag, Location, Retry-After, X-Request-Id"
    );
    assert_eq!(health.one("vary"), "Origin");

    let unauthorized =
        ParsedWireResponse::parse(roundtrip_bytes(request("GET", "/v1/runtime", "")).await);
    assert_eq!(unauthorized.status, "HTTP/1.1 401 Unauthorized");
    assert_common_wire(&unauthorized);
    assert_eq!(
        unauthorized.one("www-authenticate"),
        "Bearer realm=\"open-voice-companion\""
    );
    assert_eq!(unauthorized.one("content-type"), "application/problem+json");
    let problem: serde_json::Value = serde_json::from_slice(&unauthorized.body).unwrap();
    assert_eq!(problem["code"], "auth-missing");
    assert_eq!(
        problem["requestId"].as_str().unwrap(),
        unauthorized.one("x-request-id")
    );
    uuid::Uuid::parse_str(
        problem["instance"]
            .as_str()
            .unwrap()
            .strip_prefix("urn:uuid:")
            .unwrap(),
    )
    .unwrap();
    let safe_problem = String::from_utf8(unauthorized.body.clone()).unwrap();
    for sentinel in [
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "C8_RAW_BODY_SENTINEL",
        "C8_INTERNAL_SENTINEL",
    ] {
        assert!(!safe_problem.contains(sentinel));
    }

    let preflight = ParsedWireResponse::parse(
        roundtrip_bytes(preflight_request(
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nAccess-Control-Request-Private-Network: true\r\n",
            "",
        ))
        .await,
    );
    assert_eq!(preflight.status, "HTTP/1.1 204 No Content");
    assert_common_wire(&preflight);
    assert!(preflight.body.is_empty());
    assert_eq!(preflight.one("content-length"), "0");
    preflight.absent("content-type");
    preflight.absent("access-control-expose-headers");
    assert_eq!(preflight.one("access-control-allow-origin"), GOOD_ORIGIN);
    assert_eq!(
        preflight.one("access-control-allow-methods"),
        "GET, POST, DELETE, OPTIONS"
    );
    assert_eq!(
        preflight.one("access-control-allow-headers"),
        "Authorization, Content-Type, X-OVP-Client-Version"
    );
    assert_eq!(preflight.one("access-control-max-age"), "600");
    assert_eq!(
        preflight.one("access-control-allow-private-network"),
        "true"
    );
    assert_eq!(
        preflight.one("vary"),
        "Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network"
    );

    let failed = ParsedWireResponse::parse(
        roundtrip_bytes(preflight_request(
            "/v1/health",
            "Access-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: Content-Type, X-OVP-Client-Version\r\n",
            "",
        ))
        .await,
    );
    assert_eq!(failed.status, "HTTP/1.1 405 Method Not Allowed");
    assert_common_wire(&failed);
    assert_eq!(failed.one("allow"), "GET, OPTIONS");
    assert_eq!(
        failed.one("vary"),
        "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
    );
    for name in [
        "access-control-allow-origin",
        "access-control-allow-methods",
        "access-control-allow-headers",
        "access-control-allow-private-network",
        "access-control-expose-headers",
    ] {
        failed.absent(name);
    }

    let bearer = format!("Authorization: Bearer {}\r\n", "A".repeat(43));
    let revoked = ParsedWireResponse::parse(
        roundtrip_bytes(request("DELETE", "/v1/pairings/current", &bearer)).await,
    );
    assert_eq!(revoked.status, "HTTP/1.1 204 No Content");
    assert_common_wire(&revoked);
    assert!(revoked.body.is_empty());
    assert_eq!(revoked.one("content-length"), "0");
    revoked.absent("content-type");

    server.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c8_raw_success_metadata_and_binary_wav_profiles_are_exact() {
    let _fixed_port = FIXED_PORT.lock().await;
    let (ports, _state) = ports_with_handler(
        Arc::new(SuccessHandler {
            redeem_pending: true,
        }),
        None,
    );
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");
    let secret = "A".repeat(43);
    let challenge_body = format!(
        r#"{{"state":"{secret}","verifierHash":"{secret}","clientLabel":"Browser playground","scopes":["health:read","runtime:read","synthesis:create","jobs:read","jobs:cancel","audio:read","packs:request"]}}"#
    );
    let challenge = ParsedWireResponse::parse(
        roundtrip_bytes(json_request(
            "POST",
            "/v1/pairings/challenges",
            false,
            &challenge_body,
        ))
        .await,
    );
    assert_eq!(challenge.status, "HTTP/1.1 201 Created");
    assert_common_wire(&challenge);
    assert_eq!(challenge.one("location"), "/v1/pairings/challenges/opaque");
    challenge.absent("etag");
    challenge.absent("retry-after");

    let pending = ParsedWireResponse::parse(
        roundtrip_bytes(json_request(
            "POST",
            "/v1/pairings/challenges/11111111-1111-4111-8111-111111111111/redeem",
            false,
            &format!(r#"{{"verifier":"{secret}"}}"#),
        ))
        .await,
    );
    assert_eq!(pending.status, "HTTP/1.1 202 Accepted");
    assert_eq!(pending.one("retry-after"), "2");
    pending.absent("location");
    pending.absent("etag");

    let bearer = format!("Authorization: Bearer {}\r\n", "A".repeat(43));
    for (path, expected_etag) in [
        ("/v1/runtime", "\"runtime-v1\""),
        ("/v1/engines", "\"engines-v1\""),
        ("/v1/voices", "\"voices-v1\""),
        ("/v1/packs", "\"packs-v1\""),
    ] {
        let response =
            ParsedWireResponse::parse(roundtrip_bytes(request("GET", path, &bearer)).await);
        assert_eq!(response.status, "HTTP/1.1 200 OK");
        assert_common_wire(&response);
        assert_eq!(response.one("etag"), expected_etag);
        response.absent("location");
        response.absent("retry-after");
    }

    let created = ParsedWireResponse::parse(
        roundtrip_bytes(json_request(
            "POST",
            "/v1/jobs",
            true,
            r#"{"voiceId":"pocket:alba","text":"hello"}"#,
        ))
        .await,
    );
    assert_eq!(created.status, "HTTP/1.1 202 Accepted");
    assert_eq!(created.one("location"), "/v1/jobs/opaque");
    created.absent("retry-after");
    created.absent("etag");

    let cancelled = ParsedWireResponse::parse(
        roundtrip_bytes(request(
            "DELETE",
            "/v1/jobs/33333333-3333-4333-8333-333333333333",
            &bearer,
        ))
        .await,
    );
    assert_eq!(cancelled.status, "HTTP/1.1 202 Accepted");
    cancelled.absent("location");
    cancelled.absent("retry-after");
    cancelled.absent("etag");

    let pack = ParsedWireResponse::parse(
        roundtrip_bytes(json_request(
            "POST",
            "/v1/packs/pocket-companion-pack/actions",
            true,
            r#"{"action":"install"}"#,
        ))
        .await,
    );
    assert_eq!(pack.status, "HTTP/1.1 202 Accepted");
    assert_eq!(pack.one("location"), "/v1/pack-actions/opaque");
    pack.absent("retry-after");
    pack.absent("etag");

    let audio = ParsedWireResponse::parse(
        roundtrip_bytes(request(
            "GET",
            "/v1/jobs/44444444-4444-4444-8444-444444444444/audio",
            &bearer,
        ))
        .await,
    );
    assert_eq!(audio.status, "HTTP/1.1 200 OK");
    assert_common_wire(&audio);
    assert_eq!(audio.one("content-type"), "audio/wav");
    assert_eq!(audio.one("etag"), "\"audio-v1\"");
    assert_eq!(audio.body, vec![0, 0xff, b'R', b'I', b'F', b'F', 0x80]);
    audio.absent("location");
    audio.absent("retry-after");

    server.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c8_raw_allow_and_error_retry_conditions_are_exact() {
    let _fixed_port = FIXED_PORT.lock().await;
    let (ports, _state) = ports_with_handler(
        Arc::new(SuccessHandler {
            redeem_pending: true,
        }),
        None,
    );
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");
    for (method, path, allow) in [
        ("POST", "/v1/health", "GET, OPTIONS"),
        ("GET", "/v1/pairings/challenges", "POST, OPTIONS"),
        ("POST", "/v1/pairings/current", "GET, DELETE, OPTIONS"),
    ] {
        let response = ParsedWireResponse::parse(roundtrip_bytes(request(method, path, "")).await);
        assert_eq!(response.status, "HTTP/1.1 405 Method Not Allowed");
        assert_eq!(response.one("allow"), allow);
    }
    server.shutdown().await;

    let limited = RateLimitError::Limited(RetryAfterSeconds::new(7).unwrap());
    let (ports, _state) = ports_with_handler(
        Arc::new(SuccessHandler {
            redeem_pending: true,
        }),
        Some(limited),
    );
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .unwrap();
    let response =
        ParsedWireResponse::parse(roundtrip_bytes(request("GET", "/v1/health", "")).await);
    assert_eq!(response.status, "HTTP/1.1 429 Too Many Requests");
    assert_eq!(response.one("retry-after"), "7");
    server.shutdown().await;

    let bearer = format!("Authorization: Bearer {}\r\n", "A".repeat(43));
    let error_cases = vec![
        WireErrorCase {
            handler: Arc::new(ErrorHandler(HandlerError::QueueFull(
                RetryAfterSeconds::new(9).unwrap(),
            ))),
            raw: json_request(
                "POST",
                "/v1/jobs",
                true,
                r#"{"voiceId":"pocket:alba","text":"hello"}"#,
            ),
            status: "HTTP/1.1 503 Service Unavailable",
            retry_after: Some("9"),
        },
        WireErrorCase {
            handler: Arc::new(ErrorHandler(HandlerError::RuntimeUnavailable)),
            raw: request("GET", "/v1/runtime", &bearer).into_bytes(),
            status: "HTTP/1.1 503 Service Unavailable",
            retry_after: None,
        },
        WireErrorCase {
            handler: Arc::new(ErrorHandler(HandlerError::PackUnverified)),
            raw: json_request(
                "POST",
                "/v1/packs/pocket-companion-pack/actions",
                true,
                r#"{"action":"install"}"#,
            ),
            status: "HTTP/1.1 503 Service Unavailable",
            retry_after: None,
        },
    ];
    for case in error_cases {
        let (ports, _state) = ports_with_handler(case.handler, None);
        let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
            .await
            .unwrap();
        let response = ParsedWireResponse::parse(roundtrip_bytes(case.raw).await);
        assert_eq!(response.status, case.status);
        match case.retry_after {
            Some(value) => assert_eq!(response.one("retry-after"), value),
            None => response.absent("retry-after"),
        }
        server.shutdown().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c8_expired_or_missing_job_audio_is_non_oracular_resource_not_found() {
    let _fixed_port = FIXED_PORT.lock().await;
    let bearer = format!("Authorization: Bearer {}\r\n", "A".repeat(43));
    let raw = request(
        "GET",
        "/v1/jobs/44444444-4444-4444-8444-444444444444/audio",
        &bearer,
    );

    for error in [HandlerError::PairingExpired, HandlerError::ResourceNotFound] {
        let (ports, _state) = ports_with_handler(Arc::new(ErrorHandler(error)), None);
        let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
            .await
            .unwrap();
        let response = ParsedWireResponse::parse(roundtrip_bytes(raw.clone()).await);
        assert_eq!(response.status, "HTTP/1.1 404 Not Found");
        let problem: serde_json::Value = serde_json::from_slice(&response.body).unwrap();
        assert_eq!(problem["code"], "resource-not-found");
        server.shutdown().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c7_rejects_non_origin_forms_without_whatwg_equivalence() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local(), test_ports(false).0)
        .await
        .expect("fixed listener should bind");

    let rejected_targets = [
        "http://127.0.0.1:17843/v1/health",
        "HTTP://127.0.0.1:17843/v1/health",
        "https://127.0.0.1:17843/v1/health",
        "http://localhost:17843/v1/health",
        "http://127.0.0.1.:17843/v1/health",
        "http://127.1:17843/v1/health",
        "http://0177.0.0.1:17843/v1/health",
        "http://0x7f000001:17843/v1/health",
        "http://2130706433:17843/v1/health",
        "http://[::1]:17843/v1/health",
        "http://127.0.0.1/v1/health",
        "http://127.0.0.1:17844/v1/health",
        "http://127.0.0.1:80/v1/health",
        "http:///v1/health",
        "http://user@127.0.0.1:17843/v1/health",
        "http://@127.0.0.1:17843/v1/health",
        r"http:\\127.0.0.1:17843\v1\health",
        r"http://127.0.0.1:17843\v1\health",
        "127.0.0.1:17843",
        "//127.0.0.1:17843/v1/health",
        "*",
    ];
    let authorization = format!("Authorization: Bearer {}\r\n", "S".repeat(43));

    for target in rejected_targets {
        let before = server.metrics().body_reads;
        let response = roundtrip(request("GET", target, &authorization)).await;
        assert_problem(&response, "400 Bad Request", "host-invalid");
        assert_eq!(
            server.metrics().body_reads,
            before,
            "non-origin target reached body polling: {target:?}"
        );
        assert!(!response.contains(target), "raw target leaked: {target:?}");
    }

    server.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c7_rejects_queries_fragments_and_normalization_aliases() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local(), test_ports(false).0)
        .await
        .expect("fixed listener should bind");

    let rejected_targets = [
        "/v1/health?",
        "/v1/health?x=1",
        "/v1/health#C7_RAW_TARGET_SENTINEL",
        "/v1/%68ealth",
        "/v1/health%3f",
        "/v1/health%2F",
        r"/v1\health",
        r"/v1/health\",
        "/v1//health",
        "/v1/health/",
        "/v1/./health",
        "/v1/../health",
        "/./v1/health",
        "/v1/ health",
        "/v1/\u{1f}health",
        "/v1/\u{7f}health",
        "/v1/héalth",
        "/v1/h\u{80}ealth",
    ];
    let authorization = format!("Authorization: Bearer {}\r\n", "S".repeat(43));

    for target in rejected_targets {
        let before = server.metrics().body_reads;
        let response = roundtrip(request("GET", target, &authorization)).await;
        assert_problem(&response, "400 Bad Request", "schema-invalid");
        assert_eq!(
            server.metrics().body_reads,
            before,
            "invalid origin form reached body polling: {target:?}"
        );
        assert!(
            !response.contains("C7_RAW_TARGET_SENTINEL"),
            "raw target leaked: {target:?}"
        );
    }

    server.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c7_classifies_unknown_wrong_method_and_bad_parameters_before_auth() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local(), test_ports(false).0)
        .await
        .expect("fixed listener should bind");
    let authorization = format!("Authorization: Bearer {}\r\n", "S".repeat(43));

    let cases = vec![
        (
            "GET",
            "/v1/C7_RAW_TARGET_SENTINEL",
            authorization.clone(),
            "404 Not Found",
            "resource-not-found",
        ),
        (
            "POST",
            "/v1/C7_RAW_TARGET_SENTINEL",
            format!("{authorization}Content-Type: application/json\r\n"),
            "404 Not Found",
            "resource-not-found",
        ),
        (
            "DELETE",
            "/v1/C7_RAW_TARGET_SENTINEL",
            authorization.clone(),
            "404 Not Found",
            "resource-not-found",
        ),
        (
            "PUT",
            "/v1/C7_RAW_TARGET_SENTINEL",
            authorization.clone(),
            "404 Not Found",
            "resource-not-found",
        ),
        (
            "HEAD",
            "/v1/C7_RAW_TARGET_SENTINEL",
            authorization.clone(),
            "404 Not Found",
            "resource-not-found",
        ),
        (
            "OPTIONS",
            "/v1/C7_RAW_TARGET_SENTINEL",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "404 Not Found",
            "resource-not-found",
        ),
        (
            "POST",
            "/v1/health",
            format!("{authorization}Content-Type: application/json\r\n"),
            "405 Method Not Allowed",
            "method-not-allowed",
        ),
        (
            "DELETE",
            "/v1/pairings/challenges",
            authorization.clone(),
            "405 Method Not Allowed",
            "method-not-allowed",
        ),
        (
            "GET",
            "/v1/jobs",
            authorization.clone(),
            "405 Method Not Allowed",
            "method-not-allowed",
        ),
        (
            "get",
            "/v1/health",
            authorization.clone(),
            "405 Method Not Allowed",
            "method-not-allowed",
        ),
        (
            "BREW",
            "/v1/health",
            authorization.clone(),
            "405 Method Not Allowed",
            "method-not-allowed",
        ),
        (
            "POST",
            "/v1/pairings/challenges/not-a-uuid/redeem",
            "Content-Type: application/json\r\n".to_owned(),
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "GET",
            "/v1/jobs/not-a-uuid",
            authorization.clone(),
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "GET",
            "/v1/jobs/not-a-uuid/audio",
            authorization.clone(),
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "POST",
            "/v1/packs/not-a-pack/actions",
            format!("{authorization}Content-Type: application/json\r\n"),
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "GET",
            "/v1/runtime",
            String::new(),
            "401 Unauthorized",
            "auth-missing",
        ),
        (
            "GET",
            "/v1/runtime",
            authorization,
            "401 Unauthorized",
            "auth-invalid",
        ),
    ];

    for (method, target, extra, status, code) in cases {
        let before = server.metrics().body_reads;
        let response = roundtrip(request(method, target, &extra)).await;
        assert_problem(&response, status, code);
        assert_eq!(
            server.metrics().body_reads,
            before,
            "route classification reached body polling: {method} {target}"
        );
        assert!(
            !response.contains("C7_RAW_TARGET_SENTINEL"),
            "raw target leaked: {method} {target}"
        );
    }

    server.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c7_buffered_body_overrun_precedes_protected_auth() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local(), test_ports(false).0)
        .await
        .expect("fixed listener should bind");
    let authorization = format!("Authorization: Bearer {}\r\n", "S".repeat(43));
    let raw = format!(
        "POST /v1/jobs HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nX-OVP-Client-Version: 1.0.0\r\nContent-Type: application/json\r\nContent-Length: 0\r\n{authorization}\r\nX"
    );

    let before = server.metrics().body_reads;
    let response = roundtrip(raw).await;
    assert_problem(&response, "400 Bad Request", "schema-invalid");
    assert!(!response.contains("auth-invalid"));
    assert_eq!(
        server.metrics().body_reads,
        before,
        "buffered framing overrun reached body polling"
    );

    server.shutdown().await;
}

fn preflight_request(target: &str, headers: &str, body: &str) -> String {
    format!(
        "OPTIONS {target} HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\n{headers}\r\n{body}"
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c7_preflight_is_route_method_header_parameter_and_body_exact() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local(), test_ports(false).0)
        .await
        .expect("fixed listener should bind");

    let valid = [
        ("/v1/health", "GET", "x-ovp-client-version"),
        (
            "/v1/pairings/challenges",
            "POST",
            "X-OVP-CLIENT-VERSION,\tcontent-type",
        ),
        (
            "/v1/pairings/challenges/11111111-1111-4111-8111-111111111111/redeem",
            "POST",
            "content-type, X-OVP-Client-Version",
        ),
        (
            "/v1/pairings/current",
            "GET",
            "x-ovp-client-version, AUTHORIZATION",
        ),
        (
            "/v1/pairings/current",
            "DELETE",
            "Authorization,X-OVP-Client-Version",
        ),
        ("/v1/runtime", "GET", "Authorization, X-OVP-Client-Version"),
        ("/v1/engines", "GET", "X-OVP-Client-Version, authorization"),
        ("/v1/voices", "GET", "authorization,\tX-OVP-Client-Version"),
        ("/v1/packs", "GET", "Authorization, X-OVP-Client-Version"),
        (
            "/v1/jobs",
            "POST",
            "content-type, X-OVP-Client-Version, AUTHORIZATION",
        ),
        (
            "/v1/jobs/22222222-2222-4222-8222-222222222222",
            "GET",
            "Authorization, X-OVP-Client-Version",
        ),
        (
            "/v1/jobs/33333333-3333-4333-8333-333333333333",
            "DELETE",
            "x-ovp-client-version, authorization",
        ),
        (
            "/v1/jobs/44444444-4444-4444-8444-444444444444/audio",
            "GET",
            "AUTHORIZATION, x-ovp-client-version",
        ),
        (
            "/v1/packs/pocket-companion-pack/actions",
            "POST",
            "X-OVP-Client-Version, Content-Type, Authorization",
        ),
    ];
    for (index, (target, method, requested_headers)) in valid.into_iter().enumerate() {
        let private_network = if index % 2 == 0 {
            "Access-Control-Request-Private-Network: true\r\n"
        } else {
            ""
        };
        let headers = format!(
            "Access-Control-Request-Method: {method}\r\nAccess-Control-Request-Headers: {requested_headers}\r\n{private_network}"
        );
        let before = server.metrics().body_reads;
        let response = roundtrip(preflight_request(target, &headers, "")).await;
        assert!(
            response.starts_with("HTTP/1.1 204 No Content\r\n"),
            "valid preflight failed: {method} {target}: {response:?}"
        );
        assert!(response.ends_with("\r\n\r\n"));
        assert_security_headers(&response);
        assert_eq!(
            server.metrics().body_reads,
            before,
            "valid preflight polled a body: {method} {target}"
        );
    }

    let rejected = vec![
        (
            "/v1/C7_PREFLIGHT_SENTINEL",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "404 Not Found",
            "resource-not-found",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: Content-Type, X-OVP-Client-Version\r\n".to_owned(),
            "",
            "405 Method Not Allowed",
            "method-not-allowed",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: OPTIONS\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "405 Method Not Allowed",
            "method-not-allowed",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: HEAD\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: PUT\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: get\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "duplicate-header",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "duplicate-header",
        ),
        (
            "/v1/runtime",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version, X-C7-Extra\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: *\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: , X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version, x-ovp-client-version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/pairings/challenges/not-a-uuid/redeem",
            "Access-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: Content-Type, X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/jobs/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: Authorization, X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/packs/not-the-pack/actions",
            "Access-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: Authorization, Content-Type, X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            format!(
                "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nAuthorization: Bearer {}\r\n",
                "S".repeat(43)
            ),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nCookie: c7=forbidden\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nContent-Type: application/json\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nX-OVP-Client-Version: 1.0.0\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nAccess-Control-Request-Private-Network: false\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nAccess-Control-Request-Private-Network: True\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nAccess-Control-Request-Private-Network: true\r\nAccess-Control-Request-Private-Network: true\r\n".to_owned(),
            "",
            "400 Bad Request",
            "duplicate-header",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "C7_BODY_PREFIX",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nContent-Length: 1\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nContent-Length: 0\r\n".to_owned(),
            "X",
            "400 Bad Request",
            "schema-invalid",
        ),
    ];

    for (target, headers, body, status, code) in rejected {
        let before = server.metrics().body_reads;
        let response = roundtrip(preflight_request(target, &headers, body)).await;
        assert_problem(&response, status, code);
        assert_eq!(
            server.metrics().body_reads,
            before,
            "rejected preflight polled a body: {target}"
        );
        assert!(!response.contains("C7_PREFLIGHT_SENTINEL"));
    }

    server.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn c9_explicit_shutdown_quiesces_tracked_tasks_before_return() {
    let _fixed_port = FIXED_PORT.lock().await;
    let state = Arc::new(BoundaryState::default());
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let ports = ServerPorts::new(
        Arc::new(BlockingHealthHandler {
            state: Arc::clone(&state),
            entered: Arc::clone(&entered),
            release: Arc::clone(&release),
        }),
        Arc::new(BoundaryAuth {
            state: Arc::clone(&state),
            accept: true,
        }),
        Arc::new(BoundaryRate {
            state: Arc::clone(&state),
            error: None,
        }),
        Arc::new(BoundaryClock {
            state: Arc::clone(&state),
        }),
        fixed_listener_port(),
    );
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");

    let mut partial_header = TcpStream::connect(server.local_addr()).await.unwrap();
    partial_header.write_all(b"GET /v1/health").await.unwrap();

    let mut blocked_handler = TcpStream::connect(server.local_addr()).await.unwrap();
    blocked_handler
        .write_all(request("GET", "/v1/health", "").as_bytes())
        .await
        .unwrap();
    timeout(Duration::from_secs(2), entered.notified())
        .await
        .expect("handler entered");

    let final_metrics = server.shutdown().await;
    assert_eq!(final_metrics.active_connections, 0);
    assert_eq!(final_metrics.tracked_connection_tasks, 0);
    assert_eq!(final_metrics.occupied_handler_slots, 0);
    let calls_after_shutdown = state.handler_calls.load(Ordering::SeqCst);
    release.notify_waiters();
    sleep(Duration::from_millis(25)).await;

    assert_eq!(
        state.handler_calls.load(Ordering::SeqCst),
        calls_after_shutdown,
        "a handler ran after shutdown returned"
    );
    assert_closed_without_bytes(&mut partial_header).await;
    assert_closed_without_bytes(&mut blocked_handler).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn c9_connection_admission_is_exactly_32_then_closes_33rd_and_recovers() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local(), test_ports(false).0)
        .await
        .expect("fixed listener should bind");

    let mut held = Vec::new();
    for _ in 0..32 {
        let mut stream = TcpStream::connect(server.local_addr()).await.unwrap();
        stream.write_all(b"G").await.unwrap();
        held.push(stream);
    }
    wait_until(|| {
        let metrics = server.metrics();
        metrics.active_connections == 32
            && metrics.tracked_connection_tasks == 32
            && metrics.occupied_handler_slots == 0
    })
    .await;
    assert_eq!(server.metrics().peak_connections, 32);

    let mut overflow = TcpStream::connect(server.local_addr()).await.unwrap();
    assert_closed_without_bytes(&mut overflow).await;
    wait_until(|| server.metrics().rejected_connections == 1).await;
    assert_eq!(server.metrics().active_connections, 32);
    assert_eq!(server.metrics().tracked_connection_tasks, 32);

    drop(held.remove(0));
    wait_until(|| server.metrics().active_connections == 31).await;
    let mut replacement = TcpStream::connect(server.local_addr()).await.unwrap();
    replacement.write_all(b"G").await.unwrap();
    wait_until(|| server.metrics().active_connections == 32).await;
    assert_eq!(server.metrics().peak_connections, 32);

    drop(replacement);
    drop(held);
    let final_metrics = server.shutdown().await;
    assert_eq!(final_metrics.active_connections, 0);
    assert_eq!(final_metrics.tracked_connection_tasks, 0);
    assert_eq!(final_metrics.occupied_handler_slots, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn c9_sixty_four_connection_race_has_exactly_32_admitted_and_recovers_edges() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local(), test_ports(false).0)
        .await
        .expect("fixed listener should bind");
    let address = server.local_addr();
    let mut connect_tasks = tokio::task::JoinSet::new();
    for _ in 0..64 {
        connect_tasks.spawn(async move {
            let mut stream = TcpStream::connect(address).await.unwrap();
            stream.write_all(b"G").await.unwrap_or_default();
            stream
        });
    }
    let mut streams = Vec::new();
    while let Some(joined) = connect_tasks.join_next().await {
        streams.push(joined.unwrap());
    }
    wait_until(|| {
        let metrics = server.metrics();
        metrics.active_connections == 32
            && metrics.tracked_connection_tasks == 32
            && metrics.rejected_connections == 32
    })
    .await;
    let metrics = server.metrics();
    assert_eq!(metrics.peak_connections, 32);
    assert_eq!(metrics.occupied_handler_slots, 0);

    let mut classify_tasks = tokio::task::JoinSet::new();
    for mut stream in streams {
        classify_tasks.spawn(async move {
            let mut byte = [0_u8; 1];
            let admitted = timeout(Duration::from_millis(250), stream.read(&mut byte))
                .await
                .is_err();
            (admitted, stream)
        });
    }
    let mut held = Vec::new();
    let mut closed = 0;
    while let Some(joined) = classify_tasks.join_next().await {
        let (admitted, stream) = joined.unwrap();
        if admitted {
            held.push(stream);
        } else {
            closed += 1;
        }
    }
    assert_eq!(held.len(), 32);
    assert_eq!(closed, 32);

    for index in [31_usize, 16, 0] {
        drop(held.remove(index));
        let expected = held.len();
        wait_until(|| server.metrics().active_connections == expected).await;
        let mut replacement = TcpStream::connect(address).await.unwrap();
        replacement.write_all(b"G").await.unwrap();
        held.push(replacement);
        wait_until(|| server.metrics().active_connections == 32).await;
        assert_eq!(server.metrics().peak_connections, 32);
    }

    drop(held);
    let final_metrics = server.shutdown().await;
    assert_eq!(final_metrics.active_connections, 0);
    assert_eq!(final_metrics.tracked_connection_tasks, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn c9_slow_headers_do_not_consume_handler_slots() {
    let _fixed_port = FIXED_PORT.lock().await;
    let (ports, state) = test_ports(false);
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");

    let mut slow_headers = Vec::new();
    for _ in 0..8 {
        let mut stream = TcpStream::connect(server.local_addr()).await.unwrap();
        stream.write_all(b"G").await.unwrap();
        slow_headers.push(stream);
    }
    wait_until(|| {
        let metrics = server.metrics();
        metrics.active_connections == 8 && metrics.occupied_handler_slots == 0
    })
    .await;

    let response = roundtrip(request("GET", "/v1/health", "")).await;
    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
    assert_eq!(state.handler_calls.load(Ordering::SeqCst), 1);

    drop(slow_headers);
    server.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn c9_preflight_and_every_prehandler_rejection_keep_handler_peak_zero() {
    let _fixed_port = FIXED_PORT.lock().await;
    let (ports, state) = test_ports(false);
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");
    let mut partial = TcpStream::connect(server.local_addr()).await.unwrap();
    partial.write_all(b"G").await.unwrap();
    wait_until(|| server.metrics().active_connections == 1).await;

    let preflight = roundtrip(preflight_request(
        "/v1/health",
        "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n",
        "",
    ))
    .await;
    assert!(preflight.starts_with("HTTP/1.1 204 No Content\r\n"));

    let route_error = roundtrip(request("GET", "/v1/not-a-route", "")).await;
    assert_problem(&route_error, "404 Not Found", "resource-not-found");

    let bearer = format!("Authorization: Bearer {}\r\n", "A".repeat(43));
    let auth_rejection = roundtrip(request("GET", "/v1/runtime", &bearer)).await;
    assert_problem(&auth_rejection, "401 Unauthorized", "auth-invalid");

    let schema_rejection = roundtrip(format!(
        "{}{{}}",
        request(
            "POST",
            "/v1/pairings/challenges",
            "Content-Type: application/json\r\nContent-Length: 2\r\n",
        )
    ))
    .await;
    assert_problem(&schema_rejection, "400 Bad Request", "schema-invalid");

    let metrics = server.metrics();
    assert_eq!(metrics.occupied_handler_slots, 0);
    assert_eq!(metrics.peak_handler_slots, 0);
    assert_eq!(state.handler_calls.load(Ordering::SeqCst), 0);
    let final_metrics = server.shutdown().await;
    assert_eq!(final_metrics.occupied_handler_slots, 0);
    assert_eq!(final_metrics.peak_handler_slots, 0);
    assert_closed_without_bytes(&mut partial).await;

    let delay = RetryAfterSeconds::new(1).unwrap();
    let (ports, state) = test_ports_with_rate(true, Some(RateLimitError::Limited(delay)));
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should immediately rebind");
    let rate_rejection = roundtrip(format!(
        "{}{{}}",
        request(
            "POST",
            "/v1/pairings/challenges",
            "Content-Type: application/json\r\nContent-Length: 2\r\n",
        )
    ))
    .await;
    assert_problem(&rate_rejection, "429 Too Many Requests", "rate-limited");
    let final_metrics = server.shutdown().await;
    assert_eq!(final_metrics.occupied_handler_slots, 0);
    assert_eq!(final_metrics.peak_handler_slots, 0);
    assert_eq!(state.handler_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn c9_auth_commit_in_progress_holds_handler_slot_until_shutdown_cancels_it() {
    let _fixed_port = FIXED_PORT.lock().await;
    let state = Arc::new(BoundaryState::default());
    let commit_entered = Arc::new(AtomicUsize::new(0));
    let release = Arc::new(Notify::new());
    let ports = ServerPorts::new(
        Arc::new(BoundaryHandler {
            state: Arc::clone(&state),
        }),
        Arc::new(BlockingCommitAuth {
            state: Arc::clone(&state),
            entered: Arc::clone(&commit_entered),
            release: Arc::clone(&release),
        }),
        Arc::new(BoundaryRate {
            state: Arc::clone(&state),
            error: None,
        }),
        Arc::new(BoundaryClock {
            state: Arc::clone(&state),
        }),
        fixed_listener_port(),
    );
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");
    let bearer = format!("Authorization: Bearer {}\r\n", "A".repeat(43));
    let mut stream = TcpStream::connect(server.local_addr()).await.unwrap();
    stream
        .write_all(
            request(
                "GET",
                "/v1/jobs/11111111-1111-4111-8111-111111111111/audio",
                &bearer,
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    wait_until(|| {
        commit_entered.load(Ordering::SeqCst) == 1 && server.metrics().occupied_handler_slots == 1
    })
    .await;
    assert_eq!(state.auth_reservations.load(Ordering::SeqCst), 1);
    assert_eq!(state.auth_commits.load(Ordering::SeqCst), 0);
    assert_eq!(state.rate_reservations.load(Ordering::SeqCst), 1);
    assert_eq!(state.rate_commits.load(Ordering::SeqCst), 0);
    assert_eq!(state.handler_calls.load(Ordering::SeqCst), 0);

    let final_metrics = server.shutdown().await;
    assert_eq!(final_metrics.active_connections, 0);
    assert_eq!(final_metrics.tracked_connection_tasks, 0);
    assert_eq!(final_metrics.occupied_handler_slots, 0);
    release.notify_waiters();
    sleep(Duration::from_millis(10)).await;
    assert_eq!(state.auth_commits.load(Ordering::SeqCst), 0);
    assert_eq!(state.rate_commits.load(Ordering::SeqCst), 0);
    assert_eq!(state.handler_calls.load(Ordering::SeqCst), 0);
    assert_closed_without_bytes(&mut stream).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn c9_handler_admission_is_exactly_8_then_checked_503_before_commits() {
    let _fixed_port = FIXED_PORT.lock().await;
    let state = Arc::new(BoundaryState::default());
    let release = Arc::new(Semaphore::new(0));
    let ports = ServerPorts::new(
        Arc::new(SaturatingHandler {
            state: Arc::clone(&state),
            release: Arc::clone(&release),
        }),
        Arc::new(BoundaryAuth {
            state: Arc::clone(&state),
            accept: true,
        }),
        Arc::new(BoundaryRate {
            state: Arc::clone(&state),
            error: None,
        }),
        Arc::new(BoundaryClock {
            state: Arc::clone(&state),
        }),
        fixed_listener_port(),
    );
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");
    let bearer = format!("Authorization: Bearer {}\r\n", "A".repeat(43));
    let initial = [
        request("GET", "/v1/health", ""),
        request("GET", "/v1/pairings/current", &bearer),
        request("GET", "/v1/runtime", &bearer),
        request("GET", "/v1/engines", &bearer),
        request("GET", "/v1/voices", &bearer),
        request("GET", "/v1/packs", &bearer),
        request(
            "GET",
            "/v1/jobs/11111111-1111-4111-8111-111111111111",
            &bearer,
        ),
        request(
            "GET",
            "/v1/jobs/22222222-2222-4222-8222-222222222222/audio",
            &bearer,
        ),
    ];
    let mut held = Vec::new();
    for raw in initial {
        let mut stream = TcpStream::connect(server.local_addr()).await.unwrap();
        stream.write_all(raw.as_bytes()).await.unwrap();
        held.push(stream);
    }
    wait_until(|| {
        let metrics = server.metrics();
        state.handler_calls.load(Ordering::SeqCst) == 8
            && metrics.occupied_handler_slots == 8
            && metrics.peak_handler_slots == 8
    })
    .await;

    let auth_commits_before = state.auth_commits.load(Ordering::SeqCst);
    let rate_commits_before = state.rate_commits.load(Ordering::SeqCst);
    let auth_reservations_before = state.auth_reservations.load(Ordering::SeqCst);
    let rate_reservations_before = state.rate_reservations.load(Ordering::SeqCst);
    let ninth = roundtrip(request("GET", "/v1/runtime", &bearer)).await;
    assert_problem(&ninth, "503 Service Unavailable", "queue-full");
    assert!(ninth.contains("Retry-After: 1\r\n"));
    assert_eq!(state.handler_calls.load(Ordering::SeqCst), 8);
    assert_eq!(
        state.auth_reservations.load(Ordering::SeqCst),
        auth_reservations_before + 1
    );
    assert_eq!(
        state.rate_reservations.load(Ordering::SeqCst),
        rate_reservations_before + 1
    );
    assert_eq!(
        state.auth_commits.load(Ordering::SeqCst),
        auth_commits_before
    );
    assert_eq!(
        state.rate_commits.load(Ordering::SeqCst),
        rate_commits_before
    );
    assert_eq!(server.metrics().rejected_handlers, 1);

    release.add_permits(1);
    wait_until(|| server.metrics().occupied_handler_slots == 7).await;
    let mut replacement = TcpStream::connect(server.local_addr()).await.unwrap();
    replacement
        .write_all(request("GET", "/v1/runtime", &bearer).as_bytes())
        .await
        .unwrap();
    wait_until(|| {
        state.handler_calls.load(Ordering::SeqCst) == 9
            && server.metrics().occupied_handler_slots == 8
    })
    .await;

    release.add_permits(8);
    held.push(replacement);
    for mut stream in held {
        let mut response = Vec::new();
        timeout(Duration::from_secs(2), stream.read_to_end(&mut response))
            .await
            .expect("released handler response closes")
            .unwrap_or_default();
    }
    let final_metrics = server.shutdown().await;
    assert_eq!(final_metrics.occupied_handler_slots, 0);
    assert_eq!(final_metrics.tracked_connection_tasks, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn c9_real_socket_blocked_handler_times_out_with_checked_504_smoke() {
    let _fixed_port = FIXED_PORT.lock().await;
    let state = Arc::new(BoundaryState::default());
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let ports = ServerPorts::new(
        Arc::new(BlockingHealthHandler {
            state: Arc::clone(&state),
            entered: Arc::clone(&entered),
            release: Arc::clone(&release),
        }),
        Arc::new(BoundaryAuth {
            state: Arc::clone(&state),
            accept: true,
        }),
        Arc::new(BoundaryRate {
            state: Arc::clone(&state),
            error: None,
        }),
        Arc::new(BoundaryClock {
            state: Arc::clone(&state),
        }),
        fixed_listener_port(),
    );
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");
    let mut stream = TcpStream::connect(server.local_addr()).await.unwrap();
    stream
        .write_all(request("GET", "/v1/health", "").as_bytes())
        .await
        .unwrap();
    timeout(Duration::from_secs(2), entered.notified())
        .await
        .expect("blocked handler entered");

    let mut response = Vec::new();
    timeout(Duration::from_secs(32), stream.read_to_end(&mut response))
        .await
        .expect("thirty-second handler wall-clock smoke")
        .unwrap();
    let response = String::from_utf8(response).unwrap();
    assert_problem(&response, "504 Gateway Timeout", "handler-timeout");
    wait_until(|| server.metrics().occupied_handler_slots == 0).await;
    assert_eq!(state.handler_calls.load(Ordering::SeqCst), 1);
    release.notify_waiters();
    sleep(Duration::from_millis(25)).await;
    assert_eq!(state.handler_calls.load(Ordering::SeqCst), 1);

    let final_metrics = server.shutdown().await;
    assert_eq!(final_metrics.active_connections, 0);
    assert_eq!(final_metrics.tracked_connection_tasks, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn c9_request_head_and_body_ceilings_are_inclusive_and_max_plus_one_is_exact() {
    let _fixed_port = FIXED_PORT.lock().await;
    let (ports, state) = test_ports(false);
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");

    let target_2048 = format!("/{}", "a".repeat(2_034));
    let line_2048 = format!("GET {target_2048} HTTP/1.1");
    assert_eq!(line_2048.len(), 2_048);
    let response = roundtrip(format!(
        "{line_2048}\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nX-OVP-Client-Version: 1.0.0\r\n\r\n"
    ))
    .await;
    assert_problem(&response, "404 Not Found", "resource-not-found");

    let target_2049 = format!("/{}", "a".repeat(2_035));
    let line_2049 = format!("GET {target_2049} HTTP/1.1");
    assert_eq!(line_2049.len(), 2_049);
    let response = roundtrip(format!(
        "{line_2049}\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nX-OVP-Client-Version: 1.0.0\r\n\r\n"
    ))
    .await;
    assert_problem(&response, "414 URI Too Long", "request-line-too-large");

    let head_prefix = format!(
        "GET /v1/health HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nX-OVP-Client-Version: 1.0.0\r\nX-Fill: "
    );
    let head_suffix = "\r\n\r\n";
    let fill_8192 = "a".repeat(8_192 - head_prefix.len() - head_suffix.len());
    let head_8192 = format!("{head_prefix}{fill_8192}{head_suffix}");
    assert_eq!(head_8192.len(), 8_192);
    let response = roundtrip(head_8192).await;
    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
    let calls_after_head_max = state.handler_calls.load(Ordering::SeqCst);

    let fill_8193 = "a".repeat(8_193 - head_prefix.len() - head_suffix.len());
    let head_8193 = format!("{head_prefix}{fill_8193}{head_suffix}");
    assert_eq!(head_8193.len(), 8_193);
    let response = roundtrip(head_8193).await;
    assert_problem(
        &response,
        "431 Request Header Fields Too Large",
        "headers-too-large",
    );
    assert_eq!(
        state.handler_calls.load(Ordering::SeqCst),
        calls_after_head_max
    );

    let mut body_16384 = b"{}".to_vec();
    body_16384.resize(16_384, b' ');
    let mut raw = request(
        "POST",
        "/v1/pairings/challenges",
        "Content-Type: application/json\r\nContent-Length: 16384\r\n",
    )
    .into_bytes();
    raw.extend_from_slice(&body_16384);
    let reads_before_max = server.metrics().body_reads;
    let response = String::from_utf8(roundtrip_bytes(raw).await).unwrap();
    assert_problem(&response, "400 Bad Request", "schema-invalid");
    assert!(server.metrics().body_reads > reads_before_max);
    let reads_before_over = server.metrics().body_reads;
    let calls_before_over = state.handler_calls.load(Ordering::SeqCst);

    let response = roundtrip(request(
        "POST",
        "/v1/pairings/challenges",
        "Content-Type: application/json\r\nContent-Length: 16385\r\n",
    ))
    .await;
    assert_problem(&response, "413 Payload Too Large", "body-too-large");
    assert_eq!(server.metrics().body_reads, reads_before_over);
    assert_eq!(
        state.handler_calls.load(Ordering::SeqCst),
        calls_before_over
    );

    let final_metrics = server.shutdown().await;
    assert_eq!(final_metrics.active_connections, 0);
    assert_eq!(final_metrics.tracked_connection_tasks, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn c9_sixteen_shutdown_rebind_generations_are_quiescent() {
    let _fixed_port = FIXED_PORT.lock().await;
    let mut prior_states: Vec<(Arc<BoundaryState>, BoundarySnapshot)> = Vec::new();
    let mut prior_writer_calls: Vec<(Arc<AtomicUsize>, usize)> = Vec::new();

    for generation in 0..16 {
        for (state, snapshot) in &prior_states {
            assert_eq!(state.snapshot(), *snapshot);
        }
        for (calls, expected) in &prior_writer_calls {
            assert_eq!(calls.load(Ordering::SeqCst), *expected);
        }

        let state = Arc::new(BoundaryState::default());
        let release = Arc::new(Semaphore::new(0));
        let writer_calls = Arc::new(AtomicUsize::new(0));
        let phase = generation % 5;
        let handler: Arc<dyn HandlerPort> = if phase == 3 {
            Arc::new(LargeWavHandler {
                calls: Arc::clone(&writer_calls),
            })
        } else {
            Arc::new(SaturatingHandler {
                state: Arc::clone(&state),
                release: Arc::clone(&release),
            })
        };
        let listener: Arc<dyn FixedListenerPort> = if phase == 3 {
            Arc::new(SmallSendBufferFixedListener)
        } else {
            fixed_listener_port()
        };
        let ports = ServerPorts::new(
            handler,
            Arc::new(BoundaryAuth {
                state: Arc::clone(&state),
                accept: true,
            }),
            Arc::new(BoundaryRate {
                state: Arc::clone(&state),
                error: None,
            }),
            Arc::new(BoundaryClock {
                state: Arc::clone(&state),
            }),
            listener,
        );
        let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
            .await
            .expect("every generation binds the exact fixed address");
        let mut active_stream = match phase {
            0 => {
                let mut stream = TcpStream::connect(server.local_addr()).await.unwrap();
                stream.write_all(b"G").await.unwrap();
                wait_until(|| server.metrics().active_connections == 1).await;
                Some(stream)
            }
            1 => {
                let mut stream = TcpStream::connect(server.local_addr()).await.unwrap();
                stream
                    .write_all(
                        request(
                            "POST",
                            "/v1/pairings/challenges",
                            "Content-Type: application/json\r\nContent-Length: 100\r\n",
                        )
                        .as_bytes(),
                    )
                    .await
                    .unwrap();
                wait_until(|| server.metrics().body_reads > 0).await;
                Some(stream)
            }
            2 => {
                let mut stream = TcpStream::connect(server.local_addr()).await.unwrap();
                stream
                    .write_all(request("GET", "/v1/health", "").as_bytes())
                    .await
                    .unwrap();
                wait_until(|| {
                    state.handler_calls.load(Ordering::SeqCst) == 1
                        && server.metrics().occupied_handler_slots == 1
                })
                .await;
                Some(stream)
            }
            3 => {
                let client = TcpSocket::new_v4().unwrap();
                client.set_recv_buffer_size(1_024).unwrap();
                let mut stream = client.connect(server.local_addr()).await.unwrap();
                let bearer = format!("Authorization: Bearer {}\r\n", "A".repeat(43));
                stream
                    .write_all(
                        request(
                            "GET",
                            "/v1/jobs/11111111-1111-4111-8111-111111111111/audio",
                            &bearer,
                        )
                        .as_bytes(),
                    )
                    .await
                    .unwrap();
                wait_until(|| writer_calls.load(Ordering::SeqCst) == 1).await;
                let mut first = [0_u8; 1];
                timeout(Duration::from_secs(2), stream.read_exact(&mut first))
                    .await
                    .expect("writer must enter the socket response")
                    .unwrap();
                assert_eq!(first[0], b'H');
                let metrics = server.metrics();
                assert_eq!(metrics.occupied_handler_slots, 0);
                Some(stream)
            }
            _ => None,
        };

        let writer_calls_before_shutdown = writer_calls.load(Ordering::SeqCst);
        let final_metrics = server.shutdown().await;
        assert_eq!(final_metrics.active_connections, 0);
        assert_eq!(final_metrics.tracked_connection_tasks, 0);
        assert_eq!(final_metrics.occupied_handler_slots, 0);
        let state_after_shutdown = state.snapshot();
        release.add_permits(1);
        sleep(Duration::from_millis(10)).await;
        assert_eq!(state.snapshot(), state_after_shutdown);
        assert_eq!(
            writer_calls.load(Ordering::SeqCst),
            writer_calls_before_shutdown
        );
        if let Some(stream) = active_stream.as_mut() {
            if phase == 3 {
                assert_eventually_closed(stream).await;
            } else {
                assert_closed_without_bytes(stream).await;
            }
        }
        prior_states.push((state, state_after_shutdown));
        prior_writer_calls.push((writer_calls, writer_calls_before_shutdown));
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn c9_handler_panic_is_contained_and_restores_all_capacity() {
    let _fixed_port = FIXED_PORT.lock().await;
    let state = Arc::new(BoundaryState::default());
    let ports = ServerPorts::new(
        Arc::new(PanicHandler),
        Arc::new(BoundaryAuth {
            state: Arc::clone(&state),
            accept: true,
        }),
        Arc::new(BoundaryRate {
            state: Arc::clone(&state),
            error: None,
        }),
        Arc::new(BoundaryClock {
            state: Arc::clone(&state),
        }),
        fixed_listener_port(),
    );
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");
    let mut panicking = TcpStream::connect(server.local_addr()).await.unwrap();
    panicking
        .write_all(request("GET", "/v1/health", "").as_bytes())
        .await
        .unwrap();
    assert_closed_without_bytes(&mut panicking).await;
    wait_until(|| {
        let metrics = server.metrics();
        metrics.active_connections == 0
            && metrics.tracked_connection_tasks == 0
            && metrics.occupied_handler_slots == 0
    })
    .await;

    let mut replacement = TcpStream::connect(server.local_addr()).await.unwrap();
    replacement.write_all(b"G").await.unwrap();
    wait_until(|| server.metrics().active_connections == 1).await;
    let final_metrics = server.shutdown().await;
    assert_eq!(final_metrics.active_connections, 0);
    assert_eq!(final_metrics.tracked_connection_tasks, 0);
    assert_eq!(final_metrics.occupied_handler_slots, 0);
    assert_closed_without_bytes(&mut replacement).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn c9_large_response_nonreading_client_writer_smoke_restores_capacity() {
    let _fixed_port = FIXED_PORT.lock().await;
    let state = Arc::new(BoundaryState::default());
    let handler_calls = Arc::new(AtomicUsize::new(0));
    let ports = ServerPorts::new(
        Arc::new(LargeWavHandler {
            calls: Arc::clone(&handler_calls),
        }),
        Arc::new(BoundaryAuth {
            state: Arc::clone(&state),
            accept: true,
        }),
        Arc::new(BoundaryRate {
            state: Arc::clone(&state),
            error: None,
        }),
        Arc::new(BoundaryClock {
            state: Arc::clone(&state),
        }),
        Arc::new(SmallSendBufferFixedListener),
    );
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("fixed listener should bind");
    let bearer = format!("Authorization: Bearer {}\r\n", "A".repeat(43));
    let client = TcpSocket::new_v4().unwrap();
    client.set_recv_buffer_size(1_024).unwrap();
    let mut stream = client.connect(server.local_addr()).await.unwrap();
    stream
        .write_all(
            request(
                "GET",
                "/v1/jobs/11111111-1111-4111-8111-111111111111/audio",
                &bearer,
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    wait_until(|| handler_calls.load(Ordering::SeqCst) == 1).await;
    sleep(Duration::from_millis(100)).await;
    assert_eq!(server.metrics().occupied_handler_slots, 0);

    let final_metrics = server.shutdown().await;
    assert_eq!(final_metrics.active_connections, 0);
    assert_eq!(final_metrics.tracked_connection_tasks, 0);
    assert_eq!(final_metrics.occupied_handler_slots, 0);
    let calls_after_shutdown = handler_calls.load(Ordering::SeqCst);

    drop(stream);
    assert_eq!(handler_calls.load(Ordering::SeqCst), calls_after_shutdown);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fixed_ipv4_raw_http_boundary_fails_closed() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local(), test_ports(false).0)
        .await
        .expect("fixed listener should bind");
    assert_eq!(
        server.local_addr(),
        SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, 17_843))
    );
    assert_eq!(
        CompanionServer::start(OriginPolicy::debug_local(), test_ports(false).0)
            .await
            .unwrap_err(),
        ListenerError::Conflict
    );

    let health = roundtrip(request("GET", "/v1/health", "")).await;
    assert!(health.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(health.contains("\"listenerState\":\"listening\""));
    assert!(health.contains(&format!("Access-Control-Allow-Origin: {GOOD_ORIGIN}")));
    assert_security_headers(&health);

    for bad_host in [
        "",
        "Host: 127.0.0.1:17843\r\nHost: 127.0.0.1:17843\r\n",
        "Host: 127.0.0.1:17843, localhost:17843\r\n",
        "Host: localhost:17843\r\n",
        "Host: 127.0.0.1.:17843\r\n",
        "Host: 127.0.0.1:17844\r\n",
        "Host: [::1]:17843\r\n",
        "Host: user@127.0.0.1:17843\r\n",
    ] {
        let raw = format!(
            "GET /v1/health HTTP/1.1\r\n{bad_host}Origin: {GOOD_ORIGIN}\r\nX-OVP-Client-Version: 1.0.0\r\n\r\n"
        );
        let response = roundtrip(raw).await;
        assert!(
            response.starts_with("HTTP/1.1 400 Bad Request"),
            "{bad_host:?}"
        );
        assert!(response.contains("\"code\":\"host-invalid\""));
        assert_security_headers(&response);
    }

    let absolute_mismatch = roundtrip(request("GET", "http://localhost:17843/v1/health", "")).await;
    assert!(absolute_mismatch.contains("\"code\":\"host-invalid\""));

    for (origin_header, code) in [
        ("", "origin-missing"),
        ("Origin: null\r\n", "origin-denied"),
        ("Origin: file://\r\n", "origin-denied"),
        ("Origin: https://preview.example\r\n", "origin-denied"),
        (
            "Origin: http://127.0.0.1:5173\r\nOrigin: http://127.0.0.1:5173\r\n",
            "origin-denied",
        ),
    ] {
        let raw = format!(
            "GET /v1/health HTTP/1.1\r\nHost: 127.0.0.1:17843\r\n{origin_header}X-OVP-Client-Version: 1.0.0\r\n\r\n"
        );
        let response = roundtrip(raw).await;
        assert!(response.contains(&format!("\"code\":\"{code}\"")));
        assert!(!response.contains("Access-Control-Allow-Origin"));
    }

    for (version, code) in [("", "version-missing"), ("2.0.0", "version-unsupported")] {
        let version_header = if version.is_empty() {
            String::new()
        } else {
            format!("X-OVP-Client-Version: {version}\r\n")
        };
        let raw = format!(
            "GET /v1/health HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\n{version_header}\r\n"
        );
        let response = roundtrip(raw).await;
        assert!(response.contains(&format!("\"code\":\"{code}\"")));
    }

    for headers in [
        "Authorization: Bearer a\r\nAuthorization: Bearer b\r\n",
        "Content-Length: 1\r\nContent-Length: 1\r\n",
        "Content-Length: 1\r\nTransfer-Encoding: chunked\r\n",
        "Transfer-Encoding: gzip\r\n",
    ] {
        let response = roundtrip(request("POST", "/v1/pairings/challenges", headers)).await;
        assert!(response.starts_with("HTTP/1.1 400 Bad Request"));
        assert_security_headers(&response);
    }

    let oversize = roundtrip(request(
        "POST",
        "/v1/pairings/challenges",
        "Content-Type: application/json\r\nContent-Length: 16385\r\n",
    ))
    .await;
    assert!(oversize.starts_with("HTTP/1.1 413 Payload Too Large"));
    assert!(oversize.contains("\"code\":\"body-too-large\""));

    let preflight = roundtrip(format!(
        "OPTIONS /v1/jobs HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: Authorization, Content-Type, X-OVP-Client-Version\r\nAccess-Control-Request-Private-Network: true\r\n\r\n"
    ))
    .await;
    assert!(preflight.starts_with("HTTP/1.1 204 No Content"));
    assert!(preflight.contains("Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS"));
    assert!(preflight.contains(
        "Access-Control-Allow-Headers: Authorization, Content-Type, X-OVP-Client-Version"
    ));
    assert!(preflight.contains("Access-Control-Max-Age: 600"));
    assert!(preflight.contains("Access-Control-Allow-Private-Network: true"));
    assert!(preflight.contains("Access-Control-Request-Private-Network"));
    assert_security_headers(&preflight);

    let invalid_preflight = roundtrip(format!(
        "OPTIONS /v1/jobs HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nAccess-Control-Request-Method: PUT\r\nAccess-Control-Request-Headers: X-Evil\r\n\r\n"
    ))
    .await;
    assert_problem(&invalid_preflight, "400 Bad Request", "schema-invalid");
    assert!(!invalid_preflight.contains("Access-Control-Allow-Origin"));

    let long_target = format!("/{}", "a".repeat(2_048));
    let response = roundtrip(request("GET", &long_target, "")).await;
    assert!(response.contains("\"code\":\"request-line-too-large\""));

    let large_header = "X-Fill: ".to_owned() + &"a".repeat(8_192) + "\r\n";
    let response = roundtrip(request("GET", "/v1/health", &large_header)).await;
    assert!(response.contains("\"code\":\"headers-too-large\""));

    let before = server.metrics();
    let mut prebody = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, 17_843))
        .await
        .unwrap();
    prebody
        .write_all(
            b"POST /v1/pairings/challenges HTTP/1.1\r\nHost: localhost:17843\r\nOrigin: http://127.0.0.1:5173\r\nX-OVP-Client-Version: 1.0.0\r\nContent-Length: 100\r\n\r\n",
        )
        .await
        .unwrap();
    let mut response = Vec::new();
    timeout(Duration::from_secs(1), prebody.read_to_end(&mut response))
        .await
        .expect("bad Host must reject without waiting for body")
        .unwrap();
    assert!(
        String::from_utf8(response)
            .unwrap()
            .contains("\"code\":\"host-invalid\"")
    );
    assert_eq!(server.metrics().body_reads, before.body_reads);

    let mut held = Vec::new();
    for _ in 0..40 {
        if let Ok(mut stream) = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, 17_843)).await {
            let _ = stream.write_all(b"G").await;
            held.push(stream);
        }
    }
    sleep(Duration::from_millis(100)).await;
    let metrics = server.metrics();
    assert!(metrics.peak_connections <= 32);
    assert!(metrics.peak_handler_slots <= 8);
    drop(held);

    server.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_header_and_body_deadlines_close_slow_requests() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local(), test_ports(false).0)
        .await
        .expect("fixed listener should bind");

    let mut slow_header = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, 17_843))
        .await
        .unwrap();
    slow_header.write_all(b"GET /v1/health").await.unwrap();
    let mut response = Vec::new();
    timeout(
        Duration::from_secs(6),
        slow_header.read_to_end(&mut response),
    )
    .await
    .expect("five second header deadline")
    .unwrap();
    assert!(
        String::from_utf8(response)
            .unwrap()
            .contains("\"code\":\"header-timeout\"")
    );

    let mut slow_body = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, 17_843))
        .await
        .unwrap();
    slow_body
        .write_all(
            request(
                "POST",
                "/v1/pairings/challenges",
                "Content-Type: application/json\r\nContent-Length: 10\r\n",
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    let mut response = Vec::new();
    timeout(
        Duration::from_secs(11),
        slow_body.read_to_end(&mut response),
    )
    .await
    .expect("ten second absolute body deadline")
    .unwrap();
    assert!(
        String::from_utf8(response)
            .unwrap()
            .contains("\"code\":\"body-timeout\"")
    );

    let mut trickle_body = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, 17_843))
        .await
        .unwrap();
    trickle_body
        .write_all(
            request(
                "POST",
                "/v1/pairings/challenges",
                "Content-Type: application/json\r\nContent-Length: 2\r\n",
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    sleep(Duration::from_secs(9)).await;
    trickle_body.write_all(b"{").await.unwrap();
    let mut response = Vec::new();
    timeout(
        Duration::from_secs(12),
        trickle_body.read_to_end(&mut response),
    )
    .await
    .expect("nine-second progress resets the ten-second idle deadline")
    .unwrap();
    assert!(
        String::from_utf8(response)
            .unwrap()
            .contains("\"code\":\"body-timeout\"")
    );

    server.shutdown().await;
}
