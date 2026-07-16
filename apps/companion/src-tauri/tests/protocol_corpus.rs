use std::collections::BTreeSet;

use open_voice_companion::{
    protocol::{ALL_PROBLEM_CODES, round_trip_owned_schema},
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
fn exhaustive_rust_serde_dispatch_agrees_and_positive_values_round_trip_exactly() {
    let corpus = parse_corpus();
    for case in corpus.cases {
        let round_trip = round_trip_owned_schema(&case.schema, case.value.clone());
        assert_eq!(
            round_trip.is_ok(),
            case.valid,
            "native corpus case {}",
            case.id
        );
        if case.valid {
            assert_eq!(
                round_trip.as_ref().unwrap(),
                &case.value,
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

#[test]
fn every_corpus_case_has_exact_rust_serde_ownership() {
    let corpus = parse_corpus();
    assert_eq!(corpus.cases.len(), 1_074);
    let missing = corpus
        .cases
        .iter()
        .filter(|case| case.native.is_none())
        .map(|case| case.id.clone())
        .collect::<Vec<_>>();
    let noncanonical = corpus
        .cases
        .iter()
        .filter(|case| {
            case.native
                .as_deref()
                .is_some_and(|native| native != "rust-serde")
        })
        .map(|case| (case.id.clone(), case.native.clone().unwrap()))
        .collect::<Vec<_>>();
    assert!(
        missing.is_empty() && noncanonical.is_empty(),
        "missing native ownership: {}; noncanonical native ownership: {}",
        missing.len(),
        noncanonical.len()
    );
}
