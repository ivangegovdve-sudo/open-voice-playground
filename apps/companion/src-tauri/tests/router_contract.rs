use open_voice_companion::router::{
    AccessContract, AllowSet, AuthClass, GLOBAL_METHODS, MatchedConcreteRoute,
    MatchedPreflightRoute, Method, OPERATION_CONTRACTS, OperationContract, OperationId,
    OwnershipClass, PATH_CONTRACTS, PREFLIGHT_ALLOWED_HEADERS, PathContract, PathId,
    PathParameterKind, PathParameters, PreflightTarget, RequestedHeader, RouteError, RouteMatch,
    ScopeRequirement, resolve_route,
};
use std::collections::{BTreeMap, BTreeSet};

use open_voice_companion::protocol::{
    CanonicalUuid, OPERATION_MESSAGE_CONTRACTS, OperationMessageContract, PackId, RequestMessage,
    ResponseBody, ResponseMessage,
};
use serde_json::{Map, Value, json};

const OPENAPI: &str = include_str!("../../openapi/openapi.yaml");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ExpectedRouteKind {
    Concrete,
    Preflight,
}

#[derive(Clone, Copy, Debug)]
struct RouteCase {
    method: &'static str,
    target: &'static str,
    kind: ExpectedRouteKind,
    operation: OperationId,
    path: PathId,
    parameters: PathParameters,
    auth: AuthClass,
    scope: Option<ScopeRequirement>,
    ownership: OwnershipClass,
}

#[derive(Clone, Copy, Debug)]
struct ExpectedPath {
    id: PathId,
    template: &'static str,
    parameter: PathParameterKind,
    concrete: &'static [OperationId],
    preflight: OperationId,
    allow: AllowSet,
    header: &'static str,
}

fn route_cases() -> Vec<RouteCase> {
    let uuid = PathParameters::CanonicalUuid(
        CanonicalUuid::parse("00000000-0000-0000-0000-000000000000").unwrap(),
    );
    let pack = PathParameters::PackId(PackId);
    let none = PathParameters::None;
    let concrete = ExpectedRouteKind::Concrete;
    let preflight = ExpectedRouteKind::Preflight;
    let origin = AuthClass::OriginOnly;
    let bearer = AuthClass::Bearer;
    let options = AuthClass::Preflight;
    let no_scope = None;
    let no_owner = OwnershipClass::None;

    vec![
        RouteCase {
            method: "GET",
            target: "/v1/health",
            kind: concrete,
            operation: OperationId::GetHealth,
            path: PathId::Health,
            parameters: none,
            auth: origin,
            scope: no_scope,
            ownership: no_owner,
        },
        RouteCase {
            method: "OPTIONS",
            target: "/v1/health",
            kind: preflight,
            operation: OperationId::PreflightHealth,
            path: PathId::Health,
            parameters: none,
            auth: options,
            scope: no_scope,
            ownership: no_owner,
        },
        RouteCase {
            method: "POST",
            target: "/v1/pairings/challenges",
            kind: concrete,
            operation: OperationId::CreatePairingChallenge,
            path: PathId::PairingChallenges,
            parameters: none,
            auth: origin,
            scope: no_scope,
            ownership: no_owner,
        },
        RouteCase {
            method: "OPTIONS",
            target: "/v1/pairings/challenges",
            kind: preflight,
            operation: OperationId::PreflightPairingChallenges,
            path: PathId::PairingChallenges,
            parameters: none,
            auth: options,
            scope: no_scope,
            ownership: no_owner,
        },
        RouteCase {
            method: "POST",
            target: "/v1/pairings/challenges/00000000-0000-0000-0000-000000000000/redeem",
            kind: concrete,
            operation: OperationId::RedeemPairingChallenge,
            path: PathId::PairingChallengeRedeem,
            parameters: uuid,
            auth: origin,
            scope: no_scope,
            ownership: no_owner,
        },
        RouteCase {
            method: "OPTIONS",
            target: "/v1/pairings/challenges/00000000-0000-0000-0000-000000000000/redeem",
            kind: preflight,
            operation: OperationId::PreflightPairingChallengeRedeem,
            path: PathId::PairingChallengeRedeem,
            parameters: uuid,
            auth: options,
            scope: no_scope,
            ownership: no_owner,
        },
        RouteCase {
            method: "GET",
            target: "/v1/pairings/current",
            kind: concrete,
            operation: OperationId::GetCurrentPairing,
            path: PathId::CurrentPairing,
            parameters: none,
            auth: bearer,
            scope: no_scope,
            ownership: OwnershipClass::TokenSelf,
        },
        RouteCase {
            method: "DELETE",
            target: "/v1/pairings/current",
            kind: concrete,
            operation: OperationId::RevokeCurrentPairing,
            path: PathId::CurrentPairing,
            parameters: none,
            auth: bearer,
            scope: no_scope,
            ownership: OwnershipClass::TokenSelf,
        },
        RouteCase {
            method: "OPTIONS",
            target: "/v1/pairings/current",
            kind: preflight,
            operation: OperationId::PreflightCurrentPairing,
            path: PathId::CurrentPairing,
            parameters: none,
            auth: options,
            scope: no_scope,
            ownership: no_owner,
        },
        RouteCase {
            method: "GET",
            target: "/v1/runtime",
            kind: concrete,
            operation: OperationId::GetRuntime,
            path: PathId::Runtime,
            parameters: none,
            auth: bearer,
            scope: Some(ScopeRequirement::RuntimeRead),
            ownership: no_owner,
        },
        RouteCase {
            method: "OPTIONS",
            target: "/v1/runtime",
            kind: preflight,
            operation: OperationId::PreflightRuntime,
            path: PathId::Runtime,
            parameters: none,
            auth: options,
            scope: no_scope,
            ownership: no_owner,
        },
        RouteCase {
            method: "GET",
            target: "/v1/engines",
            kind: concrete,
            operation: OperationId::ListEngines,
            path: PathId::Engines,
            parameters: none,
            auth: bearer,
            scope: Some(ScopeRequirement::RuntimeRead),
            ownership: no_owner,
        },
        RouteCase {
            method: "OPTIONS",
            target: "/v1/engines",
            kind: preflight,
            operation: OperationId::PreflightEngines,
            path: PathId::Engines,
            parameters: none,
            auth: options,
            scope: no_scope,
            ownership: no_owner,
        },
        RouteCase {
            method: "GET",
            target: "/v1/voices",
            kind: concrete,
            operation: OperationId::ListVoices,
            path: PathId::Voices,
            parameters: none,
            auth: bearer,
            scope: Some(ScopeRequirement::RuntimeRead),
            ownership: no_owner,
        },
        RouteCase {
            method: "OPTIONS",
            target: "/v1/voices",
            kind: preflight,
            operation: OperationId::PreflightVoices,
            path: PathId::Voices,
            parameters: none,
            auth: options,
            scope: no_scope,
            ownership: no_owner,
        },
        RouteCase {
            method: "GET",
            target: "/v1/packs",
            kind: concrete,
            operation: OperationId::ListPacks,
            path: PathId::Packs,
            parameters: none,
            auth: bearer,
            scope: Some(ScopeRequirement::RuntimeRead),
            ownership: no_owner,
        },
        RouteCase {
            method: "OPTIONS",
            target: "/v1/packs",
            kind: preflight,
            operation: OperationId::PreflightPacks,
            path: PathId::Packs,
            parameters: none,
            auth: options,
            scope: no_scope,
            ownership: no_owner,
        },
        RouteCase {
            method: "POST",
            target: "/v1/jobs",
            kind: concrete,
            operation: OperationId::CreateJob,
            path: PathId::Jobs,
            parameters: none,
            auth: bearer,
            scope: Some(ScopeRequirement::SynthesisCreate),
            ownership: no_owner,
        },
        RouteCase {
            method: "OPTIONS",
            target: "/v1/jobs",
            kind: preflight,
            operation: OperationId::PreflightJobs,
            path: PathId::Jobs,
            parameters: none,
            auth: options,
            scope: no_scope,
            ownership: no_owner,
        },
        RouteCase {
            method: "GET",
            target: "/v1/jobs/00000000-0000-0000-0000-000000000000",
            kind: concrete,
            operation: OperationId::GetJob,
            path: PathId::Job,
            parameters: uuid,
            auth: bearer,
            scope: Some(ScopeRequirement::JobsRead),
            ownership: OwnershipClass::JobOwner,
        },
        RouteCase {
            method: "DELETE",
            target: "/v1/jobs/00000000-0000-0000-0000-000000000000",
            kind: concrete,
            operation: OperationId::CancelJob,
            path: PathId::Job,
            parameters: uuid,
            auth: bearer,
            scope: Some(ScopeRequirement::JobsCancel),
            ownership: OwnershipClass::JobOwner,
        },
        RouteCase {
            method: "OPTIONS",
            target: "/v1/jobs/00000000-0000-0000-0000-000000000000",
            kind: preflight,
            operation: OperationId::PreflightJob,
            path: PathId::Job,
            parameters: uuid,
            auth: options,
            scope: no_scope,
            ownership: no_owner,
        },
        RouteCase {
            method: "GET",
            target: "/v1/jobs/00000000-0000-0000-0000-000000000000/audio",
            kind: concrete,
            operation: OperationId::GetJobAudio,
            path: PathId::JobAudio,
            parameters: uuid,
            auth: bearer,
            scope: Some(ScopeRequirement::AudioRead),
            ownership: OwnershipClass::JobOwner,
        },
        RouteCase {
            method: "OPTIONS",
            target: "/v1/jobs/00000000-0000-0000-0000-000000000000/audio",
            kind: preflight,
            operation: OperationId::PreflightJobAudio,
            path: PathId::JobAudio,
            parameters: uuid,
            auth: options,
            scope: no_scope,
            ownership: no_owner,
        },
        RouteCase {
            method: "POST",
            target: "/v1/packs/pocket-companion-pack/actions",
            kind: concrete,
            operation: OperationId::RequestPackAction,
            path: PathId::PackActions,
            parameters: pack,
            auth: bearer,
            scope: Some(ScopeRequirement::PacksRequest),
            ownership: no_owner,
        },
        RouteCase {
            method: "OPTIONS",
            target: "/v1/packs/pocket-companion-pack/actions",
            kind: preflight,
            operation: OperationId::PreflightPackActions,
            path: PathId::PackActions,
            parameters: pack,
            auth: options,
            scope: no_scope,
            ownership: no_owner,
        },
    ]
}

