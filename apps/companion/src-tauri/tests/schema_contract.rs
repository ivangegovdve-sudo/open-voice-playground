use open_voice_companion::schema::OpenApiSchemas;

const VALID_JOB: &str = include_str!("../../openapi/fixtures/job-create.valid.json");
const INVALID_JOBS: &str = include_str!("../../openapi/fixtures/job-create.invalid.json");

#[test]
fn rust_validates_shared_fixtures_against_the_authoritative_openapi_schema() {
    let schemas = OpenApiSchemas::embedded().expect("embedded OpenAPI must compile");
    let valid: serde_json::Value = serde_json::from_str(VALID_JOB).unwrap();
    assert!(schemas.validate("JobCreateRequest", &valid).is_ok());

    let invalid: Vec<serde_json::Value> = serde_json::from_str(INVALID_JOBS).unwrap();
    for fixture in invalid {
        assert!(schemas.validate("JobCreateRequest", &fixture).is_err());
    }
    assert!(schemas.validate("MissingSchema", &valid).is_err());
}
