use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use crate::protocol::CanonicalUuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RetryAfterSeconds(u16);

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("Retry-After must be delay seconds from 1 through 3600")]
pub struct RetryAfterRangeError;

impl RetryAfterSeconds {
    pub fn new(value: u64) -> Result<Self, RetryAfterRangeError> {
        let value = u16::try_from(value).map_err(|_| RetryAfterRangeError)?;
        if (1..=3_600).contains(&value) {
            Ok(Self(value))
        } else {
            Err(RetryAfterRangeError)
        }
    }

    pub const fn get(self) -> u16 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum RateClass {
    Health,
    PairingCreate,
    PairingRedeem,
    AuthenticatedRead,
    JobCreate,
    PackAction,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum RateSubject {
    Origin(String),
    Challenge(CanonicalUuid),
    Pairing(CanonicalUuid),
}

pub struct RateRequest {
    class: RateClass,
    subject: RateSubject,
    now: Instant,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("the rate class and subject kind do not match")]
pub struct RateRequestError;

impl RateRequest {
    pub fn new(
        class: RateClass,
        subject: RateSubject,
        now: Instant,
    ) -> Result<Self, RateRequestError> {
        let valid = matches!(
            (class, &subject),
            (
                RateClass::Health | RateClass::PairingCreate,
                RateSubject::Origin(_)
            ) | (RateClass::PairingRedeem, RateSubject::Challenge(_))
                | (
                    RateClass::AuthenticatedRead | RateClass::JobCreate | RateClass::PackAction,
                    RateSubject::Pairing(_)
                )
        );
        if !valid {
            return Err(RateRequestError);
        }
        Ok(Self {
            class,
            subject,
            now,
        })
    }

    pub const fn class(&self) -> RateClass {
        self.class
    }

    pub const fn subject(&self) -> &RateSubject {
        &self.subject
    }

    pub const fn now(&self) -> Instant {
        self.now
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum RateLimitError {
    #[error("the request rate limit has been reached")]
    Limited(RetryAfterSeconds),
    #[error("the rate limiter is unavailable")]
    Unavailable,
}

pub trait RatePermit: Send {
    fn commit(self: Box<Self>);
}

pub trait RateLimitPort: Send + Sync {
    fn reserve(&self, request: RateRequest) -> Result<Box<dyn RatePermit>, RateLimitError>;
}

pub struct InMemoryRateLimiter {
    state: Arc<Mutex<LimiterState>>,
}

// The public C8 binding deliberately exposes only an explicit constructor.
#[allow(clippy::new_without_default)]
impl InMemoryRateLimiter {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(LimiterState::new())),
        }
    }
}

type RateKey = (RateClass, RateSubject);

struct LimiterState {
    next_reservation: u64,
    buckets: HashMap<RateKey, Bucket>,
}

impl LimiterState {
    fn new() -> Self {
        Self {
            next_reservation: 1,
            buckets: HashMap::new(),
        }
    }

    fn reservation_id(&mut self) -> Result<u64, RateLimitError> {
        let id = self.next_reservation;
        self.next_reservation = self
            .next_reservation
            .checked_add(1)
            .ok_or(RateLimitError::Unavailable)?;
        Ok(id)
    }
}

#[derive(Clone, Copy)]
enum RatePolicy {
    Rolling { limit: usize, window: Duration },
    Fixed { limit: usize, window: Duration },
    TokenBucket,
}

fn policy(class: RateClass) -> RatePolicy {
    match class {
        RateClass::Health => RatePolicy::Rolling {
            limit: 20,
            window: Duration::from_secs(60),
        },
        RateClass::PairingCreate => RatePolicy::Rolling {
            limit: 3,
            window: Duration::from_secs(600),
        },
        RateClass::PairingRedeem => RatePolicy::Fixed {
            limit: 10,
            window: Duration::from_secs(120),
        },
        RateClass::AuthenticatedRead => RatePolicy::Rolling {
            limit: 60,
            window: Duration::from_secs(60),
        },
        RateClass::JobCreate => RatePolicy::TokenBucket,
        RateClass::PackAction => RatePolicy::Rolling {
            limit: 3,
            window: Duration::from_secs(3_600),
        },
    }
}

enum Bucket {
    Rolling(RollingBucket),
    Fixed(FixedBucket),
    Token(TokenBucket),
}

impl Bucket {
    fn new(policy: RatePolicy, now: Instant) -> Self {
        match policy {
            RatePolicy::Rolling { limit, window } => Self::Rolling(RollingBucket {
                limit,
                window,
                last_seen: now,
                committed: VecDeque::new(),
                pending: HashMap::new(),
            }),
            RatePolicy::Fixed { limit, window } => Self::Fixed(FixedBucket {
                limit,
                window,
                anchor: now,
                last_seen: now,
                committed: 0,
                pending: HashMap::new(),
            }),
            RatePolicy::TokenBucket => Self::Token(TokenBucket {
                available: TOKEN_CAPACITY,
                last_refill: now,
                last_seen: now,
                pending: HashSet::new(),
            }),
        }
    }