#[test]
fn c7_public_router_api_is_closed_and_indexed() {
    assert_eq!(PATH_CONTRACTS.len(), 12);
    assert_eq!(OPERATION_CONTRACTS.len(), 26);
    assert_eq!(
        GLOBAL_METHODS,
        [Method::Get, Method::Post, Method::Delete, Method::Options]
    );
    assert_eq!(
        PREFLIGHT_ALLOWED_HEADERS,
        [
            RequestedHeader::Authorization,
            RequestedHeader::ContentType,
            RequestedHeader::ClientVersion,
        ]
    );

    assert!(resolve_route("GET", "/v1/health").is_ok());
    assert_eq!(OperationId::GetHealth.as_str(), "getHealth");
}

#[test]
fn c7_tables_and_all_twenty_six_route_exemplars_are_exact() {
    let expected_paths: &[ExpectedPath] = &[
        ExpectedPath {
            id: PathId::Health,
            template: "/v1/health",
            parameter: PathParameterKind::None,
            concrete: &[OperationId::GetHealth],
            preflight: OperationId::PreflightHealth,
            allow: AllowSet::Get,
            header: "GET, OPTIONS",
        },
        ExpectedPath {
            id: PathId::PairingChallenges,
            template: "/v1/pairings/challenges",
            parameter: PathParameterKind::None,
            concrete: &[OperationId::CreatePairingChallenge],
            preflight: OperationId::PreflightPairingChallenges,
            allow: AllowSet::Post,
            header: "POST, OPTIONS",
        },
        ExpectedPath {
            id: PathId::PairingChallengeRedeem,
            template: "/v1/pairings/challenges/{id}/redeem",
            parameter: PathParameterKind::CanonicalUuid,
            concrete: &[OperationId::RedeemPairingChallenge],
            preflight: OperationId::PreflightPairingChallengeRedeem,
            allow: AllowSet::Post,
            header: "POST, OPTIONS",
        },
        ExpectedPath {
            id: PathId::CurrentPairing,
            template: "/v1/pairings/current",
            parameter: PathParameterKind::None,
            concrete: &[
                OperationId::GetCurrentPairing,
                OperationId::RevokeCurrentPairing,
            ],
            preflight: OperationId::PreflightCurrentPairing,
            allow: AllowSet::GetDelete,
            header: "GET, DELETE, OPTIONS",
        },
        ExpectedPath {
            id: PathId::Runtime,
            template: "/v1/runtime",
            parameter: PathParameterKind::None,
            concrete: &[OperationId::GetRuntime],
            preflight: OperationId::PreflightRuntime,
            allow: AllowSet::Get,
            header: "GET, OPTIONS",
        },
        ExpectedPath {
            id: PathId::Engines,
            template: "/v1/engines",
            parameter: PathParameterKind::None,
            concrete: &[OperationId::ListEngines],
            preflight: OperationId::PreflightEngines,
            allow: AllowSet::Get,
            header: "GET, OPTIONS",
        },
        ExpectedPath {
            id: PathId::Voices,
            template: "/v1/voices",
            parameter: PathParameterKind::None,
            concrete: &[OperationId::ListVoices],
            preflight: OperationId::PreflightVoices,
            allow: AllowSet::Get,
            header: "GET, OPTIONS",
        },
        ExpectedPath {
            id: PathId::Packs,
            template: "/v1/packs",
            parameter: PathParameterKind::None,
            concrete: &[OperationId::ListPacks],
            preflight: OperationId::PreflightPacks,
            allow: AllowSet::Get,
            header: "GET, OPTIONS",
        },
        ExpectedPath {
            id: PathId::Jobs,
            template: "/v1/jobs",
            parameter: PathParameterKind::None,
            concrete: &[OperationId::CreateJob],
            preflight: OperationId::PreflightJobs,
            allow: AllowSet::Post,
            header: "POST, OPTIONS",
        },
        ExpectedPath {
            id: PathId::Job,
            template: "/v1/jobs/{id}",
            parameter: PathParameterKind::CanonicalUuid,
            concrete: &[OperationId::GetJob, OperationId::CancelJob],
            preflight: OperationId::PreflightJob,
            allow: AllowSet::GetDelete,
            header: "GET, DELETE, OPTIONS",
        },
        ExpectedPath {
            id: PathId::JobAudio,
            template: "/v1/jobs/{id}/audio",
            parameter: PathParameterKind::CanonicalUuid,
            concrete: &[OperationId::GetJobAudio],
            preflight: OperationId::PreflightJobAudio,
            allow: AllowSet::Get,
            header: "GET, OPTIONS",
        },
        ExpectedPath {
            id: PathId::PackActions,
            template: "/v1/packs/{id}/actions",
            parameter: PathParameterKind::PackId,
            concrete: &[OperationId::RequestPackAction],
            preflight: OperationId::PreflightPackActions,
            allow: AllowSet::Post,
            header: "POST, OPTIONS",
        },
    ];

    for (index, expected) in expected_paths.iter().enumerate() {
        let contract = &PATH_CONTRACTS[index];
        assert_eq!(contract.id, expected.id);
        assert_eq!(contract.id as usize, index);
        assert_eq!(contract.template, expected.template);
        assert_eq!(contract.parameter, expected.parameter);
        assert_eq!(contract.concrete_operations, expected.concrete);
        assert_eq!(contract.preflight_operation, expected.preflight);
        assert_eq!(contract.allow(), expected.allow);
        assert_eq!(contract.allow().header_value(), expected.header);
        assert_eq!(expected.id.contract().id, expected.id);
    }

    let cases = route_cases();
    assert_eq!(cases.len(), 26);
    for (index, case) in cases.into_iter().enumerate() {
        assert_eq!(case.operation as usize, index);
        let resolved = resolve_route(case.method, case.target).unwrap();
        let (operation, path, parameters, contract): (
            OperationId,
            PathId,
            PathParameters,
            &OperationContract,
        ) = match resolved {
            RouteMatch::Concrete(route) => {
                assert_eq!(case.kind, ExpectedRouteKind::Concrete);
                (
                    route.operation(),
                    route.path(),
                    route.parameters(),
                    route.contract(),
                )
            }
            RouteMatch::Preflight(route) => {
                assert_eq!(case.kind, ExpectedRouteKind::Preflight);
                (
                    route.operation(),
                    route.path(),
                    route.parameters(),
                    route.contract(),
                )
            }
        };
        assert_eq!(operation, case.operation);
        assert_eq!(path, case.path);
        assert_eq!(parameters, case.parameters);
        assert_eq!(contract.id, operation);
        assert_eq!(contract.operation_id, operation.as_str());
        assert_eq!(contract.path, path);
        assert_eq!(contract.method.as_str(), case.method);
        assert_eq!(contract.access.auth, case.auth);
        assert_eq!(contract.access.scope, case.scope);
        assert_eq!(contract.access.ownership, case.ownership);
        assert_eq!(contract.messages, &OPERATION_MESSAGE_CONTRACTS[index]);
        assert_eq!(contract.messages.operation_id, operation.as_str());
        assert_eq!(operation.contract().id, operation);
    }
}

