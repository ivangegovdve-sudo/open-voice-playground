use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

mod conversions;
mod message_contract;
mod messages;
mod problem;
mod scalars;

pub use conversions::*;
pub use message_contract::*;
pub use messages::*;
pub use problem::*;
pub use scalars::*;

pub const OWNED_SCHEMA_NAMES: [&str; 33] = [
    "CanonicalUuid",
    "CanonicalDateTime",
    "ClientLabel",
    "ClientVersion",
    "SynthesisText",
    "Scope",
    "ScopeList",
    "OpaqueSecret",
    "VoiceId",
    "PackId",
    "OperationalState",
    "ProblemCode",
    "Problem",
    "HealthResponse",
    "DeepLinkChallengeRequest",
    "ManualChallengeRequest",
    "PairingChallengeRequest",
    "PairingChallengeResponse",
    "RedeemRequest",
    "RedeemPendingResponse",
    "RedeemResponse",
    "PairingResponse",
    "RuntimeResponse",
    "EngineResponse",
    "EngineListResponse",
    "VoiceResponse",
    "VoiceListResponse",
    "PackResponse",
    "PackListResponse",
    "JobCreateRequest",
    "JobResponse",
    "PackActionRequest",
    "PackActionResponse",
];

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum OwnedSchemaName {
    CanonicalUuid,
    CanonicalDateTime,
    ClientLabel,
    ClientVersion,
    SynthesisText,
    Scope,
    ScopeList,
    OpaqueSecret,
    VoiceId,
    PackId,
    OperationalState,
    ProblemCode,
    Problem,
    HealthResponse,
    DeepLinkChallengeRequest,
    ManualChallengeRequest,
    PairingChallengeRequest,
    PairingChallengeResponse,
    RedeemRequest,
    RedeemPendingResponse,
    RedeemResponse,
    PairingResponse,
    RuntimeResponse,
    EngineResponse,
    EngineListResponse,
    VoiceResponse,
    VoiceListResponse,
    PackResponse,
    PackListResponse,
    JobCreateRequest,
    JobResponse,
    PackActionRequest,
    PackActionResponse,
}

impl OwnedSchemaName {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CanonicalUuid => "CanonicalUuid",
            Self::CanonicalDateTime => "CanonicalDateTime",
            Self::ClientLabel => "ClientLabel",
            Self::ClientVersion => "ClientVersion",
            Self::SynthesisText => "SynthesisText",
            Self::Scope => "Scope",
            Self::ScopeList => "ScopeList",
            Self::OpaqueSecret => "OpaqueSecret",
            Self::VoiceId => "VoiceId",
            Self::PackId => "PackId",
            Self::OperationalState => "OperationalState",
            Self::ProblemCode => "ProblemCode",
            Self::Problem => "Problem",
            Self::HealthResponse => "HealthResponse",
            Self::DeepLinkChallengeRequest => "DeepLinkChallengeRequest",
            Self::ManualChallengeRequest => "ManualChallengeRequest",
            Self::PairingChallengeRequest => "PairingChallengeRequest",
            Self::PairingChallengeResponse => "PairingChallengeResponse",
            Self::RedeemRequest => "RedeemRequest",
            Self::RedeemPendingResponse => "RedeemPendingResponse",
            Self::RedeemResponse => "RedeemResponse",
            Self::PairingResponse => "PairingResponse",
            Self::RuntimeResponse => "RuntimeResponse",
            Self::EngineResponse => "EngineResponse",
            Self::EngineListResponse => "EngineListResponse",
            Self::VoiceResponse => "VoiceResponse",
            Self::VoiceListResponse => "VoiceListResponse",
            Self::PackResponse => "PackResponse",
            Self::PackListResponse => "PackListResponse",
            Self::JobCreateRequest => "JobCreateRequest",
            Self::JobResponse => "JobResponse",
            Self::PackActionRequest => "PackActionRequest",
            Self::PackActionResponse => "PackActionResponse",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum OwnedSchemaError {
    #[error("the requested schema is not owned by Rust Serde")]
    UnknownSchema,
    #[error("the value does not match the owned Rust Serde schema")]
    InvalidValue,
}

impl TryFrom<&str> for OwnedSchemaName {
    type Error = OwnedSchemaError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "CanonicalUuid" => Ok(Self::CanonicalUuid),
            "CanonicalDateTime" => Ok(Self::CanonicalDateTime),
            "ClientLabel" => Ok(Self::ClientLabel),
            "ClientVersion" => Ok(Self::ClientVersion),
            "SynthesisText" => Ok(Self::SynthesisText),
            "Scope" => Ok(Self::Scope),
            "ScopeList" => Ok(Self::ScopeList),
            "OpaqueSecret" => Ok(Self::OpaqueSecret),
            "VoiceId" => Ok(Self::VoiceId),
            "PackId" => Ok(Self::PackId),
            "OperationalState" => Ok(Self::OperationalState),
            "ProblemCode" => Ok(Self::ProblemCode),
            "Problem" => Ok(Self::Problem),
            "HealthResponse" => Ok(Self::HealthResponse),
            "DeepLinkChallengeRequest" => Ok(Self::DeepLinkChallengeRequest),
            "ManualChallengeRequest" => Ok(Self::ManualChallengeRequest),
            "PairingChallengeRequest" => Ok(Self::PairingChallengeRequest),
            "PairingChallengeResponse" => Ok(Self::PairingChallengeResponse),
            "RedeemRequest" => Ok(Self::RedeemRequest),
            "RedeemPendingResponse" => Ok(Self::RedeemPendingResponse),
            "RedeemResponse" => Ok(Self::RedeemResponse),
            "PairingResponse" => Ok(Self::PairingResponse),
            "RuntimeResponse" => Ok(Self::RuntimeResponse),
            "EngineResponse" => Ok(Self::EngineResponse),
            "EngineListResponse" => Ok(Self::EngineListResponse),
            "VoiceResponse" => Ok(Self::VoiceResponse),
            "VoiceListResponse" => Ok(Self::VoiceListResponse),
            "PackResponse" => Ok(Self::PackResponse),
            "PackListResponse" => Ok(Self::PackListResponse),
            "JobCreateRequest" => Ok(Self::JobCreateRequest),
            "JobResponse" => Ok(Self::JobResponse),
            "PackActionRequest" => Ok(Self::PackActionRequest),
            "PackActionResponse" => Ok(Self::PackActionResponse),
            _ => Err(OwnedSchemaError::UnknownSchema),
        }
    }
}

