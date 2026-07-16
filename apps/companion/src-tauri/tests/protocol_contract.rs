use open_voice_companion::protocol::{
    ALL_PROBLEM_CODES, ALL_SCOPES, ALL_VOICE_IDS, JobCreateRequest, Problem, ProblemCode,
    TextValidationError, negotiate_version, validate_synthesis_text,
};

const VALID_JOB: &str = include_str!("../../openapi/fixtures/job-create.valid.json");
const INVALID_JOBS: &str = include_str!("../../openapi/fixtures/job-create.invalid.json");

#[test]
fn rust_contract_matches_shared_strict_fixtures_and_exact_ids() {
    let job: JobCreateRequest = serde_json::from_str(VALID_JOB).expect("valid shared fixture");
    assert_eq!(job.voice_id.as_str(), "pocket:alba");
    assert_eq!(job.text, "Exact text, preserved byte for byte.");

    let invalid: Vec<serde_json::Value> = serde_json::from_str(INVALID_JOBS).unwrap();
    for fixture in invalid {
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

    let problem = Problem::new(ProblemCode::SchemaInvalid, 400);
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
