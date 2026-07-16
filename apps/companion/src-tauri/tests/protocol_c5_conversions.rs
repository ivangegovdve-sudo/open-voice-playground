use open_voice_companion::{
    pairing::{ChallengeHandle, PairingRecord, RedeemSuccess, fixed_scopes, generate_secret},
    protocol::{
        CanonicalDateTime, EngineListResponse, HealthResponse, JobResponse, PackListResponse,
        PairingChallengeResponse, PairingResponse, RedeemResponse, RuntimeResponse,
        VoiceListResponse,
    },
    scheduler::{JobSnapshot, JobState},
};
use time::{Date, Month, OffsetDateTime, PrimitiveDateTime, Time, UtcOffset};
use uuid::Uuid;

fn valid_pairing() -> PairingRecord {
    PairingRecord {
        id: Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap(),
        origin: "http://127.0.0.1:5173".to_owned(),
        client_label: "Browser playground".to_owned(),
        scopes: fixed_scopes(),
        created_at: OffsetDateTime::from_unix_timestamp(1_835_469_599).unwrap(),
        last_used_at: OffsetDateTime::from_unix_timestamp(1_835_469_600).unwrap(),
    }
}

#[test]
fn native_date_time_conversion_normalizes_to_exact_utc_rfc3339() {
    let local_epoch = OffsetDateTime::UNIX_EPOCH.to_offset(UtcOffset::from_hms(3, 0, 0).unwrap());
    let exact = CanonicalDateTime::try_from(local_epoch).unwrap();
    assert_eq!(serde_json::to_value(exact).unwrap(), "1970-01-01T00:00:00Z");

    let fractional = OffsetDateTime::from_unix_timestamp_nanos(123_400_000).unwrap();
    let exact = CanonicalDateTime::try_from(fractional).unwrap();
    assert_eq!(
        serde_json::to_value(exact).unwrap(),
        "1970-01-01T00:00:00.1234Z"
    );

    let year_zero = PrimitiveDateTime::new(
        Date::from_calendar_date(0, Month::January, 1).unwrap(),
        Time::MIDNIGHT,
    )
    .assume_utc();
    assert!(CanonicalDateTime::try_from(year_zero).is_err());
}

#[test]
fn native_pairing_and_redeem_conversions_revalidate_and_omit_origin() {
    let pairing = PairingResponse::try_from(valid_pairing()).unwrap();
    let value = serde_json::to_value(&pairing).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 5);
    assert!(value.get("origin").is_none());
    assert_eq!(value["clientLabel"], "Browser playground");

    let mut invalid = valid_pairing();
    invalid.client_label = "unsafe<label".to_owned();
    assert!(PairingResponse::try_from(invalid).is_err());
    let mut invalid = valid_pairing();
    invalid.scopes.swap(0, 1);
    assert!(PairingResponse::try_from(invalid).is_err());

    let token = generate_secret().unwrap();
    let expected_token = token.expose().to_owned();
    let response = RedeemResponse::try_from(RedeemSuccess {
        token,
        pairing: valid_pairing(),
    })
    .unwrap();
    let value = serde_json::to_value(response).unwrap();
    assert_eq!(value["token"], expected_token);
    assert!(value["pairing"].get("origin").is_none());
}

#[test]
fn challenge_handle_conversion_uses_the_truthful_checked_expiry() {
    let handle = ChallengeHandle {
        id: Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap(),
        expires_at: OffsetDateTime::from_unix_timestamp(120).unwrap(),
    };
    let response = PairingChallengeResponse::try_from(handle).unwrap();
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        serde_json::json!({
            "id": "123e4567-e89b-42d3-a456-426614174000",
            "state": "pending",
            "expiresAt": "1970-01-01T00:02:00Z"
        })
    );
}

#[test]
fn job_conversion_rejects_operational_or_audio_overclaims() {
    let base = JobSnapshot {
        id: Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap(),
        pairing_id: Uuid::nil(),
        voice_id: open_voice_companion::protocol::VoiceId::parse("pocket:alba").unwrap(),
        state: JobState::Queued,
        audio_available: false,
        created_at: OffsetDateTime::UNIX_EPOCH,
        finished_at: None,
    };
    for state in [
        JobState::Queued,
        JobState::Cancelling,
        JobState::Cancelled,
        JobState::Failed,
        JobState::Expired,
    ] {
        let mut snapshot = base.clone();
        snapshot.state = state;
        assert!(
            JobResponse::try_from(snapshot).is_ok(),
            "wire state {state:?}"
        );
    }
    for state in [
        JobState::Starting,
        JobState::Synthesizing,
        JobState::Completed,
    ] {
        let mut snapshot = base.clone();
        snapshot.state = state;
        assert!(
            JobResponse::try_from(snapshot).is_err(),
            "operational state {state:?}"
        );
    }
    let mut with_audio = base;
    with_audio.audio_available = true;
    assert!(JobResponse::try_from(with_audio).is_err());
}

#[test]
fn fixed_native_catalog_constructors_never_claim_operation() {
    assert_eq!(
        serde_json::to_value(HealthResponse::listening()).unwrap(),
        serde_json::json!({
            "app": "open-voice-companion",
            "protocolMajor": 1,
            "listenerState": "listening"
        })
    );
    assert_eq!(
        serde_json::to_value(RuntimeResponse::non_operational()).unwrap(),
        serde_json::json!({
            "engineId": "pocket",
            "state": "pack-unverified",
            "operational": false,
            "reason": "pack-unverified"
        })
    );
    assert_eq!(
        serde_json::to_value(EngineListResponse::non_operational()).unwrap()["engines"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        serde_json::to_value(PackListResponse::non_operational()).unwrap()["packs"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let voices = serde_json::to_value(VoiceListResponse::non_operational()).unwrap();
    assert_eq!(voices["voices"].as_array().unwrap().len(), 20);
    assert!(
        voices["voices"]
            .as_array()
            .unwrap()
            .iter()
            .all(|voice| voice["operational"] == false && voice["availableInPack"] == true)
    );
}
