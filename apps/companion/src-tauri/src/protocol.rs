use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
use uuid::Uuid;

use crate::secret::is_canonical_secret;

pub const PROTOCOL_MAJOR: u64 = 1;
pub const CLIENT_VERSION: &str = "1.0.0";

pub const ALL_VOICE_IDS: [&str; 20] = [
    "pocket:alba",
    "pocket:estelle",
    "pocket:anna",
    "pocket:vera",
    "pocket:fantine",
    "pocket:charles",
    "pocket:paul",
    "pocket:eponine",
    "pocket:azelma",
    "pocket:george",
    "pocket:mary",
    "pocket:jane",
    "pocket:michael",
    "pocket:eve",
    "pocket:bill_boerst",
    "pocket:caro_davy",
    "pocket:peter_yearsley",
    "pocket:stuart_bell",
    "pocket:marius",
    "pocket:javert",
];

pub const ALL_SCOPES: [&str; 7] = [
    "health:read",
    "runtime:read",
    "synthesis:create",
    "jobs:read",
    "jobs:cancel",
    "audio:read",
    "packs:request",
];

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct VoiceId(&'static str);

impl VoiceId {
    pub fn parse(value: &str) -> Option<Self> {
        ALL_VOICE_IDS
            .iter()
            .copied()
            .find(|candidate| *candidate == value)
            .map(Self)
    }

    pub const fn as_str(self) -> &'static str {
        self.0
    }
}

impl Serialize for VoiceId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.0)
    }
}

impl<'de> Deserialize<'de> for VoiceId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).ok_or_else(|| de::Error::custom("unknown Pocket preset identifier"))
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct Scope(&'static str);

impl Scope {
    pub fn parse(value: &str) -> Option<Self> {
        ALL_SCOPES
            .iter()
            .copied()
            .find(|candidate| *candidate == value)
            .map(Self)
    }

    pub const fn as_str(self) -> &'static str {
        self.0
    }
}

impl Serialize for Scope {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.0)
    }
}

impl<'de> Deserialize<'de> for Scope {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).ok_or_else(|| de::Error::custom("unknown companion scope"))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("scope list must equal the fixed protocol tuple")]
pub struct ScopeListValidationError;

