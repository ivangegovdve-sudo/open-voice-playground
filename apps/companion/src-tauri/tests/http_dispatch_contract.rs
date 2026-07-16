use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::{Debug, Display},
    hash::Hash,
    ops::Deref,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Instant,
};

use async_trait::async_trait;
use open_voice_companion::{
    http_dispatch::{
        AuthError, AuthPermit, AuthPort, AuthRequest, AuthenticatedPairing, EntityTag,
        HandlerContext, HandlerError, HandlerPort, HandlerRequest, HandlerSuccess, OwnershipTarget,
        ResponseLocation, ResponseMetadataError, WavBody,
    },
    origin::OriginPolicy,
    pairing::{BearerSecret, PairingRecord, hash_for_transport},
    protocol::{HealthResponse, PackAction, PackId, PairingChallengeRequest, Scope},
    rate::{RateLimitError, RateLimitPort, RatePermit, RateRequest},
    router::{Method, OPERATION_CONTRACTS},
    scheduler::Clock,
    server::{
        CompanionServer, FIXED_LISTENER_ADDR, FixedListenerPort, LISTENER_BACKLOG, ListenerError,
        ServerPorts,
    },
};
use time::OffsetDateTime;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpSocket, TcpStream},
    time::{Duration, timeout},
};

const GOOD_ORIGIN: &str = "http://127.0.0.1:5173";
static FIXED_PORT: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct RecordingFixedListener {
    calls: Arc<AtomicUsize>,
}

impl FixedListenerPort for RecordingFixedListener {
    fn bind_fixed(&self) -> Result<TcpListener, ListenerError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let socket = TcpSocket::new_v4().map_err(|_| ListenerError::Unavailable)?;
        socket
            .bind(std::net::SocketAddr::V4(FIXED_LISTENER_ADDR))
            .map_err(|_| ListenerError::Conflict)?;
        socket
            .listen(LISTENER_BACKLOG)
            .map_err(|_| ListenerError::Unavailable)
    }
}

fn fixed_listener_port() -> Arc<dyn FixedListenerPort> {
    Arc::new(RecordingFixedListener {
        calls: Arc::new(AtomicUsize::new(0)),
    })
}

#[derive(Clone, Copy)]
enum ScriptedListenerOutcome {
    Error(ListenerError),
    WrongAddress,
}

struct ScriptedFixedListener {
    calls: Arc<AtomicUsize>,
    outcome: ScriptedListenerOutcome,
}

impl FixedListenerPort for ScriptedFixedListener {
    fn bind_fixed(&self) -> Result<TcpListener, ListenerError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        match self.outcome {
            ScriptedListenerOutcome::Error(error) => Err(error),
            ScriptedListenerOutcome::WrongAddress => {
                let socket = TcpSocket::new_v4().map_err(|_| ListenerError::Unavailable)?;
                socket
                    .bind(std::net::SocketAddr::from((
                        std::net::Ipv4Addr::LOCALHOST,
                        0,
                    )))
                    .map_err(|_| ListenerError::Unavailable)?;
                socket
                    .listen(LISTENER_BACKLOG)
                    .map_err(|_| ListenerError::Unavailable)
            }
        }
    }
}

macro_rules! assert_not_impl {
    ($type:ty: $trait:path) => {
        const _: fn() = || {
            struct Probe<T: ?Sized>(std::marker::PhantomData<T>);
            trait Ambiguous<Marker> {
                fn probe() {}
            }
            struct Implemented;
            impl<T: ?Sized> Ambiguous<()> for Probe<T> {}
            impl<T: ?Sized + $trait> Ambiguous<Implemented> for Probe<T> {}
            let _ = <Probe<$type> as Ambiguous<_>>::probe;
        };
    };
}

macro_rules! assert_secret_safe {
    ($type:ty) => {
        assert_not_impl!($type: Debug);
        assert_not_impl!($type: Clone);
        assert_not_impl!($type: Display);
        assert_not_impl!($type: Deref);
        assert_not_impl!($type: AsRef<str>);
        assert_not_impl!($type: AsRef<String>);
        assert_not_impl!($type: PartialEq);
        assert_not_impl!($type: Eq);
        assert_not_impl!($type: PartialOrd);
        assert_not_impl!($type: Ord);
        assert_not_impl!($type: Hash);
    };
}

assert_secret_safe!(BearerSecret);
assert_secret_safe!(AuthRequest);
assert_secret_safe!(HandlerRequest);

struct RecordingHandler {
    calls: Arc<AtomicUsize>,
}

#[async_trait]
impl HandlerPort for RecordingHandler {
    async fn handle(
        &self,
        context: HandlerContext,
        request: HandlerRequest,
    ) -> Result<HandlerSuccess, HandlerError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        assert_eq!(context.origin(), "http://127.0.0.1:5173");
        assert!(context.pairing().is_none());
        match request {
            HandlerRequest::GetHealth => Ok(HandlerSuccess::Health(HealthResponse::listening())),
            _ => Err(HandlerError::RuntimeUnavailable),
        }
    }
}

struct RecordingAuth {
    reserves: Arc<AtomicUsize>,
    commits: Arc<AtomicUsize>,
    observed: Option<Arc<Mutex<Vec<ObservedAuthRequest>>>>,
}

#[derive(Debug, Eq, PartialEq)]
struct ObservedAuthRequest {
    origin: String,
    required_scope: Option<Scope>,
    ownership: OwnershipTarget,
    now: OffsetDateTime,
}