    fn reserve(&mut self, id: u64, now: Instant) -> Result<(), RetryAfterSeconds> {
        match self {
            Self::Rolling(bucket) => bucket.reserve(id, now),
            Self::Fixed(bucket) => bucket.reserve(id, now),
            Self::Token(bucket) => bucket.reserve(id, now),
        }
    }

    fn commit(&mut self, id: u64) {
        match self {
            Self::Rolling(bucket) => bucket.commit(id),
            Self::Fixed(bucket) => bucket.commit(id),
            Self::Token(bucket) => bucket.commit(id),
        }
    }

    fn rollback(&mut self, id: u64) {
        match self {
            Self::Rolling(bucket) => bucket.rollback(id),
            Self::Fixed(bucket) => bucket.rollback(id),
            Self::Token(bucket) => bucket.rollback(id),
        }
    }

    fn removable(&self) -> bool {
        match self {
            Self::Rolling(bucket) => bucket.committed.is_empty() && bucket.pending.is_empty(),
            Self::Fixed(bucket) => bucket.committed == 0 && bucket.pending.is_empty(),
            Self::Token(bucket) => bucket.available == TOKEN_CAPACITY && bucket.pending.is_empty(),
        }
    }
}

struct RollingBucket {
    limit: usize,
    window: Duration,
    last_seen: Instant,
    committed: VecDeque<Instant>,
    pending: HashMap<u64, Instant>,
}

impl RollingBucket {
    fn reserve(&mut self, id: u64, now: Instant) -> Result<(), RetryAfterSeconds> {
        let effective_now = now.max(self.last_seen);
        self.last_seen = effective_now;
        self.committed
            .retain(|entry| effective_now.saturating_duration_since(*entry) < self.window);
        if self.committed.len() + self.pending.len() >= self.limit {
            let committed_delay = self
                .committed
                .iter()
                .map(|entry| until_window(effective_now, *entry, self.window));
            let pending_delay = self
                .pending
                .values()
                .map(|entry| until_window(effective_now, *entry, self.window));
            let delay = committed_delay
                .chain(pending_delay)
                .min()
                .unwrap_or(Duration::from_secs(1));
            return Err(retry_after(delay));
        }
        self.pending.insert(id, effective_now);
        Ok(())
    }

    fn commit(&mut self, id: u64) {
        if let Some(reserved_at) = self.pending.remove(&id) {
            self.committed.push_back(reserved_at);
        }
    }

    fn rollback(&mut self, id: u64) {
        self.pending.remove(&id);
    }
}

struct FixedBucket {
    limit: usize,
    window: Duration,
    anchor: Instant,
    last_seen: Instant,
    committed: usize,
    pending: HashMap<u64, Instant>,
}

impl FixedBucket {
    fn reserve(&mut self, id: u64, now: Instant) -> Result<(), RetryAfterSeconds> {
        let effective_now = now.max(self.last_seen);
        self.last_seen = effective_now;
        if self.pending.is_empty()
            && effective_now.saturating_duration_since(self.anchor) >= self.window
        {
            self.anchor = effective_now;
            self.committed = 0;
        }
        if self.committed + self.pending.len() >= self.limit {
            let delay = until_window(effective_now, self.anchor, self.window);
            return Err(retry_after(delay));
        }
        self.pending.insert(id, effective_now);
        Ok(())
    }