pub fn validate_scope_list(scopes: &[Scope]) -> Result<(), ScopeListValidationError> {
    let exact = ALL_SCOPES.map(|scope| Scope::parse(scope).expect("owned scope must parse"));
    if scopes == exact {
        Ok(())
    } else {
        Err(ScopeListValidationError)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("secret encoding is not canonical")]
pub struct OpaqueSecretValidationError;

pub fn validate_opaque_secret(value: &str) -> Result<(), OpaqueSecretValidationError> {
    if is_canonical_secret(value) {
        Ok(())
    } else {
        Err(OpaqueSecretValidationError)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("UUID text is not canonical")]
pub struct CanonicalUuidValidationError;

pub fn validate_canonical_uuid(value: &str) -> Result<(), CanonicalUuidValidationError> {
    let parsed = Uuid::parse_str(value).map_err(|_| CanonicalUuidValidationError)?;
    if parsed.to_string() == value {
        Ok(())
    } else {
        Err(CanonicalUuidValidationError)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ClientLabelValidationError {
    #[error("client label is empty")]
    Empty,
    #[error("client label exceeds 64 Unicode scalar values")]
    TooManyScalars,
    #[error("client label exceeds 128 UTF-8 bytes")]
    TooManyBytes,
    #[error("client label contains a disallowed scalar")]
    DisallowedScalar,
    #[error("client label is an unsafe repeated-scalar string")]
    RepeatedScalar,
}

pub fn validate_client_label(label: &str) -> Result<(), ClientLabelValidationError> {
    if label.is_empty() {
        return Err(ClientLabelValidationError::Empty);
    }
    if label.chars().count() > 64 {
        return Err(ClientLabelValidationError::TooManyScalars);
    }
    if label.len() > 128 {
        return Err(ClientLabelValidationError::TooManyBytes);
    }
    let prompt_punctuation = ['<', '>', '{', '}', '[', ']', '`'];
    if label.chars().any(|scalar| {
        matches!(
            scalar,
            '\u{0000}'..='\u{001f}'
                | '\u{007f}'
                | '\u{0080}'..='\u{009f}'
                | '\u{061c}'
                | '\u{200e}'..='\u{200f}'
                | '\u{2028}'..='\u{202e}'
                | '\u{2066}'..='\u{2069}'
        ) || prompt_punctuation.contains(&scalar)
    }) {
        return Err(ClientLabelValidationError::DisallowedScalar);
    }
    let mut scalars = label.chars();
    let first = scalars.next().expect("nonempty label has one scalar");
    if label.chars().count() > 32 && scalars.all(|scalar| scalar == first) {
        return Err(ClientLabelValidationError::RepeatedScalar);
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct JobCreateRequest {
    pub voice_id: VoiceId,
    #[serde(deserialize_with = "deserialize_valid_text")]
    pub text: String,
}

fn deserialize_valid_text<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let text = String::deserialize(deserializer)?;
    validate_synthesis_text(&text).map_err(de::Error::custom)?;
    Ok(text)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum TextValidationError {
    #[error("text is required")]
    Empty,
    #[error("text exceeds 8,000 UTF-8 bytes")]
    TooManyBytes,
    #[error("text exceeds 2,000 Unicode scalar values")]
    TooManyScalars,
    #[error("text contains NUL")]
    Nul,
    #[error("text contains a disallowed control character")]
    Control,
}

pub fn validate_synthesis_text(text: &str) -> Result<(), TextValidationError> {
    if text.is_empty() {
        return Err(TextValidationError::Empty);
    }
    if text.len() > 8_000 {
        return Err(TextValidationError::TooManyBytes);
    }
    if text.chars().count() > 2_000 {
        return Err(TextValidationError::TooManyScalars);
    }
    for scalar in text.chars() {
        if scalar == '\0' {
            return Err(TextValidationError::Nul);
        }
        if scalar <= '\u{001f}' && !scalar.is_whitespace() {
            return Err(TextValidationError::Control);
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProblemCode {
    HostInvalid,
    OriginMissing,
    OriginDenied,
    VersionMissing,
    VersionUnsupported,
    AuthMissing,
    AuthInvalid,
    AuthOriginMismatch,
    ScopeDenied,
    RateLimited,
    RequestLineTooLarge,
    HeadersTooLarge,
    BodyTooLarge,
    BodyTimeout,
    HeaderTimeout,
    SchemaInvalid,
    QueueFull,
    OwnershipDenied,
    ResourceNotFound,
    Conflict,
    HandlerTimeout,
    ListenerConflict,
    PairingNotFound,
    PairingDenied,
    PairingExpired,
    PairingConsumed,
    PairingAttemptsExhausted,
    PackUnverified,
    RuntimeUnavailable,
    MethodNotAllowed,
    ContentTypeUnsupported,
    TransferEncodingInvalid,
    DuplicateHeader,
    TextInvalid,
    ActionInvalid,
}

pub const ALL_PROBLEM_CODES: [ProblemCode; 35] = [
    ProblemCode::HostInvalid,
    ProblemCode::OriginMissing,
    ProblemCode::OriginDenied,
    ProblemCode::VersionMissing,
    ProblemCode::VersionUnsupported,
    ProblemCode::AuthMissing,
    ProblemCode::AuthInvalid,
    ProblemCode::AuthOriginMismatch,
    ProblemCode::ScopeDenied,
    ProblemCode::RateLimited,
    ProblemCode::RequestLineTooLarge,
    ProblemCode::HeadersTooLarge,
    ProblemCode::BodyTooLarge,
    ProblemCode::BodyTimeout,
    ProblemCode::HeaderTimeout,
    ProblemCode::SchemaInvalid,
    ProblemCode::QueueFull,
    ProblemCode::OwnershipDenied,
    ProblemCode::ResourceNotFound,
    ProblemCode::Conflict,
    ProblemCode::HandlerTimeout,
    ProblemCode::ListenerConflict,
    ProblemCode::PairingNotFound,
    ProblemCode::PairingDenied,
    ProblemCode::PairingExpired,
    ProblemCode::PairingConsumed,
    ProblemCode::PairingAttemptsExhausted,
    ProblemCode::PackUnverified,
    ProblemCode::RuntimeUnavailable,
    ProblemCode::MethodNotAllowed,
    ProblemCode::ContentTypeUnsupported,
    ProblemCode::TransferEncodingInvalid,
    ProblemCode::DuplicateHeader,
    ProblemCode::TextInvalid,
    ProblemCode::ActionInvalid,
];

impl ProblemCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::HostInvalid => "host-invalid",
            Self::OriginMissing => "origin-missing",
            Self::OriginDenied => "origin-denied",
            Self::VersionMissing => "version-missing",
            Self::VersionUnsupported => "version-unsupported",
            Self::AuthMissing => "auth-missing",
            Self::AuthInvalid => "auth-invalid",
            Self::AuthOriginMismatch => "auth-origin-mismatch",
            Self::ScopeDenied => "scope-denied",
            Self::RateLimited => "rate-limited",
            Self::RequestLineTooLarge => "request-line-too-large",
            Self::HeadersTooLarge => "headers-too-large",
            Self::BodyTooLarge => "body-too-large",
            Self::BodyTimeout => "body-timeout",
            Self::HeaderTimeout => "header-timeout",
            Self::SchemaInvalid => "schema-invalid",
            Self::QueueFull => "queue-full",
            Self::OwnershipDenied => "ownership-denied",
            Self::ResourceNotFound => "resource-not-found",
            Self::Conflict => "conflict",
            Self::HandlerTimeout => "handler-timeout",
            Self::ListenerConflict => "listener-conflict",
            Self::PairingNotFound => "pairing-not-found",
            Self::PairingDenied => "pairing-denied",
            Self::PairingExpired => "pairing-expired",
            Self::PairingConsumed => "pairing-consumed",
            Self::PairingAttemptsExhausted => "pairing-attempts-exhausted",
            Self::PackUnverified => "pack-unverified",
            Self::RuntimeUnavailable => "runtime-unavailable",
            Self::MethodNotAllowed => "method-not-allowed",
            Self::ContentTypeUnsupported => "content-type-unsupported",
            Self::TransferEncodingInvalid => "transfer-encoding-invalid",
            Self::DuplicateHeader => "duplicate-header",
            Self::TextInvalid => "text-invalid",
            Self::ActionInvalid => "action-invalid",
        }
    }

    const fn status(self) -> u16 {
        match self {
            Self::HostInvalid
            | Self::OriginMissing
            | Self::VersionMissing
            | Self::SchemaInvalid
            | Self::TransferEncodingInvalid
            | Self::DuplicateHeader
            | Self::TextInvalid
            | Self::ActionInvalid => 400,
            Self::AuthMissing | Self::AuthInvalid | Self::AuthOriginMismatch => 401,
            Self::OriginDenied
            | Self::ScopeDenied
            | Self::PairingDenied
            | Self::PairingAttemptsExhausted => 403,
            Self::OwnershipDenied | Self::ResourceNotFound | Self::PairingNotFound => 404,
            Self::MethodNotAllowed => 405,
            Self::BodyTimeout | Self::HeaderTimeout => 408,
            Self::Conflict | Self::PairingConsumed => 409,
            Self::PairingExpired => 410,
            Self::BodyTooLarge => 413,
            Self::RequestLineTooLarge => 414,
            Self::ContentTypeUnsupported => 415,
            Self::VersionUnsupported => 426,
            Self::RateLimited => 429,
            Self::HeadersTooLarge => 431,
            Self::QueueFull
            | Self::ListenerConflict
            | Self::PackUnverified
            | Self::RuntimeUnavailable => 503,
            Self::HandlerTimeout => 504,
        }
    }

    const fn title(self) -> &'static str {
        match self {
            Self::SchemaInvalid => "Invalid request",
            Self::OriginDenied => "Origin denied",
            Self::AuthInvalid | Self::AuthMissing | Self::AuthOriginMismatch => {
                "Authentication failed"
            }
            Self::RateLimited => "Rate limit exceeded",
            Self::ListenerConflict => "Listener unavailable",
            Self::PackUnverified | Self::RuntimeUnavailable => "Runtime unavailable",
            _ => "Request rejected",
        }
    }

    const fn detail(self) -> &'static str {
        match self {
            Self::HostInvalid => "The request Host is not the companion loopback authority.",
            Self::OriginMissing => "The Origin header is required.",
            Self::OriginDenied => "The requesting origin is not allowed.",
            Self::VersionMissing => "The client version header is required.",
            Self::VersionUnsupported => "The client protocol major is not supported.",
            Self::AuthMissing => "A bearer token is required.",
            Self::AuthInvalid => "The bearer token is not valid.",
            Self::AuthOriginMismatch => "The bearer token is not valid for this origin.",
            Self::ScopeDenied => "The bearer token lacks the required scope.",
            Self::RateLimited => "The request rate limit has been reached.",
            Self::RequestLineTooLarge => "The HTTP request line exceeds the limit.",
            Self::HeadersTooLarge => "The HTTP headers exceed the limit.",
            Self::BodyTooLarge => "The JSON request body exceeds the limit.",
            Self::BodyTimeout => "The request body did not arrive within the deadline.",
            Self::HeaderTimeout => "The request headers did not arrive within the deadline.",
            Self::SchemaInvalid => "The request body does not match the protocol schema.",
            Self::QueueFull => "The synthesis queue is at capacity.",
            Self::OwnershipDenied | Self::ResourceNotFound | Self::PairingNotFound => {
                "The requested resource was not found."
            }
            Self::Conflict | Self::PairingConsumed => "The request conflicts with current state.",
            Self::HandlerTimeout => "The request handler exceeded its deadline.",
            Self::ListenerConflict => "The fixed loopback port is already in use.",
            Self::PairingDenied => "The native pairing request was denied.",
            Self::PairingExpired => "The pairing request has expired.",
            Self::PairingAttemptsExhausted => "The manual pairing attempts are exhausted.",
            Self::PackUnverified => "No verified Pocket pack is installed.",
            Self::RuntimeUnavailable => "The synthesis runtime is unavailable.",
            Self::MethodNotAllowed => "The HTTP method is not supported for this route.",
            Self::ContentTypeUnsupported => "The request content type is not supported.",
            Self::TransferEncodingInvalid => "The HTTP transfer encoding is not supported.",
            Self::DuplicateHeader => "A security-sensitive header was duplicated.",
            Self::TextInvalid => "The synthesis text is outside the accepted bounds.",
            Self::ActionInvalid => "The requested pack action is not accepted.",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Problem {
    #[serde(rename = "type")]
    pub problem_type: String,
    pub title: String,
    pub status: u16,
    pub detail: String,
    pub instance: String,
    pub code: ProblemCode,
    pub request_id: Uuid,
}

impl Problem {
    pub fn new(code: ProblemCode, status: u16) -> Self {
        let request_id = Uuid::new_v4();
        Self {
            problem_type: format!("urn:ovp:problem:{}", code.as_str()),
            title: code.title().to_owned(),
            status,
            detail: code.detail().to_owned(),
            instance: format!("urn:uuid:{request_id}"),
            code,
            request_id,
        }
    }

    pub fn is_catalog_valid(&self) -> bool {
        self.problem_type == format!("urn:ovp:problem:{}", self.code.as_str())
            && self.title == self.code.title()
            && self.status == self.code.status()
            && self.detail == self.code.detail()
            && self
                .instance
                .strip_prefix("urn:uuid:")
                .is_some_and(|value| validate_canonical_uuid(value).is_ok())
    }
}

pub fn negotiate_version(value: Option<&str>) -> Result<(), ProblemCode> {
    let value = value.ok_or(ProblemCode::VersionMissing)?;
    if value.len() > 32 {
        return Err(ProblemCode::VersionUnsupported);
    }
    let parts: Vec<&str> = value.split('.').collect();
    if parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty()
                || !part.bytes().all(|byte| byte.is_ascii_digit())
                || (part.len() > 1 && part.starts_with('0'))
        })
    {
        return Err(ProblemCode::VersionUnsupported);
    }
    let major = parts[0]
        .parse::<u64>()
        .map_err(|_| ProblemCode::VersionUnsupported)?;
    if major != PROTOCOL_MAJOR {
        return Err(ProblemCode::VersionUnsupported);
    }
    Ok(())
}