struct RecordingAuthPermit {
    pairing: PairingRecord,
    commits: Arc<AtomicUsize>,
}

#[derive(Default)]
struct ScriptedAuthState {
    reserves: AtomicUsize,
    commit_attempts: AtomicUsize,
    durable_commits: AtomicUsize,
}

struct ScriptedAuth {
    state: Arc<ScriptedAuthState>,
    reserve_error: Option<AuthError>,
    commit_error: Option<AuthError>,
}

struct ScriptedAuthPermit {
    state: Arc<ScriptedAuthState>,
    pairing: PairingRecord,
    commit_error: Option<AuthError>,
}

#[async_trait]
impl AuthPermit for RecordingAuthPermit {
    fn pairing_id(&self) -> uuid::Uuid {
        self.pairing.id
    }

    async fn commit(self: Box<Self>) -> Result<AuthenticatedPairing, AuthError> {
        self.commits.fetch_add(1, Ordering::SeqCst);
        Ok(AuthenticatedPairing::from_record(self.pairing))
    }
}

#[async_trait]
impl AuthPermit for ScriptedAuthPermit {
    fn pairing_id(&self) -> uuid::Uuid {
        self.pairing.id
    }

    async fn commit(self: Box<Self>) -> Result<AuthenticatedPairing, AuthError> {
        self.state.commit_attempts.fetch_add(1, Ordering::SeqCst);
        if let Some(error) = self.commit_error {
            return Err(error);
        }
        self.state.durable_commits.fetch_add(1, Ordering::SeqCst);
        Ok(AuthenticatedPairing::from_record(self.pairing))
    }
}

#[async_trait]
impl AuthPort for RecordingAuth {
    async fn reserve(&self, request: AuthRequest) -> Result<Box<dyn AuthPermit>, AuthError> {
        self.reserves.fetch_add(1, Ordering::SeqCst);
        let (token, origin, required_scope, ownership, now) = request.into_parts();
        assert_eq!(token.expose().len(), 43);
        if let Some(observed) = &self.observed {
            observed.lock().unwrap().push(ObservedAuthRequest {
                origin: origin.clone(),
                required_scope,
                ownership,
                now,
            });
        }
        Ok(Box::new(RecordingAuthPermit {
            pairing: PairingRecord {
                id: uuid::Uuid::from_u128(1),
                origin,
                client_label: "contract fake".to_owned(),
                scopes: Vec::new(),
                created_at: now,
                last_used_at: now,
            },
            commits: Arc::clone(&self.commits),
        }))
    }
}

#[async_trait]
impl AuthPort for ScriptedAuth {
    async fn reserve(&self, request: AuthRequest) -> Result<Box<dyn AuthPermit>, AuthError> {
        self.state.reserves.fetch_add(1, Ordering::SeqCst);
        if let Some(error) = self.reserve_error {
            return Err(error);
        }
        let (token, origin, _required_scope, _ownership, now) = request.into_parts();
        assert_eq!(token.expose().len(), 43);
        Ok(Box::new(ScriptedAuthPermit {
            state: Arc::clone(&self.state),
            pairing: PairingRecord {
                id: uuid::Uuid::from_u128(1),
                origin,
                client_label: "scripted auth fake".to_owned(),
                scopes: Vec::new(),
                created_at: now,
                last_used_at: now,
            },
            commit_error: self.commit_error,
        }))
    }
}

struct RecordingRate {
    reserves: Arc<AtomicUsize>,
    commits: Arc<AtomicUsize>,
}

struct RecordingRatePermit {
    commits: Arc<AtomicUsize>,
}

impl RatePermit for RecordingRatePermit {
    fn commit(self: Box<Self>) {
        self.commits.fetch_add(1, Ordering::SeqCst);
    }
}

impl RateLimitPort for RecordingRate {
    fn reserve(&self, request: RateRequest) -> Result<Box<dyn RatePermit>, RateLimitError> {
        let _ = (request.class(), request.subject(), request.now());
        self.reserves.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(RecordingRatePermit {
            commits: Arc::clone(&self.commits),
        }))
    }
}

#[derive(Clone)]
struct FixedClock {
    monotonic: Instant,
    utc: OffsetDateTime,
}

impl Clock for FixedClock {
    fn monotonic(&self) -> Instant {
        self.monotonic
    }

    fn utc(&self) -> OffsetDateTime {
        self.utc
    }
}

#[derive(Debug, Eq, PartialEq)]
struct ObservedCall {
    origin: String,
    monotonic: Instant,
    utc: OffsetDateTime,
    pairing_id: Option<uuid::Uuid>,
    request: ObservedRequest,
}

#[derive(Debug, Eq, PartialEq)]
enum ObservedRequest {
    GetHealth,
    CreatePairingChallenge {
        kind: &'static str,
        first_len: usize,
        first_hash: String,
        verifier_hash: String,
        client_label: String,
        scopes: [Scope; 7],
    },
    RedeemPairingChallenge {
        id: uuid::Uuid,
        verifier_len: usize,
        verifier_hash: String,
    },
    GetCurrentPairing,
    RevokeCurrentPairing,
    GetRuntime,
    ListEngines,
    ListVoices,
    ListPacks,
    CreateJob {
        voice_id: &'static str,
        text_len: usize,
        text_hash: String,
    },
    GetJob(uuid::Uuid),
    CancelJob(uuid::Uuid),
    GetJobAudio(uuid::Uuid),
    RequestPackAction {
        id: PackId,
        action: PackAction,
    },
}

