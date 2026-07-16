use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

use open_voice_companion::{
    protocol::CanonicalUuid,
    rate::{
        InMemoryRateLimiter, RateClass, RateLimitError, RateLimitPort, RatePermit, RateRequest,
        RateRequestError, RateSubject, RetryAfterRangeError, RetryAfterSeconds,
    },
    router::{OPERATION_CONTRACTS, OperationId},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SubjectKind {
    Origin,
    Challenge,
    Pairing,
}

fn joined_rate_projection(operation: OperationId) -> Option<(RateClass, SubjectKind)> {
    match operation {
        OperationId::GetHealth => Some((RateClass::Health, SubjectKind::Origin)),
        OperationId::CreatePairingChallenge => {
            Some((RateClass::PairingCreate, SubjectKind::Origin))
        }
        OperationId::RedeemPairingChallenge => {
            Some((RateClass::PairingRedeem, SubjectKind::Challenge))
        }
        OperationId::GetCurrentPairing
        | OperationId::GetRuntime
        | OperationId::ListEngines
        | OperationId::ListVoices
        | OperationId::ListPacks
        | OperationId::GetJob
        | OperationId::GetJobAudio => Some((RateClass::AuthenticatedRead, SubjectKind::Pairing)),
        OperationId::CreateJob => Some((RateClass::JobCreate, SubjectKind::Pairing)),
        OperationId::RequestPackAction => Some((RateClass::PackAction, SubjectKind::Pairing)),
        OperationId::RevokeCurrentPairing
        | OperationId::CancelJob
        | OperationId::PreflightHealth
        | OperationId::PreflightPairingChallenges
        | OperationId::PreflightPairingChallengeRedeem
        | OperationId::PreflightCurrentPairing
        | OperationId::PreflightRuntime
        | OperationId::PreflightEngines
        | OperationId::PreflightVoices
        | OperationId::PreflightPacks
        | OperationId::PreflightJobs
        | OperationId::PreflightJob
        | OperationId::PreflightJobAudio
        | OperationId::PreflightPackActions => None,
    }
}

fn uuid(value: u128) -> CanonicalUuid {
    uuid::Uuid::from_u128(value).into()
}

fn request(class: RateClass, subject: RateSubject, now: Instant) -> RateRequest {
    RateRequest::new(class, subject, now).expect("test rate projection is valid")
}

fn limited_delay(result: Result<Box<dyn RatePermit>, RateLimitError>) -> u16 {
    match result {
        Err(RateLimitError::Limited(delay)) => delay.get(),
        Err(RateLimitError::Unavailable) => panic!("in-memory limiter became unavailable"),
        Ok(permit) => {
            drop(permit);
            panic!("request unexpectedly admitted")
        }
    }
}

#[test]
fn all_twenty_six_operations_join_to_exact_rate_class_and_subject_with_mutation_guards() {
    let actual = OPERATION_CONTRACTS
        .iter()
        .map(|operation| {
            (
                operation.operation_id.to_owned(),
                joined_rate_projection(operation.id),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let expected = [
        ("getHealth", Some((RateClass::Health, SubjectKind::Origin))),
        ("preflightHealth", None),
        (
            "createPairingChallenge",
            Some((RateClass::PairingCreate, SubjectKind::Origin)),
        ),
        ("preflightPairingChallenges", None),
        (
            "redeemPairingChallenge",
            Some((RateClass::PairingRedeem, SubjectKind::Challenge)),
        ),
        ("preflightPairingChallengeRedeem", None),
        (
            "getCurrentPairing",
            Some((RateClass::AuthenticatedRead, SubjectKind::Pairing)),
        ),
        ("revokeCurrentPairing", None),
        ("preflightCurrentPairing", None),
        (
            "getRuntime",
            Some((RateClass::AuthenticatedRead, SubjectKind::Pairing)),
        ),
        ("preflightRuntime", None),
        (
            "listEngines",
            Some((RateClass::AuthenticatedRead, SubjectKind::Pairing)),
        ),
        ("preflightEngines", None),
        (
            "listVoices",
            Some((RateClass::AuthenticatedRead, SubjectKind::Pairing)),
        ),
        ("preflightVoices", None),
        (
            "listPacks",
            Some((RateClass::AuthenticatedRead, SubjectKind::Pairing)),
        ),
        ("preflightPacks", None),
        (
            "createJob",
            Some((RateClass::JobCreate, SubjectKind::Pairing)),
        ),
        ("preflightJobs", None),
        (
            "getJob",
            Some((RateClass::AuthenticatedRead, SubjectKind::Pairing)),
        ),
        ("cancelJob", None),
        ("preflightJob", None),
        (
            "getJobAudio",
            Some((RateClass::AuthenticatedRead, SubjectKind::Pairing)),
        ),
        ("preflightJobAudio", None),
        (
            "requestPackAction",
            Some((RateClass::PackAction, SubjectKind::Pairing)),
        ),
        ("preflightPackActions", None),
    ]
    .into_iter()
    .map(|(operation, projection)| (operation.to_owned(), projection))
    .collect::<BTreeMap<_, _>>();

    assert_eq!(actual.len(), 26);
    assert_eq!(actual, expected);
    assert_eq!(
        actual
            .values()
            .filter(|projection| projection.is_some())
            .count(),
        12
    );

    let mut class_mutation = expected.clone();
    class_mutation.insert(
        "getHealth".to_owned(),
        Some((RateClass::PairingCreate, SubjectKind::Origin)),
    );
    assert_ne!(actual, class_mutation, "rate-class mutation escaped");

    let mut subject_mutation = expected;
    subject_mutation.insert(
        "redeemPairingChallenge".to_owned(),
        Some((RateClass::PairingRedeem, SubjectKind::Pairing)),
    );
    assert_ne!(actual, subject_mutation, "rate-subject mutation escaped");
}

#[test]
fn retry_after_accepts_only_canonical_delay_second_range() {
    assert_eq!(RetryAfterSeconds::new(1).unwrap().get(), 1);
    assert_eq!(RetryAfterSeconds::new(3_600).unwrap().get(), 3_600);
    assert_eq!(RetryAfterSeconds::new(0).unwrap_err(), RetryAfterRangeError);
    assert_eq!(
        RetryAfterSeconds::new(3_601).unwrap_err(),
        RetryAfterRangeError
    );
    assert_eq!(
        RetryAfterSeconds::new(u64::MAX).unwrap_err(),
        RetryAfterRangeError
    );
}

#[test]
fn rate_request_accepts_only_the_closed_class_subject_matrix() {
    let now = Instant::now();
    let valid = [
        (
            RateClass::Health,
            RateSubject::Origin("http://127.0.0.1:5173".to_owned()),
        ),
        (
            RateClass::PairingCreate,
            RateSubject::Origin("http://127.0.0.1:5173".to_owned()),
        ),
        (RateClass::PairingRedeem, RateSubject::Challenge(uuid(1))),
        (RateClass::AuthenticatedRead, RateSubject::Pairing(uuid(2))),
        (RateClass::JobCreate, RateSubject::Pairing(uuid(3))),
        (RateClass::PackAction, RateSubject::Pairing(uuid(4))),
    ];

    for (class, subject) in valid {
        let request = RateRequest::new(class, subject.clone(), now).unwrap();
        assert_eq!(request.class(), class);
        assert_eq!(request.subject(), &subject);
        assert_eq!(request.now(), now);
    }

    let subjects = [
        RateSubject::Origin("http://127.0.0.1:5173".to_owned()),
        RateSubject::Challenge(uuid(10)),
        RateSubject::Pairing(uuid(11)),
    ];
    for class in [
        RateClass::Health,
        RateClass::PairingCreate,
        RateClass::PairingRedeem,
        RateClass::AuthenticatedRead,
        RateClass::JobCreate,
        RateClass::PackAction,
    ] {
        for subject in &subjects {
            let accepted = matches!(
                (class, subject),
                (
                    RateClass::Health | RateClass::PairingCreate,
                    RateSubject::Origin(_)
                ) | (RateClass::PairingRedeem, RateSubject::Challenge(_))
                    | (
                        RateClass::AuthenticatedRead | RateClass::JobCreate | RateClass::PackAction,
                        RateSubject::Pairing(_)
                    )
            );
            let result = RateRequest::new(class, subject.clone(), now + Duration::from_millis(1));
            if accepted {
                assert!(result.is_ok());
            } else {
                assert_eq!(result.err(), Some(RateRequestError));
            }
        }
    }
}

#[test]
fn every_rolling_window_has_exact_limit_retry_and_reuse_boundaries() {
    let cases = [
        (
            RateClass::Health,
            RateSubject::Origin("http://127.0.0.1:5173".to_owned()),
            20,
            Duration::from_secs(60),
        ),
        (
            RateClass::PairingCreate,
            RateSubject::Origin("http://127.0.0.1:5173".to_owned()),
            3,
            Duration::from_secs(600),
        ),
        (
            RateClass::PairingRedeem,
            RateSubject::Challenge(uuid(20)),
            10,
            Duration::from_secs(120),
        ),
        (
            RateClass::AuthenticatedRead,
            RateSubject::Pairing(uuid(21)),
            60,
            Duration::from_secs(60),
        ),
        (
            RateClass::PackAction,
            RateSubject::Pairing(uuid(22)),
            3,
            Duration::from_secs(3_600),
        ),
    ];

    for (class, subject, limit, window) in cases {
        let limiter = InMemoryRateLimiter::new();
        let start = Instant::now();
        for index in 0..limit {
            limiter
                .reserve(request(class, subject.clone(), start))
                .unwrap_or_else(|_| panic!("reservation {index} of {limit} rejected"))
                .commit();
        }
        assert_eq!(
            limited_delay(limiter.reserve(request(class, subject.clone(), start))),
            window.as_secs() as u16
        );
        assert_eq!(
            limited_delay(limiter.reserve(request(
                class,
                subject.clone(),
                start + window - Duration::from_millis(1),
            ))),
            1
        );
        let permit = limiter
            .reserve(request(class, subject, start + window))
            .expect("exact expiry boundary must be reusable");
        permit.commit();
    }
}

#[test]
fn pending_reservations_count_concurrently_and_drop_rolls_capacity_back() {
    let limiter = std::sync::Arc::new(InMemoryRateLimiter::new());
    let now = Instant::now();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(25));
    let mut threads = Vec::new();
    for _ in 0..25 {
        let limiter = std::sync::Arc::clone(&limiter);
        let barrier = std::sync::Arc::clone(&barrier);
        threads.push(std::thread::spawn(move || {
            barrier.wait();
            limiter.reserve(request(
                RateClass::Health,
                RateSubject::Origin("http://127.0.0.1:5173".to_owned()),
                now,
            ))
        }));
    }
    let mut permits = Vec::new();
    let mut limited = 0;
    for thread in threads {
        match thread.join().expect("reservation thread") {
            Ok(permit) => permits.push(permit),
            Err(RateLimitError::Limited(_)) => limited += 1,
            Err(RateLimitError::Unavailable) => panic!("in-memory limiter unavailable"),
        }
    }
    assert_eq!(permits.len(), 20);
    assert_eq!(limited, 5);

    let rolled_back = permits.pop().unwrap();
    drop(rolled_back);
    let replacement = limiter
        .reserve(request(
            RateClass::Health,
            RateSubject::Origin("http://127.0.0.1:5173".to_owned()),
            now,
        ))
        .expect("drop must release exactly one pending slot");
    replacement.commit();
    for permit in permits {
        permit.commit();
    }
}

#[test]
fn rolling_windows_ignore_clock_rollback_and_clean_up_expired_or_empty_keys() {
    let limiter = InMemoryRateLimiter::new();
    let subject = RateSubject::Origin("http://127.0.0.1:5173".to_owned());
    let start = Instant::now();
    for _ in 0..3 {
        limiter
            .reserve(request(RateClass::PairingCreate, subject.clone(), start))
            .unwrap()
            .commit();
    }
    assert_eq!(
        limited_delay(limiter.reserve(request(
            RateClass::PairingCreate,
            subject.clone(),
            start + Duration::from_secs(599),
        ))),
        1
    );
    assert_eq!(
        limited_delay(limiter.reserve(request(RateClass::PairingCreate, subject.clone(), start,))),
        1,
        "clock rollback must not lengthen Retry-After"
    );
    limiter
        .reserve(request(
            RateClass::PairingCreate,
            subject.clone(),
            start + Duration::from_secs(600),
        ))
        .expect("expired key must be reusable")
        .commit();

    let empty_limiter = InMemoryRateLimiter::new();
    let mut pending = Vec::new();
    for _ in 0..3 {
        pending.push(
            empty_limiter
                .reserve(request(RateClass::PairingCreate, subject.clone(), start))
                .unwrap(),
        );
    }
    drop(pending);
    for _ in 0..3 {
        empty_limiter
            .reserve(request(RateClass::PairingCreate, subject.clone(), start))
            .expect("empty rolled-back key must not retain quota")
            .commit();
    }
}

#[test]
fn rolling_windows_expire_by_reservation_time_after_out_of_order_commits() {
    let limiter = InMemoryRateLimiter::new();
    let subject = RateSubject::Origin("http://127.0.0.1:5173".to_owned());
    let start = Instant::now();

    let oldest = limiter
        .reserve(request(RateClass::PairingCreate, subject.clone(), start))
        .unwrap();
    let newest = limiter
        .reserve(request(
            RateClass::PairingCreate,
            subject.clone(),
            start + Duration::from_secs(599),
        ))
        .unwrap();

    newest.commit();
    oldest.commit();
    limiter
        .reserve(request(
            RateClass::PairingCreate,
            subject.clone(),
            start + Duration::from_secs(599),
        ))
        .unwrap()
        .commit();

    limiter
        .reserve(request(
            RateClass::PairingCreate,
            subject,
            start + Duration::from_secs(600),
        ))
        .expect("the oldest reservation expires even when it committed last")
        .commit();
}

#[test]
fn job_creation_bucket_has_two_token_burst_integer_refill_and_exact_rollback() {
    let limiter = InMemoryRateLimiter::new();
    let subject = RateSubject::Pairing(uuid(30));
    let start = Instant::now();
    limiter
        .reserve(request(RateClass::JobCreate, subject.clone(), start))
        .unwrap()
        .commit();
    limiter
        .reserve(request(RateClass::JobCreate, subject.clone(), start))
        .unwrap()
        .commit();
    assert_eq!(
        limited_delay(limiter.reserve(request(RateClass::JobCreate, subject.clone(), start,))),
        10
    );
    assert_eq!(
        limited_delay(limiter.reserve(request(
            RateClass::JobCreate,
            subject.clone(),
            start + Duration::from_millis(9_001),
        ))),
        1
    );
    limiter
        .reserve(request(
            RateClass::JobCreate,
            subject.clone(),
            start + Duration::from_secs(10),
        ))
        .expect("one token refills at ten seconds")
        .commit();
    assert_eq!(
        limited_delay(limiter.reserve(request(RateClass::JobCreate, subject.clone(), start,))),
        10,
        "clock rollback must not manufacture refill credit"
    );

    let rollback = InMemoryRateLimiter::new();
    let first = rollback
        .reserve(request(RateClass::JobCreate, subject.clone(), start))
        .unwrap();
    let second = rollback
        .reserve(request(RateClass::JobCreate, subject.clone(), start))
        .unwrap();
    assert_eq!(
        limited_delay(rollback.reserve(request(RateClass::JobCreate, subject.clone(), start,))),
        10
    );
    drop(first);
    rollback
        .reserve(request(RateClass::JobCreate, subject.clone(), start))
        .expect("rollback restores exactly one provisional token")
        .commit();
    assert_eq!(
        limited_delay(rollback.reserve(request(RateClass::JobCreate, subject, start,))),
        10
    );
    drop(second);
}
