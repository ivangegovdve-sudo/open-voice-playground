use std::{
    cmp::{Eq, Ord, PartialEq, PartialOrd},
    fmt::{Debug, Display},
    hash::Hash,
    ops::Deref,
};

use open_voice_companion::protocol::{
    DeepLinkChallengeRequest, JobCreateRequest, ManualChallengeRequest, ManualCode, OpaqueSecret,
    PairingChallengeRequest, RedeemRequest, RedeemResponse, SynthesisText,
};

macro_rules! assert_not_impl {
    ($type:ty: $trait:path) => {
        const _: fn() = || {
            struct Probe<T: ?Sized>(std::marker::PhantomData<T>);
            trait Ambiguous<Marker> {
                fn probe() {}
            }
            struct Implemented;
            impl<T: ?Sized> Ambiguous<()> for Probe<T> {}
            impl<T: ?Sized + $trait> Ambiguous<Implemented> for Probe<T> {}
            let _ = <Probe<$type> as Ambiguous<_>>::probe;
        };
    };
}

macro_rules! assert_secret_safe {
    ($type:ty) => {
        assert_not_impl!($type: Debug);
        assert_not_impl!($type: Clone);
        assert_not_impl!($type: Display);
        assert_not_impl!($type: Deref);
        assert_not_impl!($type: AsRef<str>);
        assert_not_impl!($type: AsRef<String>);
        assert_not_impl!($type: PartialEq);
        assert_not_impl!($type: Eq);
        assert_not_impl!($type: PartialOrd);
        assert_not_impl!($type: Ord);
        assert_not_impl!($type: Hash);
    };
}

assert_secret_safe!(OpaqueSecret);
assert_secret_safe!(SynthesisText);
assert_secret_safe!(ManualCode);
assert_secret_safe!(DeepLinkChallengeRequest);
assert_secret_safe!(ManualChallengeRequest);
assert_secret_safe!(PairingChallengeRequest);
assert_secret_safe!(RedeemRequest);
assert_secret_safe!(RedeemResponse);
assert_secret_safe!(JobCreateRequest);

#[test]
fn secret_bearing_wire_types_expose_only_consuming_accessors() {
    let scalars = include_str!("../src/protocol/scalars.rs");
    let messages = include_str!("../src/protocol/messages.rs");
    assert!(!scalars.contains("String::deserialize"));
    for visitor in [
        "OpaqueSecretVisitor",
        "SynthesisTextVisitor",
        "ManualCodeVisitor",
    ] {
        let start = scalars.find(visitor).expect("secret scalar visitor");
        let visitor = &scalars[start..];
        let zeroizing = visitor
            .find("Zeroizing::new(value)")
            .expect("visitor immediately owns its string");
        let validation = visitor
            .find("validate_")
            .expect("visitor validates its owned string");
        assert!(
            zeroizing < validation,
            "{visitor} validates before zeroizing ownership"
        );
    }
    assert!(!messages.contains("serde(untagged)"));
    assert!(!messages.contains("serde_json::Value"));
    assert!(!messages.contains("Content"));
    assert!(messages.contains("Deserialize<'de> for PairingChallengeRequest"));
    assert!(messages.contains("visit_map"));
}

#[test]
fn pairing_challenge_custom_map_visitor_rejects_every_security_field_duplicate() {
    let scopes = r#"["health:read","runtime:read","synthesis:create","jobs:read","jobs:cancel","audio:read","packs:request"]"#;
    let secret = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    let duplicate_cases = [
        format!(
            r#"{{"state":"{secret}","state":"{secret}","verifierHash":"{secret}","clientLabel":"Browser","scopes":{scopes}}}"#
        ),
        format!(
            r#"{{"code":"23456789ABCD","code":"23456789ABCD","verifierHash":"{secret}","clientLabel":"Browser","scopes":{scopes}}}"#
        ),
        format!(
            r#"{{"state":"{secret}","verifierHash":"{secret}","verifierHash":"{secret}","clientLabel":"Browser","scopes":{scopes}}}"#
        ),
        format!(
            r#"{{"state":"{secret}","verifierHash":"{secret}","clientLabel":"Browser","clientLabel":"Browser","scopes":{scopes}}}"#
        ),
        format!(
            r#"{{"state":"{secret}","verifierHash":"{secret}","clientLabel":"Browser","scopes":{scopes},"scopes":{scopes}}}"#
        ),
    ];
    for raw in duplicate_cases {
        assert!(
            serde_json::from_str::<PairingChallengeRequest>(&raw).is_err(),
            "duplicate accepted: {raw}"
        );
    }
}

#[test]
fn secret_bearing_wire_requests_release_values_only_by_consuming_into_zeroizing_wrappers() {
    let secret = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    let opaque: OpaqueSecret = serde_json::from_value(serde_json::json!(secret)).unwrap();
    assert_eq!(opaque.into_zeroizing().as_str(), secret);
    let text: SynthesisText = serde_json::from_value(serde_json::json!("  exact text  ")).unwrap();
    assert_eq!(text.into_zeroizing().as_str(), "  exact text  ");
    let code: ManualCode = serde_json::from_value(serde_json::json!("23456789ABCD")).unwrap();
    assert_eq!(code.into_zeroizing().as_str(), "23456789ABCD");

    let scopes = serde_json::json!([
        "health:read",
        "runtime:read",
        "synthesis:create",
        "jobs:read",
        "jobs:cancel",
        "audio:read",
        "packs:request"
    ]);
    let deep: PairingChallengeRequest = serde_json::from_value(serde_json::json!({
        "state": secret,
        "verifierHash": secret,
        "clientLabel": "Browser",
        "scopes": scopes
    }))
    .unwrap();
    let PairingChallengeRequest::DeepLink(deep) = deep else {
        panic!("expected deep-link branch");
    };
    let (state, verifier_hash, label, _scopes) = deep.into_parts();
    assert_eq!(state.as_str(), secret);
    assert_eq!(verifier_hash.as_str(), secret);
    assert_eq!(label.as_str(), "Browser");

    let redeem: RedeemRequest = serde_json::from_value(serde_json::json!({
        "verifier": secret
    }))
    .unwrap();
    assert_eq!(redeem.into_verifier().as_str(), secret);

    let job: JobCreateRequest = serde_json::from_value(serde_json::json!({
        "voiceId": "pocket:alba",
        "text": "Exact text"
    }))
    .unwrap();
    let (voice, text) = job.into_parts();
    assert_eq!(voice.as_str(), "pocket:alba");
    assert_eq!(text.as_str(), "Exact text");

    let response: RedeemResponse = serde_json::from_value(serde_json::json!({
        "token": secret,
        "pairing": {
            "id": "123e4567-e89b-42d3-a456-426614174000",
            "clientLabel": "Browser",
            "scopes": [
                "health:read",
                "runtime:read",
                "synthesis:create",
                "jobs:read",
                "jobs:cancel",
                "audio:read",
                "packs:request"
            ],
            "createdAt": "2028-02-29T23:59:59Z",
            "lastUsedAt": "2028-02-29T23:59:59Z"
        }
    }))
    .unwrap();
    let (token, pairing) = response.into_parts();
    assert_eq!(token.as_str(), secret);
    assert_eq!(
        serde_json::to_value(pairing).unwrap()["clientLabel"],
        "Browser"
    );
}
