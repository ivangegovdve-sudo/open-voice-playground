use serde::{Deserialize, Deserializer, Serialize, Serializer, ser::SerializeStruct};
use uuid::Uuid;

use super::CanonicalUuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProblemClassification {
    Http,
    NonHttp,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProblemCatalogEntry {
    code: ProblemCode,
    code_text: &'static str,
    problem_type: &'static str,
    title: &'static str,
    status: u16,
    detail: &'static str,
    classification: ProblemClassification,
}

impl ProblemCatalogEntry {
    pub const fn code(self) -> ProblemCode {
        self.code
    }

    pub const fn code_text(self) -> &'static str {
        self.code_text
    }

    pub const fn problem_type(self) -> &'static str {
        self.problem_type
    }

    pub const fn title(self) -> &'static str {
        self.title
    }

    pub const fn status(self) -> u16 {
        self.status
    }

    pub const fn detail(self) -> &'static str {
        self.detail
    }

    pub const fn classification(self) -> ProblemClassification {
        self.classification
    }
}

macro_rules! problem_catalog {
    ($(
        $variant:ident => {
            code: $code:literal,
            title: $title:literal,
            status: $status:literal,
            detail: $detail:literal,
            class: $class:ident
        }
    ),+ $(,)?) => {
        #[repr(u8)]
        #[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
        #[serde(rename_all = "kebab-case")]
        pub enum ProblemCode {
            $($variant),+
        }

        pub const ALL_PROBLEM_CODES: [ProblemCode; 35] = [$(ProblemCode::$variant),+];

        const PROBLEM_CATALOG: [ProblemCatalogEntry; 35] = [$(
            ProblemCatalogEntry {
                code: ProblemCode::$variant,
                code_text: $code,
                problem_type: concat!("urn:ovp:problem:", $code),
                title: $title,
                status: $status,
                detail: $detail,
                classification: ProblemClassification::$class,
            }
        ),+];

        impl ProblemCode {
            pub const fn catalog(self) -> &'static ProblemCatalogEntry {
                &PROBLEM_CATALOG[self as usize]
            }

            pub const fn as_str(self) -> &'static str {
                self.catalog().code_text
            }

            pub const fn status(self) -> u16 {
                self.catalog().status
            }
        }
    };
}

problem_catalog! {
    HostInvalid => {
        code: "host-invalid",
        title: "Request rejected",
        status: 400,
        detail: "The request Host is not the companion loopback authority.",
        class: Http
    },
    OriginMissing => {
        code: "origin-missing",
        title: "Request rejected",
        status: 400,
        detail: "The Origin header is required.",
        class: Http
    },
    OriginDenied => {
        code: "origin-denied",
        title: "Origin denied",
        status: 403,
        detail: "The requesting origin is not allowed.",
        class: Http
    },
    VersionMissing => {
        code: "version-missing",
        title: "Request rejected",
        status: 400,
        detail: "The client version header is required.",
        class: Http
    },
    VersionUnsupported => {
        code: "version-unsupported",
        title: "Request rejected",
        status: 426,
        detail: "The client protocol major is not supported.",
        class: Http
    },
    AuthMissing => {
        code: "auth-missing",
        title: "Authentication failed",
        status: 401,
        detail: "A bearer token is required.",
        class: Http
    },
    AuthInvalid => {
        code: "auth-invalid",
        title: "Authentication failed",
        status: 401,
        detail: "The bearer token is not valid.",
        class: Http
    },
    AuthOriginMismatch => {
        code: "auth-origin-mismatch",
        title: "Authentication failed",
        status: 401,
        detail: "The bearer token is not valid for this origin.",
        class: Http
    },
    ScopeDenied => {
        code: "scope-denied",
        title: "Request rejected",
        status: 403,
        detail: "The bearer token lacks the required scope.",
        class: Http
    },
    RateLimited => {
        code: "rate-limited",
        title: "Rate limit exceeded",
        status: 429,
        detail: "The request rate limit has been reached.",
        class: Http
    },
    RequestLineTooLarge => {
        code: "request-line-too-large",
        title: "Request rejected",
        status: 414,
        detail: "The HTTP request line exceeds the limit.",
        class: Http
    },
    HeadersTooLarge => {
        code: "headers-too-large",
        title: "Request rejected",
        status: 431,
        detail: "The HTTP headers exceed the limit.",
        class: Http
    },
    BodyTooLarge => {
        code: "body-too-large",
        title: "Request rejected",
        status: 413,
        detail: "The JSON request body exceeds the limit.",
        class: Http
    },
    BodyTimeout => {
        code: "body-timeout",
        title: "Request rejected",
        status: 408,
        detail: "The request body did not arrive within the deadline.",
        class: Http
    },
    HeaderTimeout => {
        code: "header-timeout",
        title: "Request rejected",
        status: 408,
        detail: "The request headers did not arrive within the deadline.",
        class: Http
    },
    SchemaInvalid => {
        code: "schema-invalid",
        title: "Invalid request",
        status: 400,
        detail: "The request body does not match the protocol schema.",
        class: Http
    },
    QueueFull => {
        code: "queue-full",
        title: "Request rejected",
        status: 503,
        detail: "The synthesis queue is at capacity.",
        class: Http
    },
    OwnershipDenied => {
        code: "ownership-denied",
        title: "Request rejected",
        status: 404,
        detail: "The requested resource was not found.",
        class: Http
    },
    ResourceNotFound => {
        code: "resource-not-found",
        title: "Request rejected",
        status: 404,
        detail: "The requested resource was not found.",
        class: Http
    },
    Conflict => {
        code: "conflict",
        title: "Request rejected",
        status: 409,
        detail: "The request conflicts with current state.",
        class: Http
    },
    HandlerTimeout => {
        code: "handler-timeout",
        title: "Request rejected",
        status: 504,
        detail: "The request handler exceeded its deadline.",
        class: Http
    },
    ListenerConflict => {
        code: "listener-conflict",
        title: "Listener unavailable",
        status: 503,
        detail: "The fixed loopback port is already in use.",
        class: NonHttp
    },
    PairingNotFound => {
        code: "pairing-not-found",
        title: "Request rejected",
        status: 404,
        detail: "The requested resource was not found.",
        class: Http
    },
    PairingDenied => {
        code: "pairing-denied",
        title: "Request rejected",
        status: 403,
        detail: "The native pairing request was denied.",
        class: Http
    },
    PairingExpired => {
        code: "pairing-expired",
        title: "Request rejected",
        status: 410,
        detail: "The pairing request has expired.",
        class: Http
    },
    PairingConsumed => {
        code: "pairing-consumed",
        title: "Request rejected",
        status: 409,
        detail: "The request conflicts with current state.",
        class: Http
    },
    PairingAttemptsExhausted => {
        code: "pairing-attempts-exhausted",
        title: "Request rejected",
        status: 403,
        detail: "The manual pairing attempts are exhausted.",
        class: Http
    },
    PackUnverified => {
        code: "pack-unverified",
        title: "Runtime unavailable",
        status: 503,
        detail: "No verified Pocket pack is installed.",
        class: Http
    },
    RuntimeUnavailable => {
        code: "runtime-unavailable",
        title: "Runtime unavailable",
        status: 503,
        detail: "The synthesis runtime is unavailable.",
        class: Http
    },
    MethodNotAllowed => {
        code: "method-not-allowed",
        title: "Request rejected",
        status: 405,
        detail: "The HTTP method is not supported for this route.",
        class: Http
    },
    ContentTypeUnsupported => {
        code: "content-type-unsupported",
        title: "Request rejected",
        status: 415,
        detail: "The request content type is not supported.",
        class: Http
    },
    TransferEncodingInvalid => {
        code: "transfer-encoding-invalid",
        title: "Request rejected",
        status: 400,
        detail: "The HTTP transfer encoding is not supported.",
        class: Http
    },
    DuplicateHeader => {
        code: "duplicate-header",
        title: "Request rejected",
        status: 400,
        detail: "A security-sensitive header was duplicated.",
        class: Http
    },
    TextInvalid => {
        code: "text-invalid",
        title: "Request rejected",
        status: 400,
        detail: "The synthesis text is outside the accepted bounds.",
        class: Http
    },
    ActionInvalid => {
        code: "action-invalid",
        title: "Request rejected",
        status: 400,
        detail: "The requested pack action is not accepted.",
        class: Http
    },
}