#[test]
fn c7_requested_headers_scopes_methods_and_allow_are_derived_exactly() {
    let scope_cases = [
        (ScopeRequirement::RuntimeRead, "runtime:read"),
        (ScopeRequirement::SynthesisCreate, "synthesis:create"),
        (ScopeRequirement::JobsRead, "jobs:read"),
        (ScopeRequirement::JobsCancel, "jobs:cancel"),
        (ScopeRequirement::AudioRead, "audio:read"),
        (ScopeRequirement::PacksRequest, "packs:request"),
    ];
    for (scope, text) in scope_cases {
        assert_eq!(scope.as_str(), text);
        assert_eq!(scope.as_scope().as_str(), text);
    }
    assert_eq!(Method::Get.as_str(), "GET");
    assert_eq!(Method::Post.as_str(), "POST");
    assert_eq!(Method::Delete.as_str(), "DELETE");
    assert_eq!(Method::Options.as_str(), "OPTIONS");
    assert_eq!(RequestedHeader::Authorization.as_str(), "Authorization");
    assert_eq!(RequestedHeader::ContentType.as_str(), "Content-Type");
    assert_eq!(
        RequestedHeader::ClientVersion.as_str(),
        "X-OVP-Client-Version"
    );
    assert_eq!(AllowSet::Get.methods(), &[Method::Get, Method::Options]);
    assert_eq!(AllowSet::Post.methods(), &[Method::Post, Method::Options]);
    assert_eq!(
        AllowSet::GetDelete.methods(),
        &[Method::Get, Method::Delete, Method::Options]
    );

    let cases: &[(&str, &str, OperationId, &[RequestedHeader])] = &[
        (
            "/v1/health",
            "GET",
            OperationId::GetHealth,
            &[RequestedHeader::ClientVersion],
        ),
        (
            "/v1/pairings/challenges",
            "POST",
            OperationId::CreatePairingChallenge,
            &[RequestedHeader::ContentType, RequestedHeader::ClientVersion],
        ),
        (
            "/v1/pairings/challenges/00000000-0000-0000-0000-000000000000/redeem",
            "POST",
            OperationId::RedeemPairingChallenge,
            &[RequestedHeader::ContentType, RequestedHeader::ClientVersion],
        ),
        (
            "/v1/pairings/current",
            "GET",
            OperationId::GetCurrentPairing,
            &[
                RequestedHeader::Authorization,
                RequestedHeader::ClientVersion,
            ],
        ),
        (
            "/v1/pairings/current",
            "DELETE",
            OperationId::RevokeCurrentPairing,
            &[
                RequestedHeader::Authorization,
                RequestedHeader::ClientVersion,
            ],
        ),
        (
            "/v1/runtime",
            "GET",
            OperationId::GetRuntime,
            &[
                RequestedHeader::Authorization,
                RequestedHeader::ClientVersion,
            ],
        ),
        (
            "/v1/engines",
            "GET",
            OperationId::ListEngines,
            &[
                RequestedHeader::Authorization,
                RequestedHeader::ClientVersion,
            ],
        ),
        (
            "/v1/voices",
            "GET",
            OperationId::ListVoices,
            &[
                RequestedHeader::Authorization,
                RequestedHeader::ClientVersion,
            ],
        ),
        (
            "/v1/packs",
            "GET",
            OperationId::ListPacks,
            &[
                RequestedHeader::Authorization,
                RequestedHeader::ClientVersion,
            ],
        ),
        (
            "/v1/jobs",
            "POST",
            OperationId::CreateJob,
            &[
                RequestedHeader::Authorization,
                RequestedHeader::ContentType,
                RequestedHeader::ClientVersion,
            ],
        ),
        (
            "/v1/jobs/00000000-0000-0000-0000-000000000000",
            "GET",
            OperationId::GetJob,
            &[
                RequestedHeader::Authorization,
                RequestedHeader::ClientVersion,
            ],
        ),
        (
            "/v1/jobs/00000000-0000-0000-0000-000000000000",
            "DELETE",
            OperationId::CancelJob,
            &[
                RequestedHeader::Authorization,
                RequestedHeader::ClientVersion,
            ],
        ),
        (
            "/v1/jobs/00000000-0000-0000-0000-000000000000/audio",
            "GET",
            OperationId::GetJobAudio,
            &[
                RequestedHeader::Authorization,
                RequestedHeader::ClientVersion,
            ],
        ),
        (
            "/v1/packs/pocket-companion-pack/actions",
            "POST",
            OperationId::RequestPackAction,
            &[
                RequestedHeader::Authorization,
                RequestedHeader::ContentType,
                RequestedHeader::ClientVersion,
            ],
        ),
    ];

    for (raw_target, raw_method, operation, headers) in cases {
        let RouteMatch::Preflight(preflight) = resolve_route("OPTIONS", raw_target).unwrap() else {
            panic!("OPTIONS must resolve to a preflight route")
        };
        let target: PreflightTarget = preflight.resolve_requested_method(raw_method).unwrap();
        assert_eq!(target.operation(), *operation);
        assert_eq!(target.contract().id, *operation);
        assert_eq!(target.requested_headers(), *headers);
    }
}

#[test]
fn c7_raw_target_errors_and_precedence_are_closed_and_value_free() {
    for target in [
        "",
        "*",
        "127.0.0.1:17843",
        "//127.0.0.1:17843/v1/health",
        "http://127.0.0.1:17843/v1/health",
    ] {
        let error = resolve_route("GET", target).unwrap_err();
        assert_eq!(error, RouteError::NonOriginForm);
        assert_eq!(
            error.problem_code(),
            open_voice_companion::protocol::ProblemCode::HostInvalid
        );
        assert_eq!(error.allow(), None);
    }

    for target in [
        "/",
        "/v1/health?",
        "/v1/health#fragment",
        "/v1/%68ealth",
        r"/v1\health",
        "/v1//health",
        "/v1/health/",
        "/v1/./health",
        "/v1/../health",
        "/v1/héalth",
        "/v1/\u{7f}health",
    ] {
        let error = resolve_route("GET", target).unwrap_err();
        assert_eq!(error, RouteError::InvalidOriginForm, "{target:?}");
        assert_eq!(
            error.problem_code(),
            open_voice_companion::protocol::ProblemCode::SchemaInvalid
        );
    }

    for method in ["GET", "POST", "DELETE", "OPTIONS", "HEAD", "PUT"] {
        assert_eq!(
            resolve_route(method, "/v1/C7_RAW_TARGET_SENTINEL").unwrap_err(),
            RouteError::ResourceNotFound
        );
    }
    assert_eq!(
        resolve_route("PUT", "/v1/jobs/not-a-uuid").unwrap_err(),
        RouteError::InvalidPathParameter {
            path: PathId::Job,
            kind: PathParameterKind::CanonicalUuid,
        }
    );
    assert_eq!(
        resolve_route("GET", "/v1/packs/not-a-pack/actions").unwrap_err(),
        RouteError::InvalidPathParameter {
            path: PathId::PackActions,
            kind: PathParameterKind::PackId,
        }
    );

    let wrong_method = resolve_route("POST", "/v1/health").unwrap_err();
    assert_eq!(
        wrong_method,
        RouteError::MethodNotAllowed {
            path: PathId::Health
        }
    );
    assert_eq!(
        wrong_method.problem_code(),
        open_voice_companion::protocol::ProblemCode::MethodNotAllowed
    );
    assert_eq!(wrong_method.allow(), Some(AllowSet::Get));
    assert!(!wrong_method.to_string().contains("C7_RAW_TARGET_SENTINEL"));

    let RouteMatch::Preflight(preflight) = resolve_route("OPTIONS", "/v1/health").unwrap() else {
        panic!("OPTIONS must resolve to preflight")
    };
    for invalid in ["", "HEAD", "PUT", "get", "PATCH"] {
        assert_eq!(
            preflight.resolve_requested_method(invalid).unwrap_err(),
            RouteError::InvalidPreflightMethod
        );
    }
    assert_eq!(
        preflight.resolve_requested_method("POST").unwrap_err(),
        RouteError::MethodNotAllowed {
            path: PathId::Health
        }
    );
    assert_eq!(
        preflight.resolve_requested_method("OPTIONS").unwrap_err(),
        RouteError::MethodNotAllowed {
            path: PathId::Health
        }
    );
}

