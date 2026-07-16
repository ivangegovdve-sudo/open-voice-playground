use std::{
    collections::{HashMap, VecDeque},
    ffi::OsString,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};

use async_trait::async_trait;
use open_voice_companion::{
    deep_link::{DeepLinkError, DeepLinkRegistry},
    pairing::{
        ApprovalDecision, ApprovalPort, BearerSecret, ManualCodeRegistry, PairingError,
        PairingService, PairingStore, SqlitePairingStore, StoredPairing, fixed_scopes,
        generate_secret, hash_for_transport,
    },
    protocol::Scope,
};
use time::OffsetDateTime;
use tokio::sync::{Notify, oneshot};

#[test]
fn verifier_and_bearer_hashes_use_decoded_secret_bytes() {
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    use sha2::{Digest, Sha256};

    let encoded = fixed_state(42);
    let expected = URL_SAFE_NO_PAD.encode(Sha256::digest([42_u8; 32]));
    assert_eq!(hash_for_transport(encoded.as_bytes()), expected);
}

#[test]
fn encoded_inbound_secrets_are_validated_and_immediately_owned_by_the_zeroizing_wrapper() {
    let encoded = fixed_state(43);
    let secret = BearerSecret::from_encoded(encoded.clone()).unwrap();
    assert_eq!(secret.expose(), encoded);
    assert!(BearerSecret::from_encoded("not-a-canonical-secret".to_owned()).is_err());
}

#[test]
fn canonical_secret_final_characters_are_exhaustive_and_decoding_uses_a_bounded_buffer() {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let canonical = fixed_state(43);
    let prefix = &canonical[..42];
    for (index, final_character) in ALPHABET.iter().copied().enumerate() {
        let candidate = format!("{prefix}{}", char::from(final_character));
        assert_eq!(
            BearerSecret::from_encoded(candidate).is_ok(),
            index.is_multiple_of(4),
            "base64url final character index {index} has canonical trailing bits iff divisible by four"
        );
    }

    let source = include_str!("../src/secret.rs");
    assert!(source.contains("decode_slice"));
    assert!(!source.contains(".decode("));
    assert!(!source.contains("URL_SAFE_NO_PAD.encode(bytes)"));
    assert!(!source.contains("URL_SAFE_NO_PAD.encode(*bytes)"));
    assert!(source.contains("URL_SAFE_NO_PAD.encode(bytes.as_ref())"));
    assert!(source.contains("URL_SAFE_NO_PAD.encode(hash.as_slice())"));
}

struct ControlledApproval {
    decisions: Mutex<VecDeque<oneshot::Receiver<ApprovalDecision>>>,
    requested: Notify,
}

impl ControlledApproval {
    fn new(receivers: Vec<oneshot::Receiver<ApprovalDecision>>) -> Self {
        Self {
            decisions: Mutex::new(receivers.into()),
            requested: Notify::new(),
        }
    }
}

#[async_trait]
impl ApprovalPort for ControlledApproval {
    async fn decide(
        &self,
        _request: open_voice_companion::pairing::ApprovalRequest,
    ) -> ApprovalDecision {
        self.requested.notify_one();
        let receiver = self.decisions.lock().unwrap().pop_front();
        match receiver {
            Some(receiver) => receiver.await.unwrap_or(ApprovalDecision::Deny),
            None => ApprovalDecision::Deny,
        }
    }
}

struct FailingStore;

impl PairingStore for FailingStore {
    fn insert(&self, _pairing: &StoredPairing) -> Result<(), PairingError> {
        Err(PairingError::Unavailable)
    }

    fn active(&self, _now: OffsetDateTime) -> Result<Vec<StoredPairing>, PairingError> {
        Ok(Vec::new())
    }

    fn touch(&self, _id: uuid::Uuid, _at: OffsetDateTime) -> Result<(), PairingError> {
        Ok(())
    }

    fn revoke(&self, _id: uuid::Uuid) -> Result<(), PairingError> {
        Ok(())
    }

    fn revoke_all(&self) -> Result<(), PairingError> {
        Ok(())
    }
}

struct LabelApproval {
    decisions: Mutex<HashMap<String, oneshot::Receiver<ApprovalDecision>>>,
}

#[async_trait]
impl ApprovalPort for LabelApproval {
    async fn decide(
        &self,
        request: open_voice_companion::pairing::ApprovalRequest,
    ) -> ApprovalDecision {
        let receiver = self.decisions.lock().unwrap().remove(&request.client_label);
        match receiver {
            Some(receiver) => receiver.await.unwrap_or(ApprovalDecision::Deny),
            None => ApprovalDecision::Deny,
        }
    }
}