fn serde_round_trip<T>(value: Value) -> Result<Value, OwnedSchemaError>
where
    T: DeserializeOwned + Serialize,
{
    let owned = serde_json::from_value::<T>(value).map_err(|_| OwnedSchemaError::InvalidValue)?;
    serde_json::to_value(owned).map_err(|_| OwnedSchemaError::InvalidValue)
}

pub fn round_trip_owned_schema(schema: &str, value: Value) -> Result<Value, OwnedSchemaError> {
    match OwnedSchemaName::try_from(schema)? {
        OwnedSchemaName::CanonicalUuid => serde_round_trip::<CanonicalUuid>(value),
        OwnedSchemaName::CanonicalDateTime => serde_round_trip::<CanonicalDateTime>(value),
        OwnedSchemaName::ClientLabel => serde_round_trip::<ClientLabel>(value),
        OwnedSchemaName::ClientVersion => serde_round_trip::<ClientVersion>(value),
        OwnedSchemaName::SynthesisText => serde_round_trip::<SynthesisText>(value),
        OwnedSchemaName::Scope => serde_round_trip::<Scope>(value),
        OwnedSchemaName::ScopeList => serde_round_trip::<ScopeList>(value),
        OwnedSchemaName::OpaqueSecret => serde_round_trip::<OpaqueSecret>(value),
        OwnedSchemaName::VoiceId => serde_round_trip::<VoiceId>(value),
        OwnedSchemaName::PackId => serde_round_trip::<PackId>(value),
        OwnedSchemaName::OperationalState => serde_round_trip::<OperationalState>(value),
        OwnedSchemaName::ProblemCode => serde_round_trip::<ProblemCode>(value),
        OwnedSchemaName::Problem => serde_round_trip::<Problem>(value),
        OwnedSchemaName::HealthResponse => serde_round_trip::<HealthResponse>(value),
        OwnedSchemaName::DeepLinkChallengeRequest => {
            serde_round_trip::<DeepLinkChallengeRequest>(value)
        }
        OwnedSchemaName::ManualChallengeRequest => {
            serde_round_trip::<ManualChallengeRequest>(value)
        }
        OwnedSchemaName::PairingChallengeRequest => {
            serde_round_trip::<PairingChallengeRequest>(value)
        }
        OwnedSchemaName::PairingChallengeResponse => {
            serde_round_trip::<PairingChallengeResponse>(value)
        }
        OwnedSchemaName::RedeemRequest => serde_round_trip::<RedeemRequest>(value),
        OwnedSchemaName::RedeemPendingResponse => serde_round_trip::<RedeemPendingResponse>(value),
        OwnedSchemaName::RedeemResponse => serde_round_trip::<RedeemResponse>(value),
        OwnedSchemaName::PairingResponse => serde_round_trip::<PairingResponse>(value),
        OwnedSchemaName::RuntimeResponse => serde_round_trip::<RuntimeResponse>(value),
        OwnedSchemaName::EngineResponse => serde_round_trip::<EngineResponse>(value),
        OwnedSchemaName::EngineListResponse => serde_round_trip::<EngineListResponse>(value),
        OwnedSchemaName::VoiceResponse => serde_round_trip::<VoiceResponse>(value),
        OwnedSchemaName::VoiceListResponse => serde_round_trip::<VoiceListResponse>(value),
        OwnedSchemaName::PackResponse => serde_round_trip::<PackResponse>(value),
        OwnedSchemaName::PackListResponse => serde_round_trip::<PackListResponse>(value),
        OwnedSchemaName::JobCreateRequest => serde_round_trip::<JobCreateRequest>(value),
        OwnedSchemaName::JobResponse => serde_round_trip::<JobResponse>(value),
        OwnedSchemaName::PackActionRequest => serde_round_trip::<PackActionRequest>(value),
        OwnedSchemaName::PackActionResponse => serde_round_trip::<PackActionResponse>(value),
    }
}
