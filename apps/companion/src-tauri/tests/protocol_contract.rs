use open_voice_companion::protocol::{
    ALL_PROBLEM_CODES, ALL_SCOPES, ALL_VOICE_IDS, JobCreateRequest, Problem, ProblemCode,
    TextValidationError, negotiate_version, validate_synthesis_text,
};

#[test]
fn rust_contract_matches_strict_job_shape_and_exact_ids() {
    let job: JobCreateRequest = serde_json::from_value(serde_json::json!({
        "voiceId": "pocket:alba",
        "text": "Exact text, preserved byte for byte."
    }))
    .expect("valid canonical job");
    let (voice_id, text) = job.into_parts();
    assert_eq!(voice_id.as_str(), "pocket:alba");
    assert_eq!(text.as_str(), "Exact text, preserved byte for byte.");

    for fixture in [
        serde_json::json!({"voiceId": "pocket:alba"}),
        serde_json::json!({"voiceId": "pocket:alba", "text": "Exact", "extra": true}),
    ] {
        assert!(serde_json::from_value::<JobCreateRequest>(fixture).is_err());
    }

    assert_eq!(ALL_VOICE_IDS.len(), 20);
    for excluded in [
        "pocket:cosette",
        "pocket:jean",
        "pocket:giovanni",
        "pocket:lola",
        "pocket:juergen",
        "pocket:rafael",
        "alba",
    ] {
        assert!(!ALL_VOICE_IDS.contains(&excluded));
        assert!(
            serde_json::from_value::<JobCreateRequest>(serde_json::json!({
                "voiceId": excluded,
                "text": "No"
            }))
            .is_err()
        );
    }
    assert_eq!(ALL_SCOPES.len(), 7);
    assert!(ALL_PROBLEM_CODES.len() >= 35);
}

#[test]
fn text_validation_counts_scalars_and_bytes_without_rewriting() {
    assert_eq!(validate_synthesis_text(&"a".repeat(2_000)), Ok(()));
    assert_eq!(
        validate_synthesis_text(&"a".repeat(2_001)),
        Err(TextValidationError::TooManyScalars)
    );
    assert_eq!(validate_synthesis_text(&"🦀".repeat(2_000)), Ok(()));
    assert_eq!(
        validate_synthesis_text(&"🦀".repeat(2_001)),
        Err(TextValidationError::TooManyBytes)
    );
    assert_eq!(validate_synthesis_text(""), Err(TextValidationError::Empty));
    assert_eq!(
        validate_synthesis_text("hello\0world"),
        Err(TextValidationError::Nul)
    );
    assert_eq!(
        validate_synthesis_text("hello\u{0007}world"),
        Err(TextValidationError::Control)
    );
    let exact = "  keep\nthis\ttext  ";
    assert_eq!(validate_synthesis_text(exact), Ok(()));
}

#[test]
fn version_and_problem_contracts_are_stable_and_safe() {
    assert_eq!(negotiate_version(Some("1.0.0")), Ok(()));
    assert_eq!(negotiate_version(Some("1.99.3")), Ok(()));
    assert_eq!(negotiate_version(None), Err(ProblemCode::VersionMissing));
    for invalid in ["", "1", "1.0", "01.0.0", "1.0.0-beta", "2.0.0", "1.0.0.0"] {
        assert_eq!(
            negotiate_version(Some(invalid)),
            Err(ProblemCode::VersionUnsupported)
        );
    }

    let problem = Problem::new(ProblemCode::SchemaInvalid);
    let value = serde_json::to_value(problem).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 7);
    assert_eq!(value["type"], "urn:ovp:problem:schema-invalid");
    assert_eq!(
        value["detail"],
        "The request body does not match the protocol schema."
    );
    let serialized = serde_json::to_string(&value).unwrap();
    for forbidden in ["token", "verifier", "C:\\", "Authorization", "Exact text"] {
        assert!(!serialized.contains(forbidden));
    }
}

fn checked_schema_invalid_problem() -> serde_json::Value {
    serde_json::json!({
        "type": "urn:ovp:problem:schema-invalid",
        "title": "Invalid request",
        "status": 400,
        "detail": "The request body does not match the protocol schema.",
        "instance": "urn:uuid:123e4567-e89b-42d3-a456-426614174000",
        "code": "schema-invalid",
        "requestId": "123e4567-e89b-42d3-a456-426614174001"
    })
}

#[test]
fn problem_deserialization_rejects_catalog_mismatches_directly() {
    let valid = checked_schema_invalid_problem();
    assert!(serde_json::from_value::<Problem>(valid.clone()).is_ok());

    for (field, value) in [
        ("type", serde_json::json!("urn:ovp:problem:host-invalid")),
        ("title", serde_json::json!("Request rejected")),
        ("status", serde_json::json!(401)),
        ("detail", serde_json::json!("A mismatched detail.")),
        ("code", serde_json::json!("host-invalid")),
    ] {
        let mut candidate = valid.clone();
        candidate[field] = value;
        assert!(
            serde_json::from_value::<Problem>(candidate).is_err(),
            "unchecked Problem field {field}"
        );
    }
}

#[test]
fn problem_request_id_rejects_uppercase_before_uuid_normalization() {
    let mut candidate = checked_schema_invalid_problem();
    candidate["requestId"] = serde_json::json!("123E4567-E89B-42D3-A456-426614174001");
    assert!(serde_json::from_value::<Problem>(candidate).is_err());
}

#[test]
fn checked_problem_status_is_the_only_server_status_authority() {
    let server = include_str!("../src/server.rs");
    assert!(!server.contains("fn problem(code: ProblemCode, status: u16)"));
    assert!(!server.contains("status: u16,\n    origin: Option<String>"));
    assert!(!server.contains("const fn new(code: ProblemCode, status: u16)"));
    assert!(!server.contains("Problem::new(code, status)"));
}