struct BlockingFirstInsertStore {
    block_first: AtomicBool,
    insert_started: Notify,
    release: (Mutex<bool>, Condvar),
    pairings: Mutex<Vec<StoredPairing>>,
}

impl BlockingFirstInsertStore {
    fn new() -> Self {
        Self {
            block_first: AtomicBool::new(true),
            insert_started: Notify::new(),
            release: (Mutex::new(false), Condvar::new()),
            pairings: Mutex::new(Vec::new()),
        }
    }

    fn release(&self) {
        let (released, signal) = &self.release;
        *released.lock().unwrap() = true;
        signal.notify_all();
    }
}

impl PairingStore for BlockingFirstInsertStore {
    fn insert(&self, pairing: &StoredPairing) -> Result<(), PairingError> {
        if self.block_first.swap(false, Ordering::SeqCst) {
            self.insert_started.notify_one();
            let (released, signal) = &self.release;
            let mut released = released.lock().unwrap();
            while !*released {
                released = signal.wait(released).unwrap();
            }
        }
        self.pairings.lock().unwrap().push(pairing.clone());
        Ok(())
    }

    fn active(&self, _now: OffsetDateTime) -> Result<Vec<StoredPairing>, PairingError> {
        Ok(self.pairings.lock().unwrap().clone())
    }

    fn touch(&self, _id: uuid::Uuid, _at: OffsetDateTime) -> Result<(), PairingError> {
        Ok(())
    }

    fn revoke(&self, _id: uuid::Uuid) -> Result<(), PairingError> {
        Ok(())
    }

    fn revoke_all(&self) -> Result<(), PairingError> {
        Ok(())
    }
}

struct ImmediateApproval;

#[async_trait]
impl ApprovalPort for ImmediateApproval {
    async fn decide(
        &self,
        _request: open_voice_companion::pairing::ApprovalRequest,
    ) -> ApprovalDecision {
        ApprovalDecision::Approve
    }
}

struct CountingApproval(AtomicUsize);

#[async_trait]
impl ApprovalPort for CountingApproval {
    async fn decide(
        &self,
        _request: open_voice_companion::pairing::ApprovalRequest,
    ) -> ApprovalDecision {
        self.0.fetch_add(1, Ordering::SeqCst);
        ApprovalDecision::Approve
    }
}

struct StalledApproval;

#[async_trait]
impl ApprovalPort for StalledApproval {
    async fn decide(
        &self,
        _request: open_voice_companion::pairing::ApprovalRequest,
    ) -> ApprovalDecision {
        std::future::pending().await
    }
}

struct PanickingApproval;

#[async_trait]
impl ApprovalPort for PanickingApproval {
    async fn decide(
        &self,
        _request: open_voice_companion::pairing::ApprovalRequest,
    ) -> ApprovalDecision {
        panic!("injected approval panic")
    }
}

fn fixed_state(byte: u8) -> String {
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    URL_SAFE_NO_PAD.encode([byte; 32])
}

fn executable() -> OsString {
    std::env::current_exe().unwrap().into_os_string()
}

#[tokio::test(flavor = "current_thread")]
async fn unrepresentable_challenge_expiry_fails_before_claim_insert_or_approval() {
    let deep_links = Arc::new(DeepLinkRegistry::new());
    let approval = Arc::new(CountingApproval(AtomicUsize::new(0)));
    let service = Arc::new(PairingService::new(
        approval.clone(),
        Arc::new(SqlitePairingStore::open_in_memory().unwrap()),
        deep_links.clone(),
        Arc::new(ManualCodeRegistry::new()),
    ));
    let now = Instant::now();
    let state = fixed_state(91);
    deep_links
        .record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{state}")),
            ],
            now,
        )
        .unwrap();
    let verifier = generate_secret().unwrap();
    let verifier_hash = hash_for_transport(verifier.expose().as_bytes());

    assert!(matches!(
        service.clone().create_deep_link_challenge(
            &state,
            &verifier_hash,
            "Browser",
            &fixed_scopes(),
            "http://127.0.0.1:5173",
            now,
            time::PrimitiveDateTime::MAX.assume_utc(),
        ),
        Err(PairingError::Unavailable)
    ));
    tokio::task::yield_now().await;
    assert_eq!(approval.0.load(Ordering::SeqCst), 0);

    let retry = service.create_deep_link_challenge(
        &state,
        &verifier_hash,
        "Browser",
        &fixed_scopes(),
        "http://127.0.0.1:5173",
        now,
        OffsetDateTime::UNIX_EPOCH,
    );
    assert!(
        retry.is_ok(),
        "failed expiry validation consumed or inserted the challenge"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn immediate_approval_before_wait_subscription_is_observed() {
    let deep_links = Arc::new(DeepLinkRegistry::new());
    let service = Arc::new(PairingService::new(
        Arc::new(ImmediateApproval),
        Arc::new(SqlitePairingStore::open_in_memory().unwrap()),
        deep_links.clone(),
        Arc::new(ManualCodeRegistry::new()),
    ));
    let now = Instant::now();
    let state = fixed_state(5);
    deep_links
        .record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{state}")),
            ],
            now,
        )
        .unwrap();
    let verifier = generate_secret().unwrap();
    let challenge = service
        .clone()
        .create_deep_link_challenge(
            &state,
            &hash_for_transport(verifier.expose().as_bytes()),
            "Browser",
            &fixed_scopes(),
            "http://127.0.0.1:5173",
            now,
            OffsetDateTime::UNIX_EPOCH,
        )
        .unwrap();

    tokio::task::yield_now().await;

    tokio::time::timeout(
        Duration::from_millis(25),
        service.wait_for_decision(challenge.id),
    )
    .await
    .expect("an already-applied decision must not wait for a later watch update");
}