pub const HTTP_PROBLEM_CODES: [ProblemCode; 34] = [
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

pub const NON_HTTP_PROBLEM_CODES: [ProblemCode; 1] = [ProblemCode::ListenerConflict];

pub struct Problem {
    code: ProblemCode,
    instance: CanonicalUuid,
    request_id: CanonicalUuid,
}

impl Problem {
    pub fn new(code: ProblemCode) -> Self {
        Self {
            code,
            instance: CanonicalUuid::from(Uuid::new_v4()),
            request_id: CanonicalUuid::from(Uuid::new_v4()),
        }
    }

    pub const fn code(&self) -> ProblemCode {
        self.code
    }

    pub const fn status(&self) -> u16 {
        self.code.status()
    }

    pub const fn request_id(&self) -> Uuid {
        self.request_id.as_uuid()
    }
}

impl Serialize for Problem {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let catalog = self.code.catalog();
        let mut state = serializer.serialize_struct("Problem", 7)?;
        state.serialize_field("type", catalog.problem_type())?;
        state.serialize_field("title", catalog.title())?;
        state.serialize_field("status", &catalog.status())?;
        state.serialize_field("detail", catalog.detail())?;
        state.serialize_field(
            "instance",
            &format_args!("urn:uuid:{}", self.instance.as_uuid()),
        )?;
        state.serialize_field("code", &self.code)?;
        state.serialize_field("requestId", &self.request_id)?;
        state.end()
    }
}

impl<'de> Deserialize<'de> for Problem {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields, rename_all = "camelCase")]
        struct RawProblem {
            #[serde(rename = "type")]
            problem_type: String,
            title: String,
            status: u16,
            detail: String,
            instance: String,
            code: ProblemCode,
            request_id: CanonicalUuid,
        }

        let raw = RawProblem::deserialize(deserializer)?;
        let catalog = raw.code.catalog();
        if raw.problem_type != catalog.problem_type()
            || raw.title != catalog.title()
            || raw.status != catalog.status()
            || raw.detail != catalog.detail()
        {
            return Err(serde::de::Error::custom(
                "Problem fields do not match the closed catalog",
            ));
        }
        let instance = raw
            .instance
            .strip_prefix("urn:uuid:")
            .ok_or_else(|| serde::de::Error::custom("Problem instance is not a UUID URN"))
            .and_then(|value| CanonicalUuid::parse(value).map_err(serde::de::Error::custom))?;
        Ok(Self {
            code: raw.code,
            instance,
            request_id: raw.request_id,
        })
    }
}
