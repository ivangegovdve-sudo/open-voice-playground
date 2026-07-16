use std::time::Instant;

use async_trait::async_trait;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    pairing::{BearerSecret, PairingRecord},
    protocol::{
        CanonicalUuid, EngineListResponse, HealthResponse, JobCreateRequest, JobResponse,
        MAX_WAV_RESPONSE_BYTES, PackActionRequest, PackActionResponse, PackId, PackListResponse,
        PairingChallengeRequest, PairingChallengeResponse, PairingResponse, RedeemRequest,
        RedeemResponse, RuntimeResponse, Scope, VoiceListResponse,
    },
    rate::RetryAfterSeconds,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OwnershipTarget {
    None,
    TokenSelf,
    Job(CanonicalUuid),
}

pub struct AuthRequest {
    token: BearerSecret,
    origin: String,
    required_scope: Option<Scope>,
    ownership: OwnershipTarget,
    now_utc: OffsetDateTime,
}

impl AuthRequest {
    pub(crate) fn new(
        token: BearerSecret,
        origin: String,
        required_scope: Option<Scope>,
        ownership: OwnershipTarget,
        now_utc: OffsetDateTime,
    ) -> Self {
        Self {
            token,
            origin,
            required_scope,
            ownership,
            now_utc,
        }
    }