#[tokio::test(flavor = "current_thread")]
async fn challenge_expires_at_the_exact_two_minute_boundary() {
    let deep_links = Arc::new(DeepLinkRegistry::new());
    let service = Arc::new(PairingService::new(
        Arc::new(ImmediateApproval),
        Arc::new(SqlitePairingStore::open_in_memory().unwrap()),
        deep_links.clone(),
        Arc::new(ManualCodeRegistry::new()),
    ));
    let now = Instant::now();
    let state = fixed_state(55);
    deep_links
        .record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{state}")),
            ],
            now,
        )
        .unwrap();
    let verifier = generate_secret().unwrap();
    let challenge = service
        .clone()
        .create_deep_link_challenge(
            &state,
            &hash_for_transport(verifier.expose().as_bytes()),
            "Browser",
            &fixed_scopes(),
            "http://127.0.0.1:5173",
            now,
            OffsetDateTime::UNIX_EPOCH,
        )
        .unwrap();

    assert!(matches!(
        service.redeem(
            challenge.id,
            verifier.expose(),
            "http://127.0.0.1:5173",
            now + Duration::from_secs(120),
            OffsetDateTime::UNIX_EPOCH,
        ),
        Err(PairingError::Expired)
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn expired_challenges_remain_bounded_tombstones_when_later_challenges_are_created() {
    let deep_links = Arc::new(DeepLinkRegistry::new());
    let service = Arc::new(PairingService::new(
        Arc::new(ImmediateApproval),
        Arc::new(SqlitePairingStore::open_in_memory().unwrap()),
        deep_links.clone(),
        Arc::new(ManualCodeRegistry::new()),
    ));
    let now = Instant::now();
    let verifier = generate_secret().unwrap();
    let verifier_hash = hash_for_transport(verifier.expose().as_bytes());
    let origin = "http://127.0.0.1:5173";
    let old_state = fixed_state(68);
    deep_links
        .record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{old_state}")),
            ],
            now,
        )
        .unwrap();
    let old = service
        .clone()
        .create_deep_link_challenge(
            &old_state,
            &verifier_hash,
            "Old browser",
            &fixed_scopes(),
            origin,
            now,
            OffsetDateTime::UNIX_EPOCH,
        )
        .unwrap();

    let later = now + Duration::from_secs(120);
    let new_state = fixed_state(69);
    deep_links
        .record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{new_state}")),
            ],
            later,
        )
        .unwrap();
    service
        .clone()
        .create_deep_link_challenge(
            &new_state,
            &verifier_hash,
            "New browser",
            &fixed_scopes(),
            origin,
            later,
            OffsetDateTime::UNIX_EPOCH,
        )
        .unwrap();
    assert!(matches!(
        service.redeem(
            old.id,
            verifier.expose(),
            origin,
            later,
            OffsetDateTime::UNIX_EPOCH,
        ),
        Err(PairingError::Expired)
    ));

    let pressure_links = Arc::new(DeepLinkRegistry::new());
    let pressure_service = Arc::new(PairingService::new(
        Arc::new(ImmediateApproval),
        Arc::new(SqlitePairingStore::open_in_memory().unwrap()),
        pressure_links.clone(),
        Arc::new(ManualCodeRegistry::new()),
    ));
    for byte in 0_u8..128 {
        let state = fixed_state(byte);
        pressure_links
            .record_argv(
                &[
                    executable(),
                    OsString::from(format!("ovp-companion://pair/{state}")),
                ],
                now,
            )
            .unwrap();
        pressure_service
            .clone()
            .create_deep_link_challenge(
                &state,
                &verifier_hash,
                "Pressure browser",
                &fixed_scopes(),
                origin,
                now,
                OffsetDateTime::UNIX_EPOCH,
            )
            .unwrap();
    }
    let overflow_state = fixed_state(200);
    pressure_links
        .record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{overflow_state}")),
            ],
            later,
        )
        .unwrap();
    pressure_service
        .create_deep_link_challenge(
            &overflow_state,
            &verifier_hash,
            "Pressure replacement",
            &fixed_scopes(),
            origin,
            later,
            OffsetDateTime::UNIX_EPOCH,
        )
        .expect("expired tombstones must yield bounded capacity under pressure");
}

