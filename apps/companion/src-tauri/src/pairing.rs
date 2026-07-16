use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        mpsc::{SyncSender, sync_channel},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use async_trait::async_trait;
use rusqlite::{Connection, params};
use subtle::ConstantTimeEq;
use time::OffsetDateTime;
use tokio::sync::watch;
use uuid::Uuid;

use crate::{
    deep_link::{DeepLinkError, DeepLinkRegistry},
    protocol::{ALL_SCOPES, Scope},
    secret::{
        SecretError, SecretString, decode_canonical_secret, generate_secret as new_secret,
        hash_bytes, hash_for_transport as transport_hash,
    },
};

const PAIRING_TTL: Duration = Duration::from_secs(120);
const MAX_REDEEM_ATTEMPTS: u8 = 10;
const MAX_MANUAL_ATTEMPTS: u8 = 5;
const INACTIVITY_DAYS: i64 = 90;
const MAX_CHALLENGES: usize = 128;
const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

pub use crate::secret::SecretString as BearerSecret;

pub fn generate_secret() -> Result<SecretString, PairingError> {
    new_secret().map_err(|_| PairingError::Unavailable)
}

pub fn hash_for_transport(value: &[u8]) -> String {
    transport_hash(value)
}

pub fn fixed_scopes() -> Vec<Scope> {
    ALL_SCOPES
        .iter()
        .map(|scope| Scope::parse(scope).expect("fixed scopes are valid"))
        .collect()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ApprovalDecision {
    Approve,
    Deny,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApprovalRequest {
    pub challenge_id: Uuid,
    pub origin: String,
    pub client_label: String,
    pub scopes: Vec<Scope>,
}

#[async_trait]
pub trait ApprovalPort: Send + Sync {
    async fn decide(&self, request: ApprovalRequest) -> ApprovalDecision;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum PairingError {
    #[error("the pairing request is pending")]
    Pending,
    #[error("the pairing request was denied")]
    Denied,
    #[error("the pairing request expired")]
    Expired,
    #[error("the pairing request was already consumed")]
    Consumed,
    #[error("the pairing request is invalid")]
    InvalidRequest,
    #[error("the pairing verifier is invalid")]
    InvalidVerifier,
    #[error("the bearer token is invalid")]
    InvalidBearer,
    #[error("the bearer origin does not match")]
    OriginMismatch,
    #[error("the bearer lacks the required scope")]
    ScopeDenied,
    #[error("manual pairing attempts are exhausted")]
    AttemptsExhausted,
    #[error("the pairing subsystem is unavailable")]
    Unavailable,
}

impl From<DeepLinkError> for PairingError {
    fn from(error: DeepLinkError) -> Self {
        match error {
            DeepLinkError::Expired => Self::Expired,
            DeepLinkError::Consumed | DeepLinkError::Replay => Self::Consumed,
            _ => Self::InvalidRequest,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ChallengeStatus {
    Pending,
    Approved,
    Denied,
    Expired,
    Consumed,
}

struct Challenge {
    verifier_hash: [u8; 32],
    origin: String,
    client_label: String,
    scopes: Vec<Scope>,
    created_utc: OffsetDateTime,
    expires: Instant,
    status: ChallengeStatus,
    decision_signal: watch::Sender<ChallengeStatus>,
    redeem_attempts: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ChallengeHandle {
    pub id: Uuid,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PairingRecord {
    pub id: Uuid,
    pub origin: String,
    pub client_label: String,
    pub scopes: Vec<Scope>,
    pub created_at: OffsetDateTime,
    pub last_used_at: OffsetDateTime,
}

pub struct RedeemSuccess {
    pub token: SecretString,
    pub pairing: PairingRecord,
}

#[derive(Clone)]
pub struct StoredPairing {
    record: PairingRecord,
    bearer_hash: [u8; 32],
}

pub trait PairingStore: Send + Sync {
    fn insert(&self, pairing: &StoredPairing) -> Result<(), PairingError>;
    fn active(&self, now: OffsetDateTime) -> Result<Vec<StoredPairing>, PairingError>;
    fn touch(&self, id: Uuid, at: OffsetDateTime) -> Result<(), PairingError>;
    fn revoke(&self, id: Uuid) -> Result<(), PairingError>;
    fn revoke_all(&self) -> Result<(), PairingError>;
}

const STORE_QUEUE_CAPACITY: usize = 32;
const MAX_ACTIVE_PAIRINGS: usize = 128;
const MAX_RETAINED_REVOKED_PAIRINGS: usize = 128;

enum StoreLocation {
    Memory,
    File(PathBuf),
}

enum StoreCommand {
    Insert(StoredPairing, SyncSender<Result<(), PairingError>>),
    Active(
        OffsetDateTime,
        SyncSender<Result<Vec<StoredPairing>, PairingError>>,
    ),
    Touch(Uuid, OffsetDateTime, SyncSender<Result<(), PairingError>>),
    Revoke(Uuid, SyncSender<Result<(), PairingError>>),
    RevokeAll(SyncSender<Result<(), PairingError>>),
    Shutdown,
}

pub struct SqlitePairingStore {
    commands: SyncSender<StoreCommand>,
    #[cfg(test)]
    worker_thread_id: thread::ThreadId,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl SqlitePairingStore {
    pub fn open_in_memory() -> Result<Self, PairingError> {
        Self::start_worker(StoreLocation::Memory)
    }

    pub fn open_fixed(path: &std::path::Path) -> Result<Self, PairingError> {
        Self::start_worker(StoreLocation::File(path.to_path_buf()))
    }

    fn start_worker(location: StoreLocation) -> Result<Self, PairingError> {
        let (commands, receiver) = sync_channel(STORE_QUEUE_CAPACITY);
        let (ready_tx, ready_rx) = sync_channel(1);
        let worker = thread::Builder::new()
            .name("ovp-pairing-store".into())
            .spawn(move || {
                let opened = match location {
                    StoreLocation::Memory => Connection::open_in_memory(),
                    StoreLocation::File(path) => Connection::open(path),
                };
                let connection = match opened
                    .map_err(|_| PairingError::Unavailable)
                    .and_then(initialize_database)
                {
                    Ok(connection) => connection,
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                        return;
                    }
                };
                if ready_tx.send(Ok(thread::current().id())).is_err() {
                    return;
                }
                while let Ok(command) = receiver.recv() {
                    match command {
                        StoreCommand::Insert(pairing, reply) => {
                            let _ = reply.send(database_insert(&connection, &pairing));
                        }
                        StoreCommand::Active(now, reply) => {
                            let _ = reply.send(database_active(&connection, now));
                        }
                        StoreCommand::Touch(id, at, reply) => {
                            let _ = reply.send(database_touch(&connection, id, at));
                        }
                        StoreCommand::Revoke(id, reply) => {
                            let _ = reply.send(database_revoke(&connection, id));
                        }
                        StoreCommand::RevokeAll(reply) => {
                            let _ = reply.send(database_revoke_all(&connection));
                        }
                        StoreCommand::Shutdown => break,
                    }
                }
            })
            .map_err(|_| PairingError::Unavailable)?;
        let worker_thread_id = ready_rx.recv().map_err(|_| PairingError::Unavailable)??;
        #[cfg(not(test))]
        let _ = worker_thread_id;
        Ok(Self {
            commands,
            #[cfg(test)]
            worker_thread_id,
            worker: Mutex::new(Some(worker)),
        })
    }
}

impl Drop for SqlitePairingStore {
    fn drop(&mut self) {
        let _ = self.commands.send(StoreCommand::Shutdown);
        if let Ok(mut worker) = self.worker.lock()
            && let Some(worker) = worker.take()
        {
            let _ = worker.join();
        }
    }
}

fn initialize_database(connection: Connection) -> Result<Connection, PairingError> {
    connection
        .execute_batch(
            "PRAGMA trusted_schema=OFF;
             CREATE TABLE IF NOT EXISTS pairings (
               id TEXT PRIMARY KEY NOT NULL,
               bearer_hash BLOB NOT NULL CHECK(length(bearer_hash) = 32),
               origin TEXT NOT NULL,
               client_label TEXT NOT NULL,
               scopes TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               last_used_at INTEGER NOT NULL,
               revoked INTEGER NOT NULL CHECK(revoked IN (0, 1))
             );",
        )
        .map_err(|_| PairingError::Unavailable)?;
    database_prune_revoked(&connection)?;
    Ok(connection)
}

fn encode_scopes(scopes: &[Scope]) -> String {
    scopes
        .iter()
        .map(|scope| scope.as_str())
        .collect::<Vec<_>>()
        .join(",")
}

fn decode_scopes(value: &str) -> Result<Vec<Scope>, PairingError> {
    value
        .split(',')
        .map(|scope| Scope::parse(scope).ok_or(PairingError::Unavailable))
        .collect()
}

impl PairingStore for SqlitePairingStore {
    fn insert(&self, pairing: &StoredPairing) -> Result<(), PairingError> {
        let (reply, receiver) = sync_channel(1);
        self.commands
            .send(StoreCommand::Insert(pairing.clone(), reply))
            .map_err(|_| PairingError::Unavailable)?;
        receiver.recv().map_err(|_| PairingError::Unavailable)?
    }

    fn active(&self, now: OffsetDateTime) -> Result<Vec<StoredPairing>, PairingError> {
        let (reply, receiver) = sync_channel(1);
        self.commands
            .send(StoreCommand::Active(now, reply))
            .map_err(|_| PairingError::Unavailable)?;
        receiver.recv().map_err(|_| PairingError::Unavailable)?
    }

    fn touch(&self, id: Uuid, at: OffsetDateTime) -> Result<(), PairingError> {
        let (reply, receiver) = sync_channel(1);
        self.commands
            .send(StoreCommand::Touch(id, at, reply))
            .map_err(|_| PairingError::Unavailable)?;
        receiver.recv().map_err(|_| PairingError::Unavailable)?
    }

    fn revoke(&self, id: Uuid) -> Result<(), PairingError> {
        let (reply, receiver) = sync_channel(1);
        self.commands
            .send(StoreCommand::Revoke(id, reply))
            .map_err(|_| PairingError::Unavailable)?;
        receiver.recv().map_err(|_| PairingError::Unavailable)?
    }

    fn revoke_all(&self) -> Result<(), PairingError> {
        let (reply, receiver) = sync_channel(1);
        self.commands
            .send(StoreCommand::RevokeAll(reply))
            .map_err(|_| PairingError::Unavailable)?;
        receiver.recv().map_err(|_| PairingError::Unavailable)?
    }
}

fn database_insert(connection: &Connection, pairing: &StoredPairing) -> Result<(), PairingError> {
    database_expire_inactive(connection, pairing.record.last_used_at)?;
    let active: i64 = connection
        .query_row(
            "SELECT count(*) FROM pairings WHERE revoked = 0",
            [],
            |row| row.get(0),
        )
        .map_err(|_| PairingError::Unavailable)?;
    if active >= MAX_ACTIVE_PAIRINGS as i64 {
        return Err(PairingError::Unavailable);
    }
    connection
        .execute(
            "INSERT INTO pairings
             (id, bearer_hash, origin, client_label, scopes, created_at, last_used_at, revoked)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
            params![
                pairing.record.id.to_string(),
                pairing.bearer_hash.as_slice(),
                &pairing.record.origin,
                &pairing.record.client_label,
                encode_scopes(&pairing.record.scopes),
                pairing.record.created_at.unix_timestamp(),
                pairing.record.last_used_at.unix_timestamp(),
            ],
        )
        .map_err(|_| PairingError::Unavailable)?;
    Ok(())
}

fn database_active(
    connection: &Connection,
    now: OffsetDateTime,
) -> Result<Vec<StoredPairing>, PairingError> {
    database_expire_inactive(connection, now)?;
    let mut statement = connection
        .prepare(
            "SELECT id, bearer_hash, origin, client_label, scopes, created_at, last_used_at
             FROM pairings WHERE revoked = 0 ORDER BY id LIMIT 129",
        )
        .map_err(|_| PairingError::Unavailable)?;
    let rows = statement
        .query_map([], |row| {
            let hash: Vec<u8> = row.get(1)?;
            let hash: [u8; 32] = hash.try_into().map_err(|_| {
                rusqlite::Error::InvalidColumnType(
                    1,
                    "bearer_hash".into(),
                    rusqlite::types::Type::Blob,
                )
            })?;
            let created = OffsetDateTime::from_unix_timestamp(row.get(5)?).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    5,
                    rusqlite::types::Type::Integer,
                    Box::new(error),
                )
            })?;
            let last_used = OffsetDateTime::from_unix_timestamp(row.get(6)?).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    6,
                    rusqlite::types::Type::Integer,
                    Box::new(error),
                )
            })?;
            Ok((
                row.get::<_, String>(0)?,
                hash,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                created,
                last_used,
            ))
        })
        .map_err(|_| PairingError::Unavailable)?;
    let mut pairings = Vec::new();
    for row in rows {
        let (id, bearer_hash, origin, client_label, scopes, created_at, last_used_at) =
            row.map_err(|_| PairingError::Unavailable)?;
        pairings.push(StoredPairing {
            bearer_hash,
            record: PairingRecord {
                id: Uuid::parse_str(&id).map_err(|_| PairingError::Unavailable)?,
                origin,
                client_label,
                scopes: decode_scopes(&scopes)?,
                created_at,
                last_used_at,
            },
        });
    }
    if pairings.len() > MAX_ACTIVE_PAIRINGS {
        return Err(PairingError::Unavailable);
    }
    Ok(pairings)
}

fn database_touch(
    connection: &Connection,
    id: Uuid,
    at: OffsetDateTime,
) -> Result<(), PairingError> {
    let changed = connection
        .execute(
            "UPDATE pairings SET last_used_at = max(last_used_at, ?2)
             WHERE id = ?1 AND revoked = 0",
            params![id.to_string(), at.unix_timestamp()],
        )
        .map_err(|_| PairingError::Unavailable)?;
    if changed == 1 {
        Ok(())
    } else {
        Err(PairingError::Unavailable)
    }
}

fn database_revoke(connection: &Connection, id: Uuid) -> Result<(), PairingError> {
    connection
        .execute(
            "UPDATE pairings SET revoked = 1 WHERE id = ?1",
            params![id.to_string()],
        )
        .map_err(|_| PairingError::Unavailable)?;
    database_prune_revoked(connection)
}

fn database_revoke_all(connection: &Connection) -> Result<(), PairingError> {
    connection
        .execute("UPDATE pairings SET revoked = 1", [])
        .map_err(|_| PairingError::Unavailable)?;
    database_prune_revoked(connection)
}

fn database_prune_revoked(connection: &Connection) -> Result<(), PairingError> {
    connection
        .execute(
            "DELETE FROM pairings
             WHERE revoked = 1
               AND rowid NOT IN (
                 SELECT rowid FROM pairings
                 WHERE revoked = 1
                 ORDER BY last_used_at DESC, rowid DESC
                 LIMIT ?1
               )",
            [MAX_RETAINED_REVOKED_PAIRINGS as i64],
        )
        .map_err(|_| PairingError::Unavailable)?;
    Ok(())
}

fn database_expire_inactive(
    connection: &Connection,
    now: OffsetDateTime,
) -> Result<(), PairingError> {
    let cutoff = now
        .unix_timestamp()
        .saturating_sub(INACTIVITY_DAYS.saturating_mul(24 * 60 * 60));
    connection
        .execute(
            "UPDATE pairings SET revoked = 1
             WHERE revoked = 0 AND last_used_at <= ?1",
            [cutoff],
        )
        .map_err(|_| PairingError::Unavailable)?;
    database_prune_revoked(connection)
}

struct ManualEntry {
    code: String,
    origin: String,
    expires: Instant,
    failed_attempts: u8,
    consumed: bool,
}

pub struct ManualCodeRegistry {
    active: Mutex<Option<ManualEntry>>,
}

impl Default for ManualCodeRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ManualCodeRegistry {
    pub const fn new() -> Self {
        Self {
            active: Mutex::new(None),
        }
    }

    pub fn create(&self, origin: &str, now: Instant) -> Result<String, PairingError> {
        let mut random = [0_u8; 8];
        getrandom::fill(&mut random).map_err(|_| PairingError::Unavailable)?;
        let mut value = u64::from_le_bytes(random) & ((1_u64 << 60) - 1);
        let mut code = [b'0'; 12];
        for slot in code.iter_mut().rev() {
            *slot = CROCKFORD[(value & 31) as usize];
            value >>= 5;
        }
        let code = String::from_utf8(code.to_vec()).map_err(|_| PairingError::Unavailable)?;
        *self.active.lock().map_err(|_| PairingError::Unavailable)? = Some(ManualEntry {
            code: code.clone(),
            origin: origin.to_owned(),
            expires: now + PAIRING_TTL,
            failed_attempts: 0,
            consumed: false,
        });
        Ok(code)
    }

    pub fn claim(&self, code: &str, origin: &str, now: Instant) -> Result<(), PairingError> {
        let mut active = self.active.lock().map_err(|_| PairingError::Unavailable)?;
        let entry = active.as_mut().ok_or(PairingError::InvalidRequest)?;
        if entry.consumed {
            return Err(PairingError::Consumed);
        }
        if now >= entry.expires {
            return Err(PairingError::Expired);
        }
        if entry.failed_attempts >= MAX_MANUAL_ATTEMPTS {
            return Err(PairingError::AttemptsExhausted);
        }
        let canonical = code.len() == 12 && code.bytes().all(|byte| CROCKFORD.contains(&byte));
        if !canonical || code != entry.code || origin != entry.origin {
            entry.failed_attempts = entry.failed_attempts.saturating_add(1);
            if entry.failed_attempts >= MAX_MANUAL_ATTEMPTS {
                return Err(PairingError::AttemptsExhausted);
            }
            return Err(if origin != entry.origin {
                PairingError::OriginMismatch
            } else {
                PairingError::InvalidRequest
            });
        }
        entry.consumed = true;
        Ok(())
    }
}

pub struct PairingService<A: ApprovalPort + 'static> {
    approval: Arc<A>,
    store: Arc<dyn PairingStore>,
    deep_links: Arc<DeepLinkRegistry>,
    manual_codes: Arc<ManualCodeRegistry>,
    challenges: Mutex<HashMap<Uuid, Challenge>>,
}

impl<A: ApprovalPort + 'static> PairingService<A> {
    pub fn new<S: PairingStore + 'static>(
        approval: Arc<A>,
        store: Arc<S>,
        deep_links: Arc<DeepLinkRegistry>,
        manual_codes: Arc<ManualCodeRegistry>,
    ) -> Self {
        Self {
            approval,
            store,
            deep_links,
            manual_codes,
            challenges: Mutex::new(HashMap::new()),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_deep_link_challenge(
        self: Arc<Self>,
        state: &str,
        verifier_hash: &str,
        client_label: &str,
        scopes: &[Scope],
        origin: &str,
        now: Instant,
        utc: OffsetDateTime,
    ) -> Result<ChallengeHandle, PairingError> {
        validate_challenge_input(verifier_hash, client_label, scopes, origin)?;
        self.deep_links.claim(state, now)?;
        self.create_challenge(verifier_hash, client_label, scopes, origin, now, utc)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_manual_challenge(
        self: Arc<Self>,
        code: &str,
        verifier_hash: &str,
        client_label: &str,
        scopes: &[Scope],
        origin: &str,
        now: Instant,
        utc: OffsetDateTime,
    ) -> Result<ChallengeHandle, PairingError> {
        validate_challenge_input(verifier_hash, client_label, scopes, origin)?;
        self.manual_codes.claim(code, origin, now)?;
        self.create_challenge(verifier_hash, client_label, scopes, origin, now, utc)
    }

    fn create_challenge(
        self: Arc<Self>,
        verifier_hash: &str,
        client_label: &str,
        scopes: &[Scope],
        origin: &str,
        now: Instant,
        utc: OffsetDateTime,
    ) -> Result<ChallengeHandle, PairingError> {
        let verifier_hash =
            decode_canonical_secret(verifier_hash).map_err(|_| PairingError::InvalidRequest)?;
        let id = Uuid::new_v4();
        let expires = now + PAIRING_TTL;
        let (decision_signal, _decision_receiver) = watch::channel(ChallengeStatus::Pending);
        let mut challenges = self
            .challenges
            .lock()
            .map_err(|_| PairingError::Unavailable)?;
        challenges.retain(|_, challenge| now < challenge.expires);
        if challenges.len() >= MAX_CHALLENGES {
            return Err(PairingError::Unavailable);
        }
        challenges.insert(
            id,
            Challenge {
                verifier_hash: *verifier_hash,
                origin: origin.to_owned(),
                client_label: client_label.to_owned(),
                scopes: scopes.to_vec(),
                created_utc: utc,
                expires,
                status: ChallengeStatus::Pending,
                decision_signal,
                redeem_attempts: 0,
            },
        );
        drop(challenges);
        let approval = Arc::clone(&self.approval);
        let service = Arc::clone(&self);
        let request = ApprovalRequest {
            challenge_id: id,
            origin: origin.to_owned(),
            client_label: client_label.to_owned(),
            scopes: scopes.to_vec(),
        };
        tokio::spawn(async move {
            tokio::select! {
                decision = approval.decide(request) => service.apply_decision(id, decision),
                () = tokio::time::sleep_until(tokio::time::Instant::from_std(expires)) => {
                    service.expire_challenge(id);
                }
            }
        });
        Ok(ChallengeHandle { id })
    }

    fn apply_decision(&self, id: Uuid, decision: ApprovalDecision) {
        if let Ok(mut challenges) = self.challenges.lock()
            && let Some(challenge) = challenges.get_mut(&id)
            && challenge.status == ChallengeStatus::Pending
        {
            challenge.status = match decision {
                ApprovalDecision::Approve => ChallengeStatus::Approved,
                ApprovalDecision::Deny => ChallengeStatus::Denied,
            };
            challenge.decision_signal.send_replace(challenge.status);
        }
    }

    fn expire_challenge(&self, id: Uuid) {
        if let Ok(mut challenges) = self.challenges.lock()
            && let Some(challenge) = challenges.get_mut(&id)
            && challenge.status == ChallengeStatus::Pending
        {
            challenge.status = ChallengeStatus::Expired;
            challenge
                .decision_signal
                .send_replace(ChallengeStatus::Expired);
        }
    }

    pub async fn wait_for_decision(&self, id: Uuid) {
        let (mut decision, expires) = match self.challenges.lock().ok().and_then(|challenges| {
            challenges
                .get(&id)
                .map(|challenge| (challenge.decision_signal.subscribe(), challenge.expires))
        }) {
            Some(state) => state,
            None => return,
        };
        let deadline = tokio::time::Instant::from_std(expires);
        loop {
            let is_pending = *decision.borrow_and_update() == ChallengeStatus::Pending;
            if !is_pending {
                return;
            }
            tokio::select! {
                changed = decision.changed() => {
                    if changed.is_err() {
                        return;
                    }
                }
                () = tokio::time::sleep_until(deadline) => {
                    self.expire_challenge(id);
                    return;
                }
            }
        }
    }

    pub fn redeem(
        &self,
        challenge_id: Uuid,
        verifier: &str,
        origin: &str,
        now: Instant,
        utc: OffsetDateTime,
    ) -> Result<RedeemSuccess, PairingError> {
        let decoded_verifier = decode_canonical_secret(verifier);
        let verifier_is_canonical = decoded_verifier.is_ok();
        let presented_hash = decoded_verifier.as_ref().map_or_else(
            |_| hash_bytes(&[0_u8; 32]),
            |decoded| hash_bytes(decoded.as_ref()),
        );
        let mut challenges = self
            .challenges
            .lock()
            .map_err(|_| PairingError::Unavailable)?;
        let challenge = challenges
            .get_mut(&challenge_id)
            .ok_or(PairingError::InvalidRequest)?;
        if challenge.origin != origin {
            return Err(PairingError::OriginMismatch);
        }
        if now >= challenge.expires {
            return Err(PairingError::Expired);
        }
        if challenge.redeem_attempts >= MAX_REDEEM_ATTEMPTS {
            return Err(PairingError::InvalidVerifier);
        }
        if !verifier_is_canonical || presented_hash.ct_eq(&challenge.verifier_hash).unwrap_u8() != 1
        {
            challenge.redeem_attempts = challenge.redeem_attempts.saturating_add(1);
            return Err(PairingError::InvalidVerifier);
        }
        match challenge.status {
            ChallengeStatus::Pending => return Err(PairingError::Pending),
            ChallengeStatus::Denied => return Err(PairingError::Denied),
            ChallengeStatus::Expired => return Err(PairingError::Expired),
            ChallengeStatus::Consumed => return Err(PairingError::Consumed),
            ChallengeStatus::Approved => challenge.status = ChallengeStatus::Consumed,
        }

        let token = new_secret().map_err(map_secret_error)?;
        let record = PairingRecord {
            id: Uuid::new_v4(),
            origin: challenge.origin.clone(),
            client_label: challenge.client_label.clone(),
            scopes: challenge.scopes.clone(),
            created_at: challenge.created_utc,
            last_used_at: utc,
        };
        let decoded_token =
            decode_canonical_secret(token.expose()).map_err(|_| PairingError::Unavailable)?;
        let stored = StoredPairing {
            bearer_hash: hash_bytes(decoded_token.as_ref()),
            record: record.clone(),
        };
        self.store.insert(&stored)?;
        Ok(RedeemSuccess {
            token,
            pairing: record,
        })
    }

    pub async fn redeem_async(
        self: Arc<Self>,
        challenge_id: Uuid,
        verifier: SecretString,
        origin: String,
        now: Instant,
        utc: OffsetDateTime,
    ) -> Result<RedeemSuccess, PairingError> {
        tokio::task::spawn_blocking(move || {
            self.redeem(challenge_id, verifier.expose(), &origin, now, utc)
        })
        .await
        .map_err(|_| PairingError::Unavailable)?
    }

    pub fn authenticate(
        &self,
        token: &str,
        origin: &str,
        required_scope: Scope,
        now: OffsetDateTime,
    ) -> Result<PairingRecord, PairingError> {
        let decoded_token = decode_canonical_secret(token);
        let token_is_canonical = decoded_token.is_ok();
        let candidate_hash = decoded_token.as_ref().map_or_else(
            |_| hash_bytes(&[0_u8; 32]),
            |decoded| hash_bytes(decoded.as_ref()),
        );
        let candidates = self.store.active(now)?;
        std::hint::black_box([0_u8; 32].ct_eq(&candidate_hash).unwrap_u8());
        let comparisons = candidates
            .iter()
            .map(|candidate| candidate.bearer_hash.ct_eq(&candidate_hash).unwrap_u8())
            .collect::<Vec<_>>();
        if !token_is_canonical {
            return Err(PairingError::InvalidBearer);
        }
        let index = comparisons
            .iter()
            .position(|matched| *matched == 1)
            .ok_or(PairingError::InvalidBearer)?;
        let mut pairing = candidates
            .into_iter()
            .nth(index)
            .ok_or(PairingError::InvalidBearer)?
            .record;
        if pairing.origin != origin {
            return Err(PairingError::OriginMismatch);
        }
        if now - pairing.last_used_at >= time::Duration::days(INACTIVITY_DAYS) {
            return Err(PairingError::Expired);
        }
        if !pairing.scopes.contains(&required_scope) {
            return Err(PairingError::ScopeDenied);
        }
        self.store.touch(pairing.id, now)?;
        pairing.last_used_at = pairing.last_used_at.max(now);
        Ok(pairing)
    }

    pub async fn authenticate_async(
        self: Arc<Self>,
        token: BearerSecret,
        origin: String,
        required_scope: Scope,
        now: OffsetDateTime,
    ) -> Result<PairingRecord, PairingError> {
        tokio::task::spawn_blocking(move || {
            self.authenticate(token.expose(), &origin, required_scope, now)
        })
        .await
        .map_err(|_| PairingError::Unavailable)?
    }

    pub fn revoke_one(&self, id: Uuid) -> Result<(), PairingError> {
        self.store.revoke(id)
    }

    pub fn revoke_all(&self) -> Result<(), PairingError> {
        self.store.revoke_all()
    }

    pub async fn revoke_one_async(self: Arc<Self>, id: Uuid) -> Result<(), PairingError> {
        tokio::task::spawn_blocking(move || self.revoke_one(id))
            .await
            .map_err(|_| PairingError::Unavailable)?
    }

    pub async fn revoke_all_async(self: Arc<Self>) -> Result<(), PairingError> {
        tokio::task::spawn_blocking(move || self.revoke_all())
            .await
            .map_err(|_| PairingError::Unavailable)?
    }
}

fn map_secret_error(_error: SecretError) -> PairingError {
    PairingError::Unavailable
}

fn validate_challenge_input(
    verifier_hash: &str,
    client_label: &str,
    scopes: &[Scope],
    origin: &str,
) -> Result<(), PairingError> {
    decode_canonical_secret(verifier_hash).map_err(|_| PairingError::InvalidRequest)?;
    if scopes != fixed_scopes() {
        return Err(PairingError::InvalidRequest);
    }
    validate_client_label(client_label)?;
    if origin.is_empty() || origin.len() > 256 || origin.contains(['\r', '\n', '\0']) {
        return Err(PairingError::InvalidRequest);
    }
    Ok(())
}

fn validate_client_label(label: &str) -> Result<(), PairingError> {
    if label.is_empty() || label.chars().count() > 64 || label.len() > 128 {
        return Err(PairingError::InvalidRequest);
    }
    let prompt_punctuation = ['<', '>', '{', '}', '[', ']', '`'];
    if label.chars().any(|scalar| {
        scalar == '\0'
            || scalar <= '\u{001f}'
            || matches!(scalar, '\u{007f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
            || prompt_punctuation.contains(&scalar)
    }) {
        return Err(PairingError::InvalidRequest);
    }
    let unique = label.chars().collect::<HashSet<_>>();
    if unique.len() == 1 && label.chars().count() > 32 {
        return Err(PairingError::InvalidRequest);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored_pairing(id: Uuid, timestamp: OffsetDateTime) -> StoredPairing {
        StoredPairing {
            record: PairingRecord {
                id,
                origin: "http://127.0.0.1:5173".to_owned(),
                client_label: "Browser".to_owned(),
                scopes: fixed_scopes(),
                created_at: timestamp,
                last_used_at: timestamp,
            },
            bearer_hash: hash_bytes(id.as_bytes()),
        }
    }

    #[test]
    fn sqlite_store_owns_connection_on_a_dedicated_worker() {
        let caller = thread::current().id();
        let store = SqlitePairingStore::open_in_memory().unwrap();
        assert_ne!(store.worker_thread_id, caller);
    }

    #[test]
    fn sqlite_touch_fails_if_the_pairing_was_revoked_after_candidate_load() {
        let connection = initialize_database(Connection::open_in_memory().unwrap()).unwrap();
        let id = Uuid::new_v4();
        database_insert(&connection, &stored_pairing(id, OffsetDateTime::UNIX_EPOCH)).unwrap();
        database_revoke(&connection, id).unwrap();

        assert_eq!(
            database_touch(&connection, id, OffsetDateTime::UNIX_EPOCH),
            Err(PairingError::Unavailable)
        );
    }

    #[test]
    fn sqlite_touch_never_moves_last_used_timestamp_backwards() {
        let connection = initialize_database(Connection::open_in_memory().unwrap()).unwrap();
        let id = Uuid::new_v4();
        let later = OffsetDateTime::UNIX_EPOCH + time::Duration::days(10);
        let earlier = OffsetDateTime::UNIX_EPOCH + time::Duration::days(5);
        database_insert(&connection, &stored_pairing(id, later)).unwrap();

        database_touch(&connection, id, earlier).unwrap();

        let persisted: i64 = connection
            .query_row(
                "SELECT last_used_at FROM pairings WHERE id = ?1",
                [id.to_string()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(persisted, later.unix_timestamp());
    }

    #[test]
    fn expired_unrevoked_rows_cannot_permanently_exhaust_active_capacity() {
        let connection = initialize_database(Connection::open_in_memory().unwrap()).unwrap();
        for index in 0_u128..128 {
            database_insert(
                &connection,
                &stored_pairing(Uuid::from_u128(index + 1), OffsetDateTime::UNIX_EPOCH),
            )
            .unwrap();
        }
        let fresh = stored_pairing(
            Uuid::from_u128(1_000),
            OffsetDateTime::UNIX_EPOCH + time::Duration::days(90),
        );

        database_insert(&connection, &fresh).unwrap();

        let active: i64 = connection
            .query_row(
                "SELECT count(*) FROM pairings WHERE revoked = 0",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active, 1);
    }

    #[test]
    fn sqlite_prunes_revoked_rows_to_a_fixed_retention_bound() {
        let connection = initialize_database(Connection::open_in_memory().unwrap()).unwrap();
        for index in 0_u128..160 {
            let id = Uuid::from_u128(index + 1);
            let timestamp = OffsetDateTime::UNIX_EPOCH + time::Duration::seconds(index as i64);
            database_insert(&connection, &stored_pairing(id, timestamp)).unwrap();
            database_revoke(&connection, id).unwrap();
        }

        let retained: i64 = connection
            .query_row(
                "SELECT count(*) FROM pairings WHERE revoked = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retained, 128);
    }
}
