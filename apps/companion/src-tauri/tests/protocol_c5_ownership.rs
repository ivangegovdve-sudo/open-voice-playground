use open_voice_companion::protocol::{
    CanonicalDateTime, CanonicalUuid, ClientLabel, ClientVersion, DeepLinkChallengeRequest,
    EngineListResponse, EngineResponse, HealthResponse, JobCreateRequest, JobResponse,
    ManualChallengeRequest, OWNED_SCHEMA_NAMES, OpaqueSecret, OperationalState, OwnedSchemaError,
    OwnedSchemaName, PackActionRequest, PackActionResponse, PackId, PackListResponse, PackResponse,
    PairingChallengeRequest, PairingChallengeResponse, PairingResponse, Problem, ProblemCode,
    RedeemPendingResponse, RedeemRequest, RedeemResponse, RuntimeResponse, Scope, ScopeList,
    SynthesisText, VoiceId, VoiceListResponse, VoiceResponse, round_trip_owned_schema,
};
use serde::{Serialize, de::DeserializeOwned};

fn assert_concrete_serde<T: Serialize + DeserializeOwned>() {}

#[test]
fn all_33_yaml_ordered_owned_schemas_are_concrete_serde_types() {
    assert_concrete_serde::<CanonicalUuid>();
    assert_concrete_serde::<CanonicalDateTime>();
    assert_concrete_serde::<ClientLabel>();
    assert_concrete_serde::<ClientVersion>();
    assert_concrete_serde::<SynthesisText>();
    assert_concrete_serde::<Scope>();
    assert_concrete_serde::<ScopeList>();
    assert_concrete_serde::<OpaqueSecret>();
    assert_concrete_serde::<VoiceId>();
    assert_concrete_serde::<PackId>();
    assert_concrete_serde::<OperationalState>();
    assert_concrete_serde::<ProblemCode>();
    assert_concrete_serde::<Problem>();
    assert_concrete_serde::<HealthResponse>();
    assert_concrete_serde::<DeepLinkChallengeRequest>();
    assert_concrete_serde::<ManualChallengeRequest>();
    assert_concrete_serde::<PairingChallengeRequest>();
    assert_concrete_serde::<PairingChallengeResponse>();
    assert_concrete_serde::<RedeemRequest>();
    assert_concrete_serde::<RedeemPendingResponse>();
    assert_concrete_serde::<RedeemResponse>();
    assert_concrete_serde::<PairingResponse>();
    assert_concrete_serde::<RuntimeResponse>();
    assert_concrete_serde::<EngineResponse>();
    assert_concrete_serde::<EngineListResponse>();
    assert_concrete_serde::<VoiceResponse>();
    assert_concrete_serde::<VoiceListResponse>();
    assert_concrete_serde::<PackResponse>();
    assert_concrete_serde::<PackListResponse>();
    assert_concrete_serde::<JobCreateRequest>();
    assert_concrete_serde::<JobResponse>();
    assert_concrete_serde::<PackActionRequest>();
    assert_concrete_serde::<PackActionResponse>();

    assert_eq!(
        OWNED_SCHEMA_NAMES,
        [
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
        ]
    );
}

#[test]
fn owned_schema_name_and_dispatch_are_closed_to_the_exact_inventory() {
    for name in OWNED_SCHEMA_NAMES {
        let owned = OwnedSchemaName::try_from(name).expect("owned schema literal");
        assert_eq!(owned.as_str(), name);
    }
    assert!(matches!(
        OwnedSchemaName::try_from("UnknownSchema"),
        Err(OwnedSchemaError::UnknownSchema)
    ));
    assert!(matches!(
        round_trip_owned_schema("UnknownSchema", serde_json::json!({})),
        Err(OwnedSchemaError::UnknownSchema)
    ));
}

#[test]
fn canonical_date_time_preserves_source_lexemes_and_rejects_envelope_edges() {
    for exact in [
        "2028-02-29T23:59:59Z",
        "2028-02-29T23:59:59.0Z",
        "2028-02-29T23:59:59.123400000+03:00",
        "2028-02-29T23:59:59.123456789-00:01",
    ] {
        let parsed: CanonicalDateTime = serde_json::from_value(serde_json::json!(exact)).unwrap();
        assert_eq!(
            serde_json::to_value(parsed).unwrap(),
            serde_json::json!(exact)
        );
    }

    for invalid in [
        "0000-01-01T00:00:00Z",
        "2027-02-29T00:00:00Z",
        "2028-02-29T23:59:60Z",
        "2028-02-29T23:59:59.1234567890Z",
        "2028-02-29T23:59:59-00:00",
        "2028-02-29t23:59:59z",
    ] {
        assert!(serde_json::from_value::<CanonicalDateTime>(serde_json::json!(invalid)).is_err());
    }
}

#[test]
fn scope_tuple_order_is_fixed_while_voice_lists_accept_valid_permutations() {
    let scopes = serde_json::json!([
        "health:read",
        "runtime:read",
        "synthesis:create",
        "jobs:read",
        "jobs:cancel",
        "audio:read",
        "packs:request"
    ]);
    assert!(serde_json::from_value::<ScopeList>(scopes.clone()).is_ok());
    let mut reordered_scopes = scopes.as_array().unwrap().clone();
    reordered_scopes.swap(0, 1);
    assert!(serde_json::from_value::<ScopeList>(reordered_scopes.into()).is_err());

    let corpus: serde_json::Value =
        serde_json::from_str(include_str!("../../openapi/fixtures/protocol-corpus.json")).unwrap();
    let representative = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| {
            case["schema"] == "VoiceListResponse"
                && case["valid"] == true
                && case["category"] == "representative"
        })
        .unwrap()["value"]
        .clone();
    let mut permutation = representative.clone();
    permutation["voices"].as_array_mut().unwrap().reverse();
    let parsed: VoiceListResponse = serde_json::from_value(permutation.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), permutation);

    let canonical = serde_json::to_value(VoiceListResponse::non_operational()).unwrap();
    let canonical_ids = canonical["voices"]
        .as_array()
        .unwrap()
        .iter()
        .map(|voice| voice["id"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(canonical_ids, open_voice_companion::protocol::ALL_VOICE_IDS);
}
