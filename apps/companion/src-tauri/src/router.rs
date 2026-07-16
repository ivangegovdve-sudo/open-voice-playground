//! Exact, byte-preserving routing metadata for the loopback HTTP boundary.

use crate::protocol::{
    CanonicalUuid, OPERATION_MESSAGE_CONTRACTS, OperationMessageContract, PackId, ProblemCode,
    RequestMessage, Scope,
};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum Method {
    Get,
    Post,
    Delete,
    Options,
}

impl Method {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Delete => "DELETE",
            Self::Options => "OPTIONS",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "GET" => Some(Self::Get),
            "POST" => Some(Self::Post),
            "DELETE" => Some(Self::Delete),
            "OPTIONS" => Some(Self::Options),
            _ => None,
        }
    }
}

#[repr(usize)]
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum PathId {
    Health,
    PairingChallenges,
    PairingChallengeRedeem,
    CurrentPairing,
    Runtime,
    Engines,
    Voices,
    Packs,
    Jobs,
    Job,
    JobAudio,
    PackActions,
}

impl PathId {
    pub fn contract(self) -> &'static PathContract {
        &PATH_CONTRACTS[self as usize]
    }
}

#[repr(usize)]
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum OperationId {
    GetHealth,
    PreflightHealth,
    CreatePairingChallenge,
    PreflightPairingChallenges,
    RedeemPairingChallenge,
    PreflightPairingChallengeRedeem,
    GetCurrentPairing,
    RevokeCurrentPairing,
    PreflightCurrentPairing,
    GetRuntime,
    PreflightRuntime,
    ListEngines,
    PreflightEngines,
    ListVoices,
    PreflightVoices,
    ListPacks,
    PreflightPacks,
    CreateJob,
    PreflightJobs,
    GetJob,
    CancelJob,
    PreflightJob,
    GetJobAudio,
    PreflightJobAudio,
    RequestPackAction,
    PreflightPackActions,
}