#[tokio::test(flavor = "current_thread")]
async fn stalled_approval_expires_and_releases_its_service_reference() {
    let deep_links = Arc::new(DeepLinkRegistry::new());
    let service = Arc::new(PairingService::new(
        Arc::new(StalledApproval),
        Arc::new(SqlitePairingStore::open_in_memory().unwrap()),
        deep_links.clone(),
        Arc::new(ManualCodeRegistry::new()),
    ));
    let weak_service = Arc::downgrade(&service);
    let now = Instant::now() - Duration::from_secs(120) + Duration::from_millis(25);
    let state = fixed_state(6);
    deep_links
        .record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{state}")),
            ],
            now,
        )
        .unwrap();
    let verifier = generate_secret().unwrap();
    let challenge = service
        .clone()
        .create_deep_link_challenge(
            &state,
            &hash_for_transport(verifier.expose().as_bytes()),
            "Browser",
            &fixed_scopes(),
            "http://127.0.0.1:5173",
            now,
            OffsetDateTime::UNIX_EPOCH,
        )
        .unwrap();

    tokio::time::timeout(
        Duration::from_secs(1),
        service.wait_for_decision(challenge.id),
    )
    .await
    .expect("a stalled approval must stop waiting at the challenge deadline");
    assert!(matches!(
        service.redeem(
            challenge.id,
            verifier.expose(),
            "http://127.0.0.1:5173",
            now + Duration::from_secs(121),
            OffsetDateTime::UNIX_EPOCH,
        ),
        Err(PairingError::Expired)
    ));

    drop(service);
    tokio::task::yield_now().await;
    assert!(weak_service.upgrade().is_none());
}

#[tokio::test(flavor = "current_thread")]
async fn approval_task_failure_cannot_leave_decision_wait_pending_past_expiry() {
    let deep_links = Arc::new(DeepLinkRegistry::new());
    let service = Arc::new(PairingService::new(
        Arc::new(PanickingApproval),
        Arc::new(SqlitePairingStore::open_in_memory().unwrap()),
        deep_links.clone(),
        Arc::new(ManualCodeRegistry::new()),
    ));
    let now = Instant::now() - Duration::from_secs(120) + Duration::from_millis(25);
    let state = fixed_state(66);
    deep_links
        .record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{state}")),
            ],
            now,
        )
        .unwrap();
    let challenge = service
        .clone()
        .create_deep_link_challenge(
            &state,
            &hash_for_transport(generate_secret().unwrap().expose().as_bytes()),
            "Browser",
            &fixed_scopes(),
            "http://127.0.0.1:5173",
            now,
            OffsetDateTime::UNIX_EPOCH,
        )
        .unwrap();

    tokio::time::timeout(
        Duration::from_secs(1),
        service.wait_for_decision(challenge.id),
    )
    .await
    .expect("decision wait must enforce expiry even if its approval task exits");
}

#[tokio::test(flavor = "current_thread")]
async fn async_pairing_facades_keep_plaintext_in_secret_wrappers_and_include_revokes() {
    let service = Arc::new(PairingService::new(
        Arc::new(ImmediateApproval),
        Arc::new(SqlitePairingStore::open_in_memory().unwrap()),
        Arc::new(DeepLinkRegistry::new()),
        Arc::new(ManualCodeRegistry::new()),
    ));
    let origin = "http://127.0.0.1:5173".to_owned();

    assert!(matches!(
        service
            .clone()
            .redeem_async(
                uuid::Uuid::nil(),
                generate_secret().unwrap(),
                origin.clone(),
                Instant::now(),
                OffsetDateTime::UNIX_EPOCH,
            )
            .await,
        Err(PairingError::InvalidRequest)
    ));
    assert!(matches!(
        service
            .clone()
            .authenticate_async(
                generate_secret().unwrap(),
                origin,
                Scope::parse("health:read").unwrap(),
                OffsetDateTime::UNIX_EPOCH,
            )
            .await,
        Err(PairingError::InvalidBearer)
    ));
    service
        .clone()
        .revoke_one_async(uuid::Uuid::new_v4())
        .await
        .unwrap();
    service.revoke_all_async().await.unwrap();
}