impl ObservedRequest {
    fn operation_and_variant(&self) -> (&'static str, &'static str) {
        match self {
            Self::GetHealth => ("getHealth", "GetHealth"),
            Self::CreatePairingChallenge { .. } => {
                ("createPairingChallenge", "CreatePairingChallenge")
            }
            Self::RedeemPairingChallenge { .. } => {
                ("redeemPairingChallenge", "RedeemPairingChallenge")
            }
            Self::GetCurrentPairing => ("getCurrentPairing", "GetCurrentPairing"),
            Self::RevokeCurrentPairing => ("revokeCurrentPairing", "RevokeCurrentPairing"),
            Self::GetRuntime => ("getRuntime", "GetRuntime"),
            Self::ListEngines => ("listEngines", "ListEngines"),
            Self::ListVoices => ("listVoices", "ListVoices"),
            Self::ListPacks => ("listPacks", "ListPacks"),
            Self::CreateJob { .. } => ("createJob", "CreateJob"),
            Self::GetJob(_) => ("getJob", "GetJob"),
            Self::CancelJob(_) => ("cancelJob", "CancelJob"),
            Self::GetJobAudio(_) => ("getJobAudio", "GetJobAudio"),
            Self::RequestPackAction { .. } => ("requestPackAction", "RequestPackAction"),
        }
    }
}

struct DispatchRecordingHandler {
    calls: Arc<Mutex<Vec<ObservedCall>>>,
}

#[async_trait]
impl HandlerPort for DispatchRecordingHandler {
    async fn handle(
        &self,
        context: HandlerContext,
        request: HandlerRequest,
    ) -> Result<HandlerSuccess, HandlerError> {
        let request = match request {
            HandlerRequest::GetHealth => ObservedRequest::GetHealth,
            HandlerRequest::CreatePairingChallenge { body } => match body {
                PairingChallengeRequest::DeepLink(body) => {
                    let (state, verifier, client_label, scopes) = body.into_parts();
                    ObservedRequest::CreatePairingChallenge {
                        kind: "deep-link",
                        first_len: state.len(),
                        first_hash: hash_for_transport(state.as_bytes()),
                        verifier_hash: hash_for_transport(verifier.as_bytes()),
                        client_label: client_label.into_string(),
                        scopes: scopes.as_array(),
                    }
                }
                PairingChallengeRequest::Manual(body) => {
                    let (code, verifier, client_label, scopes) = body.into_parts();
                    ObservedRequest::CreatePairingChallenge {
                        kind: "manual",
                        first_len: code.len(),
                        first_hash: hash_for_transport(code.as_bytes()),
                        verifier_hash: hash_for_transport(verifier.as_bytes()),
                        client_label: client_label.into_string(),
                        scopes: scopes.as_array(),
                    }
                }
            },
            HandlerRequest::RedeemPairingChallenge { id, body } => {
                let verifier = body.into_verifier();
                ObservedRequest::RedeemPairingChallenge {
                    id: id.as_uuid(),
                    verifier_len: verifier.len(),
                    verifier_hash: hash_for_transport(verifier.as_bytes()),
                }
            }
            HandlerRequest::GetCurrentPairing => ObservedRequest::GetCurrentPairing,
            HandlerRequest::RevokeCurrentPairing => ObservedRequest::RevokeCurrentPairing,
            HandlerRequest::GetRuntime => ObservedRequest::GetRuntime,
            HandlerRequest::ListEngines => ObservedRequest::ListEngines,
            HandlerRequest::ListVoices => ObservedRequest::ListVoices,
            HandlerRequest::ListPacks => ObservedRequest::ListPacks,
            HandlerRequest::CreateJob { body } => {
                let (voice_id, text) = body.into_parts();
                ObservedRequest::CreateJob {
                    voice_id: voice_id.as_str(),
                    text_len: text.len(),
                    text_hash: hash_for_transport(text.as_bytes()),
                }
            }
            HandlerRequest::GetJob { id } => ObservedRequest::GetJob(id.as_uuid()),
            HandlerRequest::CancelJob { id } => ObservedRequest::CancelJob(id.as_uuid()),
            HandlerRequest::GetJobAudio { id } => ObservedRequest::GetJobAudio(id.as_uuid()),
            HandlerRequest::RequestPackAction { id, body } => ObservedRequest::RequestPackAction {
                id,
                action: body.into_action(),
            },
        };
        self.calls.lock().unwrap().push(ObservedCall {
            origin: context.origin().to_owned(),
            monotonic: context.observed_at().monotonic(),
            utc: context.observed_at().utc(),
            pairing_id: context.pairing().map(AuthenticatedPairing::pairing_id),
            request,
        });
        Err(HandlerError::ResourceNotFound)
    }
}

fn raw_request(method: &str, target: &str, authorization: bool) -> Vec<u8> {
    let authorization = if authorization {
        format!("Authorization: Bearer {}\r\n", "A".repeat(43))
    } else {
        String::new()
    };
    format!(
        "{method} {target} HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nX-OVP-Client-Version: 1.0.0\r\n{authorization}\r\n"
    )
    .into_bytes()
}

