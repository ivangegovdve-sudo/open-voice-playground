use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tokio::io::{AsyncWriteExt, Result as IoResult};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::{
    http_dispatch::{EntityTag, HandlerSuccess, ResponseLocation},
    protocol::{
        JSON_MEDIA_TYPE, OwnedSchemaName, PROBLEM_MEDIA_TYPE, Problem, ProblemClassification,
        ProblemCode, RedeemPendingResponse, ResponseBody, WAV_MEDIA_TYPE,
    },
    rate::RetryAfterSeconds,
    router::{
        AllowSet, AuthClass, GLOBAL_METHODS, MatchedConcreteRoute, MatchedPreflightRoute,
        OperationId, PREFLIGHT_ALLOWED_HEADERS, PreflightTarget,
    },
    schema::OpenApiSchemas,
};

pub(crate) struct ResponseFactory {
    schemas: Arc<OpenApiSchemas>,
}

pub(crate) struct ValidatedOrigin(String);

impl ValidatedOrigin {
    pub(crate) fn from_allowed(value: String) -> Self {
        Self(value)
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PreflightResponseHeaders {
    legacy_private_network: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum VaryProfile {
    None,
    ActualOrigin,
    PreflightBase,
    PreflightWithPrivateNetwork,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WireStatus {
    Ok,
    Created,
    Accepted,
    NoContent,
    BadRequest,
    Unauthorized,
    Forbidden,
    NotFound,
    MethodNotAllowed,
    RequestTimeout,
    Conflict,
    Gone,
    PayloadTooLarge,
    UriTooLong,
    UnsupportedMediaType,
    UpgradeRequired,
    TooManyRequests,
    RequestHeaderFieldsTooLarge,
    ServiceUnavailable,
    GatewayTimeout,
}

impl WireStatus {
    pub(crate) const fn code(self) -> u16 {
        match self {
            Self::Ok => 200,
            Self::Created => 201,
            Self::Accepted => 202,
            Self::NoContent => 204,
            Self::BadRequest => 400,
            Self::Unauthorized => 401,
            Self::Forbidden => 403,
            Self::NotFound => 404,
            Self::MethodNotAllowed => 405,
            Self::RequestTimeout => 408,
            Self::Conflict => 409,
            Self::Gone => 410,
            Self::PayloadTooLarge => 413,
            Self::UriTooLong => 414,
            Self::UnsupportedMediaType => 415,
            Self::UpgradeRequired => 426,
            Self::TooManyRequests => 429,
            Self::RequestHeaderFieldsTooLarge => 431,
            Self::ServiceUnavailable => 503,
            Self::GatewayTimeout => 504,
        }
    }

    pub(crate) const fn reason_phrase(self) -> &'static str {
        match self {
            Self::Ok => "OK",
            Self::Created => "Created",
            Self::Accepted => "Accepted",
            Self::NoContent => "No Content",
            Self::BadRequest => "Bad Request",
            Self::Unauthorized => "Unauthorized",
            Self::Forbidden => "Forbidden",
            Self::NotFound => "Not Found",
            Self::MethodNotAllowed => "Method Not Allowed",
            Self::RequestTimeout => "Request Timeout",
            Self::Conflict => "Conflict",
            Self::Gone => "Gone",
            Self::PayloadTooLarge => "Payload Too Large",
            Self::UriTooLong => "URI Too Long",
            Self::UnsupportedMediaType => "Unsupported Media Type",
            Self::UpgradeRequired => "Upgrade Required",
            Self::TooManyRequests => "Too Many Requests",
            Self::RequestHeaderFieldsTooLarge => "Request Header Fields Too Large",
            Self::ServiceUnavailable => "Service Unavailable",
            Self::GatewayTimeout => "Gateway Timeout",
        }
    }

    const fn from_code(code: u16) -> Option<Self> {
        match code {
            200 => Some(Self::Ok),
            201 => Some(Self::Created),
            202 => Some(Self::Accepted),
            204 => Some(Self::NoContent),
            400 => Some(Self::BadRequest),
            401 => Some(Self::Unauthorized),
            403 => Some(Self::Forbidden),
            404 => Some(Self::NotFound),
            405 => Some(Self::MethodNotAllowed),
            408 => Some(Self::RequestTimeout),
            409 => Some(Self::Conflict),
            410 => Some(Self::Gone),
            413 => Some(Self::PayloadTooLarge),
            414 => Some(Self::UriTooLong),
            415 => Some(Self::UnsupportedMediaType),
            426 => Some(Self::UpgradeRequired),
            429 => Some(Self::TooManyRequests),
            431 => Some(Self::RequestHeaderFieldsTooLarge),
            503 => Some(Self::ServiceUnavailable),
            504 => Some(Self::GatewayTimeout),
            _ => None,
        }
    }
}

pub(crate) enum PreparedBody {
    Empty,
    Json(Zeroizing<Vec<u8>>),
    Audio(Vec<u8>),
}

pub(crate) struct PreparedResponse {
    status: WireStatus,
    body: PreparedBody,
    content_type: Option<&'static str>,
    request_id: Uuid,
    allow_origin: Option<String>,
    expose_headers: bool,
    preflight_allow: Option<PreflightResponseHeaders>,
    allow: Option<AllowSet>,
    www_authenticate: bool,
    retry_after: Option<RetryAfterSeconds>,
    etag: Option<EntityTag>,
    location: Option<ResponseLocation>,
    vary: VaryProfile,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub(crate) enum ResponseFactoryError {
    #[error("a non-HTTP Problem cannot be written")]
    NonHttpProblem,
    #[error("the status is not declared by the selected operation")]
    UndeclaredStatus,
    #[error("the typed body does not match the selected response")]
    BodyMismatch,
    #[error("conditional response metadata is inconsistent")]
    MetadataMismatch,
    #[error("the typed response could not be serialized")]
    Serialization,
    #[error("the typed response failed its owned schema")]
    Schema,
}

struct SuccessParts {
    status: WireStatus,
    body: PreparedBody,
    content_type: Option<&'static str>,
    retry_after: Option<RetryAfterSeconds>,
    etag: Option<EntityTag>,
    location: Option<ResponseLocation>,
}

enum SuccessMetadata {
    None,
    RetryAfter(RetryAfterSeconds),
    EntityTag(EntityTag),
    Location(ResponseLocation),
}

impl ResponseFactory {
    pub(crate) fn new(schemas: Arc<OpenApiSchemas>) -> Self {
        Self { schemas }
    }

    pub(crate) fn success(
        &self,
        origin: &ValidatedOrigin,
        route: &MatchedConcreteRoute,
        success: HandlerSuccess,
    ) -> Result<PreparedResponse, ResponseFactoryError> {
        let operation = route.operation();
        if operation.contract().access.auth == AuthClass::Preflight {
            return Err(ResponseFactoryError::BodyMismatch);
        }
        let parts = match (operation, success) {
            (OperationId::GetHealth, HandlerSuccess::Health(body)) => self.json_success(
                operation,
                200,
                OwnedSchemaName::HealthResponse,
                body,
                SuccessMetadata::None,
            )?,
            (
                OperationId::CreatePairingChallenge,
                HandlerSuccess::PairingChallengeCreated { body, location },
            ) => self.json_success(
                operation,
                201,
                OwnedSchemaName::PairingChallengeResponse,
                body,
                SuccessMetadata::Location(location),
            )?,
            (OperationId::RedeemPairingChallenge, HandlerSuccess::RedeemComplete(body)) => self
                .json_success(
                    operation,
                    200,
                    OwnedSchemaName::RedeemResponse,
                    body,
                    SuccessMetadata::None,
                )?,
            (
                OperationId::RedeemPairingChallenge,
                HandlerSuccess::RedeemPending { retry_after },
            ) => self.json_success(
                operation,
                202,
                OwnedSchemaName::RedeemPendingResponse,
                RedeemPendingResponse::pending(),
                SuccessMetadata::RetryAfter(retry_after),
            )?,
            (OperationId::GetCurrentPairing, HandlerSuccess::CurrentPairing(body)) => self
                .json_success(
                    operation,
                    200,
                    OwnedSchemaName::PairingResponse,
                    body,
                    SuccessMetadata::None,
                )?,
            (OperationId::RevokeCurrentPairing, HandlerSuccess::PairingRevoked) => {
                self.empty_success(operation, 204)?
            }
            (OperationId::GetRuntime, HandlerSuccess::Runtime { body, etag }) => self
                .json_success(
                    operation,
                    200,
                    OwnedSchemaName::RuntimeResponse,
                    body,
                    SuccessMetadata::EntityTag(etag),
                )?,
            (OperationId::ListEngines, HandlerSuccess::Engines { body, etag }) => self
                .json_success(
                    operation,
                    200,
                    OwnedSchemaName::EngineListResponse,
                    body,
                    SuccessMetadata::EntityTag(etag),
                )?,
            (OperationId::ListVoices, HandlerSuccess::Voices { body, etag }) => self.json_success(
                operation,
                200,
                OwnedSchemaName::VoiceListResponse,
                body,
                SuccessMetadata::EntityTag(etag),
            )?,
            (OperationId::ListPacks, HandlerSuccess::Packs { body, etag }) => self.json_success(
                operation,
                200,
                OwnedSchemaName::PackListResponse,
                body,
                SuccessMetadata::EntityTag(etag),
            )?,
            (OperationId::CreateJob, HandlerSuccess::JobCreated { body, location }) => self
                .json_success(
                    operation,
                    202,
                    OwnedSchemaName::JobResponse,
                    body,
                    SuccessMetadata::Location(location),
                )?,
            (OperationId::GetJob, HandlerSuccess::Job(body)) => self.json_success(
                operation,
                200,
                OwnedSchemaName::JobResponse,
                body,
                SuccessMetadata::None,
            )?,
            (OperationId::CancelJob, HandlerSuccess::JobCancellationAccepted(body)) => self
                .json_success(
                    operation,
                    202,
                    OwnedSchemaName::JobResponse,
                    body,
                    SuccessMetadata::None,
                )?,
            (OperationId::GetJobAudio, HandlerSuccess::JobAudio { body, etag }) => {
                self.audio_success(operation, 200, body.into_bytes(), etag)?
            }
            (
                OperationId::RequestPackAction,
                HandlerSuccess::PackActionAccepted { body, location },
            ) => self.json_success(
                operation,
                202,
                OwnedSchemaName::PackActionResponse,
                body,
                SuccessMetadata::Location(location),
            )?,
            (_, _) => return Err(ResponseFactoryError::BodyMismatch),
        };
        self.check_success_metadata(operation, &parts)?;
        Ok(PreparedResponse {
            status: parts.status,
            body: parts.body,
            content_type: parts.content_type,
            request_id: Uuid::new_v4(),
            allow_origin: Some(origin.as_str().to_owned()),
            expose_headers: true,
            preflight_allow: None,
            allow: None,
            www_authenticate: false,
            retry_after: parts.retry_after,
            etag: parts.etag,
            location: parts.location,
            vary: VaryProfile::ActualOrigin,
        })
    }

    pub(crate) fn actual_problem(
        &self,
        origin: Option<&ValidatedOrigin>,
        operation: Option<OperationId>,
        allow: Option<AllowSet>,
        code: ProblemCode,
        retry_after: Option<RetryAfterSeconds>,
    ) -> Result<PreparedResponse, ResponseFactoryError> {
        if operation
            .is_some_and(|operation| operation.contract().access.auth == AuthClass::Preflight)
        {
            return Err(ResponseFactoryError::BodyMismatch);
        }
        self.problem(
            origin,
            operation,
            allow,
            code,
            retry_after,
            VaryProfile::None,
        )
    }

    pub(crate) fn preflight_success(
        &self,
        origin: &ValidatedOrigin,
        route: &MatchedPreflightRoute,
        target: &PreflightTarget,
        legacy_private_network: bool,
    ) -> Result<PreparedResponse, ResponseFactoryError> {
        if route.operation().contract().access.auth != AuthClass::Preflight
            || target.operation().contract().access.auth == AuthClass::Preflight
            || target.operation().contract().path != route.path()
        {
            return Err(ResponseFactoryError::BodyMismatch);
        }
        self.expect_empty(route.operation(), 204)?;
        Ok(PreparedResponse {
            status: WireStatus::NoContent,
            body: PreparedBody::Empty,
            content_type: None,
            request_id: Uuid::new_v4(),
            allow_origin: Some(origin.as_str().to_owned()),
            expose_headers: false,
            preflight_allow: Some(PreflightResponseHeaders {
                legacy_private_network,
            }),
            allow: None,
            www_authenticate: false,
            retry_after: None,
            etag: None,
            location: None,
            vary: if legacy_private_network {
                VaryProfile::PreflightWithPrivateNetwork
            } else {
                VaryProfile::PreflightBase
            },
        })
    }

    pub(crate) fn preflight_problem(
        &self,
        operation: Option<OperationId>,
        allow: Option<AllowSet>,
        code: ProblemCode,
        retry_after: Option<RetryAfterSeconds>,
    ) -> Result<PreparedResponse, ResponseFactoryError> {
        if operation
            .is_some_and(|operation| operation.contract().access.auth != AuthClass::Preflight)
        {
            return Err(ResponseFactoryError::BodyMismatch);
        }
        self.problem(
            None,
            operation,
            allow,
            code,
            retry_after,
            VaryProfile::PreflightBase,
        )
    }

    pub(crate) fn fallback_actual(
        &self,
        origin: Option<&ValidatedOrigin>,
        operation: Option<OperationId>,
        _allow: Option<AllowSet>,
    ) -> PreparedResponse {
        self.actual_problem(
            origin,
            operation,
            None,
            ProblemCode::RuntimeUnavailable,
            None,
        )
        .expect("runtime-unavailable is a closed actual-response fallback")
    }

    pub(crate) fn fallback_preflight(
        &self,
        operation: Option<OperationId>,
        _allow: Option<AllowSet>,
    ) -> PreparedResponse {
        self.preflight_problem(operation, None, ProblemCode::RuntimeUnavailable, None)
            .expect("runtime-unavailable is a closed preflight fallback")
    }

    fn problem(
        &self,
        origin: Option<&ValidatedOrigin>,
        operation: Option<OperationId>,
        allow: Option<AllowSet>,
        code: ProblemCode,
        retry_after: Option<RetryAfterSeconds>,
        default_vary: VaryProfile,
    ) -> Result<PreparedResponse, ResponseFactoryError> {
        if code.catalog().classification() != ProblemClassification::Http {
            return Err(ResponseFactoryError::NonHttpProblem);
        }
        self.check_problem_metadata(code, allow, retry_after)?;
        let status =
            WireStatus::from_code(code.status()).ok_or(ResponseFactoryError::UndeclaredStatus)?;
        if let Some(operation) = operation {
            self.expect_json(
                operation,
                code.status(),
                OwnedSchemaName::Problem,
                PROBLEM_MEDIA_TYPE,
            )?;
        }
        let problem = Problem::new(code);
        let request_id = problem.request_id();
        let body = self.serialize_checked(OwnedSchemaName::Problem, problem)?;
        let actual_origin = origin.map(|origin| origin.as_str().to_owned());
        Ok(PreparedResponse {
            status,
            body: PreparedBody::Json(body),
            content_type: Some(PROBLEM_MEDIA_TYPE),
            request_id,
            allow_origin: actual_origin,
            expose_headers: origin.is_some(),
            preflight_allow: None,
            allow,
            www_authenticate: status == WireStatus::Unauthorized,
            retry_after,
            etag: None,
            location: None,
            vary: if origin.is_some() {
                VaryProfile::ActualOrigin
            } else {
                default_vary
            },
        })
    }

    fn json_success<T: Serialize>(
        &self,
        operation: OperationId,
        status: u16,
        schema: OwnedSchemaName,
        body: T,
        metadata: SuccessMetadata,
    ) -> Result<SuccessParts, ResponseFactoryError> {
        self.expect_json(operation, status, schema, JSON_MEDIA_TYPE)?;
        let (retry_after, etag, location) = match metadata {
            SuccessMetadata::None => (None, None, None),
            SuccessMetadata::RetryAfter(value) => (Some(value), None, None),
            SuccessMetadata::EntityTag(value) => (None, Some(value), None),
            SuccessMetadata::Location(value) => (None, None, Some(value)),
        };
        Ok(SuccessParts {
            status: WireStatus::from_code(status).ok_or(ResponseFactoryError::UndeclaredStatus)?,
            body: PreparedBody::Json(self.serialize_checked(schema, body)?),
            content_type: Some(JSON_MEDIA_TYPE),
            retry_after,
            etag,
            location,
        })
    }

    fn empty_success(
        &self,
        operation: OperationId,
        status: u16,
    ) -> Result<SuccessParts, ResponseFactoryError> {
        self.expect_empty(operation, status)?;
        Ok(SuccessParts {
            status: WireStatus::from_code(status).ok_or(ResponseFactoryError::UndeclaredStatus)?,
            body: PreparedBody::Empty,
            content_type: None,
            retry_after: None,
            etag: None,
            location: None,
        })
    }

    fn audio_success(
        &self,
        operation: OperationId,
        status: u16,
        bytes: Vec<u8>,
        etag: EntityTag,
    ) -> Result<SuccessParts, ResponseFactoryError> {
        let descriptor = operation
            .contract()
            .messages
            .responses
            .iter()
            .find(|response| response.status == status)
            .ok_or(ResponseFactoryError::UndeclaredStatus)?;
        match descriptor.body {
            ResponseBody::Audio {
                media_type,
                max_bytes,
            } if media_type == WAV_MEDIA_TYPE && bytes.len() as u64 <= max_bytes => {}
            ResponseBody::Audio { .. } => return Err(ResponseFactoryError::Schema),
            _ => return Err(ResponseFactoryError::BodyMismatch),
        }
        Ok(SuccessParts {
            status: WireStatus::from_code(status).ok_or(ResponseFactoryError::UndeclaredStatus)?,
            body: PreparedBody::Audio(bytes),
            content_type: Some(WAV_MEDIA_TYPE),
            retry_after: None,
            etag: Some(etag),
            location: None,
        })
    }

    fn expect_json(
        &self,
        operation: OperationId,
        status: u16,
        schema: OwnedSchemaName,
        media_type: &'static str,
    ) -> Result<(), ResponseFactoryError> {
        let descriptor = operation
            .contract()
            .messages
            .responses
            .iter()
            .find(|response| response.status == status)
            .ok_or(ResponseFactoryError::UndeclaredStatus)?;
        match descriptor.body {
            ResponseBody::Json {
                media_type: actual_media,
                schema: actual_schema,
            } if actual_media == media_type && actual_schema == schema => Ok(()),
            _ => Err(ResponseFactoryError::BodyMismatch),
        }
    }

    fn expect_empty(
        &self,
        operation: OperationId,
        status: u16,
    ) -> Result<(), ResponseFactoryError> {
        let descriptor = operation
            .contract()
            .messages
            .responses
            .iter()
            .find(|response| response.status == status)
            .ok_or(ResponseFactoryError::UndeclaredStatus)?;
        if descriptor.body == ResponseBody::Empty {
            Ok(())
        } else {
            Err(ResponseFactoryError::BodyMismatch)
        }
    }

    fn serialize_checked<T: Serialize>(
        &self,
        schema: OwnedSchemaName,
        body: T,
    ) -> Result<Zeroizing<Vec<u8>>, ResponseFactoryError> {
        let bytes = Zeroizing::new(
            serde_json::to_vec(&body).map_err(|_| ResponseFactoryError::Serialization)?,
        );
        let mut value = serde_json::from_slice::<Value>(&bytes)
            .map_err(|_| ResponseFactoryError::Serialization)?;
        let result = self
            .schemas
            .validate_owned(schema, &value)
            .map_err(|_| ResponseFactoryError::Schema);
        scrub_json_strings(&mut value);
        result?;
        Ok(bytes)
    }

    fn check_problem_metadata(
        &self,
        code: ProblemCode,
        allow: Option<AllowSet>,
        retry_after: Option<RetryAfterSeconds>,
    ) -> Result<(), ResponseFactoryError> {
        if (code.status() == 405) != allow.is_some() {
            return Err(ResponseFactoryError::MetadataMismatch);
        }
        let retry_required = code == ProblemCode::RateLimited || code == ProblemCode::QueueFull;
        if retry_required != retry_after.is_some() {
            return Err(ResponseFactoryError::MetadataMismatch);
        }
        if code.status() != 429 && code.status() != 503 && retry_after.is_some() {
            return Err(ResponseFactoryError::MetadataMismatch);
        }
        Ok(())
    }

    fn check_success_metadata(
        &self,
        operation: OperationId,
        parts: &SuccessParts,
    ) -> Result<(), ResponseFactoryError> {
        let has_retry = parts.retry_after.is_some();
        let has_etag = parts.etag.is_some();
        let has_location = parts.location.is_some();
        let valid = match operation {
            OperationId::GetHealth
            | OperationId::GetCurrentPairing
            | OperationId::GetJob
            | OperationId::CancelJob
            | OperationId::RevokeCurrentPairing => !has_retry && !has_etag && !has_location,
            OperationId::CreatePairingChallenge
            | OperationId::CreateJob
            | OperationId::RequestPackAction => !has_retry && !has_etag && has_location,
            OperationId::RedeemPairingChallenge => !has_etag && !has_location,
            OperationId::GetRuntime
            | OperationId::ListEngines
            | OperationId::ListVoices
            | OperationId::ListPacks
            | OperationId::GetJobAudio => !has_retry && has_etag && !has_location,
            OperationId::PreflightHealth
            | OperationId::PreflightPairingChallenges
            | OperationId::PreflightPairingChallengeRedeem
            | OperationId::PreflightCurrentPairing
            | OperationId::PreflightRuntime
            | OperationId::PreflightEngines
            | OperationId::PreflightVoices
            | OperationId::PreflightPacks
            | OperationId::PreflightJobs
            | OperationId::PreflightJob
            | OperationId::PreflightJobAudio
            | OperationId::PreflightPackActions => false,
        };
        if valid {
            Ok(())
        } else {
            Err(ResponseFactoryError::MetadataMismatch)
        }
    }
}

fn scrub_json_strings(value: &mut Value) {
    match value {
        Value::Object(object) => {
            for (mut key, mut child) in std::mem::take(object) {
                key.zeroize();
                scrub_json_strings(&mut child);
            }
        }
        Value::Array(array) => {
            for mut child in std::mem::take(array) {
                scrub_json_strings(&mut child);
            }
        }
        Value::String(string) => string.zeroize(),
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

pub(crate) async fn write_prepared(
    stream: &mut tokio::net::TcpStream,
    response: PreparedResponse,
) -> IoResult<()> {
    let PreparedResponse {
        status,
        body,
        content_type,
        request_id,
        allow_origin,
        expose_headers,
        preflight_allow,
        allow,
        www_authenticate,
        retry_after,
        etag,
        location,
        vary,
    } = response;
    let body_len = match &body {
        PreparedBody::Empty => 0,
        PreparedBody::Json(bytes) => bytes.len(),
        PreparedBody::Audio(bytes) => bytes.len(),
    };
    let mut headers = format!(
        "HTTP/1.1 {} {}\r\nConnection: close\r\nContent-Length: {body_len}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Request-Id: {request_id}\r\n",
        status.code(),
        status.reason_phrase(),
    );
    if let Some(content_type) = content_type {
        headers.push_str("Content-Type: ");
        headers.push_str(content_type);
        headers.push_str("\r\n");
    }
    if let Some(origin) = allow_origin {
        headers.push_str("Access-Control-Allow-Origin: ");
        headers.push_str(&origin);
        headers.push_str("\r\n");
    }
    if expose_headers {
        headers.push_str(
            "Access-Control-Expose-Headers: ETag, Location, Retry-After, X-Request-Id\r\n",
        );
    }
    if let Some(preflight) = preflight_allow {
        headers.push_str("Access-Control-Allow-Methods: ");
        headers.push_str(
            &GLOBAL_METHODS
                .iter()
                .map(|method| method.as_str())
                .collect::<Vec<_>>()
                .join(", "),
        );
        headers.push_str("\r\nAccess-Control-Allow-Headers: ");
        headers.push_str(
            &PREFLIGHT_ALLOWED_HEADERS
                .iter()
                .map(|header| header.as_str())
                .collect::<Vec<_>>()
                .join(", "),
        );
        headers.push_str("\r\nAccess-Control-Max-Age: 600\r\n");
        if preflight.legacy_private_network {
            headers.push_str("Access-Control-Allow-Private-Network: true\r\n");
        }
    }
    if let Some(allow) = allow {
        headers.push_str("Allow: ");
        headers.push_str(allow.header_value());
        headers.push_str("\r\n");
    }
    if www_authenticate {
        headers.push_str("WWW-Authenticate: Bearer realm=\"open-voice-companion\"\r\n");
    }
    if let Some(delay) = retry_after {
        headers.push_str("Retry-After: ");
        headers.push_str(&delay.get().to_string());
        headers.push_str("\r\n");
    }
    if let Some(etag) = etag {
        headers.push_str("ETag: ");
        headers.push_str(&etag.into_string());
        headers.push_str("\r\n");
    }
    if let Some(location) = location {
        headers.push_str("Location: ");
        headers.push_str(&location.into_string());
        headers.push_str("\r\n");
    }
    match vary {
        VaryProfile::None => {}
        VaryProfile::ActualOrigin => headers.push_str("Vary: Origin\r\n"),
        VaryProfile::PreflightBase => headers.push_str(
            "Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers\r\n",
        ),
        VaryProfile::PreflightWithPrivateNetwork => headers.push_str(
            "Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network\r\n",
        ),
    }
    headers.push_str("\r\n");
    stream.write_all(headers.as_bytes()).await?;
    match body {
        PreparedBody::Empty => {}
        PreparedBody::Json(bytes) => stream.write_all(&bytes).await?,
        PreparedBody::Audio(bytes) => stream.write_all(&bytes).await?,
    }
    stream.shutdown().await
}

#[cfg(test)]
mod tests {
    use std::{
        collections::{BTreeMap, BTreeSet},
        sync::Arc,
    };

    use serde::de::DeserializeOwned;
    use serde_json::{Map, json};

    use super::*;

    use crate::{
        http_dispatch::{HandlerSuccess, ResponseLocation, WavBody},
        protocol::{
            ALL_PROBLEM_CODES, EngineListResponse, HTTP_PROBLEM_CODES, HealthResponse, JobResponse,
            OPERATION_MESSAGE_CONTRACTS, PackAction, PackActionResponse, PackListResponse,
            PairingChallengeResponse, PairingResponse, ProblemClassification, RedeemResponse,
            RequestMessage, ResponseMessage, RuntimeResponse, VoiceListResponse,
        },
        rate::RetryAfterSeconds,
        router::{
            AllowSet, AuthClass, GLOBAL_METHODS, Method, OPERATION_CONTRACTS, OperationId,
            OwnershipClass, PATH_CONTRACTS, PREFLIGHT_ALLOWED_HEADERS, PathParameterKind,
            RouteMatch, resolve_route,
        },
        schema::OpenApiSchemas,
    };

    const OPENAPI: &str = include_str!("../../openapi/openapi.yaml");

    #[derive(Clone, Debug, PartialEq)]
    enum ProfileRequest {
        None,
        Json {
            required: bool,
            media_type: String,
            schema: String,
        },
    }

    #[derive(Clone, Debug, PartialEq)]
    enum ProfileBody {
        Empty,
        Json { media_type: String, schema: String },
        Audio { media_type: String, max_bytes: u64 },
    }

    #[derive(Clone, Debug, PartialEq)]
    struct ProfileHeader {
        required: bool,
        condition: Option<String>,
        schema: Value,
    }

    #[derive(Clone, Debug, PartialEq)]
    struct ProfileResponse {
        body: ProfileBody,
        headers: BTreeMap<String, ProfileHeader>,
    }

    #[derive(Clone, Debug, PartialEq)]
    struct ProfileAccess {
        auth: String,
        scope: Option<String>,
        ownership: String,
    }

    #[derive(Clone, Debug, PartialEq)]
    struct ProfileOperation {
        path: String,
        method: String,
        access: ProfileAccess,
        request: ProfileRequest,
        responses: BTreeMap<u16, ProfileResponse>,
    }

    #[derive(Clone, Debug, PartialEq)]
    struct ProfilePath {
        parameter_schema: Option<String>,
        concrete_operations: Vec<String>,
        preflight_operation: String,
        preflight_methods: Vec<String>,
    }

    #[derive(Clone, Debug, PartialEq)]
    struct CompleteProjection {
        policy: Value,
        problem_enum: Vec<String>,
        paths: BTreeMap<String, ProfilePath>,
        operations: BTreeMap<String, ProfileOperation>,
    }

    fn local_ref(value: &Value, prefix: &str) -> Result<String, String> {
        let object = value
            .as_object()
            .ok_or_else(|| "reference is not an object".to_owned())?;
        if object.len() != 1 {
            return Err("reference has siblings".to_owned());
        }
        object
            .get("$ref")
            .and_then(Value::as_str)
            .and_then(|reference| reference.strip_prefix(prefix))
            .filter(|name| !name.is_empty() && !name.contains('/'))
            .map(str::to_owned)
            .ok_or_else(|| "reference is not canonical and local".to_owned())
    }

    fn resolve_component<'a>(
        document: &'a Value,
        candidate: &'a Value,
        family: &str,
    ) -> Result<&'a Value, String> {
        let Some(reference) = candidate.get("$ref") else {
            return Ok(candidate);
        };
        if candidate.as_object().is_none_or(|object| object.len() != 1) {
            return Err(format!("{family} reference has siblings"));
        }
        let prefix = format!("#/components/{family}/");
        let name = reference
            .as_str()
            .and_then(|value| value.strip_prefix(&prefix))
            .filter(|name| !name.is_empty() && !name.contains('/'))
            .ok_or_else(|| format!("{family} reference is not canonical"))?;
        document["components"][family]
            .get(name)
            .ok_or_else(|| format!("dangling {family} reference {name}"))
    }

    fn normalize_header_schema(_document: &Value, schema: &Value) -> Result<Value, String> {
        if schema.get("$ref").is_some() {
            return Ok(json!({
                "kind": "schema-ref",
                "schema": local_ref(schema, "#/components/schemas/")?,
            }));
        }
        let object = schema
            .as_object()
            .ok_or_else(|| "header schema is not an object".to_owned())?;
        let kind = object
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| "header schema type is missing".to_owned())?;
        if let Some(value) = object.get("const") {
            return Ok(json!({"kind": format!("const-{kind}"), "value": value}));
        }
        if let Some(values) = object.get("enum") {
            return Ok(json!({"kind": format!("enum-{kind}"), "values": values}));
        }
        match kind {
            "string" => Ok(json!({
                "kind": "bounded-string",
                "minimum": object.get("minLength").and_then(Value::as_u64)
                    .ok_or_else(|| "string header minimum is missing".to_owned())?,
                "maximum": object.get("maxLength").and_then(Value::as_u64)
                    .ok_or_else(|| "string header maximum is missing".to_owned())?,
            })),
            "integer" => Ok(json!({
                "kind": "bounded-integer",
                "minimum": object.get("minimum").and_then(Value::as_u64)
                    .ok_or_else(|| "integer header minimum is missing".to_owned())?,
                "maximum": object.get("maximum").and_then(Value::as_u64)
                    .ok_or_else(|| "integer header maximum is missing".to_owned())?,
            })),
            _ => Err("unsupported header schema".to_owned()),
        }
    }

    fn extract_header(document: &Value, candidate: &Value) -> Result<ProfileHeader, String> {
        let header = resolve_component(document, candidate, "headers")?;
        let object = header
            .as_object()
            .ok_or_else(|| "header is not an object".to_owned())?;
        let required = object
            .get("required")
            .and_then(Value::as_bool)
            .ok_or_else(|| "header required marker is missing".to_owned())?;
        let condition = object
            .get("x-ovp-condition")
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| "header condition is not a string".to_owned())
            })
            .transpose()?;
        if condition.is_some() == required {
            return Err("header required/condition markers disagree".to_owned());
        }
        Ok(ProfileHeader {
            required,
            condition,
            schema: normalize_header_schema(
                document,
                object
                    .get("schema")
                    .ok_or_else(|| "header schema is missing".to_owned())?,
            )?,
        })
    }