impl OperationId {
    pub fn as_str(self) -> &'static str {
        self.contract().operation_id
    }

    pub fn contract(self) -> &'static OperationContract {
        &OPERATION_CONTRACTS[self as usize]
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum AuthClass {
    OriginOnly,
    Bearer,
    Preflight,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum OwnershipClass {
    None,
    TokenSelf,
    JobOwner,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ScopeRequirement {
    RuntimeRead,
    SynthesisCreate,
    JobsRead,
    JobsCancel,
    AudioRead,
    PacksRequest,
}

impl ScopeRequirement {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::RuntimeRead => "runtime:read",
            Self::SynthesisCreate => "synthesis:create",
            Self::JobsRead => "jobs:read",
            Self::JobsCancel => "jobs:cancel",
            Self::AudioRead => "audio:read",
            Self::PacksRequest => "packs:request",
        }
    }

    pub fn as_scope(self) -> Scope {
        Scope::parse(self.as_str()).expect("closed route scope must be an owned protocol scope")
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct AccessContract {
    pub auth: AuthClass,
    pub scope: Option<ScopeRequirement>,
    pub ownership: OwnershipClass,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum PathParameterKind {
    None,
    CanonicalUuid,
    PackId,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum PathParameters {
    None,
    CanonicalUuid(CanonicalUuid),
    PackId(PackId),
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum RequestedHeader {
    Authorization,
    ContentType,
    ClientVersion,
}

impl RequestedHeader {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Authorization => "Authorization",
            Self::ContentType => "Content-Type",
            Self::ClientVersion => "X-OVP-Client-Version",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum AllowSet {
    Get,
    Post,
    GetDelete,
}

impl AllowSet {
    pub const fn methods(self) -> &'static [Method] {
        match self {
            Self::Get => &[Method::Get, Method::Options],
            Self::Post => &[Method::Post, Method::Options],
            Self::GetDelete => &[Method::Get, Method::Delete, Method::Options],
        }
    }

    pub const fn header_value(self) -> &'static str {
        match self {
            Self::Get => "GET, OPTIONS",
            Self::Post => "POST, OPTIONS",
            Self::GetDelete => "GET, DELETE, OPTIONS",
        }
    }
}

pub static GLOBAL_METHODS: [Method; 4] =
    [Method::Get, Method::Post, Method::Delete, Method::Options];

pub static PREFLIGHT_ALLOWED_HEADERS: [RequestedHeader; 3] = [
    RequestedHeader::Authorization,
    RequestedHeader::ContentType,
    RequestedHeader::ClientVersion,
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PathContract {
    pub id: PathId,
    pub template: &'static str,
    pub parameter: PathParameterKind,
    pub concrete_operations: &'static [OperationId],
    pub preflight_operation: OperationId,
}

impl PathContract {
    pub fn allow(&self) -> AllowSet {
        let has_get = self
            .concrete_operations
            .iter()
            .any(|operation| operation.contract().method == Method::Get);
        let has_post = self
            .concrete_operations
            .iter()
            .any(|operation| operation.contract().method == Method::Post);
        let has_delete = self
            .concrete_operations
            .iter()
            .any(|operation| operation.contract().method == Method::Delete);
        match (has_get, has_post, has_delete) {
            (true, false, false) => AllowSet::Get,
            (false, true, false) => AllowSet::Post,
            (true, false, true) => AllowSet::GetDelete,
            _ => panic!("closed path has an unsupported concrete method combination"),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OperationContract {
    pub id: OperationId,
    pub operation_id: &'static str,
    pub path: PathId,
    pub method: Method,
    pub access: AccessContract,
    pub messages: &'static OperationMessageContract,
}

const ORIGIN_ONLY: AccessContract = AccessContract {
    auth: AuthClass::OriginOnly,
    scope: None,
    ownership: OwnershipClass::None,
};
const PREFLIGHT: AccessContract = AccessContract {
    auth: AuthClass::Preflight,
    scope: None,
    ownership: OwnershipClass::None,
};

const fn bearer(scope: Option<ScopeRequirement>, ownership: OwnershipClass) -> AccessContract {
    AccessContract {
        auth: AuthClass::Bearer,
        scope,
        ownership,
    }
}

pub static PATH_CONTRACTS: [PathContract; 12] = [
    PathContract {
        id: PathId::Health,
        template: "/v1/health",
        parameter: PathParameterKind::None,
        concrete_operations: &[OperationId::GetHealth],
        preflight_operation: OperationId::PreflightHealth,
    },
    PathContract {
        id: PathId::PairingChallenges,
        template: "/v1/pairings/challenges",
        parameter: PathParameterKind::None,
        concrete_operations: &[OperationId::CreatePairingChallenge],
        preflight_operation: OperationId::PreflightPairingChallenges,
    },
    PathContract {
        id: PathId::PairingChallengeRedeem,
        template: "/v1/pairings/challenges/{id}/redeem",
        parameter: PathParameterKind::CanonicalUuid,
        concrete_operations: &[OperationId::RedeemPairingChallenge],
        preflight_operation: OperationId::PreflightPairingChallengeRedeem,
    },
    PathContract {
        id: PathId::CurrentPairing,
        template: "/v1/pairings/current",
        parameter: PathParameterKind::None,
        concrete_operations: &[
            OperationId::GetCurrentPairing,
            OperationId::RevokeCurrentPairing,
        ],
        preflight_operation: OperationId::PreflightCurrentPairing,
    },
    PathContract {
        id: PathId::Runtime,
        template: "/v1/runtime",
        parameter: PathParameterKind::None,
        concrete_operations: &[OperationId::GetRuntime],
        preflight_operation: OperationId::PreflightRuntime,
    },
    PathContract {
        id: PathId::Engines,
        template: "/v1/engines",
        parameter: PathParameterKind::None,
        concrete_operations: &[OperationId::ListEngines],
        preflight_operation: OperationId::PreflightEngines,
    },
    PathContract {
        id: PathId::Voices,
        template: "/v1/voices",
        parameter: PathParameterKind::None,
        concrete_operations: &[OperationId::ListVoices],
        preflight_operation: OperationId::PreflightVoices,
    },
    PathContract {
        id: PathId::Packs,
        template: "/v1/packs",
        parameter: PathParameterKind::None,
        concrete_operations: &[OperationId::ListPacks],
        preflight_operation: OperationId::PreflightPacks,
    },
    PathContract {
        id: PathId::Jobs,
        template: "/v1/jobs",
        parameter: PathParameterKind::None,
        concrete_operations: &[OperationId::CreateJob],
        preflight_operation: OperationId::PreflightJobs,
    },
    PathContract {
        id: PathId::Job,
        template: "/v1/jobs/{id}",
        parameter: PathParameterKind::CanonicalUuid,
        concrete_operations: &[OperationId::GetJob, OperationId::CancelJob],
        preflight_operation: OperationId::PreflightJob,
    },
    PathContract {
        id: PathId::JobAudio,
        template: "/v1/jobs/{id}/audio",
        parameter: PathParameterKind::CanonicalUuid,
        concrete_operations: &[OperationId::GetJobAudio],
        preflight_operation: OperationId::PreflightJobAudio,
    },
    PathContract {
        id: PathId::PackActions,
        template: "/v1/packs/{id}/actions",
        parameter: PathParameterKind::PackId,
        concrete_operations: &[OperationId::RequestPackAction],
        preflight_operation: OperationId::PreflightPackActions,
    },
];

macro_rules! operation {
    ($index:literal, $id:ident, $text:literal, $path:ident, $method:ident, $access:expr) => {
        OperationContract {
            id: OperationId::$id,
            operation_id: $text,
            path: PathId::$path,
            method: Method::$method,
            access: $access,
            messages: &OPERATION_MESSAGE_CONTRACTS[$index],
        }
    };
}

pub static OPERATION_CONTRACTS: [OperationContract; 26] = [
    operation!(0, GetHealth, "getHealth", Health, Get, ORIGIN_ONLY),
    operation!(
        1,
        PreflightHealth,
        "preflightHealth",
        Health,
        Options,
        PREFLIGHT
    ),
    operation!(
        2,
        CreatePairingChallenge,
        "createPairingChallenge",
        PairingChallenges,
        Post,
        ORIGIN_ONLY
    ),
    operation!(
        3,
        PreflightPairingChallenges,
        "preflightPairingChallenges",
        PairingChallenges,
        Options,
        PREFLIGHT
    ),
    operation!(
        4,
        RedeemPairingChallenge,
        "redeemPairingChallenge",
        PairingChallengeRedeem,
        Post,
        ORIGIN_ONLY
    ),
    operation!(
        5,
        PreflightPairingChallengeRedeem,
        "preflightPairingChallengeRedeem",
        PairingChallengeRedeem,
        Options,
        PREFLIGHT
    ),
    operation!(
        6,
        GetCurrentPairing,
        "getCurrentPairing",
        CurrentPairing,
        Get,
        bearer(None, OwnershipClass::TokenSelf)
    ),
    operation!(
        7,
        RevokeCurrentPairing,
        "revokeCurrentPairing",
        CurrentPairing,
        Delete,
        bearer(None, OwnershipClass::TokenSelf)
    ),
    operation!(
        8,
        PreflightCurrentPairing,
        "preflightCurrentPairing",
        CurrentPairing,
        Options,
        PREFLIGHT
    ),
    operation!(
        9,
        GetRuntime,
        "getRuntime",
        Runtime,
        Get,
        bearer(Some(ScopeRequirement::RuntimeRead), OwnershipClass::None)
    ),
    operation!(
        10,
        PreflightRuntime,
        "preflightRuntime",
        Runtime,
        Options,
        PREFLIGHT
    ),
    operation!(
        11,
        ListEngines,
        "listEngines",
        Engines,
        Get,
        bearer(Some(ScopeRequirement::RuntimeRead), OwnershipClass::None)
    ),
    operation!(
        12,
        PreflightEngines,
        "preflightEngines",
        Engines,
        Options,
        PREFLIGHT
    ),
    operation!(
        13,
        ListVoices,
        "listVoices",
        Voices,
        Get,
        bearer(Some(ScopeRequirement::RuntimeRead), OwnershipClass::None)
    ),
    operation!(
        14,
        PreflightVoices,
        "preflightVoices",
        Voices,
        Options,
        PREFLIGHT
    ),
    operation!(
        15,
        ListPacks,
        "listPacks",
        Packs,
        Get,
        bearer(Some(ScopeRequirement::RuntimeRead), OwnershipClass::None)
    ),
    operation!(
        16,
        PreflightPacks,
        "preflightPacks",
        Packs,
        Options,
        PREFLIGHT
    ),
    operation!(
        17,
        CreateJob,
        "createJob",
        Jobs,
        Post,
        bearer(
            Some(ScopeRequirement::SynthesisCreate),
            OwnershipClass::None
        )
    ),
    operation!(18, PreflightJobs, "preflightJobs", Jobs, Options, PREFLIGHT),
    operation!(
        19,
        GetJob,
        "getJob",
        Job,
        Get,
        bearer(Some(ScopeRequirement::JobsRead), OwnershipClass::JobOwner)
    ),
    operation!(
        20,
        CancelJob,
        "cancelJob",
        Job,
        Delete,
        bearer(Some(ScopeRequirement::JobsCancel), OwnershipClass::JobOwner)
    ),
    operation!(21, PreflightJob, "preflightJob", Job, Options, PREFLIGHT),
    operation!(
        22,
        GetJobAudio,
        "getJobAudio",
        JobAudio,
        Get,
        bearer(Some(ScopeRequirement::AudioRead), OwnershipClass::JobOwner)
    ),
    operation!(
        23,
        PreflightJobAudio,
        "preflightJobAudio",
        JobAudio,
        Options,
        PREFLIGHT
    ),
    operation!(
        24,
        RequestPackAction,
        "requestPackAction",
        PackActions,
        Post,
        bearer(Some(ScopeRequirement::PacksRequest), OwnershipClass::None)
    ),
    operation!(
        25,
        PreflightPackActions,
        "preflightPackActions",
        PackActions,
        Options,
        PREFLIGHT
    ),
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RouteMatch {
    Concrete(MatchedConcreteRoute),
    Preflight(MatchedPreflightRoute),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MatchedConcreteRoute {
    path: PathId,
    operation: OperationId,
    parameters: PathParameters,
}

impl MatchedConcreteRoute {
    pub const fn operation(&self) -> OperationId {
        self.operation
    }

    pub const fn path(&self) -> PathId {
        self.path
    }

    pub const fn parameters(&self) -> PathParameters {
        self.parameters
    }

    pub fn contract(&self) -> &'static OperationContract {
        self.operation.contract()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MatchedPreflightRoute {
    path: PathId,
    operation: OperationId,
    parameters: PathParameters,
}

impl MatchedPreflightRoute {
    pub const fn operation(&self) -> OperationId {
        self.operation
    }

    pub const fn path(&self) -> PathId {
        self.path
    }

    pub const fn parameters(&self) -> PathParameters {
        self.parameters
    }

    pub fn contract(&self) -> &'static OperationContract {
        self.operation.contract()
    }

    pub fn resolve_requested_method(
        &self,
        raw_method: &str,
    ) -> Result<PreflightTarget, RouteError> {
        let method = Method::parse(raw_method).ok_or(RouteError::InvalidPreflightMethod)?;
        if method == Method::Options {
            return Err(RouteError::MethodNotAllowed { path: self.path });
        }
        let operation = self
            .path
            .contract()
            .concrete_operations
            .iter()
            .copied()
            .find(|operation| operation.contract().method == method)
            .ok_or(RouteError::MethodNotAllowed { path: self.path })?;
        Ok(PreflightTarget {
            operation,
            requested_headers: requested_headers(operation),
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PreflightTarget {
    operation: OperationId,
    requested_headers: &'static [RequestedHeader],
}

impl PreflightTarget {
    pub const fn operation(&self) -> OperationId {
        self.operation
    }

    pub fn contract(&self) -> &'static OperationContract {
        self.operation.contract()
    }

    pub const fn requested_headers(&self) -> &'static [RequestedHeader] {
        self.requested_headers
    }
}

const ORIGIN_NONE_HEADERS: &[RequestedHeader] = &[RequestedHeader::ClientVersion];
const ORIGIN_JSON_HEADERS: &[RequestedHeader] =
    &[RequestedHeader::ContentType, RequestedHeader::ClientVersion];
const BEARER_NONE_HEADERS: &[RequestedHeader] = &[
    RequestedHeader::Authorization,
    RequestedHeader::ClientVersion,
];
const BEARER_JSON_HEADERS: &[RequestedHeader] = &[
    RequestedHeader::Authorization,
    RequestedHeader::ContentType,
    RequestedHeader::ClientVersion,
];

fn requested_headers(operation: OperationId) -> &'static [RequestedHeader] {
    let contract = operation.contract();
    requested_headers_for(contract.access.auth, contract.messages.request)
}

fn requested_headers_for(auth: AuthClass, request: RequestMessage) -> &'static [RequestedHeader] {
    let has_json = matches!(request, RequestMessage::Json { required: true, .. });
    match (auth, has_json) {
        (AuthClass::OriginOnly, false) => ORIGIN_NONE_HEADERS,
        (AuthClass::OriginOnly, true) => ORIGIN_JSON_HEADERS,
        (AuthClass::Bearer, false) => BEARER_NONE_HEADERS,
        (AuthClass::Bearer, true) => BEARER_JSON_HEADERS,
        (AuthClass::Preflight, _) => {
            panic!("a preflight operation cannot be a concrete preflight target")
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum RouteError {
    #[error("the request target is not origin-form")]
    NonOriginForm,
    #[error("the origin-form request target is invalid")]
    InvalidOriginForm,
    #[error("the requested route does not exist")]
    ResourceNotFound,
    #[error("a route path parameter is invalid")]
    InvalidPathParameter {
        path: PathId,
        kind: PathParameterKind,
    },
    #[error("the method is not allowed for this route")]
    MethodNotAllowed { path: PathId },
    #[error("the preflight requested method is invalid")]
    InvalidPreflightMethod,
}

impl RouteError {
    pub const fn problem_code(self) -> ProblemCode {
        match self {
            Self::NonOriginForm => ProblemCode::HostInvalid,
            Self::InvalidOriginForm
            | Self::InvalidPathParameter { .. }
            | Self::InvalidPreflightMethod => ProblemCode::SchemaInvalid,
            Self::ResourceNotFound => ProblemCode::ResourceNotFound,
            Self::MethodNotAllowed { .. } => ProblemCode::MethodNotAllowed,
        }
    }

    pub fn allow(self) -> Option<AllowSet> {
        match self {
            Self::MethodNotAllowed { path } => Some(path.contract().allow()),
            _ => None,
        }
    }
}

pub fn resolve_route(raw_method: &str, raw_target: &str) -> Result<RouteMatch, RouteError> {
    let segments = origin_form_segments(raw_target)?;
    for path in &PATH_CONTRACTS {
        if let Some(parameters) = match_path(path, &segments)? {
            if raw_method == Method::Options.as_str() {
                return Ok(RouteMatch::Preflight(MatchedPreflightRoute {
                    path: path.id,
                    operation: path.preflight_operation,
                    parameters,
                }));
            }
            let operation = path
                .concrete_operations
                .iter()
                .copied()
                .find(|operation| operation.contract().method.as_str() == raw_method)
                .ok_or(RouteError::MethodNotAllowed { path: path.id })?;
            return Ok(RouteMatch::Concrete(MatchedConcreteRoute {
                path: path.id,
                operation,
                parameters,
            }));
        }
    }
    Err(RouteError::ResourceNotFound)
}

fn origin_form_segments(raw_target: &str) -> Result<Vec<&str>, RouteError> {
    if !raw_target.starts_with('/') || raw_target.starts_with("//") {
        return Err(RouteError::NonOriginForm);
    }
    if raw_target
        .bytes()
        .any(|byte| !(0x21..=0x7e).contains(&byte))
        || raw_target
            .bytes()
            .any(|byte| matches!(byte, b'?' | b'#' | b'%' | b'\\'))
    {
        return Err(RouteError::InvalidOriginForm);
    }
    let segments: Vec<_> = raw_target[1..].split('/').collect();
    if segments
        .iter()
        .any(|segment| segment.is_empty() || matches!(*segment, "." | ".."))
    {
        return Err(RouteError::InvalidOriginForm);
    }
    Ok(segments)
}

fn match_path(
    path: &PathContract,
    raw_segments: &[&str],
) -> Result<Option<PathParameters>, RouteError> {
    let template_segments: Vec<_> = path.template[1..].split('/').collect();
    if template_segments.len() != raw_segments.len() {
        return Ok(None);
    }
    let mut parameter = None;
    for (template, raw) in template_segments.iter().zip(raw_segments) {
        if *template == "{id}" {
            parameter = Some(*raw);
        } else if template != raw {
            return Ok(None);
        }
    }
    let parameters = match (path.parameter, parameter) {
        (PathParameterKind::None, None) => PathParameters::None,
        (PathParameterKind::CanonicalUuid, Some(value)) => {
            PathParameters::CanonicalUuid(CanonicalUuid::parse(value).map_err(|_| {
                RouteError::InvalidPathParameter {
                    path: path.id,
                    kind: path.parameter,
                }
            })?)
        }
        (PathParameterKind::PackId, Some("pocket-companion-pack")) => {
            PathParameters::PackId(PackId)
        }
        (PathParameterKind::PackId, Some(_)) => {
            return Err(RouteError::InvalidPathParameter {
                path: path.id,
                kind: path.parameter,
            });
        }
        _ => panic!("closed path template and parameter kind disagree"),
    };
    Ok(Some(parameters))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn c7_optional_json_descriptor_does_not_request_content_type() {
        let RequestMessage::Json {
            media_type, schema, ..
        } = OperationId::CreateJob.contract().messages.request
        else {
            panic!("createJob must retain its accepted JSON descriptor")
        };
        let optional = RequestMessage::Json {
            required: false,
            media_type,
            schema,
        };

        assert_eq!(
            requested_headers_for(AuthClass::Bearer, optional),
            BEARER_NONE_HEADERS
        );
    }
}
