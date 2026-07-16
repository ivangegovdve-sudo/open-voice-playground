use open_voice_companion::schema::OpenApiSchemas;

#[test]
fn embedded_schemas_compile_and_reject_unknown_schemas() {
    let schemas = OpenApiSchemas::embedded().expect("embedded OpenAPI must compile");
    let valid = serde_json::json!({
        "voiceId": "pocket:alba",
        "text": "Exact text, preserved byte for byte."
    });
    assert!(schemas.validate("JobCreateRequest", &valid).is_ok());
    assert!(schemas.validate("MissingSchema", &valid).is_err());
}