    fn extract_body(response: &Value) -> Result<ProfileBody, String> {
        let Some(content) = response.get("content") else {
            return Ok(ProfileBody::Empty);
        };
        let content = content
            .as_object()
            .filter(|content| content.len() == 1)
            .ok_or_else(|| "response must have exactly one media type".to_owned())?;
        let (media_type, media) = content.iter().next().unwrap();
        if media_type == WAV_MEDIA_TYPE {
            return Ok(ProfileBody::Audio {
                media_type: media_type.clone(),
                max_bytes: media
                    .get("x-maxBodyBytes")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| "audio maximum is missing".to_owned())?,
            });
        }
        Ok(ProfileBody::Json {
            media_type: media_type.clone(),
            schema: local_ref(
                media
                    .get("schema")
                    .ok_or_else(|| "JSON schema is missing".to_owned())?,
                "#/components/schemas/",
            )?,
        })
    }

    fn extract_response(document: &Value, candidate: &Value) -> Result<ProfileResponse, String> {
        let response = resolve_component(document, candidate, "responses")?;
        let headers = response
            .get("headers")
            .and_then(Value::as_object)
            .ok_or_else(|| "response headers are missing".to_owned())?;
        let mut projected_headers = BTreeMap::new();
        for (name, header) in headers {
            if projected_headers
                .insert(name.clone(), extract_header(document, header)?)
                .is_some()
            {
                return Err(format!("duplicate response header {name}"));
            }
        }
        Ok(ProfileResponse {
            body: extract_body(response)?,
            headers: projected_headers,
        })
    }

    fn extract_request(operation: &Value) -> Result<ProfileRequest, String> {
        let Some(request) = operation.get("requestBody") else {
            return Ok(ProfileRequest::None);
        };
        let required = request
            .get("required")
            .and_then(Value::as_bool)
            .ok_or_else(|| "request required marker is missing".to_owned())?;
        let content = request["content"]
            .as_object()
            .filter(|content| content.len() == 1)
            .ok_or_else(|| "request must have exactly one media type".to_owned())?;
        let (media_type, media) = content.iter().next().unwrap();
        Ok(ProfileRequest::Json {
            required,
            media_type: media_type.clone(),
            schema: local_ref(
                media
                    .get("schema")
                    .ok_or_else(|| "request schema is missing".to_owned())?,
                "#/components/schemas/",
            )?,
        })
    }

    fn extract_access(value: &Value) -> Result<ProfileAccess, String> {
        let object = value
            .as_object()
            .ok_or_else(|| "access descriptor is not an object".to_owned())?;
        if object.keys().map(String::as_str).collect::<BTreeSet<_>>()
            != BTreeSet::from(["auth", "ownership", "scope"])
        {
            return Err("access descriptor fields are not exact".to_owned());
        }
        Ok(ProfileAccess {
            auth: object["auth"]
                .as_str()
                .ok_or_else(|| "access auth is invalid".to_owned())?
                .to_owned(),
            scope: match &object["scope"] {
                Value::Null => None,
                Value::String(scope) => Some(scope.clone()),
                _ => return Err("access scope is invalid".to_owned()),
            },
            ownership: object["ownership"]
                .as_str()
                .ok_or_else(|| "access ownership is invalid".to_owned())?
                .to_owned(),
        })
    }

    fn parameter_schema(
        document: &Value,
        template: &str,
        path_item: &Value,
    ) -> Result<Option<String>, String> {
        let parameters = path_item
            .get("parameters")
            .map(|value| {
                value
                    .as_array()
                    .cloned()
                    .ok_or_else(|| "path parameters are not an array".to_owned())
            })
            .transpose()?
            .unwrap_or_default();
        if !template.contains("{id}") {
            return if parameters.is_empty() {
                Ok(None)
            } else {
                Err("literal path declares a path parameter".to_owned())
            };
        }
        if parameters.len() != 1 {
            return Err("parameterized path must have one parameter".to_owned());
        }
        let parameter = resolve_component(document, &parameters[0], "parameters")?;
        if parameter.get("name").and_then(Value::as_str) != Some("id")
            || parameter.get("in").and_then(Value::as_str) != Some("path")
            || parameter.get("required").and_then(Value::as_bool) != Some(true)
        {
            return Err("path parameter metadata is invalid".to_owned());
        }
        local_ref(&parameter["schema"], "#/components/schemas/").map(Some)
    }

    fn preflight_methods(document: &Value, operation: &Value) -> Result<Vec<String>, String> {
        let parameters = operation["parameters"]
            .as_array()
            .ok_or_else(|| "preflight parameters are missing".to_owned())?;
        let mut methods = None;
        for parameter in parameters {
            let parameter = resolve_component(document, parameter, "parameters")?;
            if parameter.get("name").and_then(Value::as_str)
                == Some("Access-Control-Request-Method")
            {
                if methods.is_some() {
                    return Err("duplicate requested-method parameter".to_owned());
                }
                methods = Some(
                    parameter["schema"]["enum"]
                        .as_array()
                        .ok_or_else(|| "preflight method enum is missing".to_owned())?
                        .iter()
                        .map(|value| {
                            value
                                .as_str()
                                .map(str::to_owned)
                                .ok_or_else(|| "preflight method is not a string".to_owned())
                        })
                        .collect::<Result<Vec<_>, _>>()?,
                );
            }
        }
        methods.ok_or_else(|| "preflight requested-method parameter is missing".to_owned())
    }

    fn extract_openapi(document: &Value) -> Result<CompleteProjection, String> {
        let raw_policy = document
            .get("x-ovp-http-policy")
            .and_then(Value::as_object)
            .ok_or_else(|| "HTTP policy is missing".to_owned())?;
        let access_by_operation = raw_policy
            .get("accessByOperation")
            .and_then(Value::as_object)
            .ok_or_else(|| "accessByOperation is missing".to_owned())?;
        let paths = document["paths"]
            .as_object()
            .ok_or_else(|| "paths are missing".to_owned())?;
        let mut projected_paths = BTreeMap::new();
        let mut operations = BTreeMap::new();
        let mut used_access = BTreeSet::new();
        for (template, path_item) in paths {
            let path_object = path_item
                .as_object()
                .ok_or_else(|| format!("path {template} is not an object"))?;
            let allowed = BTreeSet::from(["parameters", "get", "post", "delete", "options"]);
            if path_object
                .keys()
                .any(|key| !allowed.contains(key.as_str()))
            {
                return Err(format!("path {template} has an unsupported method"));
            }
            let mut concrete = Vec::new();
            let mut preflight = None;
            let mut methods = None;
            for (method, yaml_method) in [
                ("GET", "get"),
                ("POST", "post"),
                ("DELETE", "delete"),
                ("OPTIONS", "options"),
            ] {
                let Some(operation) = path_object.get(yaml_method) else {
                    continue;
                };
                let operation_id = operation
                    .get("operationId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| format!("{template} {method} has no operation ID"))?
                    .to_owned();
                let access = if method == "OPTIONS" {
                    ProfileAccess {
                        auth: "preflight".to_owned(),
                        scope: None,
                        ownership: "none".to_owned(),
                    }
                } else {
                    used_access.insert(operation_id.clone());
                    extract_access(
                        access_by_operation
                            .get(&operation_id)
                            .ok_or_else(|| format!("{operation_id} has no access descriptor"))?,
                    )?
                };
                let responses = operation["responses"]
                    .as_object()
                    .ok_or_else(|| format!("{operation_id} responses are missing"))?;
                let mut projected_responses = BTreeMap::new();
                for (raw_status, response) in responses {
                    if raw_status.len() != 3
                        || !raw_status.bytes().all(|byte| byte.is_ascii_digit())
                    {
                        return Err(format!("{operation_id} has invalid status {raw_status}"));
                    }
                    let status = raw_status
                        .parse::<u16>()
                        .map_err(|_| "invalid response status".to_owned())?;
                    if projected_responses
                        .insert(status, extract_response(document, response)?)
                        .is_some()
                    {
                        return Err(format!("{operation_id} duplicates status {status}"));
                    }
                }
                if operations
                    .insert(
                        operation_id.clone(),
                        ProfileOperation {
                            path: template.clone(),
                            method: method.to_owned(),
                            access,
                            request: extract_request(operation)?,
                            responses: projected_responses,
                        },
                    )
                    .is_some()
                {
                    return Err(format!("duplicate operation ID {operation_id}"));
                }
                if method == "OPTIONS" {
                    methods = Some(preflight_methods(document, operation)?);
                    preflight = Some(operation_id);
                } else {
                    concrete.push(operation_id);
                }
            }
            if projected_paths
                .insert(
                    template.clone(),
                    ProfilePath {
                        parameter_schema: parameter_schema(document, template, path_item)?,
                        concrete_operations: concrete,
                        preflight_operation: preflight
                            .ok_or_else(|| format!("{template} lacks OPTIONS"))?,
                        preflight_methods: methods
                            .ok_or_else(|| format!("{template} lacks preflight methods"))?,
                    },
                )
                .is_some()
            {
                return Err(format!("duplicate path {template}"));
            }
        }
        if used_access != access_by_operation.keys().cloned().collect() {
            return Err("accessByOperation has missing or unused entries".to_owned());
        }
        let problem_enum = document["components"]["schemas"]["ProblemCode"]["enum"]
            .as_array()
            .ok_or_else(|| "ProblemCode enum is missing".to_owned())?
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| "ProblemCode enum contains non-string".to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(CompleteProjection {
            policy: Value::Object(raw_policy.clone()),
            problem_enum,
            paths: projected_paths,
            operations,
        })
    }

    fn profile_header(required: bool, condition: Option<&str>, schema: Value) -> ProfileHeader {
        ProfileHeader {
            required,
            condition: condition.map(str::to_owned),
            schema,
        }
    }

    fn schema_ref(name: &str) -> Value {
        json!({"kind": "schema-ref", "schema": name})
    }

    fn const_string(value: &str) -> Value {
        json!({"kind": "const-string", "value": value})
    }

    fn const_integer(value: u64) -> Value {
        json!({"kind": "const-integer", "value": value})
    }

    fn bounded_string(minimum: u64, maximum: u64) -> Value {
        json!({"kind": "bounded-string", "minimum": minimum, "maximum": maximum})
    }

    fn bounded_integer(minimum: u64, maximum: u64) -> Value {
        json!({"kind": "bounded-integer", "minimum": minimum, "maximum": maximum})
    }

    fn common_headers() -> BTreeMap<String, ProfileHeader> {
        BTreeMap::from([
            (
                "Cache-Control".to_owned(),
                profile_header(true, None, const_string("no-store")),
            ),
            (
                "X-Content-Type-Options".to_owned(),
                profile_header(true, None, const_string("nosniff")),
            ),
            (
                "X-Request-Id".to_owned(),
                profile_header(true, None, schema_ref("CanonicalUuid")),
            ),
        ])
    }

    fn actual_headers() -> BTreeMap<String, ProfileHeader> {
        let mut headers = common_headers();
        headers.insert(
            "Access-Control-Allow-Origin".to_owned(),
            profile_header(false, Some("validated-origin"), bounded_string(1, 256)),
        );
        headers.insert(
            "Access-Control-Expose-Headers".to_owned(),
            profile_header(
                false,
                Some("validated-origin"),
                const_string("ETag, Location, Retry-After, X-Request-Id"),
            ),
        );
        headers.insert(
            "Vary".to_owned(),
            profile_header(false, Some("validated-origin"), const_string("Origin")),
        );
        headers
    }

    fn allow_schema(operation: OperationId) -> Value {
        const_string(operation.contract().path.contract().allow().header_value())
    }

    fn expected_response_headers(
        operation: OperationId,
        status: u16,
    ) -> BTreeMap<String, ProfileHeader> {
        let preflight = operation.contract().method == Method::Options;
        let mut headers = if preflight {
            common_headers()
        } else {
            actual_headers()
        };
        if preflight {
            if status == 204 {
                headers.insert(
                    "Access-Control-Allow-Headers".to_owned(),
                    profile_header(
                        true,
                        None,
                        const_string("Authorization, Content-Type, X-OVP-Client-Version"),
                    ),
                );
                headers.insert(
                    "Access-Control-Allow-Methods".to_owned(),
                    profile_header(true, None, const_string("GET, POST, DELETE, OPTIONS")),
                );
                headers.insert(
                    "Access-Control-Allow-Origin".to_owned(),
                    profile_header(true, None, bounded_string(1, 256)),
                );
                headers.insert(
                    "Access-Control-Allow-Private-Network".to_owned(),
                    profile_header(
                        false,
                        Some("legacy-private-network-requested"),
                        const_string("true"),
                    ),
                );
                headers.insert(
                    "Access-Control-Max-Age".to_owned(),
                    profile_header(true, None, const_integer(600)),
                );
                headers.insert(
                    "Vary".to_owned(),
                    profile_header(
                        true,
                        None,
                        json!({
                            "kind": "enum-string",
                            "values": [
                                "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
                                "Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network"
                            ]
                        }),
                    ),
                );
            } else {
                headers.insert(
                    "Vary".to_owned(),
                    profile_header(
                        true,
                        None,
                        const_string(
                            "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
                        ),
                    ),
                );
                if status == 405 {
                    headers.insert(
                        "Allow".to_owned(),
                        profile_header(true, None, allow_schema(operation)),
                    );
                }
                if status == 503 {
                    headers.insert(
                        "Retry-After".to_owned(),
                        profile_header(true, None, bounded_integer(1, 3_600)),
                    );
                }
            }
            return headers;
        }

        if status == 401 {
            headers.insert(
                "WWW-Authenticate".to_owned(),
                profile_header(
                    true,
                    None,
                    const_string("Bearer realm=\"open-voice-companion\""),
                ),
            );
        }
        if status == 405 {
            headers.insert(
                "Allow".to_owned(),
                profile_header(true, None, allow_schema(operation)),
            );
        }
        if status == 429 {
            headers.insert(
                "Retry-After".to_owned(),
                profile_header(true, None, bounded_integer(1, 3_600)),
            );
        } else if status == 503 {
            headers.insert(
                "Retry-After".to_owned(),
                profile_header(false, Some("queue-full-problem"), bounded_integer(1, 3_600)),
            );
        }
        match (operation, status) {
            (OperationId::CreatePairingChallenge, 201)
            | (OperationId::CreateJob | OperationId::RequestPackAction, 202) => {
                headers.insert(
                    "Location".to_owned(),
                    profile_header(true, None, bounded_string(1, 256)),
                );
            }
            (OperationId::RedeemPairingChallenge, 202) => {
                headers.insert(
                    "Retry-After".to_owned(),
                    profile_header(true, None, bounded_integer(1, 3_600)),
                );
            }
            (
                OperationId::GetRuntime
                | OperationId::ListEngines
                | OperationId::ListVoices
                | OperationId::ListPacks
                | OperationId::GetJobAudio,
                200,
            ) => {
                headers.insert(
                    "ETag".to_owned(),
                    profile_header(true, None, bounded_string(3, 128)),
                );
            }
            _ => {}
        }
        headers
    }

    fn profile_access(operation: &crate::router::OperationContract) -> ProfileAccess {
        ProfileAccess {
            auth: match operation.access.auth {
                AuthClass::OriginOnly => "origin-only",
                AuthClass::Bearer => "bearer",
                AuthClass::Preflight => "preflight",
            }
            .to_owned(),
            scope: operation
                .access
                .scope
                .map(|scope| scope.as_str().to_owned()),
            ownership: match operation.access.ownership {
                OwnershipClass::None => "none",
                OwnershipClass::TokenSelf => "token-self",
                OwnershipClass::JobOwner => "job-owner",
            }
            .to_owned(),
        }
    }

    fn profile_request(request: RequestMessage) -> ProfileRequest {
        match request {
            RequestMessage::None => ProfileRequest::None,
            RequestMessage::Json {
                required,
                media_type,
                schema,
            } => ProfileRequest::Json {
                required,
                media_type: media_type.to_owned(),
                schema: schema.as_str().to_owned(),
            },
        }
    }

    fn profile_body(message: ResponseMessage) -> ProfileBody {
        match message.body {
            ResponseBody::Empty => ProfileBody::Empty,
            ResponseBody::Json { media_type, schema } => ProfileBody::Json {
                media_type: media_type.to_owned(),
                schema: schema.as_str().to_owned(),
            },
            ResponseBody::Audio {
                media_type,
                max_bytes,
            } => ProfileBody::Audio {
                media_type: media_type.to_owned(),
                max_bytes,
            },
        }
    }

    fn expected_policy() -> Value {
        let mut access = Map::new();
        for operation in OPERATION_CONTRACTS
            .iter()
            .filter(|operation| operation.method != Method::Options)
        {
            let projected = profile_access(operation);
            access.insert(
                operation.operation_id.to_owned(),
                json!({
                    "auth": projected.auth,
                    "scope": projected.scope,
                    "ownership": projected.ownership,
                }),
            );
        }
        let http = ALL_PROBLEM_CODES
            .iter()
            .filter(|code| code.catalog().classification() == ProblemClassification::Http)
            .map(|code| Value::String(code.as_str().to_owned()))
            .collect::<Vec<_>>();
        let non_http = ALL_PROBLEM_CODES
            .iter()
            .filter(|code| code.catalog().classification() != ProblemClassification::Http)
            .map(|code| Value::String(code.as_str().to_owned()))
            .collect::<Vec<_>>();
        let unknown = resolve_route("GET", "/v1/not-a-route").unwrap_err();
        json!({
            "version": 1,
            "allowedOriginSource": "compiled-exact-allowlist",
            "credentials": "prohibited",
            "actual": {
                "allowOrigin": "validated-origin",
                "exposeHeaders": ["ETag", "Location", "Retry-After", "X-Request-Id"],
                "vary": ["Origin"]
            },
            "preflight": {
                "allowMethods": GLOBAL_METHODS.iter().map(|method| method.as_str()).collect::<Vec<_>>(),
                "allowHeaders": PREFLIGHT_ALLOWED_HEADERS.iter().map(|header| header.as_str()).collect::<Vec<_>>(),
                "maxAgeSeconds": 600,
                "requestedHeaderComparison": "ascii-case-insensitive-exact-set",
                "requiresDeclaredConcreteTarget": true,
                "rejectsBody": true,
                "rejectsCredentials": true,
                "rejectsOptionsTarget": true,
                "failureMap": {
                    "admission-overload": {"status": 503, "code": "queue-full"},
                    "denied-origin": {"status": 403, "code": "origin-denied"},
                    "duplicate-preflight-header": {"status": 400, "code": "duplicate-header"},
                    "header-timeout": {"status": 408, "code": "header-timeout"},
                    "headers-too-large": {"status": 431, "code": "headers-too-large"},
                    "invalid-preflight-shape": {"status": 400, "code": "schema-invalid"},
                    "missing-origin": {"status": 400, "code": "origin-missing"},
                    "oversize-body": {"status": 413, "code": "body-too-large"},
                    "request-line-too-large": {"status": 414, "code": "request-line-too-large"},
                    "unsupported-route-method": {"status": 405, "code": "method-not-allowed"}
                },
                "legacyPrivateNetwork": {
                    "requestHeader": "Access-Control-Request-Private-Network",
                    "requestValue": "true",
                    "responseHeader": "Access-Control-Allow-Private-Network",
                    "responseValue": "true",
                    "varyToken": "Access-Control-Request-Private-Network",
                    "emitIffRequested": true
                }
            },
            "unknownRoute": {
                "status": unknown.problem_code().status(),
                "code": unknown.problem_code().as_str()
            },
            "retryAfter": {
                "kind": "delay-seconds",
                "minimum": RetryAfterSeconds::new(1).unwrap().get(),
                "maximum": RetryAfterSeconds::new(3_600).unwrap().get(),
                "httpDateAllowed": false,
                "queueFullProblemCode": ProblemCode::QueueFull.as_str(),
                "queueFullResponseCondition": "queue-full-problem"
            },
            "problemCodes": {"http": http, "nonHttp": non_http},
            "accessByOperation": Value::Object(access)
        })
    }

    fn rust_projection() -> Result<CompleteProjection, String> {
        let mut paths = BTreeMap::new();
        for path in &PATH_CONTRACTS {
            if paths
                .insert(
                    path.template.to_owned(),
                    ProfilePath {
                        parameter_schema: match path.parameter {
                            PathParameterKind::None => None,
                            PathParameterKind::CanonicalUuid => Some("CanonicalUuid".to_owned()),
                            PathParameterKind::PackId => Some("PackId".to_owned()),
                        },
                        concrete_operations: path
                            .concrete_operations
                            .iter()
                            .map(|operation| operation.as_str().to_owned())
                            .collect(),
                        preflight_operation: path.preflight_operation.as_str().to_owned(),
                        preflight_methods: path
                            .allow()
                            .methods()
                            .iter()
                            .map(|method| method.as_str().to_owned())
                            .collect(),
                    },
                )
                .is_some()
            {
                return Err(format!("duplicate Rust path {}", path.template));
            }
        }
        let mut operations = BTreeMap::new();
        for operation in &OPERATION_CONTRACTS {
            if operation.messages.operation_id != operation.operation_id {
                return Err(format!(
                    "{} references message descriptor {}",
                    operation.operation_id, operation.messages.operation_id
                ));
            }
            let mut responses = BTreeMap::new();
            for response in operation.messages.responses {
                if responses
                    .insert(
                        response.status,
                        ProfileResponse {
                            body: profile_body(*response),
                            headers: expected_response_headers(operation.id, response.status),
                        },
                    )
                    .is_some()
                {
                    return Err(format!(
                        "{} duplicates Rust status {}",
                        operation.operation_id, response.status
                    ));
                }
            }
            if operations
                .insert(
                    operation.operation_id.to_owned(),
                    ProfileOperation {
                        path: operation.path.contract().template.to_owned(),
                        method: operation.method.as_str().to_owned(),
                        access: profile_access(operation),
                        request: profile_request(operation.messages.request),
                        responses,
                    },
                )
                .is_some()
            {
                return Err(format!(
                    "duplicate Rust operation {}",
                    operation.operation_id
                ));
            }
        }
        let problem_enum = ALL_PROBLEM_CODES
            .iter()
            .map(|code| code.as_str().to_owned())
            .collect();
        Ok(CompleteProjection {
            policy: expected_policy(),
            problem_enum,
            paths,
            operations,
        })
    }

    fn decode<T: DeserializeOwned>(value: Value) -> T {
        serde_json::from_value(value).expect("checked factory fixture")
    }

    fn pairing_fixture() -> PairingResponse {
        decode(json!({
            "id": "55555555-5555-4555-8555-555555555555",
            "clientLabel": "response factory",
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

    fn job_fixture() -> JobResponse {
        decode(json!({
            "id": "66666666-6666-4666-8666-666666666666",
            "voiceId": "pocket:alba",
            "state": "queued",
            "audioAvailable": false,
            "createdAt": "2026-01-02T03:04:05Z"
        }))
    }

    fn etag(value: &str) -> EntityTag {
        EntityTag::new(value.to_owned()).unwrap()
    }

    fn location(value: &str) -> ResponseLocation {
        ResponseLocation::new(value.to_owned()).unwrap()
    }

    fn success_fixture(operation: OperationId, status: u16) -> Option<HandlerSuccess> {
        match operation {
            OperationId::GetHealth => {
                assert_eq!(status, 200);
                Some(HandlerSuccess::Health(HealthResponse::listening()))
            }
            OperationId::CreatePairingChallenge => {
                assert_eq!(status, 201);
                Some(HandlerSuccess::PairingChallengeCreated {
                    body: decode::<PairingChallengeResponse>(json!({
                        "id": "11111111-1111-4111-8111-111111111111",
                        "state": "pending",
                        "expiresAt": "2026-01-02T03:06:05Z"
                    })),
                    location: location("/v1/pairings/challenges/opaque"),
                })
            }
            OperationId::RedeemPairingChallenge => match status {
                200 => Some(HandlerSuccess::RedeemComplete(decode::<RedeemResponse>(
                    json!({
                        "token": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                        "pairing": {
                            "id": "55555555-5555-4555-8555-555555555555",
                            "clientLabel": "response factory",
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
                    }),
                ))),
                202 => Some(HandlerSuccess::RedeemPending {
                    retry_after: RetryAfterSeconds::new(1).unwrap(),
                }),
                _ => panic!("unexpected redeem success status {status}"),
            },
            OperationId::GetCurrentPairing => {
                assert_eq!(status, 200);
                Some(HandlerSuccess::CurrentPairing(pairing_fixture()))
            }
            OperationId::RevokeCurrentPairing => {
                assert_eq!(status, 204);
                Some(HandlerSuccess::PairingRevoked)
            }
            OperationId::GetRuntime => {
                assert_eq!(status, 200);
                Some(HandlerSuccess::Runtime {
                    body: RuntimeResponse::non_operational(),
                    etag: etag("\"runtime-v1\""),
                })
            }
            OperationId::ListEngines => {
                assert_eq!(status, 200);
                Some(HandlerSuccess::Engines {
                    body: EngineListResponse::non_operational(),
                    etag: etag("\"engines-v1\""),
                })
            }
            OperationId::ListVoices => {
                assert_eq!(status, 200);
                Some(HandlerSuccess::Voices {
                    body: VoiceListResponse::non_operational(),
                    etag: etag("\"voices-v1\""),
                })
            }
            OperationId::ListPacks => {
                assert_eq!(status, 200);
                Some(HandlerSuccess::Packs {
                    body: PackListResponse::non_operational(),
                    etag: etag("\"packs-v1\""),
                })
            }
            OperationId::CreateJob => {
                assert_eq!(status, 202);
                Some(HandlerSuccess::JobCreated {
                    body: job_fixture(),
                    location: location("/v1/jobs/opaque"),
                })
            }
            OperationId::GetJob => {
                assert_eq!(status, 200);
                Some(HandlerSuccess::Job(job_fixture()))
            }
            OperationId::CancelJob => {
                assert_eq!(status, 202);
                Some(HandlerSuccess::JobCancellationAccepted(job_fixture()))
            }
            OperationId::GetJobAudio => {
                assert_eq!(status, 200);
                Some(HandlerSuccess::JobAudio {
                    body: WavBody::new(vec![0, 0xff, b'R', b'I', b'F', b'F']).unwrap(),
                    etag: etag("\"audio-v1\""),
                })
            }
            OperationId::RequestPackAction => {
                assert_eq!(status, 202);
                Some(HandlerSuccess::PackActionAccepted {
                    body: PackActionResponse::pending(
                        uuid::Uuid::from_u128(0x7777).into(),
                        PackAction::Install,
                    ),
                    location: location("/v1/pack-actions/opaque"),
                })
            }
            OperationId::PreflightHealth
            | OperationId::PreflightPairingChallenges
            | OperationId::PreflightPairingChallengeRedeem
            | OperationId::PreflightCurrentPairing
            | OperationId::PreflightRuntime
            | OperationId::PreflightEngines
            | OperationId::PreflightVoices
            | OperationId::PreflightPacks
            | OperationId::PreflightJobs
            | OperationId::PreflightJob
            | OperationId::PreflightJobAudio
            | OperationId::PreflightPackActions => None,
        }
    }

    fn problem_for_status(status: u16) -> ProblemCode {
        match status {
            400 => ProblemCode::SchemaInvalid,
            401 => ProblemCode::AuthMissing,
            403 => ProblemCode::OriginDenied,
            404 => ProblemCode::ResourceNotFound,
            405 => ProblemCode::MethodNotAllowed,
            408 => ProblemCode::BodyTimeout,
            409 => ProblemCode::Conflict,
            410 => ProblemCode::PairingExpired,
            413 => ProblemCode::BodyTooLarge,
            414 => ProblemCode::RequestLineTooLarge,
            415 => ProblemCode::ContentTypeUnsupported,
            426 => ProblemCode::VersionUnsupported,
            429 => ProblemCode::RateLimited,
            431 => ProblemCode::HeadersTooLarge,
            503 => ProblemCode::QueueFull,
            504 => ProblemCode::HandlerTimeout,
            _ => panic!("no checked HTTP Problem fixture for {status}"),
        }
    }

    fn exemplar_target(template: &str) -> String {
        if template.contains("/packs/{id}/") {
            template.replace("{id}", "pocket-companion-pack")
        } else {
            template.replace("{id}", "11111111-1111-4111-8111-111111111111")
        }
    }

    fn project_prepared(
        response: PreparedResponse,
        operation: OperationId,
        expected_body: &ProfileBody,
    ) -> ProfileResponse {
        assert!(response.request_id.get_version_num() == 4);
        let body = match (response.body, expected_body) {
            (PreparedBody::Empty, ProfileBody::Empty) => {
                assert_eq!(response.content_type, None);
                ProfileBody::Empty
            }
            (PreparedBody::Json(bytes), ProfileBody::Json { media_type, schema }) => {
                assert_eq!(response.content_type, Some(media_type.as_str()));
                let _: Value = serde_json::from_slice(&bytes).unwrap();
                ProfileBody::Json {
                    media_type: media_type.clone(),
                    schema: schema.clone(),
                }
            }
            (
                PreparedBody::Audio(bytes),
                ProfileBody::Audio {
                    media_type,
                    max_bytes,
                },
            ) => {
                assert_eq!(response.content_type, Some(media_type.as_str()));
                assert!(bytes.len() as u64 <= *max_bytes);
                ProfileBody::Audio {
                    media_type: media_type.clone(),
                    max_bytes: *max_bytes,
                }
            }
            _ => panic!("factory body kind did not match {operation:?}"),
        };

        let mut headers = common_headers();
        if let Some(preflight) = response.preflight_allow {
            assert!(response.allow_origin.is_some());
            assert!(!response.expose_headers);
            headers.insert(
                "Access-Control-Allow-Headers".to_owned(),
                profile_header(
                    true,
                    None,
                    const_string("Authorization, Content-Type, X-OVP-Client-Version"),
                ),
            );
            headers.insert(
                "Access-Control-Allow-Methods".to_owned(),
                profile_header(true, None, const_string("GET, POST, DELETE, OPTIONS")),
            );
            headers.insert(
                "Access-Control-Allow-Origin".to_owned(),
                profile_header(true, None, bounded_string(1, 256)),
            );
            headers.insert(
                "Access-Control-Allow-Private-Network".to_owned(),
                profile_header(
                    false,
                    Some("legacy-private-network-requested"),
                    const_string("true"),
                ),
            );
            assert!(preflight.legacy_private_network);
            headers.insert(
                "Access-Control-Max-Age".to_owned(),
                profile_header(true, None, const_integer(600)),
            );
            headers.insert(
                "Vary".to_owned(),
                profile_header(
                    true,
                    None,
                    json!({
                        "kind": "enum-string",
                        "values": [
                            "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
                            "Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network"
                        ]
                    }),
                ),
            );
        } else if response.allow_origin.is_some() {
            assert!(response.expose_headers);
            headers.extend(actual_headers());
            assert_eq!(response.vary, VaryProfile::ActualOrigin);
        } else if response.vary == VaryProfile::PreflightBase {
            assert!(!response.expose_headers);
            headers.insert(
                "Vary".to_owned(),
                profile_header(
                    true,
                    None,
                    const_string(
                        "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
                    ),
                ),
            );
        } else {
            assert_eq!(response.vary, VaryProfile::None);
        }
        if let Some(allow) = response.allow {
            headers.insert(
                "Allow".to_owned(),
                profile_header(true, None, const_string(allow.header_value())),
            );
        }
        if response.www_authenticate {
            headers.insert(
                "WWW-Authenticate".to_owned(),
                profile_header(
                    true,
                    None,
                    const_string("Bearer realm=\"open-voice-companion\""),
                ),
            );
        }
        if response.retry_after.is_some() {
            let preflight_failure = operation.contract().method == Method::Options
                && response.preflight_allow.is_none();
            let conditional =
                response.status == WireStatus::ServiceUnavailable && !preflight_failure;
            headers.insert(
                "Retry-After".to_owned(),
                profile_header(
                    !conditional,
                    conditional.then_some("queue-full-problem"),
                    bounded_integer(1, 3_600),
                ),
            );
        }
        if response.etag.is_some() {
            headers.insert(
                "ETag".to_owned(),
                profile_header(true, None, bounded_string(3, 128)),
            );
        }
        if response.location.is_some() {
            headers.insert(
                "Location".to_owned(),
                profile_header(true, None, bounded_string(1, 256)),
            );
        }
        ProfileResponse { body, headers }
    }

    fn factory_projection() -> Result<CompleteProjection, String> {
        let factory = ResponseFactory::new(Arc::new(OpenApiSchemas::embedded().unwrap()));
        let origin = ValidatedOrigin::from_allowed("http://127.0.0.1:5173".to_owned());
        let mut projection = rust_projection()?;
        for operation in &OPERATION_CONTRACTS {
            let target = exemplar_target(operation.path.contract().template);
            let mut responses = BTreeMap::new();
            match resolve_route(operation.method.as_str(), &target)
                .map_err(|error| error.to_string())?
            {
                RouteMatch::Concrete(route) => {
                    if route.operation() != operation.id {
                        return Err(format!(
                            "{} resolved to the wrong route",
                            operation.operation_id
                        ));
                    }
                    for descriptor in operation.messages.responses {
                        let prepared = if (200..300).contains(&descriptor.status) {
                            let success = success_fixture(operation.id, descriptor.status)
                                .ok_or_else(|| {
                                    format!(
                                        "{} lacks a success fixture for {}",
                                        operation.operation_id, descriptor.status
                                    )
                                })?;
                            factory
                                .success(&origin, &route, success)
                                .map_err(|error| error.to_string())?
                        } else {
                            let code = problem_for_status(descriptor.status);
                            let allow = (descriptor.status == 405)
                                .then(|| operation.path.contract().allow());
                            let retry = matches!(descriptor.status, 429 | 503)
                                .then(|| RetryAfterSeconds::new(1).unwrap());
                            factory
                                .actual_problem(
                                    Some(&origin),
                                    Some(operation.id),
                                    allow,
                                    code,
                                    retry,
                                )
                                .map_err(|error| error.to_string())?
                        };
                        assert_eq!(prepared.status.code(), descriptor.status);
                        responses.insert(
                            descriptor.status,
                            project_prepared(prepared, operation.id, &profile_body(*descriptor)),
                        );
                    }
                }
                RouteMatch::Preflight(route) => {
                    if route.operation() != operation.id {
                        return Err(format!(
                            "{} resolved to the wrong preflight",
                            operation.operation_id
                        ));
                    }
                    let concrete = operation
                        .path
                        .contract()
                        .concrete_operations
                        .first()
                        .ok_or_else(|| "preflight path lacks a concrete operation".to_owned())?;
                    let target = route
                        .resolve_requested_method(concrete.contract().method.as_str())
                        .map_err(|error| error.to_string())?;
                    for descriptor in operation.messages.responses {
                        let prepared = if descriptor.status == 204 {
                            factory
                                .preflight_success(&origin, &route, &target, true)
                                .map_err(|error| error.to_string())?
                        } else {
                            let code = problem_for_status(descriptor.status);
                            let allow = (descriptor.status == 405)
                                .then(|| operation.path.contract().allow());
                            let retry = (descriptor.status == 503)
                                .then(|| RetryAfterSeconds::new(1).unwrap());
                            factory
                                .preflight_problem(Some(operation.id), allow, code, retry)
                                .map_err(|error| error.to_string())?
                        };
                        assert_eq!(prepared.status.code(), descriptor.status);
                        responses.insert(
                            descriptor.status,
                            project_prepared(prepared, operation.id, &profile_body(*descriptor)),
                        );
                    }
                }
            }
            projection
                .operations
                .get_mut(operation.operation_id)
                .unwrap()
                .responses = responses;
        }
        Ok(projection)
    }

    #[test]
    fn factory_complete_openapi_c7_c5_projection_is_exact_and_exhaustive() {
        let document: Value = yaml_serde::from_str(OPENAPI).unwrap();
        let openapi = extract_openapi(&document).unwrap();
        let rust = rust_projection().unwrap();
        let factory = factory_projection().unwrap();
        assert_eq!(openapi, rust);
        assert_eq!(factory, rust);

        assert_eq!(rust.paths.len(), 12);
        assert_eq!(rust.operations.len(), 26);
        assert_eq!(
            rust.paths
                .values()
                .map(|path| path.concrete_operations.len())
                .sum::<usize>(),
            14
        );
        assert_eq!(
            rust.operations
                .values()
                .filter(|operation| operation.method == "OPTIONS")
                .count(),
            12
        );
        let route_ids = OPERATION_CONTRACTS
            .iter()
            .map(|operation| operation.operation_id)
            .collect::<BTreeSet<_>>();
        let message_ids = OPERATION_MESSAGE_CONTRACTS
            .iter()
            .map(|operation| operation.operation_id)
            .collect::<BTreeSet<_>>();
        let projected_ids = rust
            .operations
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        assert_eq!(route_ids.len(), OPERATION_CONTRACTS.len());
        assert_eq!(message_ids.len(), OPERATION_MESSAGE_CONTRACTS.len());
        assert_eq!(route_ids, message_ids);
        assert_eq!(route_ids, projected_ids);
    }

    fn operation_mut<'a>(
        document: &'a mut Value,
        operation_id: &str,
    ) -> &'a mut Map<String, Value> {
        for path in document["paths"].as_object_mut().unwrap().values_mut() {
            for (key, operation) in path.as_object_mut().unwrap() {
                if key != "parameters"
                    && operation.get("operationId").and_then(Value::as_str) == Some(operation_id)
                {
                    return operation.as_object_mut().unwrap();
                }
            }
        }
        panic!("missing operation {operation_id}")
    }

    fn response_mut<'a>(
        document: &'a mut Value,
        operation_id: &str,
        status: &str,
    ) -> &'a mut Map<String, Value> {
        let reference = operation_mut(document, operation_id)["responses"][status]["$ref"]
            .as_str()
            .unwrap()
            .strip_prefix("#/components/responses/")
            .unwrap()
            .to_owned();
        document["components"]["responses"][reference]
            .as_object_mut()
            .unwrap()
    }

    fn assert_projection_mutation(
        label: &str,
        expected: &CompleteProjection,
        mutator: impl FnOnce(&mut Value),
    ) {
        let mut document: Value = yaml_serde::from_str(OPENAPI).unwrap();
        mutator(&mut document);
        let actual = extract_openapi(&document);
        assert_ne!(
            actual.as_ref().ok(),
            Some(expected),
            "contract mutation escaped: {label}"
        );
    }

    #[test]
    fn every_c8_projection_mutation_family_fails_closed() {
        let expected = rust_projection().unwrap();

        assert_projection_mutation("request schema", &expected, |document| {
            operation_mut(document, "createJob")["requestBody"]["content"]["application/json"]["schema"]
                ["$ref"] = Value::String("#/components/schemas/RedeemRequest".to_owned());
        });
        assert_projection_mutation("request media", &expected, |document| {
            let content = operation_mut(document, "createJob")["requestBody"]["content"]
                .as_object_mut()
                .unwrap();
            let descriptor = content.remove("application/json").unwrap();
            content.insert("text/json".to_owned(), descriptor);
        });
        assert_projection_mutation("request requiredness", &expected, |document| {
            operation_mut(document, "createJob")["requestBody"]["required"] = Value::Bool(false);
        });
        assert_projection_mutation("bodyless operation gains body", &expected, |document| {
            let body = operation_mut(document, "createJob")["requestBody"].clone();
            operation_mut(document, "getHealth").insert("requestBody".to_owned(), body);
        });
        assert_projection_mutation("body operation loses body", &expected, |document| {
            operation_mut(document, "createJob").remove("requestBody");
        });
        assert_projection_mutation("access auth", &expected, |document| {
            document["x-ovp-http-policy"]["accessByOperation"]["getRuntime"]["auth"] =
                Value::String("origin-only".to_owned());
        });
        assert_projection_mutation("access scope", &expected, |document| {
            document["x-ovp-http-policy"]["accessByOperation"]["getRuntime"]["scope"] =
                Value::String("jobs:read".to_owned());
        });
        assert_projection_mutation("access ownership", &expected, |document| {
            document["x-ovp-http-policy"]["accessByOperation"]["getRuntime"]["ownership"] =
                Value::String("job-owner".to_owned());
        });
        assert_projection_mutation("operation identity", &expected, |document| {
            operation_mut(document, "getHealth")["operationId"] =
                Value::String("getHealthV2".to_owned());
        });
        assert_projection_mutation("response status", &expected, |document| {
            let response = operation_mut(document, "getHealth")["responses"]
                .as_object_mut()
                .unwrap()
                .remove("200")
                .unwrap();
            operation_mut(document, "getHealth")["responses"]
                .as_object_mut()
                .unwrap()
                .insert("201".to_owned(), response);
        });
        assert_projection_mutation("response body", &expected, |document| {
            response_mut(document, "getHealth", "200").remove("content");
        });
        assert_projection_mutation("response media", &expected, |document| {
            let content = response_mut(document, "getHealth", "200")["content"]
                .as_object_mut()
                .unwrap();
            let descriptor = content.remove("application/json").unwrap();
            content.insert("text/json".to_owned(), descriptor);
        });
        assert_projection_mutation("response schema", &expected, |document| {
            response_mut(document, "getHealth", "200")["content"]["application/json"]["schema"]["$ref"] =
                Value::String("#/components/schemas/RuntimeResponse".to_owned());
        });
        assert_projection_mutation("WAV cap", &expected, |document| {
            response_mut(document, "getJobAudio", "200")["content"]["audio/wav"]["x-maxBodyBytes"] =
                Value::from(67_108_863_u64);
        });
        assert_projection_mutation("common header", &expected, |document| {
            response_mut(document, "getHealth", "200")["headers"]
                .as_object_mut()
                .unwrap()
                .remove("Cache-Control");
        });
        assert_projection_mutation("actual header", &expected, |document| {
            response_mut(document, "getHealth", "200")["headers"]
                .as_object_mut()
                .unwrap()
                .remove("Access-Control-Allow-Origin");
        });
        assert_projection_mutation("preflight header", &expected, |document| {
            response_mut(document, "preflightHealth", "204")["headers"]
                .as_object_mut()
                .unwrap()
                .remove("Access-Control-Allow-Methods");
        });
        assert_projection_mutation("header required marker", &expected, |document| {
            document["components"]["headers"]["NoStore"]["required"] = Value::Bool(false);
        });
        assert_projection_mutation("header conditional marker", &expected, |document| {
            document["components"]["headers"]["ActualVary"]["x-ovp-condition"] =
                Value::String("queue-full-problem".to_owned());
        });
        assert_projection_mutation("Allow", &expected, |document| {
            document["components"]["headers"]["AllowGet"]["schema"]["const"] =
                Value::String("POST, OPTIONS".to_owned());
        });
        assert_projection_mutation("WWW", &expected, |document| {
            document["components"]["headers"]["WWWAuthenticate"]["schema"]["const"] =
                Value::String("Bearer".to_owned());
        });
        assert_projection_mutation("Retry bounds", &expected, |document| {
            document["components"]["headers"]["RetryAfter"]["schema"]["minimum"] =
                Value::from(2_u64);
        });
        assert_projection_mutation("Retry code condition", &expected, |document| {
            document["x-ovp-http-policy"]["retryAfter"]["queueFullProblemCode"] =
                Value::String("runtime-unavailable".to_owned());
        });
        assert_projection_mutation("Retry header condition", &expected, |document| {
            document["components"]["headers"]["ConditionalRetryAfter"]["x-ovp-condition"] =
                Value::String("validated-origin".to_owned());
        });
        assert_projection_mutation("Location operation", &expected, |document| {
            response_mut(document, "getJob", "200")["headers"]
                .as_object_mut()
                .unwrap()
                .insert(
                    "Location".to_owned(),
                    json!({"$ref": "#/components/headers/Location"}),
                );
        });
        assert_projection_mutation("ETag operation", &expected, |document| {
            response_mut(document, "getHealth", "200")["headers"]
                .as_object_mut()
                .unwrap()
                .insert(
                    "ETag".to_owned(),
                    json!({"$ref": "#/components/headers/ETag"}),
                );
        });
        assert_projection_mutation("CORS policy", &expected, |document| {
            document["x-ovp-http-policy"]["actual"]["allowOrigin"] =
                Value::String("wildcard".to_owned());
        });
        assert_projection_mutation("LNA policy", &expected, |document| {
            document["x-ovp-http-policy"]["preflight"]["legacyPrivateNetwork"]["emitIffRequested"] =
                Value::Bool(false);
        });
        assert_projection_mutation("HTTP Problem partition", &expected, |document| {
            document["x-ovp-http-policy"]["problemCodes"]["http"]
                .as_array_mut()
                .unwrap()
                .push(Value::String("listener-conflict".to_owned()));
        });
        assert_projection_mutation("non-HTTP Problem partition", &expected, |document| {
            document["x-ovp-http-policy"]["problemCodes"]["nonHttp"] = json!([]);
        });
        assert_projection_mutation("unknown route", &expected, |document| {
            document["x-ovp-http-policy"]["unknownRoute"]["status"] = Value::from(400_u16);
        });
    }

    #[test]
    fn factory_projects_checked_health_and_rejects_a_wrong_success_variant() {
        let factory = ResponseFactory::new(Arc::new(OpenApiSchemas::embedded().unwrap()));
        let origin = ValidatedOrigin::from_allowed("http://127.0.0.1:5173".to_owned());
        let RouteMatch::Concrete(route) = resolve_route("GET", "/v1/health").unwrap() else {
            panic!("health is concrete")
        };
        let response = factory
            .success(
                &origin,
                &route,
                HandlerSuccess::Health(HealthResponse::listening()),
            )
            .unwrap();
        assert_eq!(response.status, WireStatus::Ok);
        assert_eq!(response.content_type, Some("application/json"));
        assert_eq!(response.allow_origin.as_deref(), Some(origin.as_str()));
        assert_eq!(response.vary, VaryProfile::ActualOrigin);

        let wrong = HandlerSuccess::PairingRevoked;
        assert_eq!(
            factory.success(&origin, &route, wrong).err(),
            Some(ResponseFactoryError::BodyMismatch)
        );

        assert_eq!(
            ResponseLocation::new("/v1/jobs/opaque".to_owned())
                .unwrap()
                .as_str(),
            "/v1/jobs/opaque"
        );
    }

    #[test]
    fn factory_accepts_all_http_problems_and_rejects_non_http_or_undeclared_statuses() {
        let factory = ResponseFactory::new(Arc::new(OpenApiSchemas::embedded().unwrap()));
        for code in HTTP_PROBLEM_CODES {
            let allow = (code == ProblemCode::MethodNotAllowed).then_some(AllowSet::Get);
            let retry_after = matches!(code, ProblemCode::RateLimited | ProblemCode::QueueFull)
                .then(|| RetryAfterSeconds::new(1).unwrap());
            let response = factory
                .actual_problem(None, None, allow, code, retry_after)
                .unwrap_or_else(|error| panic!("{} failed: {error}", code.as_str()));
            assert_eq!(response.status.code(), code.status());
            assert_eq!(response.www_authenticate, code.status() == 401);
            assert_eq!(response.allow.is_some(), code.status() == 405);
            assert_eq!(
                response.retry_after.is_some(),
                matches!(code, ProblemCode::RateLimited | ProblemCode::QueueFull)
            );
            let PreparedBody::Json(bytes) = response.body else {
                panic!("Problem must be JSON")
            };
            let value: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(value["code"], code.as_str());
            assert_eq!(value["status"], code.status());
        }

        assert_eq!(
            factory
                .actual_problem(None, None, None, ProblemCode::ListenerConflict, None)
                .err(),
            Some(ResponseFactoryError::NonHttpProblem)
        );
        assert_eq!(
            factory
                .actual_problem(
                    None,
                    Some(OperationId::GetHealth),
                    None,
                    ProblemCode::ResourceNotFound,
                    None,
                )
                .err(),
            Some(ResponseFactoryError::UndeclaredStatus)
        );
        assert_eq!(
            factory
                .actual_problem(
                    None,
                    Some(OperationId::PreflightHealth),
                    None,
                    ProblemCode::RuntimeUnavailable,
                    None,
                )
                .err(),
            Some(ResponseFactoryError::BodyMismatch)
        );
        assert_eq!(
            factory
                .preflight_problem(
                    Some(OperationId::GetHealth),
                    None,
                    ProblemCode::RuntimeUnavailable,
                    None,
                )
                .err(),
            Some(ResponseFactoryError::BodyMismatch)
        );
    }

    #[test]
    fn factory_enforces_every_conditional_problem_header() {
        let factory = ResponseFactory::new(Arc::new(OpenApiSchemas::embedded().unwrap()));
        let one = RetryAfterSeconds::new(1).unwrap();
        for (code, allow, retry_after) in [
            (ProblemCode::MethodNotAllowed, None, None),
            (ProblemCode::RuntimeUnavailable, Some(AllowSet::Get), None),
            (ProblemCode::RateLimited, None, None),
            (ProblemCode::QueueFull, None, None),
            (ProblemCode::RuntimeUnavailable, None, Some(one)),
            (ProblemCode::PackUnverified, None, Some(one)),
        ] {
            assert_eq!(
                factory
                    .actual_problem(None, None, allow, code, retry_after)
                    .err(),
                Some(ResponseFactoryError::MetadataMismatch),
                "{} metadata",
                code.as_str()
            );
        }
    }

    #[test]
    fn every_concrete_operation_rejects_a_wrong_handler_success() {
        let factory = ResponseFactory::new(Arc::new(OpenApiSchemas::embedded().unwrap()));
        let origin = ValidatedOrigin::from_allowed("http://127.0.0.1:5173".to_owned());
        let routes = [
            ("GET", "/v1/health"),
            ("POST", "/v1/pairings/challenges"),
            (
                "POST",
                "/v1/pairings/challenges/11111111-1111-4111-8111-111111111111/redeem",
            ),
            ("GET", "/v1/pairings/current"),
            ("DELETE", "/v1/pairings/current"),
            ("GET", "/v1/runtime"),
            ("GET", "/v1/engines"),
            ("GET", "/v1/voices"),
            ("GET", "/v1/packs"),
            ("POST", "/v1/jobs"),
            ("GET", "/v1/jobs/22222222-2222-4222-8222-222222222222"),
            ("DELETE", "/v1/jobs/33333333-3333-4333-8333-333333333333"),
            ("GET", "/v1/jobs/44444444-4444-4444-8444-444444444444/audio"),
            ("POST", "/v1/packs/pocket-companion-pack/actions"),
        ];
        for (method, path) in routes {
            let RouteMatch::Concrete(route) = resolve_route(method, path).unwrap() else {
                panic!("concrete fixture")
            };
            let wrong = if route.operation() == OperationId::GetHealth {
                HandlerSuccess::PairingRevoked
            } else {
                HandlerSuccess::Health(HealthResponse::listening())
            };
            assert_eq!(
                factory.success(&origin, &route, wrong).err(),
                Some(ResponseFactoryError::BodyMismatch),
                "{}",
                route.operation().as_str()
            );
        }
    }
}