    pub fn into_parts(
        self,
    ) -> (
        BearerSecret,
        String,
        Option<Scope>,
        OwnershipTarget,
        OffsetDateTime,
    ) {
        (
            self.token,
            self.origin,
            self.required_scope,
            self.ownership,
            self.now_utc,
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum AuthError {
    #[error("the bearer token is invalid")]
    Invalid,
    #[error("the bearer origin does not match")]
    OriginMismatch,
    #[error("the bearer lacks the required scope")]
    ScopeDenied,
    #[error("the requested resource was not found")]
    NotFound,
    #[error("authentication is unavailable")]
    Unavailable,
}

pub struct AuthenticatedPairing {
    record: PairingRecord,
}

impl AuthenticatedPairing {
    pub fn from_record(record: PairingRecord) -> Self {
        Self { record }
    }

    pub const fn pairing_id(&self) -> Uuid {
        self.record.id
    }

    pub const fn record(&self) -> &PairingRecord {
        &self.record
    }

    pub fn into_record(self) -> PairingRecord {
        self.record
    }
}

#[async_trait]
pub trait AuthPermit: Send {
    fn pairing_id(&self) -> Uuid;
    async fn commit(self: Box<Self>) -> Result<AuthenticatedPairing, AuthError>;
}

#[async_trait]
pub trait AuthPort: Send + Sync {
    async fn reserve(&self, request: AuthRequest) -> Result<Box<dyn AuthPermit>, AuthError>;
}

pub struct RequestObservedAt {
    monotonic: Instant,
    utc: OffsetDateTime,
}

impl RequestObservedAt {
    pub(crate) const fn new(monotonic: Instant, utc: OffsetDateTime) -> Self {
        Self { monotonic, utc }
    }

    pub const fn monotonic(&self) -> Instant {
        self.monotonic
    }

    pub const fn utc(&self) -> OffsetDateTime {
        self.utc
    }
}

pub struct HandlerContext {
    origin: String,
    observed_at: RequestObservedAt,
    pairing: Option<AuthenticatedPairing>,
}

impl HandlerContext {
    pub(crate) fn new(
        origin: String,
        observed_at: RequestObservedAt,
        pairing: Option<AuthenticatedPairing>,
    ) -> Self {
        Self {
            origin,
            observed_at,
            pairing,
        }
    }

    pub fn origin(&self) -> &str {
        &self.origin
    }

    pub const fn observed_at(&self) -> &RequestObservedAt {
        &self.observed_at
    }

    pub const fn pairing(&self) -> Option<&AuthenticatedPairing> {
        self.pairing.as_ref()
    }
}

pub enum HandlerRequest {
    GetHealth,
    CreatePairingChallenge {
        body: PairingChallengeRequest,
    },
    RedeemPairingChallenge {
        id: CanonicalUuid,
        body: RedeemRequest,
    },
    GetCurrentPairing,
    RevokeCurrentPairing,
    GetRuntime,
    ListEngines,
    ListVoices,
    ListPacks,
    CreateJob {
        body: JobCreateRequest,
    },
    GetJob {
        id: CanonicalUuid,
    },
    CancelJob {
        id: CanonicalUuid,
    },
    GetJobAudio {
        id: CanonicalUuid,
    },
    RequestPackAction {
        id: PackId,
        body: PackActionRequest,
    },
}

pub struct EntityTag(String);

pub struct ResponseLocation(String);

pub struct WavBody(Vec<u8>);

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ResponseMetadataError {
    #[error("the response metadata length is outside the contract")]
    Length,
    #[error("the response metadata is not a safe visible ASCII header value")]
    InvalidHeaderValue,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("the WAV response exceeds 67108864 bytes")]
pub struct WavBodyError;

fn validate_header_value(
    value: &str,
    minimum: usize,
    maximum: usize,
) -> Result<(), ResponseMetadataError> {
    if !(minimum..=maximum).contains(&value.len()) {
        return Err(ResponseMetadataError::Length);
    }
    if !value.bytes().all(|byte| (0x20..=0x7e).contains(&byte)) {
        return Err(ResponseMetadataError::InvalidHeaderValue);
    }
    Ok(())
}

impl EntityTag {
    pub fn new(value: String) -> Result<Self, ResponseMetadataError> {
        validate_header_value(&value, 3, 128)?;
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn into_string(self) -> String {
        self.0
    }
}

impl ResponseLocation {
    pub fn new(value: String) -> Result<Self, ResponseMetadataError> {
        validate_header_value(&value, 1, 256)?;
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn into_string(self) -> String {
        self.0
    }
}

impl WavBody {
    pub fn new(bytes: Vec<u8>) -> Result<Self, WavBodyError> {
        validate_wav_len(bytes.len())?;
        Ok(Self(bytes))
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.0
    }
}

pub(crate) fn validate_wav_len(len: usize) -> Result<(), WavBodyError> {
    if u64::try_from(len).is_ok_and(|len| len <= MAX_WAV_RESPONSE_BYTES) {
        Ok(())
    } else {
        Err(WavBodyError)
    }
}

pub enum HandlerSuccess {
    Health(HealthResponse),
    PairingChallengeCreated {
        body: PairingChallengeResponse,
        location: ResponseLocation,
    },
    RedeemComplete(RedeemResponse),
    RedeemPending {
        retry_after: RetryAfterSeconds,
    },
    CurrentPairing(PairingResponse),
    PairingRevoked,
    Runtime {
        body: RuntimeResponse,
        etag: EntityTag,
    },
    Engines {
        body: EngineListResponse,
        etag: EntityTag,
    },
    Voices {
        body: VoiceListResponse,
        etag: EntityTag,
    },
    Packs {
        body: PackListResponse,
        etag: EntityTag,
    },
    JobCreated {
        body: JobResponse,
        location: ResponseLocation,
    },
    Job(JobResponse),
    JobCancellationAccepted(JobResponse),
    JobAudio {
        body: WavBody,
        etag: EntityTag,
    },
    PackActionAccepted {
        body: PackActionResponse,
        location: ResponseLocation,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum HandlerError {
    #[error("the requested resource was not found")]
    ResourceNotFound,
    #[error("the request conflicts with current state")]
    Conflict,
    #[error("the pairing request was not found")]
    PairingNotFound,
    #[error("the pairing request was denied")]
    PairingDenied,
    #[error("the pairing request expired")]
    PairingExpired,
    #[error("the pairing request was consumed")]
    PairingConsumed,
    #[error("manual pairing attempts are exhausted")]
    PairingAttemptsExhausted,
    #[error("the queue is full")]
    QueueFull(RetryAfterSeconds),
    #[error("the pack is unverified")]
    PackUnverified,
    #[error("the runtime is unavailable")]
    RuntimeUnavailable,
}

#[async_trait]
pub trait HandlerPort: Send + Sync {
    async fn handle(
        &self,
        context: HandlerContext,
        request: HandlerRequest,
    ) -> Result<HandlerSuccess, HandlerError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_length_helper_accepts_the_inclusive_c4_boundary() {
        assert_eq!(validate_wav_len(0), Ok(()));
        assert_eq!(validate_wav_len(67_108_864), Ok(()));
        assert_eq!(validate_wav_len(67_108_865), Err(WavBodyError));
    }

    #[test]
    fn wav_body_preserves_small_arbitrary_binary() {
        let bytes = vec![0, 0xff, 0x80, b'R', b'I', b'F', b'F'];
        let body = WavBody::new(bytes.clone()).expect("small binary body");
        assert_eq!(body.into_bytes(), bytes);
    }
}