fn raw_json_request(target: &str, authorization: bool, body: &str) -> Vec<u8> {
    let authorization = if authorization {
        format!("Authorization: Bearer {}\r\n", "A".repeat(43))
    } else {
        String::new()
    };
    format!(
        "POST {target} HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nX-OVP-Client-Version: 1.0.0\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{authorization}\r\n{body}",
        body.len()
    )
    .into_bytes()
}

fn raw_preflight_request(target: &str, method: &str, headers: &str) -> Vec<u8> {
    format!(
        "OPTIONS {target} HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nAccess-Control-Request-Method: {method}\r\nAccess-Control-Request-Headers: {headers}\r\n\r\n"
    )
    .into_bytes()
}

async fn send(raw: Vec<u8>) -> Vec<u8> {
    let mut stream = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, 17_843))
        .await
        .unwrap();
    stream.write_all(&raw).await.unwrap();
    let mut response = Vec::new();
    timeout(Duration::from_secs(2), stream.read_to_end(&mut response))
        .await
        .expect("server closes one-request connections")
        .unwrap();
    response
}

fn scripted_auth_ports(
    state: Arc<ScriptedAuthState>,
    reserve_error: Option<AuthError>,
    commit_error: Option<AuthError>,
    handler_calls: Arc<AtomicUsize>,
    rate_reserves: Arc<AtomicUsize>,
    rate_commits: Arc<AtomicUsize>,
) -> ServerPorts {
    ServerPorts::new(
        Arc::new(RecordingHandler {
            calls: handler_calls,
        }),
        Arc::new(ScriptedAuth {
            state,
            reserve_error,
            commit_error,
        }),
        Arc::new(RecordingRate {
            reserves: rate_reserves,
            commits: rate_commits,
        }),
        Arc::new(FixedClock {
            monotonic: Instant::now(),
            utc: OffsetDateTime::UNIX_EPOCH,
        }),
        fixed_listener_port(),
    )
}