    fn commit(&mut self, id: u64) {
        if self.pending.remove(&id).is_some() {
            self.committed += 1;
        }
    }

    fn rollback(&mut self, id: u64) {
        self.pending.remove(&id);
    }
}

const TOKEN_CAPACITY: u8 = 2;
const TOKEN_PERIOD: Duration = Duration::from_secs(10);

struct TokenBucket {
    available: u8,
    last_refill: Instant,
    last_seen: Instant,
    pending: HashSet<u64>,
}

impl TokenBucket {
    fn observe(&mut self, now: Instant) -> Instant {
        let effective_now = now.max(self.last_seen);
        self.last_seen = effective_now;
        if self.available == TOKEN_CAPACITY {
            self.last_refill = effective_now;
            return effective_now;
        }
        let elapsed = effective_now.saturating_duration_since(self.last_refill);
        let gained = elapsed.as_secs() / TOKEN_PERIOD.as_secs();
        if gained > 0 {
            self.available = TOKEN_CAPACITY.min(
                self.available
                    .saturating_add(u8::try_from(gained).unwrap_or(u8::MAX)),
            );
            if self.available == TOKEN_CAPACITY {
                self.last_refill = effective_now;
            } else {
                self.last_refill += TOKEN_PERIOD * u32::try_from(gained).unwrap_or(u32::MAX);
            }
        }
        effective_now
    }

    fn reserve(&mut self, id: u64, now: Instant) -> Result<(), RetryAfterSeconds> {
        let effective_now = self.observe(now);
        if self.available == 0 {
            let elapsed = effective_now.saturating_duration_since(self.last_refill);
            return Err(retry_after(TOKEN_PERIOD.saturating_sub(elapsed)));
        }
        self.available -= 1;
        self.pending.insert(id);
        Ok(())
    }

    fn commit(&mut self, id: u64) {
        self.pending.remove(&id);
    }

    fn rollback(&mut self, id: u64) {
        if self.pending.remove(&id) {
            self.available = TOKEN_CAPACITY.min(self.available.saturating_add(1));
            if self.available == TOKEN_CAPACITY {
                self.last_refill = self.last_seen;
            }
        }
    }
}

fn until_window(now: Instant, started: Instant, window: Duration) -> Duration {
    window.saturating_sub(now.saturating_duration_since(started))
}

fn retry_after(delay: Duration) -> RetryAfterSeconds {
    let seconds = delay
        .as_secs()
        .saturating_add(u64::from(delay.subsec_nanos() != 0))
        .clamp(1, 3_600);
    RetryAfterSeconds::new(seconds).expect("closed limiter delay is within the typed range")
}

struct InMemoryRatePermit {
    state: Arc<Mutex<LimiterState>>,
    key: RateKey,
    id: u64,
    active: bool,
}

impl RatePermit for InMemoryRatePermit {
    fn commit(mut self: Box<Self>) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(bucket) = state.buckets.get_mut(&self.key) {
            bucket.commit(self.id);
        }
        self.active = false;
    }
}

impl Drop for InMemoryRatePermit {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let remove = if let Some(bucket) = state.buckets.get_mut(&self.key) {
            bucket.rollback(self.id);
            bucket.removable()
        } else {
            false
        };
        if remove {
            state.buckets.remove(&self.key);
        }
        self.active = false;
    }
}

impl RateLimitPort for InMemoryRateLimiter {
    fn reserve(&self, request: RateRequest) -> Result<Box<dyn RatePermit>, RateLimitError> {
        let RateRequest {
            class,
            subject,
            now,
        } = request;
        let key = (class, subject);
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let id = state.reservation_id()?;
        let bucket = state
            .buckets
            .entry(key.clone())
            .or_insert_with(|| Bucket::new(policy(class), now));
        bucket.reserve(id, now).map_err(RateLimitError::Limited)?;
        Ok(Box::new(InMemoryRatePermit {
            state: Arc::clone(&self.state),
            key,
            id,
            active: true,
        }))
    }
}
