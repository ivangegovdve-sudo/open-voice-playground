use open_voice_companion::protocol::{
    ALL_PROBLEM_CODES, HTTP_PROBLEM_CODES, NON_HTTP_PROBLEM_CODES, Problem, ProblemClassification,
    ProblemCode,
};

#[test]
fn checked_problem_constructor_has_no_numeric_status_input() {
    let constructor: fn(ProblemCode) -> Problem = Problem::new;
    let problem = constructor(ProblemCode::VersionUnsupported);
    assert_eq!(problem.status(), 426);
    assert_eq!(problem.code(), ProblemCode::VersionUnsupported);
    let value = serde_json::to_value(problem).unwrap();
    assert_eq!(value["status"], 426);
    assert_eq!(value["code"], "version-unsupported");
}

#[test]
fn one_catalog_entry_owns_every_checked_problem_tuple_and_partition() {
    assert_eq!(ALL_PROBLEM_CODES.len(), 35);
    assert_eq!(HTTP_PROBLEM_CODES.len(), 34);
    assert_eq!(NON_HTTP_PROBLEM_CODES, [ProblemCode::ListenerConflict]);
    let relative_http = ALL_PROBLEM_CODES
        .into_iter()
        .filter(|code| *code != ProblemCode::ListenerConflict)
        .collect::<Vec<_>>();
    assert_eq!(HTTP_PROBLEM_CODES, relative_http.as_slice());

    for code in ALL_PROBLEM_CODES {
        let entry = code.catalog();
        assert_eq!(entry.code(), code);
        assert_eq!(
            entry.problem_type(),
            format!("urn:ovp:problem:{}", code.as_str())
        );
        assert!(!entry.title().is_empty());
        assert!(!entry.detail().is_empty());
        assert!((400..=599).contains(&entry.status()));
        assert_eq!(
            entry.classification(),
            if code == ProblemCode::ListenerConflict {
                ProblemClassification::NonHttp
            } else {
                ProblemClassification::Http
            }
        );
    }
}