#[test]
fn c7_public_matched_and_descriptor_types_are_readable_but_not_forgeable() {
    let _public_types: Option<(
        AccessContract,
        PathContract,
        OperationContract,
        MatchedConcreteRoute,
        MatchedPreflightRoute,
    )> = None;
    let RouteMatch::Concrete(route) = resolve_route("GET", "/v1/health").unwrap() else {
        panic!("health must be concrete")
    };
    assert_eq!(route.operation(), OperationId::GetHealth);
    assert_eq!(route.path(), PathId::Health);
    assert_eq!(route.parameters(), PathParameters::None);
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OwnedAccess {
    auth: String,
    scope: Option<String>,
    ownership: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum OwnedRequest {
    None,
    Json {
        required: bool,
        media_type: String,
        schema_ref: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum OwnedBody {
    Empty,
    Json {
        media_type: String,
        schema_ref: String,
    },
    Audio {
        media_type: String,
        max_bytes: u64,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OwnedMessage {
    request: OwnedRequest,
    responses: BTreeMap<u16, OwnedBody>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OwnedOperation {
    path: String,
    method: String,
    access: OwnedAccess,
    messages: OwnedMessage,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OwnedConcreteTarget {
    method: String,
    operation_id: String,
    requested_headers: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OwnedPath {
    parameter_schema: Option<String>,
    concrete: Vec<OwnedConcreteTarget>,
    preflight_operation: String,
    preflight_methods: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OwnedPolicy {
    credentials: String,
    allow_methods: Vec<String>,
    allow_headers: Vec<String>,
    requested_header_comparison: String,
    requires_declared_concrete_target: bool,
    rejects_body: bool,
    rejects_credentials: bool,
    rejects_options_target: bool,
    unknown_route_status: u16,
    unknown_route_code: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RoutingProjection {
    policy: OwnedPolicy,
    paths: BTreeMap<String, OwnedPath>,
    operations: BTreeMap<String, OwnedOperation>,
}

fn local_ref(value: &Value, prefix: &str) -> Result<String, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "reference is not an object".to_owned())?;
    if object.len() != 1 {
        return Err("reference has unsupported siblings".to_owned());
    }
    object
        .get("$ref")
        .and_then(Value::as_str)
        .and_then(|reference| reference.strip_prefix(prefix))
        .filter(|name| !name.is_empty() && !name.contains('/'))
        .map(str::to_owned)
        .ok_or_else(|| "reference is not canonical and local".to_owned())
}

fn string_array(value: &Value, field: &str) -> Result<Vec<String>, String> {
    value
        .as_array()
        .ok_or_else(|| format!("{field} is not an array"))?
        .iter()
        .map(|entry| {
            entry
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| format!("{field} contains a non-string"))
        })
        .collect()
}

fn resolve_response<'a>(document: &'a Value, candidate: &'a Value) -> Result<&'a Value, String> {
    let object = candidate
        .as_object()
        .ok_or_else(|| "response is not an object".to_owned())?;
    let Some(reference) = object.get("$ref") else {
        return Ok(candidate);
    };
    if object.len() != 1 {
        return Err("response reference has siblings".to_owned());
    }
    let name = reference
        .as_str()
        .and_then(|value| value.strip_prefix("#/components/responses/"))
        .ok_or_else(|| "response reference is not canonical and local".to_owned())?;
    document["components"]["responses"]
        .get(name)
        .ok_or_else(|| "response reference is dangling".to_owned())
}

fn extract_body(response: &Value) -> Result<OwnedBody, String> {
    let Some(content) = response.get("content") else {
        return Ok(OwnedBody::Empty);
    };
    let content = content
        .as_object()
        .filter(|content| content.len() == 1)
        .ok_or_else(|| "response content must contain exactly one media type".to_owned())?;
    let (media_type, descriptor) = content.iter().next().unwrap();
    if media_type == "audio/wav" {
        return Ok(OwnedBody::Audio {
            media_type: media_type.clone(),
            max_bytes: descriptor
                .get("x-maxBodyBytes")
                .and_then(Value::as_u64)
                .ok_or_else(|| "audio response lacks a byte maximum".to_owned())?,
        });
    }
    Ok(OwnedBody::Json {
        media_type: media_type.clone(),
        schema_ref: local_ref(
            descriptor
                .get("schema")
                .ok_or_else(|| "JSON response lacks a schema".to_owned())?,
            "#/components/schemas/",
        )?,
    })
}

fn extract_request(operation: &Value) -> Result<OwnedRequest, String> {
    let Some(request) = operation.get("requestBody") else {
        return Ok(OwnedRequest::None);
    };
    let required = request
        .get("required")
        .and_then(Value::as_bool)
        .ok_or_else(|| "request requiredness is missing".to_owned())?;
    let content = request["content"]
        .as_object()
        .filter(|content| content.len() == 1)
        .ok_or_else(|| "request content must contain exactly one media type".to_owned())?;
    let (media_type, descriptor) = content.iter().next().unwrap();
    Ok(OwnedRequest::Json {
        required,
        media_type: media_type.clone(),
        schema_ref: local_ref(
            descriptor
                .get("schema")
                .ok_or_else(|| "JSON request lacks a schema".to_owned())?,
            "#/components/schemas/",
        )?,
    })
}

fn extract_responses(
    document: &Value,
    operation: &Value,
) -> Result<BTreeMap<u16, OwnedBody>, String> {
    let operation_id = operation
        .get("operationId")
        .and_then(Value::as_str)
        .unwrap_or("<missing-operation-id>");
    let responses = operation["responses"]
        .as_object()
        .ok_or_else(|| format!("{operation_id} responses are missing"))?;
    let mut extracted = BTreeMap::new();
    for (raw_status, response) in responses {
        if raw_status.len() != 3
            || !raw_status.bytes().all(|byte| byte.is_ascii_digit())
            || !matches!(raw_status.as_bytes()[0], b'1'..=b'5')
        {
            return Err(format!(
                "{operation_id} has nonconcrete response {raw_status}"
            ));
        }
        let status = raw_status
            .parse::<u16>()
            .map_err(|_| "response status is invalid".to_owned())?;
        let response = resolve_response(document, response)?;
        if extracted.insert(status, extract_body(response)?).is_some() {
            return Err(format!("{operation_id} duplicates response {status}"));
        }
    }
    Ok(extracted)
}

fn extract_access(value: &Value) -> Result<OwnedAccess, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "access contract is not an object".to_owned())?;
    let keys: BTreeSet<_> = object.keys().map(String::as_str).collect();
    if keys != BTreeSet::from(["auth", "ownership", "scope"]) {
        return Err("access contract fields are not exact".to_owned());
    }
    let scope = match object.get("scope") {
        Some(Value::Null) => None,
        Some(Value::String(scope)) => Some(scope.clone()),
        _ => return Err("access scope is neither null nor a string".to_owned()),
    };
    Ok(OwnedAccess {
        auth: object["auth"]
            .as_str()
            .ok_or_else(|| "access auth is not a string".to_owned())?
            .to_owned(),
        scope,
        ownership: object["ownership"]
            .as_str()
            .ok_or_else(|| "access ownership is not a string".to_owned())?
            .to_owned(),
    })
}

fn requested_headers(access: &OwnedAccess, request: &OwnedRequest) -> Vec<String> {
    let mut headers = Vec::new();
    if access.auth == "bearer" {
        headers.push("Authorization".to_owned());
    }
    if matches!(request, OwnedRequest::Json { required: true, .. }) {
        headers.push("Content-Type".to_owned());
    }
    headers.push("X-OVP-Client-Version".to_owned());
    headers
}

fn resolve_parameter<'a>(document: &'a Value, reference: &Value) -> Result<&'a Value, String> {
    let name = local_ref(reference, "#/components/parameters/")?;
    document["components"]["parameters"]
        .get(&name)
        .ok_or_else(|| format!("parameter reference {name} is dangling"))
}

fn extract_path_parameter(
    document: &Value,
    template: &str,
    path_item: &Value,
) -> Result<Option<String>, String> {
    let references = match path_item.get("parameters") {
        None => Vec::new(),
        Some(value) => value
            .as_array()
            .ok_or_else(|| "path parameters are not an array".to_owned())?
            .to_vec(),
    };
    if !template.contains("{id}") {
        if !references.is_empty() {
            return Err("literal path unexpectedly declares parameters".to_owned());
        }
        return Ok(None);
    }
    if references.len() != 1 {
        return Err("parameterized path must declare exactly one parameter".to_owned());
    }
    let parameter = resolve_parameter(document, &references[0])?;
    if parameter.get("name").and_then(Value::as_str) != Some("id")
        || parameter.get("in").and_then(Value::as_str) != Some("path")
        || parameter.get("required").and_then(Value::as_bool) != Some(true)
    {
        return Err("path parameter shape is invalid".to_owned());
    }
    local_ref(&parameter["schema"], "#/components/schemas/").map(Some)
}

fn extract_preflight_methods(document: &Value, operation: &Value) -> Result<Vec<String>, String> {
    let references = operation["parameters"]
        .as_array()
        .ok_or_else(|| "preflight parameters are missing".to_owned())?;
    let mut found = Vec::new();
    for reference in references {
        let parameter = resolve_parameter(document, reference)?;
        if parameter.get("name").and_then(Value::as_str) == Some("Access-Control-Request-Method") {
            found.push(string_array(
                &parameter["schema"]["enum"],
                "preflight method enum",
            )?);
        }
    }
    if found.len() != 1 {
        return Err("preflight must declare one requested-method parameter".to_owned());
    }
    Ok(found.pop().unwrap())
}

fn extract_policy(document: &Value) -> Result<OwnedPolicy, String> {
    let policy = document
        .get("x-ovp-http-policy")
        .and_then(Value::as_object)
        .ok_or_else(|| "HTTP policy is missing".to_owned())?;
    let preflight = policy["preflight"]
        .as_object()
        .ok_or_else(|| "preflight policy is missing".to_owned())?;
    let unknown = policy["unknownRoute"]
        .as_object()
        .ok_or_else(|| "unknown-route policy is missing".to_owned())?;
    Ok(OwnedPolicy {
        credentials: policy["credentials"]
            .as_str()
            .ok_or_else(|| "credentials policy is missing".to_owned())?
            .to_owned(),
        allow_methods: string_array(&preflight["allowMethods"], "allowMethods")?,
        allow_headers: string_array(&preflight["allowHeaders"], "allowHeaders")?,
        requested_header_comparison: preflight["requestedHeaderComparison"]
            .as_str()
            .ok_or_else(|| "requested-header comparison is missing".to_owned())?
            .to_owned(),
        requires_declared_concrete_target: preflight["requiresDeclaredConcreteTarget"]
            .as_bool()
            .ok_or_else(|| "declared-target policy is missing".to_owned())?,
        rejects_body: preflight["rejectsBody"]
            .as_bool()
            .ok_or_else(|| "body policy is missing".to_owned())?,
        rejects_credentials: preflight["rejectsCredentials"]
            .as_bool()
            .ok_or_else(|| "credential policy is missing".to_owned())?,
        rejects_options_target: preflight["rejectsOptionsTarget"]
            .as_bool()
            .ok_or_else(|| "OPTIONS-target policy is missing".to_owned())?,
        unknown_route_status: unknown["status"]
            .as_u64()
            .and_then(|status| u16::try_from(status).ok())
            .ok_or_else(|| "unknown-route status is invalid".to_owned())?,
        unknown_route_code: unknown["code"]
            .as_str()
            .ok_or_else(|| "unknown-route code is missing".to_owned())?
            .to_owned(),
    })
}

fn extract_routing_projection(document: &Value) -> Result<RoutingProjection, String> {
    let access_by_operation = document["x-ovp-http-policy"]["accessByOperation"]
        .as_object()
        .ok_or_else(|| "accessByOperation is missing".to_owned())?;
    let paths = document["paths"]
        .as_object()
        .ok_or_else(|| "paths is not an object".to_owned())?;
    let allowed_path_keys = BTreeSet::from(["parameters", "get", "post", "delete", "options"]);
    let mut projected_paths = BTreeMap::new();
    let mut operations = BTreeMap::new();
    let mut used_access = BTreeSet::new();

    for (template, path_item) in paths {
        let path_item = path_item
            .as_object()
            .ok_or_else(|| format!("path item {template} is not an object"))?;
        for key in path_item.keys() {
            if !allowed_path_keys.contains(key.as_str()) {
                return Err(format!("path {template} has undeclared operation {key}"));
            }
        }
        let parameter_schema =
            extract_path_parameter(document, template, &Value::Object(path_item.clone()))?;
        let mut concrete = Vec::new();
        let mut preflight_operation = None;
        let mut preflight_methods = None;
        for (wire_method, yaml_method) in [
            ("GET", "get"),
            ("POST", "post"),
            ("DELETE", "delete"),
            ("OPTIONS", "options"),
        ] {
            let Some(operation) = path_item.get(yaml_method) else {
                continue;
            };
            let operation_id = operation
                .get("operationId")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("{template} {wire_method} lacks an operation id"))?
                .to_owned();
            let request = extract_request(operation)?;
            let responses = extract_responses(document, operation)?;
            let access = if wire_method == "OPTIONS" {
                OwnedAccess {
                    auth: "preflight".to_owned(),
                    scope: None,
                    ownership: "none".to_owned(),
                }
            } else {
                let access = access_by_operation
                    .get(&operation_id)
                    .ok_or_else(|| format!("{operation_id} lacks an access contract"))?;
                used_access.insert(operation_id.clone());
                extract_access(access)?
            };
            if operations
                .insert(
                    operation_id.clone(),
                    OwnedOperation {
                        path: template.clone(),
                        method: wire_method.to_owned(),
                        access: access.clone(),
                        messages: OwnedMessage {
                            request: request.clone(),
                            responses,
                        },
                    },
                )
                .is_some()
            {
                return Err(format!("duplicate operation id {operation_id}"));
            }
            if wire_method == "OPTIONS" {
                preflight_methods = Some(extract_preflight_methods(document, operation)?);
                preflight_operation = Some(operation_id);
            } else {
                concrete.push(OwnedConcreteTarget {
                    method: wire_method.to_owned(),
                    operation_id,
                    requested_headers: requested_headers(&access, &request),
                });
            }
        }
        if concrete.is_empty() {
            return Err(format!("path {template} has no concrete target"));
        }
        if projected_paths
            .insert(
                template.clone(),
                OwnedPath {
                    parameter_schema,
                    concrete,
                    preflight_operation: preflight_operation
                        .ok_or_else(|| format!("path {template} lacks OPTIONS"))?,
                    preflight_methods: preflight_methods
                        .ok_or_else(|| format!("path {template} lacks a preflight method enum"))?,
                },
            )
            .is_some()
        {
            return Err(format!("duplicate path {template}"));
        }
    }

    let declared_access: BTreeSet<_> = access_by_operation.keys().cloned().collect();
    if used_access != declared_access {
        return Err("accessByOperation has missing or unused entries".to_owned());
    }
    Ok(RoutingProjection {
        policy: extract_policy(document)?,
        paths: projected_paths,
        operations,
    })
}

fn owned_access(access: AccessContract) -> OwnedAccess {
    OwnedAccess {
        auth: match access.auth {
            AuthClass::OriginOnly => "origin-only",
            AuthClass::Bearer => "bearer",
            AuthClass::Preflight => "preflight",
        }
        .to_owned(),
        scope: access.scope.map(|scope| scope.as_str().to_owned()),
        ownership: match access.ownership {
            OwnershipClass::None => "none",
            OwnershipClass::TokenSelf => "token-self",
            OwnershipClass::JobOwner => "job-owner",
        }
        .to_owned(),
    }
}

fn owned_request(request: RequestMessage) -> OwnedRequest {
    match request {
        RequestMessage::None => OwnedRequest::None,
        RequestMessage::Json {
            required,
            media_type,
            schema,
        } => OwnedRequest::Json {
            required,
            media_type: media_type.to_owned(),
            schema_ref: schema.as_str().to_owned(),
        },
    }
}

fn owned_responses(responses: &[ResponseMessage]) -> Result<BTreeMap<u16, OwnedBody>, String> {
    let mut projected = BTreeMap::new();
    for response in responses {
        let body = match response.body {
            ResponseBody::Empty => OwnedBody::Empty,
            ResponseBody::Json { media_type, schema } => OwnedBody::Json {
                media_type: media_type.to_owned(),
                schema_ref: schema.as_str().to_owned(),
            },
            ResponseBody::Audio {
                media_type,
                max_bytes,
            } => OwnedBody::Audio {
                media_type: media_type.to_owned(),
                max_bytes,
            },
        };
        if projected.insert(response.status, body).is_some() {
            return Err(format!(
                "duplicate Rust response status {}",
                response.status
            ));
        }
    }
    Ok(projected)
}

fn owned_message(contract: &OperationMessageContract) -> Result<OwnedMessage, String> {
    Ok(OwnedMessage {
        request: owned_request(contract.request),
        responses: owned_responses(contract.responses)?,
    })
}

fn exemplar_target(path: &PathContract) -> String {
    match path.parameter {
        PathParameterKind::None => path.template.to_owned(),
        PathParameterKind::CanonicalUuid => path
            .template
            .replace("{id}", "00000000-0000-0000-0000-000000000000"),
        PathParameterKind::PackId => path.template.replace("{id}", "pocket-companion-pack"),
    }
}

fn rust_routing_projection() -> Result<RoutingProjection, String> {
    let mut paths = BTreeMap::new();
    let mut operations = BTreeMap::new();
    for path in &PATH_CONTRACTS {
        let target = exemplar_target(path);
        let RouteMatch::Preflight(preflight) = resolve_route("OPTIONS", &target)
            .map_err(|error| format!("Rust preflight exemplar failed: {error}"))?
        else {
            return Err("OPTIONS exemplar resolved as concrete".to_owned());
        };
        let mut concrete = Vec::new();
        for operation_id in path.concrete_operations {
            let operation = operation_id.contract();
            let preflight_target = preflight
                .resolve_requested_method(operation.method.as_str())
                .map_err(|error| format!("Rust concrete preflight target failed: {error}"))?;
            concrete.push(OwnedConcreteTarget {
                method: operation.method.as_str().to_owned(),
                operation_id: operation.operation_id.to_owned(),
                requested_headers: preflight_target
                    .requested_headers()
                    .iter()
                    .map(|header| header.as_str().to_owned())
                    .collect(),
            });
        }
        let parameter_schema = match path.parameter {
            PathParameterKind::None => None,
            PathParameterKind::CanonicalUuid => Some("CanonicalUuid".to_owned()),
            PathParameterKind::PackId => Some("PackId".to_owned()),
        };
        if paths
            .insert(
                path.template.to_owned(),
                OwnedPath {
                    parameter_schema,
                    concrete,
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
    for operation in &OPERATION_CONTRACTS {
        if operation.messages.operation_id != operation.operation_id {
            return Err(format!(
                "{} points at message contract {}",
                operation.operation_id, operation.messages.operation_id
            ));
        }
        if operations
            .insert(
                operation.operation_id.to_owned(),
                OwnedOperation {
                    path: operation.path.contract().template.to_owned(),
                    method: operation.method.as_str().to_owned(),
                    access: owned_access(operation.access),
                    messages: owned_message(operation.messages)?,
                },
            )
            .is_some()
        {
            return Err(format!(
                "duplicate Rust operation id {}",
                operation.operation_id
            ));
        }
    }
    Ok(RoutingProjection {
        policy: OwnedPolicy {
            credentials: "prohibited".to_owned(),
            allow_methods: GLOBAL_METHODS
                .iter()
                .map(|method| method.as_str().to_owned())
                .collect(),
            allow_headers: PREFLIGHT_ALLOWED_HEADERS
                .iter()
                .map(|header| header.as_str().to_owned())
                .collect(),
            requested_header_comparison: "ascii-case-insensitive-exact-set".to_owned(),
            requires_declared_concrete_target: true,
            rejects_body: true,
            rejects_credentials: true,
            rejects_options_target: true,
            unknown_route_status: 404,
            unknown_route_code: "resource-not-found".to_owned(),
        },
        paths,
        operations,
    })
}

fn derive_preflight_methods(path: &OwnedPath) -> Vec<String> {
    path.concrete
        .iter()
        .map(|target| target.method.clone())
        .chain(["OPTIONS".to_owned()])
        .collect()
}

fn validate_projection_derivations(projection: &RoutingProjection) -> Result<(), String> {
    for (template, path) in &projection.paths {
        if path.preflight_methods != derive_preflight_methods(path) {
            return Err(format!("{template} preflight methods are not derived"));
        }
        for target in &path.concrete {
            let operation = projection
                .operations
                .get(&target.operation_id)
                .ok_or_else(|| format!("{} is not an operation", target.operation_id))?;
            if operation.path != *template || operation.method != target.method {
                return Err(format!(
                    "{} target is not joined exactly",
                    target.operation_id
                ));
            }
            if target.requested_headers
                != requested_headers(&operation.access, &operation.messages.request)
            {
                return Err(format!(
                    "{} requested headers are not derived",
                    target.operation_id
                ));
            }
        }
    }
    Ok(())
}

#[test]
fn c7_rust_router_projection_equals_c4_and_c5_as_complete_runtime_data() {
    let document: Value = yaml_serde::from_str(OPENAPI).unwrap();
    let yaml = extract_routing_projection(&document).unwrap();
    let rust = rust_routing_projection().unwrap();
    validate_projection_derivations(&yaml).unwrap();
    validate_projection_derivations(&rust).unwrap();
    assert_eq!(yaml, rust);

    assert_eq!(rust.paths.len(), 12);
    assert_eq!(rust.operations.len(), 26);
    assert_eq!(
        rust.paths
            .values()
            .map(|path| path.concrete.len())
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
    let table_ids: BTreeSet<_> = OPERATION_CONTRACTS
        .iter()
        .map(|operation| operation.operation_id)
        .collect();
    let message_ids: BTreeSet<_> = OPERATION_MESSAGE_CONTRACTS
        .iter()
        .map(|operation| operation.operation_id)
        .collect();
    assert_eq!(table_ids.len(), 26);
    assert_eq!(message_ids.len(), 26);
    assert_eq!(table_ids, message_ids);

    let mut common_preflight_responses = None;
    for operation in OPERATION_CONTRACTS
        .iter()
        .filter(|operation| operation.method == Method::Options)
    {
        assert_eq!(operation.access.auth, AuthClass::Preflight);
        assert_eq!(operation.access.scope, None);
        assert_eq!(operation.access.ownership, OwnershipClass::None);
        assert_eq!(operation.messages.request, RequestMessage::None);
        assert_eq!(operation.messages.operation_id, operation.operation_id);
        let responses = owned_responses(operation.messages.responses).unwrap();
        assert_eq!(
            responses.keys().copied().collect::<Vec<_>>(),
            [204, 400, 403, 405, 408, 413, 414, 431, 503]
        );
        match &common_preflight_responses {
            None => common_preflight_responses = Some(responses),
            Some(common) => assert_eq!(&responses, common),
        }
    }
}

fn operation_value_mut<'a>(document: &'a mut Value, id: &str) -> &'a mut Map<String, Value> {
    for path_item in document["paths"].as_object_mut().unwrap().values_mut() {
        for (key, operation) in path_item.as_object_mut().unwrap() {
            if key != "parameters"
                && operation.get("operationId").and_then(Value::as_str) == Some(id)
            {
                return operation.as_object_mut().unwrap();
            }
        }
    }
    panic!("missing operation {id}")
}

fn response_component_value_mut<'a>(
    document: &'a mut Value,
    operation_id: &str,
    status: &str,
) -> &'a mut Map<String, Value> {
    let reference = operation_value_mut(document, operation_id)["responses"][status]["$ref"]
        .as_str()
        .unwrap()
        .strip_prefix("#/components/responses/")
        .unwrap()
        .to_owned();
    document["components"]["responses"][reference]
        .as_object_mut()
        .unwrap()
}

fn assert_routing_mutation_detected(label: &str, mutator: impl FnOnce(&mut Value)) {
    let expected = rust_routing_projection().unwrap();
    let mut document: Value = yaml_serde::from_str(OPENAPI).unwrap();
    mutator(&mut document);
    let actual = extract_routing_projection(&document);
    assert_ne!(
        actual.as_ref().ok(),
        Some(&expected),
        "mutation escaped: {label}"
    );
}

#[test]
fn c7_c4_c5_routing_mutation_families_all_fail_closed() {
    assert_routing_mutation_detected("add path", |document| {
        let mut extra = document["paths"]["/v1/health"].clone();
        extra["get"]["operationId"] = Value::String("extraHealth".to_owned());
        extra["options"]["operationId"] = Value::String("preflightExtraHealth".to_owned());
        document["paths"]["/v1/extra"] = extra;
    });
    assert_routing_mutation_detected("remove path", |document| {
        document["paths"]
            .as_object_mut()
            .unwrap()
            .remove("/v1/health");
    });
    assert_routing_mutation_detected("rename path", |document| {
        let path = document["paths"]
            .as_object_mut()
            .unwrap()
            .remove("/v1/health")
            .unwrap();
        document["paths"]["/v1/Health"] = path;
    });
    assert_routing_mutation_detected("add standard method target", |document| {
        let mut post = document["paths"]["/v1/health"]["get"].clone();
        post["operationId"] = Value::String("postHealth".to_owned());
        document["paths"]["/v1/health"]["post"] = post;
        document["x-ovp-http-policy"]["accessByOperation"]["postHealth"] =
            document["x-ovp-http-policy"]["accessByOperation"]["getHealth"].clone();
    });
    assert_routing_mutation_detected("remove concrete method", |document| {
        document["paths"]["/v1/health"]
            .as_object_mut()
            .unwrap()
            .remove("get");
        document["x-ovp-http-policy"]["accessByOperation"]
            .as_object_mut()
            .unwrap()
            .remove("getHealth");
    });
    assert_routing_mutation_detected("change concrete method", |document| {
        let operation = document["paths"]["/v1/health"]
            .as_object_mut()
            .unwrap()
            .remove("get")
            .unwrap();
        document["paths"]["/v1/health"]["post"] = operation;
    });
    assert_routing_mutation_detected("add operation id", |document| {
        operation_value_mut(document, "getHealth")["operationId"] =
            Value::String("getHealthV2".to_owned());
        let access = document["x-ovp-http-policy"]["accessByOperation"]
            .as_object_mut()
            .unwrap()
            .remove("getHealth")
            .unwrap();
        document["x-ovp-http-policy"]["accessByOperation"]["getHealthV2"] = access;
    });
    assert_routing_mutation_detected("remove operation id", |document| {
        operation_value_mut(document, "getHealth").remove("operationId");
    });
    assert_routing_mutation_detected("duplicate operation id", |document| {
        operation_value_mut(document, "createPairingChallenge")["operationId"] =
            Value::String("getHealth".to_owned());
    });
    assert_routing_mutation_detected("swap preflight operation ids", |document| {
        operation_value_mut(document, "preflightHealth")["operationId"] =
            Value::String("C7_TEMP_PREFLIGHT".to_owned());
        operation_value_mut(document, "preflightRuntime")["operationId"] =
            Value::String("preflightHealth".to_owned());
        operation_value_mut(document, "C7_TEMP_PREFLIGHT")["operationId"] =
            Value::String("preflightRuntime".to_owned());
    });
    assert_routing_mutation_detected("change UUID parameter schema", |document| {
        document["components"]["parameters"]["ChallengeId"]["schema"]["$ref"] =
            Value::String("#/components/schemas/PackId".to_owned());
    });
    assert_routing_mutation_detected("change PackId parameter schema", |document| {
        document["components"]["parameters"]["PackId"]["schema"]["$ref"] =
            Value::String("#/components/schemas/CanonicalUuid".to_owned());
    });
    assert_routing_mutation_detected("change auth", |document| {
        document["x-ovp-http-policy"]["accessByOperation"]["getRuntime"]["auth"] =
            Value::String("origin-only".to_owned());
    });
    assert_routing_mutation_detected("change scope", |document| {
        document["x-ovp-http-policy"]["accessByOperation"]["getRuntime"]["scope"] =
            Value::String("jobs:read".to_owned());
    });
    assert_routing_mutation_detected("change ownership", |document| {
        document["x-ovp-http-policy"]["accessByOperation"]["getRuntime"]["ownership"] =
            Value::String("job-owner".to_owned());
    });
    assert_routing_mutation_detected("add concrete target", |document| {
        let mut post = document["paths"]["/v1/health"]["get"].clone();
        post["operationId"] = Value::String("postHealth".to_owned());
        document["paths"]["/v1/health"]["post"] = post;
        document["x-ovp-http-policy"]["accessByOperation"]["postHealth"] =
            document["x-ovp-http-policy"]["accessByOperation"]["getHealth"].clone();
    });
    assert_routing_mutation_detected("remove concrete target", |document| {
        document["paths"]["/v1/pairings/current"]
            .as_object_mut()
            .unwrap()
            .remove("delete");
        document["x-ovp-http-policy"]["accessByOperation"]
            .as_object_mut()
            .unwrap()
            .remove("revokeCurrentPairing");
    });
    assert_routing_mutation_detected("swap concrete targets", |document| {
        operation_value_mut(document, "getCurrentPairing")["operationId"] =
            Value::String("C7_TEMP_CONCRETE".to_owned());
        operation_value_mut(document, "revokeCurrentPairing")["operationId"] =
            Value::String("getCurrentPairing".to_owned());
        operation_value_mut(document, "C7_TEMP_CONCRETE")["operationId"] =
            Value::String("revokeCurrentPairing".to_owned());
    });
    assert_routing_mutation_detected("request body requiredness", |document| {
        operation_value_mut(document, "createJob")["requestBody"]["required"] = Value::Bool(false);
    });
    assert_routing_mutation_detected("request body media", |document| {
        let content = operation_value_mut(document, "createJob")["requestBody"]["content"]
            .as_object_mut()
            .unwrap();
        let body = content.remove("application/json").unwrap();
        content.insert("text/json".to_owned(), body);
    });
    assert_routing_mutation_detected("request body schema", |document| {
        operation_value_mut(document, "createJob")["requestBody"]["content"]["application/json"]
            ["schema"]["$ref"] =
            Value::String("#/components/schemas/PairingChallengeRequest".to_owned());
    });
    assert_routing_mutation_detected("success status", |document| {
        let response = operation_value_mut(document, "getHealth")["responses"]
            .as_object_mut()
            .unwrap()
            .remove("200")
            .unwrap();
        operation_value_mut(document, "getHealth")["responses"]["201"] = response;
    });
    assert_routing_mutation_detected("success body", |document| {
        response_component_value_mut(document, "getHealth", "200")["content"] = json!({
            "application/json": {
                "schema": { "$ref": "#/components/schemas/RuntimeResponse" }
            }
        });
    });
    assert_routing_mutation_detected("error status", |document| {
        let response = operation_value_mut(document, "getHealth")["responses"]
            .as_object_mut()
            .unwrap()
            .remove("400")
            .unwrap();
        operation_value_mut(document, "getHealth")["responses"]["418"] = response;
    });
    assert_routing_mutation_detected("error body", |document| {
        response_component_value_mut(document, "getHealth", "400")["content"] = json!({
            "application/json": {
                "schema": { "$ref": "#/components/schemas/HealthResponse" }
            }
        });
    });
    assert_routing_mutation_detected("preflight method enum", |document| {
        document["components"]["parameters"]["PreflightGetMethod"]["schema"]["enum"] =
            json!(["POST", "OPTIONS"]);
    });
    assert_routing_mutation_detected("requested-header comparison", |document| {
        document["x-ovp-http-policy"]["preflight"]["requestedHeaderComparison"] =
            Value::String("ascii-case-insensitive-subset".to_owned());
    });
    assert_routing_mutation_detected("credentials policy", |document| {
        document["x-ovp-http-policy"]["credentials"] = Value::String("allowed".to_owned());
    });
    for (label, field) in [
        ("declared target boolean", "requiresDeclaredConcreteTarget"),
        ("body boolean", "rejectsBody"),
        ("credential boolean", "rejectsCredentials"),
        ("OPTIONS target boolean", "rejectsOptionsTarget"),
    ] {
        assert_routing_mutation_detected(label, |document| {
            document["x-ovp-http-policy"]["preflight"][field] = Value::Bool(false);
        });
    }
    assert_routing_mutation_detected("add global allowed method", |document| {
        document["x-ovp-http-policy"]["preflight"]["allowMethods"]
            .as_array_mut()
            .unwrap()
            .push(Value::String("PATCH".to_owned()));
    });
    assert_routing_mutation_detected("remove global allowed method", |document| {
        document["x-ovp-http-policy"]["preflight"]["allowMethods"]
            .as_array_mut()
            .unwrap()
            .remove(0);
    });
    assert_routing_mutation_detected("reorder global allowed methods", |document| {
        document["x-ovp-http-policy"]["preflight"]["allowMethods"]
            .as_array_mut()
            .unwrap()
            .swap(0, 1);
    });
    assert_routing_mutation_detected("add global allowed header", |document| {
        document["x-ovp-http-policy"]["preflight"]["allowHeaders"]
            .as_array_mut()
            .unwrap()
            .push(Value::String("X-C7-Extra".to_owned()));
    });
    assert_routing_mutation_detected("remove global allowed header", |document| {
        document["x-ovp-http-policy"]["preflight"]["allowHeaders"]
            .as_array_mut()
            .unwrap()
            .remove(0);
    });
    assert_routing_mutation_detected("reorder global allowed headers", |document| {
        document["x-ovp-http-policy"]["preflight"]["allowHeaders"]
            .as_array_mut()
            .unwrap()
            .swap(0, 1);
    });
    assert_routing_mutation_detected("unknown route status", |document| {
        document["x-ovp-http-policy"]["unknownRoute"]["status"] = Value::from(400_u16);
    });
    assert_routing_mutation_detected("unknown route code", |document| {
        document["x-ovp-http-policy"]["unknownRoute"]["code"] =
            Value::String("schema-invalid".to_owned());
    });
    assert_routing_mutation_detected("undeclared path operation", |document| {
        let mut head = document["paths"]["/v1/health"]["get"].clone();
        head["operationId"] = Value::String("headHealth".to_owned());
        document["paths"]["/v1/health"]["head"] = head;
    });
}

#[test]
fn c7_cloned_rust_projection_rejects_method_and_requested_header_drift() {
    let baseline = rust_routing_projection().unwrap();
    validate_projection_derivations(&baseline).unwrap();

    let mut added = baseline.clone();
    let health = added.paths.get_mut("/v1/health").unwrap();
    let original_allow = derive_preflight_methods(health);
    let create_job = baseline.operations.get("createJob").unwrap();
    health.concrete.push(OwnedConcreteTarget {
        method: "POST".to_owned(),
        operation_id: "createJob".to_owned(),
        requested_headers: health.concrete[0].requested_headers.clone(),
    });
    assert_ne!(derive_preflight_methods(health), original_allow);
    assert_ne!(
        health.concrete.last().unwrap().requested_headers,
        requested_headers(&create_job.access, &create_job.messages.request)
    );
    assert!(validate_projection_derivations(&added).is_err());

    let mut removed = baseline.clone();
    let current = removed.paths.get_mut("/v1/pairings/current").unwrap();
    let original_allow = derive_preflight_methods(current);
    current.concrete.remove(0);
    assert_ne!(derive_preflight_methods(current), original_allow);
    assert!(validate_projection_derivations(&removed).is_err());

    let mut reordered = baseline.clone();
    let current = reordered.paths.get_mut("/v1/pairings/current").unwrap();
    let original_allow = derive_preflight_methods(current);
    current.concrete.swap(0, 1);
    assert_ne!(derive_preflight_methods(current), original_allow);
    assert!(validate_projection_derivations(&reordered).is_err());

    for mutation in ["add", "remove", "reorder"] {
        let mut changed = baseline.clone();
        let target = &mut changed.paths.get_mut("/v1/jobs").unwrap().concrete[0];
        match mutation {
            "add" => target.requested_headers.push("X-C7-Extra".to_owned()),
            "remove" => {
                target.requested_headers.remove(0);
            }
            "reorder" => target.requested_headers.swap(0, 1),
            _ => unreachable!(),
        }
        assert!(
            validate_projection_derivations(&changed).is_err(),
            "requested header {mutation} escaped"
        );
    }
}

#[test]
fn c7_every_path_method_and_preflight_method_is_exhaustively_classified() {
    let raw_methods = [
        "GET",
        "POST",
        "DELETE",
        "OPTIONS",
        "HEAD",
        "PUT",
        "PATCH",
        "CONNECT",
        "TRACE",
        "get",
        "C7-EXTENSION",
    ];
    let requested_methods = ["GET", "POST", "DELETE", "OPTIONS", "HEAD", "PUT", "", "get"];

    for path in &PATH_CONTRACTS {
        let target = exemplar_target(path);
        for raw_method in raw_methods {
            let result = resolve_route(raw_method, &target);
            if raw_method == "OPTIONS" {
                let RouteMatch::Preflight(route) = result.unwrap() else {
                    panic!("{} OPTIONS was not preflight", path.template)
                };
                assert_eq!(route.path(), path.id);
                assert_eq!(route.operation(), path.preflight_operation);
                continue;
            }
            let declared = path
                .concrete_operations
                .iter()
                .copied()
                .find(|operation| operation.contract().method.as_str() == raw_method);
            match declared {
                Some(operation) => {
                    let RouteMatch::Concrete(route) = result.unwrap() else {
                        panic!("{} {raw_method} was not concrete", path.template)
                    };
                    assert_eq!(route.path(), path.id);
                    assert_eq!(route.operation(), operation);
                }
                None => {
                    let error = result.unwrap_err();
                    assert_eq!(error, RouteError::MethodNotAllowed { path: path.id });
                    assert_eq!(error.allow(), Some(path.allow()));
                }
            }
        }

        let RouteMatch::Preflight(preflight) = resolve_route("OPTIONS", &target).unwrap() else {
            unreachable!()
        };
        for requested_method in requested_methods {
            let declared = path
                .concrete_operations
                .iter()
                .copied()
                .find(|operation| operation.contract().method.as_str() == requested_method);
            let result = preflight.resolve_requested_method(requested_method);
            if let Some(operation) = declared {
                let resolved = result.unwrap();
                assert_eq!(resolved.operation(), operation);
                let projected = owned_access(operation.contract().access);
                let request = owned_request(operation.contract().messages.request);
                assert_eq!(
                    resolved
                        .requested_headers()
                        .iter()
                        .map(|header| header.as_str().to_owned())
                        .collect::<Vec<_>>(),
                    requested_headers(&projected, &request)
                );
            } else if matches!(requested_method, "GET" | "POST" | "DELETE" | "OPTIONS") {
                assert_eq!(
                    result.unwrap_err(),
                    RouteError::MethodNotAllowed { path: path.id }
                );
            } else {
                assert_eq!(result.unwrap_err(), RouteError::InvalidPreflightMethod);
            }
        }
    }
}

fn uppercase_first_ascii_letter(value: &str) -> String {
    let mut bytes = value.as_bytes().to_vec();
    let index = bytes
        .iter()
        .position(u8::is_ascii_lowercase)
        .expect("route has a lowercase ASCII letter");
    bytes[index] = bytes[index].to_ascii_uppercase();
    String::from_utf8(bytes).unwrap()
}

fn assert_target_mutation_rejected(path: &PathContract, mutated: &str) {
    assert!(
        resolve_route(
            path.concrete_operations[0].contract().method.as_str(),
            mutated,
        )
        .is_err(),
        "{} aliased through {mutated:?}",
        path.template
    );
}

#[test]
fn c7_every_accepted_target_rejects_lexical_and_segment_aliases() {
    for path in &PATH_CONTRACTS {
        let target = exemplar_target(path);
        let internal_duplicate = format!("/{}", target[1..].replacen('/', "//", 1));
        let perturbations = [
            format!("{target}?"),
            format!("{target}?x=1"),
            format!("{target}#C7"),
            target.replacen('v', "%76", 1),
            target.replacen("/v1/", "/v1\\", 1),
            internal_duplicate,
            format!("{target}/"),
            target.replacen("/v1/", "/v1/./", 1),
            target.replacen("/v1/", "/v1/../", 1),
            format!("{target}\0"),
            format!("{target}\u{7f}"),
            format!("{target}Г©"),
            uppercase_first_ascii_letter(&target),
        ];
        for mutated in perturbations {
            assert_target_mutation_rejected(path, &mutated);
        }

        for boundary in target.match_indices('/').map(|(index, _)| index) {
            let mut duplicate = target.clone();
            duplicate.insert(boundary, '/');
            assert_target_mutation_rejected(path, &duplicate);

            let mut dot = target.clone();
            dot.insert_str(boundary + 1, "./");
            assert_target_mutation_rejected(path, &dot);

            let mut dot_dot = target.clone();
            dot_dot.insert_str(boundary + 1, "../");
            assert_target_mutation_rejected(path, &dot_dot);

            let mut backslash = target.clone();
            backslash.replace_range(boundary..=boundary, "\\");
            assert_target_mutation_rejected(path, &backslash);

            let mut encoded = target.clone();
            encoded.replace_range(boundary..=boundary, "%2f");
            assert_target_mutation_rejected(path, &encoded);

            let mut control = target.clone();
            control.insert(boundary + 1, '\u{1f}');
            assert_target_mutation_rejected(path, &control);

            let mut non_ascii = target.clone();
            non_ascii.insert(boundary + 1, '\u{e9}');
            assert_target_mutation_rejected(path, &non_ascii);
        }

        let mut segment_start = 1;
        for segment in target[1..].split('/') {
            if let Some(relative) = segment.bytes().position(|byte| byte.is_ascii_lowercase()) {
                let mut changed_case = target.as_bytes().to_vec();
                let index = segment_start + relative;
                changed_case[index] = changed_case[index].to_ascii_uppercase();
                assert_target_mutation_rejected(path, &String::from_utf8(changed_case).unwrap());
            }
            segment_start += segment.len() + 1;
        }
    }
}

fn assert_typed_parameter_rejection(
    path: &PathContract,
    value: &str,
    expected_kind: PathParameterKind,
) {
    let target = path.template.replace("{id}", value);
    let error = resolve_route(
        path.concrete_operations[0].contract().method.as_str(),
        &target,
    )
    .unwrap_err();
    assert!(
        matches!(
            error,
            RouteError::InvalidPathParameter { path: id, kind }
                if id == path.id && kind == expected_kind
        ) || error == RouteError::InvalidOriginForm,
        "{} classified {value:?} as {error:?}",
        path.template
    );
}

#[test]
fn c7_uuid_and_pack_slots_reject_every_noncanonical_family() {
    let canonical = "abcdefab-cdef-4abc-8def-abcdefabcdef";
    CanonicalUuid::parse(canonical).unwrap();
    let mut uuid_mutations = vec![
        canonical[..35].to_owned(),
        format!("{canonical}0"),
        canonical.to_ascii_uppercase(),
        canonical.replacen('a', "g", 1),
        format!("{{{canonical}}}"),
        format!("urn:uuid:{canonical}"),
        canonical.replace('-', ""),
        canonical.replacen('a', "%61", 1),
    ];
    for index in [8, 13, 18, 23] {
        let mut removed = canonical.to_owned();
        removed.remove(index);
        uuid_mutations.push(removed);
    }
    for path in PATH_CONTRACTS
        .iter()
        .filter(|path| path.parameter == PathParameterKind::CanonicalUuid)
    {
        for mutation in &uuid_mutations {
            assert_typed_parameter_rejection(path, mutation, PathParameterKind::CanonicalUuid);
        }
    }

    let pack_mutations = [
        "Pocket-companion-pack",
        "pocket-companion",
        "pocket-companion-pack-extra",
        "pocket_companion_pack",
        "pocket.companion.pack",
        "upstream-pack",
        "voice-identifier",
        "pocket-%63ompanion-pack",
    ];
    let pack_path = PathId::PackActions.contract();
    for mutation in pack_mutations {
        assert_typed_parameter_rejection(pack_path, mutation, PathParameterKind::PackId);
    }
}

#[test]
fn c7_every_template_prefix_suffix_and_extra_segment_is_classified_without_disclosure() {
    for path in &PATH_CONTRACTS {
        let target = exemplar_target(path);
        assert_eq!(
            resolve_route("GET", target.trim_start_matches('/')).unwrap_err(),
            RouteError::NonOriginForm
        );
        assert_eq!(
            resolve_route("GET", &format!("/C7_PREFIX{target}")).unwrap_err(),
            RouteError::ResourceNotFound
        );
        let extra_error = resolve_route("GET", &format!("{target}/C7_EXTRA_SEGMENT")).unwrap_err();
        if path.id == PathId::Jobs {
            assert_eq!(
                extra_error,
                RouteError::InvalidPathParameter {
                    path: PathId::Job,
                    kind: PathParameterKind::CanonicalUuid,
                }
            );
        } else {
            assert_eq!(extra_error, RouteError::ResourceNotFound);
        }
        let suffix_error = resolve_route("GET", &format!("{target}C7_SUFFIX")).unwrap_err();
        if path.template.ends_with("{id}") {
            assert_eq!(
                suffix_error,
                RouteError::InvalidPathParameter {
                    path: path.id,
                    kind: path.parameter,
                }
            );
        } else {
            assert_eq!(suffix_error, RouteError::ResourceNotFound);
        }
        assert_eq!(
            resolve_route("GET", &format!("{target}/")).unwrap_err(),
            RouteError::InvalidOriginForm
        );
    }

    const SENTINEL: &str = "C7_UNIQUE_RAW_TARGET_SENTINEL_28f3";
    let error = resolve_route("C7-EXTENSION", &format!("/v1/{SENTINEL}"))
        .unwrap_err()
        .to_string();
    assert!(!error.contains(SENTINEL));
}
