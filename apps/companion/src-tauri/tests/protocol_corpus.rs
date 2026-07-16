use std::collections::BTreeSet;

use open_voice_companion::{
    protocol::{
        ALL_PROBLEM_CODES, JobCreateRequest, Problem, ProblemCode, Scope, VoiceId,
        negotiate_version, validate_canonical_uuid, validate_client_label, validate_opaque_secret,
        validate_scope_list, validate_synthesis_text,
    },
    schema::OpenApiSchemas,
};
use serde::Deserialize;
use serde_json::Value;

const CORPUS: &str = include_str!("../../openapi/fixtures/protocol-corpus.json");

#[derive(Debug, Deserialize)]
struct Corpus {
    version: u64,
    cases: Vec<CorpusCase>,
}

#[derive(Debug, Deserialize)]
struct CorpusCase {
    id: String,
    schema: String,
    valid: bool,
    value: Value,
    native: Option<String>,
}

fn parse_corpus() -> Corpus {
    serde_json::from_str(CORPUS).expect("the checked-in corpus must be valid JSON")
}

#[test]
fn rust_draft_2020_12_validators_execute_the_entire_corpus() {
    let corpus = parse_corpus();
    assert_eq!(corpus.version, 1);
    let schemas = OpenApiSchemas::embedded().expect("embedded OpenAPI must compile");
    for case in corpus.cases {
        let actual = schemas.validate(&case.schema, &case.value).is_ok();
        assert_eq!(actual, case.valid, "schema corpus case {}", case.id);
    }
}

#[test]
fn currently_owned_native_semantics_agree_and_positive_values_round_trip_exactly() {
    let corpus = parse_corpus();
    for case in corpus
        .cases
        .into_iter()
        .filter(|case| case.native.is_some())
    {
        let native = case.native.as_deref().unwrap();
        let (actual, round_trip) = match native {
            "voice-id" => serde_json::from_value::<VoiceId>(case.value.clone())
                .map(|value| (true, Some(serde_json::to_value(value).unwrap())))
                .unwrap_or((false, None)),
            "scope" => serde_json::from_value::<Scope>(case.value.clone())
                .map(|value| (true, Some(serde_json::to_value(value).unwrap())))
                .unwrap_or((false, None)),
            "scope-list" => serde_json::from_value::<Vec<Scope>>(case.value.clone())
                .map(|value| {
                    let valid = validate_scope_list(&value).is_ok();
                    let serialized = valid.then(|| serde_json::to_value(value).unwrap());
                    (valid, serialized)
                })
                .unwrap_or((false, None)),
            "secret" => (
                case.value
                    .as_str()
                    .is_some_and(|value| validate_opaque_secret(value).is_ok()),
                Some(case.value.clone()),
            ),
            "version" => (
                case.value
                    .as_str()
                    .is_some_and(|value| negotiate_version(Some(value)).is_ok()),
                Some(case.value.clone()),
            ),
            "uuid" => (
                case.value
                    .as_str()
                    .is_some_and(|value| validate_canonical_uuid(value).is_ok()),
                Some(case.value.clone()),
            ),
            "label" => (
                case.value
                    .as_str()
                    .is_some_and(|value| validate_client_label(value).is_ok()),
                Some(case.value.clone()),
            ),
            "text" => (
                case.value
                    .as_str()
                    .is_some_and(|value| validate_synthesis_text(value).is_ok()),
                Some(case.value.clone()),
            ),
            "job" => serde_json::from_value::<JobCreateRequest>(case.value.clone())
                .map(|value| (true, Some(serde_json::to_value(value).unwrap())))
                .unwrap_or((false, None)),
            "problem" => serde_json::from_value::<Problem>(case.value.clone())
                .map(|value| {
                    let valid = value.is_catalog_valid();
                    let serialized = valid.then(|| serde_json::to_value(value).unwrap());
                    (valid, serialized)
                })
                .unwrap_or((false, None)),
            "problem-code" => serde_json::from_value::<ProblemCode>(case.value.clone())
                .map(|value| (true, Some(serde_json::to_value(value).unwrap())))
                .unwrap_or((false, None)),
            unknown => panic!("unknown native corpus path {unknown}"),
        };
        assert_eq!(actual, case.valid, "native corpus case {}", case.id);
        if case.valid {
            assert_eq!(
                round_trip.as_ref(),
                Some(&case.value),
                "round trip {}",
                case.id
            );
        }
    }
}

#[test]
fn native_problem_code_catalog_exactly_matches_the_positive_corpus_set() {
    let corpus_codes = parse_corpus()
        .cases
        .into_iter()
        .filter(|case| case.schema == "ProblemCode" && case.valid)
        .map(|case| case.value.as_str().unwrap().to_owned())
        .collect::<BTreeSet<_>>();
    let native_codes = ALL_PROBLEM_CODES
        .iter()
        .map(|code| code.as_str().to_owned())
        .collect::<BTreeSet<_>>();
    assert_eq!(native_codes, corpus_codes);
}