#[test]
fn raw_deep_link_parser_rejects_normalization_ambiguity_replay_and_expiry() {
    let registry = DeepLinkRegistry::new();
    let now = Instant::now();
    let state = fixed_state(7);
    let exact = format!("ovp-companion://pair/{state}");
    assert_eq!(
        registry
            .record_argv(&[executable(), OsString::from(&exact)], now)
            .unwrap(),
        state
    );
    assert_eq!(
        registry.record_argv(&[executable(), OsString::from(&exact)], now),
        Err(DeepLinkError::Replay)
    );

    for forged in [
        format!("OVP-COMPANION://pair/{state}"),
        format!("ovp-companion://pair/{state}/extra"),
        format!("ovp-companion://pair/{state}?x=1"),
        format!("ovp-companion://pair/{state}#x"),
        format!("ovp-companion://user@pair/{state}"),
        format!("ovp-companion://pair:12/{state}"),
        format!("ovp-companion://pair/%41{}", &state[1..]),
        format!("ovp-companion://pair/%252F{state}"),
    ] {
        assert_eq!(
            registry.record_argv(&[executable(), OsString::from(forged)], now),
            Err(DeepLinkError::Invalid)
        );
    }
    assert_eq!(
        registry.record_argv(&[executable()], now),
        Err(DeepLinkError::MixedArguments)
    );
    assert_eq!(
        registry.record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{}", fixed_state(8))),
                OsString::from("--forged")
            ],
            now
        ),
        Err(DeepLinkError::MixedArguments)
    );

    let expired = fixed_state(9);
    registry
        .record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{expired}")),
            ],
            now,
        )
        .unwrap();
    assert_eq!(
        registry.claim(&expired, now + Duration::from_secs(120)),
        Err(DeepLinkError::Expired)
    );
}

#[test]
fn raw_deep_link_requires_the_current_executable_identity() {
    let registry = DeepLinkRegistry::new();
    let state = fixed_state(31);
    assert_eq!(
        registry.record_argv(
            &[
                OsString::from("forged-companion.exe"),
                OsString::from(format!("ovp-companion://pair/{state}")),
            ],
            Instant::now(),
        ),
        Err(DeepLinkError::MixedArguments)
    );
}

#[cfg(windows)]
#[test]
fn raw_deep_link_rejects_non_unicode_windows_arguments() {
    use std::os::windows::ffi::OsStringExt;

    let registry = DeepLinkRegistry::new();
    let non_unicode = OsString::from_wide(&[0xD800]);
    assert_eq!(
        registry.record_argv(&[executable(), non_unicode], Instant::now()),
        Err(DeepLinkError::MixedArguments)
    );
}

#[test]
fn raw_deep_link_registry_has_a_hard_memory_bound() {
    let registry = DeepLinkRegistry::new();
    let now = Instant::now();
    for byte in 0_u8..128 {
        let state = fixed_state(byte);
        registry
            .record_argv(
                &[
                    executable(),
                    OsString::from(format!("ovp-companion://pair/{state}")),
                ],
                now,
            )
            .unwrap();
    }
    let overflow = fixed_state(200);
    assert_eq!(
        registry.record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{overflow}")),
            ],
            now,
        ),
        Err(DeepLinkError::Invalid)
    );
}