fn problem_status_code_and_www(bytes: &[u8]) -> (String, String, bool) {
    let end = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .expect("Problem response has a header terminator");
    let headers = std::str::from_utf8(&bytes[..end]).expect("Problem headers are ASCII");
    let status = headers.lines().next().unwrap().to_owned();
    let has_www = headers
        .lines()
        .any(|line| line.starts_with("WWW-Authenticate: "));
    let body: serde_json::Value = serde_json::from_slice(&bytes[end + 4..]).unwrap();
    (status, body["code"].as_str().unwrap().to_owned(), has_www)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn server_requires_all_five_injected_ports() {
    let _fixed_port = FIXED_PORT.lock().await;
    let handler_calls = Arc::new(AtomicUsize::new(0));
    let auth_reserves = Arc::new(AtomicUsize::new(0));
    let auth_commits = Arc::new(AtomicUsize::new(0));
    let rate_reserves = Arc::new(AtomicUsize::new(0));
    let rate_commits = Arc::new(AtomicUsize::new(0));
    let listener_calls = Arc::new(AtomicUsize::new(0));
    let ports = ServerPorts::new(
        Arc::new(RecordingHandler {
            calls: Arc::clone(&handler_calls),
        }),
        Arc::new(RecordingAuth {
            reserves: Arc::clone(&auth_reserves),
            commits: Arc::clone(&auth_commits),
            observed: None,
        }),
        Arc::new(RecordingRate {
            reserves: Arc::clone(&rate_reserves),
            commits: Arc::clone(&rate_commits),
        }),
        Arc::new(FixedClock {
            monotonic: Instant::now(),
            utc: OffsetDateTime::UNIX_EPOCH,
        }),
        Arc::new(RecordingFixedListener {
            calls: Arc::clone(&listener_calls),
        }),
    );

    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("injected server should bind");
    server.shutdown().await;

    assert_eq!(handler_calls.load(Ordering::SeqCst), 0);
    assert_eq!(auth_reserves.load(Ordering::SeqCst), 0);
    assert_eq!(auth_commits.load(Ordering::SeqCst), 0);
    assert_eq!(rate_reserves.load(Ordering::SeqCst), 0);
    assert_eq!(rate_commits.load(Ordering::SeqCst), 0);
    assert_eq!(listener_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c9_fixed_listener_errors_and_wrong_address_are_closed_without_retry() {
    let _fixed_port = FIXED_PORT.lock().await;
    let cases = [
        (
            ScriptedListenerOutcome::Error(ListenerError::Conflict),
            ListenerError::Conflict,
        ),
        (
            ScriptedListenerOutcome::Error(ListenerError::Unavailable),
            ListenerError::Unavailable,
        ),
        (
            ScriptedListenerOutcome::WrongAddress,
            ListenerError::Unavailable,
        ),
    ];

    for (outcome, expected) in cases {
        let handler_calls = Arc::new(AtomicUsize::new(0));
        let listener_calls = Arc::new(AtomicUsize::new(0));
        let ports = ServerPorts::new(
            Arc::new(RecordingHandler {
                calls: Arc::clone(&handler_calls),
            }),
            Arc::new(RecordingAuth {
                reserves: Arc::new(AtomicUsize::new(0)),
                commits: Arc::new(AtomicUsize::new(0)),
                observed: None,
            }),
            Arc::new(RecordingRate {
                reserves: Arc::new(AtomicUsize::new(0)),
                commits: Arc::new(AtomicUsize::new(0)),
            }),
            Arc::new(FixedClock {
                monotonic: Instant::now(),
                utc: OffsetDateTime::UNIX_EPOCH,
            }),
            Arc::new(ScriptedFixedListener {
                calls: Arc::clone(&listener_calls),
                outcome,
            }),
        );

        assert_eq!(
            CompanionServer::start(OriginPolicy::debug_local(), ports)
                .await
                .unwrap_err(),
            expected
        );
        assert_eq!(listener_calls.load(Ordering::SeqCst), 1);
        assert_eq!(handler_calls.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auth_reserve_and_commit_failures_map_exactly_without_durable_effects() {
    let _fixed_port = FIXED_PORT.lock().await;
    let reserve_cases = [
        (
            "expired or invalid token",
            AuthError::Invalid,
            raw_request("GET", "/v1/runtime", true),
            "HTTP/1.1 401 Unauthorized",
            "auth-invalid",
        ),
        (
            "origin mismatch",
            AuthError::OriginMismatch,
            raw_request("GET", "/v1/runtime", true),
            "HTTP/1.1 401 Unauthorized",
            "auth-origin-mismatch",
        ),
        (
            "scope denial",
            AuthError::ScopeDenied,
            raw_request("GET", "/v1/runtime", true),
            "HTTP/1.1 403 Forbidden",
            "scope-denied",
        ),
        (
            "unknown owned job",
            AuthError::NotFound,
            raw_request("GET", "/v1/jobs/11111111-1111-4111-8111-111111111111", true),
            "HTTP/1.1 404 Not Found",
            "resource-not-found",
        ),
        (
            "foreign owned job",
            AuthError::NotFound,
            raw_request("GET", "/v1/jobs/22222222-2222-4222-8222-222222222222", true),
            "HTTP/1.1 404 Not Found",
            "resource-not-found",
        ),
        (
            "auth store unavailable",
            AuthError::Unavailable,
            raw_request("GET", "/v1/runtime", true),
            "HTTP/1.1 503 Service Unavailable",
            "runtime-unavailable",
        ),
    ];
    let mut ownership_not_found = Vec::new();
    for (label, error, raw, expected_status, expected_code) in reserve_cases {
        let state = Arc::new(ScriptedAuthState::default());
        let handler_calls = Arc::new(AtomicUsize::new(0));
        let rate_reserves = Arc::new(AtomicUsize::new(0));
        let rate_commits = Arc::new(AtomicUsize::new(0));
        let ports = scripted_auth_ports(
            Arc::clone(&state),
            Some(error),
            None,
            Arc::clone(&handler_calls),
            Arc::clone(&rate_reserves),
            Arc::clone(&rate_commits),
        );
        let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
            .await
            .unwrap();
        let projected = problem_status_code_and_www(&send(raw).await);
        server.shutdown().await;

        assert_eq!(projected.0, expected_status, "{label}");
        assert_eq!(projected.1, expected_code, "{label}");
        assert_eq!(projected.2, expected_status.contains(" 401 "), "{label}");
        assert_eq!(state.reserves.load(Ordering::SeqCst), 1, "{label}");
        assert_eq!(state.commit_attempts.load(Ordering::SeqCst), 0, "{label}");
        assert_eq!(state.durable_commits.load(Ordering::SeqCst), 0, "{label}");
        assert_eq!(rate_reserves.load(Ordering::SeqCst), 0, "{label}");
        assert_eq!(rate_commits.load(Ordering::SeqCst), 0, "{label}");
        assert_eq!(handler_calls.load(Ordering::SeqCst), 0, "{label}");
        if error == AuthError::NotFound {
            ownership_not_found.push(projected);
        }
    }
    assert_eq!(ownership_not_found.len(), 2);
    assert_eq!(ownership_not_found[0], ownership_not_found[1]);

    let commit_cases = [
        (
            "revocation race at commit",
            AuthError::Invalid,
            raw_request("DELETE", "/v1/pairings/current", true),
            "HTTP/1.1 401 Unauthorized",
            "auth-invalid",
            0,
        ),
        (
            "auth store unavailable at commit",
            AuthError::Unavailable,
            raw_json_request(
                "/v1/jobs",
                true,
                r#"{"voiceId":"pocket:alba","text":"validated before commit"}"#,
            ),
            "HTTP/1.1 503 Service Unavailable",
            "runtime-unavailable",
            1,
        ),
    ];
    for (label, error, raw, expected_status, expected_code, expected_rate_reserves) in commit_cases
    {
        let state = Arc::new(ScriptedAuthState::default());
        let handler_calls = Arc::new(AtomicUsize::new(0));
        let rate_reserves = Arc::new(AtomicUsize::new(0));
        let rate_commits = Arc::new(AtomicUsize::new(0));
        let ports = scripted_auth_ports(
            Arc::clone(&state),
            None,
            Some(error),
            Arc::clone(&handler_calls),
            Arc::clone(&rate_reserves),
            Arc::clone(&rate_commits),
        );
        let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
            .await
            .unwrap();
        let projected = problem_status_code_and_www(&send(raw).await);
        server.shutdown().await;

        assert_eq!(projected.0, expected_status, "{label}");
        assert_eq!(projected.1, expected_code, "{label}");
        assert_eq!(projected.2, expected_status.contains(" 401 "), "{label}");
        assert_eq!(state.reserves.load(Ordering::SeqCst), 1, "{label}");
        assert_eq!(state.commit_attempts.load(Ordering::SeqCst), 1, "{label}");
        assert_eq!(state.durable_commits.load(Ordering::SeqCst), 0, "{label}");
        assert_eq!(
            rate_reserves.load(Ordering::SeqCst),
            expected_rate_reserves,
            "{label}"
        );
        assert_eq!(rate_commits.load(Ordering::SeqCst), 0, "{label}");
        assert_eq!(handler_calls.load(Ordering::SeqCst), 0, "{label}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn all_twelve_preflights_have_no_dispatch_auth_rate_or_clock_effect() {
    let _fixed_port = FIXED_PORT.lock().await;
    let calls = Arc::new(Mutex::new(Vec::new()));
    let auth_reserves = Arc::new(AtomicUsize::new(0));
    let auth_commits = Arc::new(AtomicUsize::new(0));
    let rate_reserves = Arc::new(AtomicUsize::new(0));
    let rate_commits = Arc::new(AtomicUsize::new(0));
    let monotonic_calls = Arc::new(AtomicUsize::new(0));
    let utc_calls = Arc::new(AtomicUsize::new(0));

    struct CountingClock {
        monotonic_calls: Arc<AtomicUsize>,
        utc_calls: Arc<AtomicUsize>,
    }
    impl Clock for CountingClock {
        fn monotonic(&self) -> Instant {
            self.monotonic_calls.fetch_add(1, Ordering::SeqCst);
            Instant::now()
        }

        fn utc(&self) -> OffsetDateTime {
            self.utc_calls.fetch_add(1, Ordering::SeqCst);
            OffsetDateTime::UNIX_EPOCH
        }
    }

    let ports = ServerPorts::new(
        Arc::new(DispatchRecordingHandler {
            calls: Arc::clone(&calls),
        }),
        Arc::new(RecordingAuth {
            reserves: Arc::clone(&auth_reserves),
            commits: Arc::clone(&auth_commits),
            observed: None,
        }),
        Arc::new(RecordingRate {
            reserves: Arc::clone(&rate_reserves),
            commits: Arc::clone(&rate_commits),
        }),
        Arc::new(CountingClock {
            monotonic_calls: Arc::clone(&monotonic_calls),
            utc_calls: Arc::clone(&utc_calls),
        }),
        fixed_listener_port(),
    );
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("injected server should bind");
    let cases = [
        (
            "/v1/health",
            "GET",
            "X-OVP-Client-Version",
            "preflightHealth",
        ),
        (
            "/v1/pairings/challenges",
            "POST",
            "Content-Type, X-OVP-Client-Version",
            "preflightPairingChallenges",
        ),
        (
            "/v1/pairings/challenges/11111111-1111-4111-8111-111111111111/redeem",
            "POST",
            "Content-Type, X-OVP-Client-Version",
            "preflightPairingChallengeRedeem",
        ),
        (
            "/v1/pairings/current",
            "GET",
            "Authorization, X-OVP-Client-Version",
            "preflightCurrentPairing",
        ),
        (
            "/v1/runtime",
            "GET",
            "Authorization, X-OVP-Client-Version",
            "preflightRuntime",
        ),
        (
            "/v1/engines",
            "GET",
            "Authorization, X-OVP-Client-Version",
            "preflightEngines",
        ),
        (
            "/v1/voices",
            "GET",
            "Authorization, X-OVP-Client-Version",
            "preflightVoices",
        ),
        (
            "/v1/packs",
            "GET",
            "Authorization, X-OVP-Client-Version",
            "preflightPacks",
        ),
        (
            "/v1/jobs",
            "POST",
            "Authorization, Content-Type, X-OVP-Client-Version",
            "preflightJobs",
        ),
        (
            "/v1/jobs/22222222-2222-4222-8222-222222222222",
            "GET",
            "Authorization, X-OVP-Client-Version",
            "preflightJob",
        ),
        (
            "/v1/jobs/33333333-3333-4333-8333-333333333333/audio",
            "GET",
            "Authorization, X-OVP-Client-Version",
            "preflightJobAudio",
        ),
        (
            "/v1/packs/pocket-companion-pack/actions",
            "POST",
            "Authorization, Content-Type, X-OVP-Client-Version",
            "preflightPackActions",
        ),
    ];
    for (target, method, headers, operation) in cases {
        let response = send(raw_preflight_request(target, method, headers)).await;
        assert!(
            response.starts_with(b"HTTP/1.1 204 No Content\r\n"),
            "{operation} did not return 204"
        );
    }
    server.shutdown().await;

    assert!(calls.lock().unwrap().is_empty());
    assert_eq!(auth_reserves.load(Ordering::SeqCst), 0);
    assert_eq!(auth_commits.load(Ordering::SeqCst), 0);
    assert_eq!(rate_reserves.load(Ordering::SeqCst), 0);
    assert_eq!(rate_commits.load(Ordering::SeqCst), 0);
    assert_eq!(monotonic_calls.load(Ordering::SeqCst), 0);
    assert_eq!(utc_calls.load(Ordering::SeqCst), 0);
    let table_preflights = OPERATION_CONTRACTS
        .iter()
        .filter(|operation| operation.method == Method::Options)
        .map(|operation| operation.operation_id)
        .collect::<BTreeSet<_>>();
    let case_preflights = cases
        .iter()
        .map(|(_, _, _, operation)| *operation)
        .collect::<BTreeSet<_>>();
    assert_eq!(table_preflights.len(), 12);
    assert_eq!(table_preflights, case_preflights);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn all_fourteen_operations_dispatch_once_with_exact_typed_context() {
    let _fixed_port = FIXED_PORT.lock().await;
    let calls = Arc::new(Mutex::new(Vec::new()));
    let auth_reserves = Arc::new(AtomicUsize::new(0));
    let auth_commits = Arc::new(AtomicUsize::new(0));
    let rate_reserves = Arc::new(AtomicUsize::new(0));
    let rate_commits = Arc::new(AtomicUsize::new(0));
    let observed_auth = Arc::new(Mutex::new(Vec::new()));
    let monotonic = Instant::now();
    let utc = OffsetDateTime::UNIX_EPOCH;
    let ports = ServerPorts::new(
        Arc::new(DispatchRecordingHandler {
            calls: Arc::clone(&calls),
        }),
        Arc::new(RecordingAuth {
            reserves: Arc::clone(&auth_reserves),
            commits: Arc::clone(&auth_commits),
            observed: Some(Arc::clone(&observed_auth)),
        }),
        Arc::new(RecordingRate {
            reserves: Arc::clone(&rate_reserves),
            commits: Arc::clone(&rate_commits),
        }),
        Arc::new(FixedClock { monotonic, utc }),
        fixed_listener_port(),
    );
    let server = CompanionServer::start(OriginPolicy::debug_local(), ports)
        .await
        .expect("injected server should bind");

    let secret = "A".repeat(43);
    let challenge_body = format!(
        r#"{{"state":"{secret}","verifierHash":"{secret}","clientLabel":"Browser playground","scopes":["health:read","runtime:read","synthesis:create","jobs:read","jobs:cancel","audio:read","packs:request"]}}"#
    );
    let requests = vec![
        raw_request("GET", "/v1/health", false),
        raw_json_request("/v1/pairings/challenges", false, &challenge_body),
        raw_json_request(
            "/v1/pairings/challenges/11111111-1111-4111-8111-111111111111/redeem",
            false,
            &format!(r#"{{"verifier":"{secret}"}}"#),
        ),
        raw_request("GET", "/v1/pairings/current", true),
        raw_request("DELETE", "/v1/pairings/current", true),
        raw_request("GET", "/v1/runtime", true),
        raw_request("GET", "/v1/engines", true),
        raw_request("GET", "/v1/voices", true),
        raw_request("GET", "/v1/packs", true),
        raw_json_request(
            "/v1/jobs",
            true,
            r#"{"voiceId":"pocket:alba","text":"exact text"}"#,
        ),
        raw_request("GET", "/v1/jobs/22222222-2222-4222-8222-222222222222", true),
        raw_request(
            "DELETE",
            "/v1/jobs/33333333-3333-4333-8333-333333333333",
            true,
        ),
        raw_request(
            "GET",
            "/v1/jobs/44444444-4444-4444-8444-444444444444/audio",
            true,
        ),
        raw_json_request(
            "/v1/packs/pocket-companion-pack/actions",
            true,
            r#"{"action":"install"}"#,
        ),
    ];
    for request in requests {
        send(request).await;
    }
    server.shutdown().await;

    let id = |value: &str| uuid::Uuid::parse_str(value).unwrap();
    let scope = |value: &str| Scope::parse(value).unwrap();
    let expected_scopes = [
        scope("health:read"),
        scope("runtime:read"),
        scope("synthesis:create"),
        scope("jobs:read"),
        scope("jobs:cancel"),
        scope("audio:read"),
        scope("packs:request"),
    ];
    let secret_hash = hash_for_transport(secret.as_bytes());
    let expected = vec![
        ObservedRequest::GetHealth,
        ObservedRequest::CreatePairingChallenge {
            kind: "deep-link",
            first_len: 43,
            first_hash: secret_hash.clone(),
            verifier_hash: secret_hash.clone(),
            client_label: "Browser playground".to_owned(),
            scopes: expected_scopes,
        },
        ObservedRequest::RedeemPairingChallenge {
            id: id("11111111-1111-4111-8111-111111111111"),
            verifier_len: 43,
            verifier_hash: secret_hash,
        },
        ObservedRequest::GetCurrentPairing,
        ObservedRequest::RevokeCurrentPairing,
        ObservedRequest::GetRuntime,
        ObservedRequest::ListEngines,
        ObservedRequest::ListVoices,
        ObservedRequest::ListPacks,
        ObservedRequest::CreateJob {
            voice_id: "pocket:alba",
            text_len: "exact text".len(),
            text_hash: hash_for_transport(b"exact text"),
        },
        ObservedRequest::GetJob(id("22222222-2222-4222-8222-222222222222")),
        ObservedRequest::CancelJob(id("33333333-3333-4333-8333-333333333333")),
        ObservedRequest::GetJobAudio(id("44444444-4444-4444-8444-444444444444")),
        ObservedRequest::RequestPackAction {
            id: PackId,
            action: PackAction::Install,
        },
    ];
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), expected.len());
    for (index, (call, expected_request)) in calls.iter().zip(&expected).enumerate() {
        assert_eq!(&call.request, expected_request, "operation index {index}");
        assert_eq!(call.origin, GOOD_ORIGIN);
        assert_eq!(call.monotonic, monotonic);
        assert_eq!(call.utc, utc);
        assert_eq!(
            call.pairing_id,
            (index >= 3).then_some(uuid::Uuid::from_u128(1)),
            "principal presence for operation index {index}"
        );
    }
    let observed_dispatch = calls
        .iter()
        .map(|call| {
            let (operation, variant) = call.request.operation_and_variant();
            (operation.to_owned(), variant.to_owned())
        })
        .collect::<BTreeMap<_, _>>();
    let expected_dispatch = [
        ("getHealth", "GetHealth"),
        ("createPairingChallenge", "CreatePairingChallenge"),
        ("redeemPairingChallenge", "RedeemPairingChallenge"),
        ("getCurrentPairing", "GetCurrentPairing"),
        ("revokeCurrentPairing", "RevokeCurrentPairing"),
        ("getRuntime", "GetRuntime"),
        ("listEngines", "ListEngines"),
        ("listVoices", "ListVoices"),
        ("listPacks", "ListPacks"),
        ("createJob", "CreateJob"),
        ("getJob", "GetJob"),
        ("cancelJob", "CancelJob"),
        ("getJobAudio", "GetJobAudio"),
        ("requestPackAction", "RequestPackAction"),
    ]
    .into_iter()
    .map(|(operation, variant)| (operation.to_owned(), variant.to_owned()))
    .collect::<BTreeMap<_, _>>();
    assert_eq!(observed_dispatch.len(), 14);
    assert_eq!(observed_dispatch, expected_dispatch);
    let concrete_table_ids = OPERATION_CONTRACTS
        .iter()
        .filter(|operation| operation.method != Method::Options)
        .map(|operation| operation.operation_id.to_owned())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        concrete_table_ids,
        observed_dispatch.keys().cloned().collect()
    );
    let mut variant_mutation = expected_dispatch;
    variant_mutation.insert("getHealth".to_owned(), "GetRuntime".to_owned());
    assert_ne!(observed_dispatch, variant_mutation);
    assert_eq!(auth_reserves.load(Ordering::SeqCst), 11);
    assert_eq!(auth_commits.load(Ordering::SeqCst), 11);
    let expected_auth = vec![
        (None, OwnershipTarget::TokenSelf),
        (None, OwnershipTarget::TokenSelf),
        (Some(scope("runtime:read")), OwnershipTarget::None),
        (Some(scope("runtime:read")), OwnershipTarget::None),
        (Some(scope("runtime:read")), OwnershipTarget::None),
        (Some(scope("runtime:read")), OwnershipTarget::None),
        (Some(scope("synthesis:create")), OwnershipTarget::None),
        (
            Some(scope("jobs:read")),
            OwnershipTarget::Job(id("22222222-2222-4222-8222-222222222222").into()),
        ),
        (
            Some(scope("jobs:cancel")),
            OwnershipTarget::Job(id("33333333-3333-4333-8333-333333333333").into()),
        ),
        (
            Some(scope("audio:read")),
            OwnershipTarget::Job(id("44444444-4444-4444-8444-444444444444").into()),
        ),
        (Some(scope("packs:request")), OwnershipTarget::None),
    ]
    .into_iter()
    .map(|(required_scope, ownership)| ObservedAuthRequest {
        origin: GOOD_ORIGIN.to_owned(),
        required_scope,
        ownership,
        now: utc,
    })
    .collect::<Vec<_>>();
    assert_eq!(*observed_auth.lock().unwrap(), expected_auth);
    assert_eq!(rate_reserves.load(Ordering::SeqCst), 12);
    assert_eq!(rate_commits.load(Ordering::SeqCst), 12);
}

#[test]
fn response_metadata_construction_is_length_and_injection_safe() {
    let etag = EntityTag::new("\"contract-v1\"".to_owned()).unwrap();
    assert_eq!(etag.as_str(), "\"contract-v1\"");
    assert_eq!(
        EntityTag::new("ab".to_owned()).err(),
        Some(ResponseMetadataError::Length)
    );
    assert_eq!(
        EntityTag::new("x".repeat(129)).err(),
        Some(ResponseMetadataError::Length)
    );
    assert_eq!(
        EntityTag::new("abc\rdef".to_owned()).err(),
        Some(ResponseMetadataError::InvalidHeaderValue)
    );
    assert_eq!(
        EntityTag::new("abc\u{7f}".to_owned()).err(),
        Some(ResponseMetadataError::InvalidHeaderValue)
    );
    assert_eq!(
        EntityTag::new("abc\u{80}".to_owned()).err(),
        Some(ResponseMetadataError::InvalidHeaderValue)
    );

    let location = ResponseLocation::new("/v1/jobs/opaque".to_owned()).unwrap();
    assert_eq!(location.as_str(), "/v1/jobs/opaque");
    assert_eq!(
        ResponseLocation::new(String::new()).err(),
        Some(ResponseMetadataError::Length)
    );
    assert_eq!(
        ResponseLocation::new("x".repeat(257)).err(),
        Some(ResponseMetadataError::Length)
    );
    assert_eq!(
        ResponseLocation::new("/v1/jobs/x\nInjected: yes".to_owned()).err(),
        Some(ResponseMetadataError::InvalidHeaderValue)
    );
}

#[test]
fn wav_body_preserves_arbitrary_binary() {
    let bytes = vec![0, 0xff, b'R', b'I', b'F', b'F', 0x80];
    assert_eq!(WavBody::new(bytes.clone()).unwrap().into_bytes(), bytes);
}