#[test]
fn manual_code_is_crockford_bounded_origin_bound_and_attempt_limited() {
    let registry = ManualCodeRegistry::new();
    let now = Instant::now();
    let code = registry.create("http://127.0.0.1:5173", now).unwrap();
    assert_eq!(code.len(), 12);
    assert!(
        code.bytes()
            .all(|byte| b"0123456789ABCDEFGHJKMNPQRSTVWXYZ".contains(&byte))
    );
    for invalid in [
        format!(" {code}"),
        format!("O{}", &code[1..]),
        format!("I{}", &code[1..]),
        format!("L{}", &code[1..]),
    ] {
        assert_eq!(
            registry.claim(&invalid, "http://127.0.0.1:5173", now),
            Err(PairingError::InvalidRequest)
        );
    }
    let mut wrong_canonical = code.clone().into_bytes();
    wrong_canonical[0] = if wrong_canonical[0] == b'0' {
        b'1'
    } else {
        b'0'
    };
    let wrong_canonical = String::from_utf8(wrong_canonical).unwrap();
    assert_eq!(
        registry.claim(&wrong_canonical, "http://127.0.0.1:5173", now),
        Err(PairingError::AttemptsExhausted)
    );
    assert_eq!(
        registry.claim(&code, "http://127.0.0.1:5173", now),
        Err(PairingError::AttemptsExhausted)
    );

    let registry = ManualCodeRegistry::new();
    let code = registry.create("http://127.0.0.1:5173", now).unwrap();
    assert_eq!(
        registry.claim(&code, "https://other.invalid", now),
        Err(PairingError::OriginMismatch)
    );
    assert_eq!(
        registry.claim(
            &code,
            "http://127.0.0.1:5173",
            now + Duration::from_secs(120)
        ),
        Err(PairingError::Expired)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pairing_is_atomic_one_time_hash_only_origin_and_scope_bound() {
    let (approve_tx, approve_rx) = oneshot::channel();
    let (deny_tx, deny_rx) = oneshot::channel();
    let approval = Arc::new(ControlledApproval::new(vec![approve_rx, deny_rx]));
    let store_directory = tempfile::tempdir().unwrap();
    let store_path = store_directory.path().join("pairings.sqlite3");
    let store = Arc::new(SqlitePairingStore::open_fixed(&store_path).unwrap());
    let deep_links = Arc::new(DeepLinkRegistry::new());
    let manuals = Arc::new(ManualCodeRegistry::new());
    let service = Arc::new(PairingService::new(
        approval.clone(),
        store.clone(),
        deep_links.clone(),
        manuals,
    ));
    let now = Instant::now();
    let utc = OffsetDateTime::UNIX_EPOCH + time::Duration::days(10_000);
    let origin = "http://127.0.0.1:5173";
    let state = fixed_state(11);
    deep_links
        .record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{state}")),
            ],
            now,
        )
        .unwrap();
    let verifier = generate_secret().unwrap();
    let verifier_hash = hash_for_transport(verifier.expose().as_bytes());
    let challenge = service
        .clone()
        .create_deep_link_challenge(
            &state,
            &verifier_hash,
            "My desktop browser",
            &fixed_scopes(),
            origin,
            now,
            utc,
        )
        .unwrap();
    assert!(matches!(
        service.redeem(challenge.id, verifier.expose(), origin, now, utc),
        Err(PairingError::Pending)
    ));
    approval.requested.notified().await;
    approve_tx.send(ApprovalDecision::Approve).unwrap();
    service.wait_for_decision(challenge.id).await;

    let success = service
        .redeem(challenge.id, verifier.expose(), origin, now, utc)
        .unwrap();
    assert_eq!(success.token.expose().len(), 43);
    assert!(matches!(
        service.redeem(challenge.id, verifier.expose(), origin, now, utc),
        Err(PairingError::Consumed)
    ));
    let audit_connection = rusqlite::Connection::open(&store_path).unwrap();
    let mut statement = audit_connection
        .prepare(
            "SELECT id, hex(bearer_hash), origin, client_label, scopes,
                    created_at_ns, last_used_at_ns, revoked FROM pairings ORDER BY id",
        )
        .unwrap();
    let raw_database = statement
        .query_map([], |row| {
            Ok(format!(
                "{}|{}|{}|{}|{}|{}|{}|{}",
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
        .join("\n");
    for forbidden in [success.token.expose(), verifier.expose(), state.as_str()] {
        assert!(!raw_database.contains(forbidden));
    }

    let health_scope = Scope::parse("health:read").unwrap();
    let authenticated = service
        .authenticate(success.token.expose(), origin, health_scope, utc)
        .unwrap();
    assert_eq!(authenticated.id, success.pairing.id);
    let after_clock_rollback = service
        .authenticate(
            success.token.expose(),
            origin,
            health_scope,
            utc - time::Duration::days(1),
        )
        .unwrap();
    assert_eq!(after_clock_rollback.last_used_at, utc);
    assert_eq!(
        service.authenticate(
            success.token.expose(),
            "https://other.invalid",
            health_scope,
            utc
        ),
        Err(PairingError::OriginMismatch)
    );
    assert_eq!(
        service.authenticate(
            success.token.expose(),
            origin,
            health_scope,
            utc + time::Duration::days(90)
        ),
        Err(PairingError::InvalidBearer)
    );

    service.revoke_one(authenticated.id).unwrap();
    assert_eq!(
        service.authenticate(success.token.expose(), origin, health_scope, utc),
        Err(PairingError::InvalidBearer)
    );
    service.revoke_all().unwrap();

    let denied_state = fixed_state(12);
    deep_links
        .record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{denied_state}")),
            ],
            now,
        )
        .unwrap();
    let denied = service
        .clone()
        .create_deep_link_challenge(
            &denied_state,
            &verifier_hash,
            "Browser",
            &fixed_scopes(),
            origin,
            now,
            utc,
        )
        .unwrap();
    approval.requested.notified().await;
    deny_tx.send(ApprovalDecision::Deny).unwrap();
    service.wait_for_decision(denied.id).await;
    assert!(matches!(
        service.redeem(denied.id, verifier.expose(), origin, now, utc),
        Err(PairingError::Denied)
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_redeem_delivers_only_one_bearer_and_labels_fail_closed() {
    let (approval_tx, approval_rx) = oneshot::channel();
    let approval = Arc::new(ControlledApproval::new(vec![approval_rx]));
    let store = Arc::new(SqlitePairingStore::open_in_memory().unwrap());
    let deep_links = Arc::new(DeepLinkRegistry::new());
    let service = Arc::new(PairingService::new(
        approval.clone(),
        store,
        deep_links.clone(),
        Arc::new(ManualCodeRegistry::new()),
    ));
    let now = Instant::now();
    let utc = OffsetDateTime::UNIX_EPOCH;
    let origin = "http://127.0.0.1:5173";
    let verifier = generate_secret().unwrap();
    let verifier_hash = hash_for_transport(verifier.expose().as_bytes());

    for bad_label in [
        "",
        "line\nbreak",
        "bell\u{0007}",
        "c1\u{0080}control",
        "next\u{0085}line",
        "c1\u{009f}control",
        "line\u{2028}separator",
        "paragraph\u{2029}separator",
        "arabic\u{061c}mark",
        "left\u{200e}mark",
        "right\u{200f}mark",
        "right\u{202e}left",
        "isolate\u{2066}text",
        "<Approve this request>",
    ] {
        let state = generate_secret().unwrap();
        deep_links
            .record_argv(
                &[
                    executable(),
                    OsString::from(format!("ovp-companion://pair/{}", state.expose())),
                ],
                now,
            )
            .unwrap();
        assert!(
            service
                .clone()
                .create_deep_link_challenge(
                    state.expose(),
                    &verifier_hash,
                    bad_label,
                    &fixed_scopes(),
                    origin,
                    now,
                    utc,
                )
                .is_err()
        );
    }

    let state = fixed_state(20);
    deep_links
        .record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{state}")),
            ],
            now,
        )
        .unwrap();
    let challenge = service
        .clone()
        .create_deep_link_challenge(
            &state,
            &verifier_hash,
            "Browser",
            &fixed_scopes(),
            origin,
            now,
            utc,
        )
        .unwrap();
    approval.requested.notified().await;
    approval_tx.send(ApprovalDecision::Approve).unwrap();
    service.wait_for_decision(challenge.id).await;

    let first = {
        let service = service.clone();
        let verifier = verifier.expose().to_owned();
        tokio::task::spawn_blocking(move || {
            service.redeem(challenge.id, &verifier, origin, now, utc)
        })
    };
    let second = {
        let service = service.clone();
        let verifier = verifier.expose().to_owned();
        tokio::task::spawn_blocking(move || {
            service.redeem(challenge.id, &verifier, origin, now, utc)
        })
    };
    let results = [first.await.unwrap(), second.await.unwrap()];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(PairingError::Consumed)))
            .count(),
        1
    );

    let mut missing_scope = fixed_scopes();
    missing_scope.pop();
    let state = fixed_state(21);
    deep_links
        .record_argv(
            &[
                executable(),
                OsString::from(format!("ovp-companion://pair/{state}")),
            ],
            now,
        )
        .unwrap();
    assert!(
        service
            .create_deep_link_challenge(
                &state,
                &verifier_hash,
                "Browser",
                &missing_scope,
                origin,
                now,
                utc,
            )
            .is_err()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn persistence_failure_still_consumes_the_approved_challenge() {
    let (approval_tx, approval_rx) = oneshot::channel();
    let approval = Arc::new(ControlledApproval::new(vec![approval_rx]));
    let deep_links = Arc::new(DeepLinkRegistry::new());
    let service = Arc::new(PairingService::new(
        approval.clone(),
        Arc::new(FailingStore),
        deep_links.clone(),
        Arc::new(ManualCodeRegistry::new()),
    ));
    let now = Instant::now();
    let utc = OffsetDateTime::UNIX_EPOCH;
    let origin = "http://127.0.0.1:5173";
    let state = fixed_state(99);
    let executable = std::env::current_exe().unwrap().into_os_string();
    deep_links
        .record_argv(
            &[
                executable,
                OsString::from(format!("ovp-companion://pair/{state}")),
            ],
            now,
        )
        .unwrap();
    let verifier = generate_secret().unwrap();
    let challenge = service
        .clone()
        .create_deep_link_challenge(
            &state,
            &hash_for_transport(verifier.expose().as_bytes()),
            "Browser",
            &fixed_scopes(),
            origin,
            now,
            utc,
        )
        .unwrap();
    approval.requested.notified().await;
    approval_tx.send(ApprovalDecision::Approve).unwrap();
    service.wait_for_decision(challenge.id).await;
    assert!(matches!(
        service.redeem(challenge.id, verifier.expose(), origin, now, utc),
        Err(PairingError::Unavailable)
    ));
    assert!(matches!(
        service.redeem(challenge.id, verifier.expose(), origin, now, utc),
        Err(PairingError::Consumed)
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn blocked_persistence_does_not_hold_the_global_challenge_lock() {
    let (blocked_tx, blocked_rx) = oneshot::channel();
    let (_redeem_tx, redeem_rx) = oneshot::channel();
    let (decision_tx, decision_rx) = oneshot::channel();
    let approval = Arc::new(LabelApproval {
        decisions: Mutex::new(HashMap::from([
            ("Blocked insert".to_owned(), blocked_rx),
            ("Independent redeem".to_owned(), redeem_rx),
            ("Independent decision".to_owned(), decision_rx),
        ])),
    });
    let store = Arc::new(BlockingFirstInsertStore::new());
    let deep_links = Arc::new(DeepLinkRegistry::new());
    let service = Arc::new(PairingService::new(
        approval,
        store.clone(),
        deep_links.clone(),
        Arc::new(ManualCodeRegistry::new()),
    ));
    let now = Instant::now();
    let utc = OffsetDateTime::UNIX_EPOCH;
    let origin = "http://127.0.0.1:5173";
    let verifier = generate_secret().unwrap();
    let verifier_hash = hash_for_transport(verifier.expose().as_bytes());

    let create = |byte: u8, label: &str| {
        let state = fixed_state(byte);
        deep_links
            .record_argv(
                &[
                    executable(),
                    OsString::from(format!("ovp-companion://pair/{state}")),
                ],
                now,
            )
            .unwrap();
        service
            .clone()
            .create_deep_link_challenge(
                &state,
                &verifier_hash,
                label,
                &fixed_scopes(),
                origin,
                now,
                utc,
            )
            .unwrap()
    };
    let blocked = create(101, "Blocked insert");
    let independent_redeem = create(102, "Independent redeem");
    let independent_decision = create(103, "Independent decision");

    blocked_tx.send(ApprovalDecision::Approve).unwrap();
    tokio::time::timeout(
        Duration::from_secs(1),
        service.wait_for_decision(blocked.id),
    )
    .await
    .expect("blocked challenge approval did not arrive");

    let first_service = service.clone();
    let first_verifier = verifier.expose().to_owned();
    let first = tokio::task::spawn_blocking(move || {
        first_service.redeem(blocked.id, &first_verifier, origin, now, utc)
    });
    tokio::time::timeout(Duration::from_secs(1), store.insert_started.notified())
        .await
        .expect("the first persistence call did not start");

    let second_service = service.clone();
    let second_verifier = verifier.expose().to_owned();
    let mut second = tokio::task::spawn_blocking(move || {
        second_service.redeem(independent_redeem.id, &second_verifier, origin, now, utc)
    });
    let second_before_release = tokio::time::timeout(Duration::from_millis(50), &mut second).await;
    let second_finished_before_release = second_before_release.is_ok();
    if let Ok(result) = second_before_release {
        assert!(matches!(result.unwrap(), Err(PairingError::Pending)));
    }

    decision_tx.send(ApprovalDecision::Approve).unwrap();
    let decision_service = service.clone();
    let mut decision = tokio::spawn(async move {
        decision_service
            .wait_for_decision(independent_decision.id)
            .await;
    });
    let decision_before_release =
        tokio::time::timeout(Duration::from_millis(50), &mut decision).await;
    let decision_finished_before_release = decision_before_release.is_ok();
    if let Ok(result) = decision_before_release {
        result.unwrap();
    }

    store.release();
    assert!(
        tokio::time::timeout(Duration::from_secs(1), first)
            .await
            .expect("blocked redeem did not resume after persistence release")
            .unwrap()
            .is_ok()
    );
    if !second_finished_before_release {
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(1), second)
                .await
                .expect("independent redeem did not resume after persistence release")
                .unwrap(),
            Err(PairingError::Pending)
        ));
    }
    if !decision_finished_before_release {
        tokio::time::timeout(Duration::from_secs(1), decision)
            .await
            .expect("independent decision did not resume after persistence release")
            .unwrap();
    }

    assert!(
        second_finished_before_release,
        "an unrelated redeem stalled behind the blocked persistence call"
    );
    assert!(
        decision_finished_before_release,
        "an unrelated native decision stalled behind the blocked persistence call"
    );
}
