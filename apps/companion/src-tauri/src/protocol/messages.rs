use std::{collections::HashSet, fmt};

use serde::{
    Deserialize, Deserializer, Serialize, Serializer,
    de::{self, MapAccess, Visitor},
};
use zeroize::Zeroizing;

use super::{
    ALL_VOICE_IDS, CanonicalDateTime, CanonicalUuid, ClientLabel, ManualCode, OpaqueSecret,
    OperationalState, PackId, ScopeList, SynthesisText, VoiceId,
};

macro_rules! fixed_string_type {
    ($name:ident, $value:literal) => {
        #[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
        struct $name;

        impl Serialize for $name {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                serializer.serialize_str($value)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                struct FixedVisitor;
                impl Visitor<'_> for FixedVisitor {
                    type Value = $name;
                    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                        formatter.write_str(concat!("the exact string ", $value))
                    }
                    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
                    where
                        E: de::Error,
                    {
                        if value == $value {
                            Ok($name)
                        } else {
                            Err(E::invalid_value(de::Unexpected::Str(value), &self))
                        }
                    }
                }
                deserializer.deserialize_str(FixedVisitor)
            }
        }
    };
}

macro_rules! fixed_bool_type {
    ($name:ident, $value:literal) => {
        #[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
        struct $name;

        impl Serialize for $name {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                serializer.serialize_bool($value)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                struct FixedVisitor;
                impl Visitor<'_> for FixedVisitor {
                    type Value = $name;
                    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                        formatter.write_str(concat!("the exact boolean ", stringify!($value)))
                    }
                    fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E>
                    where
                        E: de::Error,
                    {
                        if value == $value {
                            Ok($name)
                        } else {
                            Err(E::invalid_value(de::Unexpected::Bool(value), &self))
                        }
                    }
                }
                deserializer.deserialize_bool(FixedVisitor)
            }
        }
    };
}

fixed_string_type!(AppName, "open-voice-companion");
fixed_string_type!(EngineId, "pocket");
fixed_string_type!(PendingState, "pending");
fixed_string_type!(PendingNativeDecisionState, "pending-native-decision");
fixed_string_type!(PackUnverifiedReason, "pack-unverified");
fixed_bool_type!(RuntimeOperationalFalse, false);
fixed_bool_type!(EngineOperationalFalse, false);
fixed_bool_type!(VoiceAvailableInPackTrue, true);
fixed_bool_type!(VoiceOperationalFalse, false);
fixed_bool_type!(PackVerifiedFalse, false);
fixed_bool_type!(PackOperationalFalse, false);
fixed_bool_type!(JobAudioAvailableFalse, false);

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
struct ProtocolMajorOne;

impl Serialize for ProtocolMajorOne {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u64(1)
    }
}

impl<'de> Deserialize<'de> for ProtocolMajorOne {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct MajorVisitor;
        impl Visitor<'_> for MajorVisitor {
            type Value = ProtocolMajorOne;
            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("the exact integer 1")
            }
            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if value == 1 {
                    Ok(ProtocolMajorOne)
                } else {
                    Err(E::invalid_value(de::Unexpected::Unsigned(value), &self))
                }
            }
            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if value == 1 {
                    Ok(ProtocolMajorOne)
                } else {
                    Err(E::invalid_value(de::Unexpected::Signed(value), &self))
                }
            }
        }
        deserializer.deserialize_any(MajorVisitor)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ListenerState {
    Listening,
    ListenerConflict,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PackAction {
    Install,
    Update,
    Repair,
    Remove,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobWireState {
    Queued,
    Cancelling,
    Cancelled,
    Failed,
    Expired,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HealthResponse {
    app: AppName,
    protocol_major: ProtocolMajorOne,
    listener_state: ListenerState,
}

impl HealthResponse {
    pub const fn listening() -> Self {
        Self {
            app: AppName,
            protocol_major: ProtocolMajorOne,
            listener_state: ListenerState::Listening,
        }
    }

    pub const fn listener_conflict() -> Self {
        Self {
            app: AppName,
            protocol_major: ProtocolMajorOne,
            listener_state: ListenerState::ListenerConflict,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeepLinkChallengeRequest {
    state: OpaqueSecret,
    verifier_hash: OpaqueSecret,
    client_label: ClientLabel,
    scopes: ScopeList,
}

impl DeepLinkChallengeRequest {
    pub fn into_parts(self) -> (Zeroizing<String>, Zeroizing<String>, ClientLabel, ScopeList) {
        (
            self.state.into_zeroizing(),
            self.verifier_hash.into_zeroizing(),
            self.client_label,
            self.scopes,
        )
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ManualChallengeRequest {
    code: ManualCode,
    verifier_hash: OpaqueSecret,
    client_label: ClientLabel,
    scopes: ScopeList,
}

impl ManualChallengeRequest {
    pub fn into_parts(self) -> (Zeroizing<String>, Zeroizing<String>, ClientLabel, ScopeList) {
        (
            self.code.into_zeroizing(),
            self.verifier_hash.into_zeroizing(),
            self.client_label,
            self.scopes,
        )
    }
}

pub enum PairingChallengeRequest {
    DeepLink(DeepLinkChallengeRequest),
    Manual(ManualChallengeRequest),
}

impl Serialize for PairingChallengeRequest {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::DeepLink(request) => request.serialize(serializer),
            Self::Manual(request) => request.serialize(serializer),
        }
    }
}

enum ChallengeField {
    State,
    Code,
    VerifierHash,
    ClientLabel,
    Scopes,
}

impl<'de> Deserialize<'de> for ChallengeField {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct FieldVisitor;
        impl Visitor<'_> for FieldVisitor {
            type Value = ChallengeField;
            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a pairing challenge field")
            }
            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                match value {
                    "state" => Ok(ChallengeField::State),
                    "code" => Ok(ChallengeField::Code),
                    "verifierHash" => Ok(ChallengeField::VerifierHash),
                    "clientLabel" => Ok(ChallengeField::ClientLabel),
                    "scopes" => Ok(ChallengeField::Scopes),
                    _ => Err(E::unknown_field(
                        value,
                        &["state", "code", "verifierHash", "clientLabel", "scopes"],
                    )),
                }
            }
        }
        deserializer.deserialize_identifier(FieldVisitor)
    }
}

struct PairingChallengeRequestVisitor;

impl<'de> Visitor<'de> for PairingChallengeRequestVisitor {
    type Value = PairingChallengeRequest;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("one closed deep-link or manual pairing challenge object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut state = None;
        let mut code = None;
        let mut verifier_hash = None;
        let mut client_label = None;
        let mut scopes = None;
        while let Some(field) = map.next_key::<ChallengeField>()? {
            match field {
                ChallengeField::State => {
                    if state.is_some() {
                        return Err(de::Error::duplicate_field("state"));
                    }
                    state = Some(map.next_value::<OpaqueSecret>()?);
                }
                ChallengeField::Code => {
                    if code.is_some() {
                        return Err(de::Error::duplicate_field("code"));
                    }
                    code = Some(map.next_value::<ManualCode>()?);
                }
                ChallengeField::VerifierHash => {
                    if verifier_hash.is_some() {
                        return Err(de::Error::duplicate_field("verifierHash"));
                    }
                    verifier_hash = Some(map.next_value::<OpaqueSecret>()?);
                }
                ChallengeField::ClientLabel => {
                    if client_label.is_some() {
                        return Err(de::Error::duplicate_field("clientLabel"));
                    }
                    client_label = Some(map.next_value::<ClientLabel>()?);
                }
                ChallengeField::Scopes => {
                    if scopes.is_some() {
                        return Err(de::Error::duplicate_field("scopes"));
                    }
                    scopes = Some(map.next_value::<ScopeList>()?);
                }
            }
        }
        let verifier_hash =
            verifier_hash.ok_or_else(|| de::Error::missing_field("verifierHash"))?;
        let client_label = client_label.ok_or_else(|| de::Error::missing_field("clientLabel"))?;
        let scopes = scopes.ok_or_else(|| de::Error::missing_field("scopes"))?;
        match (state, code) {
            (Some(state), None) => Ok(PairingChallengeRequest::DeepLink(
                DeepLinkChallengeRequest {
                    state,
                    verifier_hash,
                    client_label,
                    scopes,
                },
            )),
            (None, Some(code)) => Ok(PairingChallengeRequest::Manual(ManualChallengeRequest {
                code,
                verifier_hash,
                client_label,
                scopes,
            })),
            (Some(_), Some(_)) => Err(de::Error::custom(
                "pairing challenge cannot combine state and code",
            )),
            (None, None) => Err(de::Error::custom(
                "pairing challenge requires exactly one of state or code",
            )),
        }
    }
}

impl<'de> Deserialize<'de> for PairingChallengeRequest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(PairingChallengeRequestVisitor)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PairingChallengeResponse {
    id: CanonicalUuid,
    state: PendingState,
    expires_at: CanonicalDateTime,
}

impl PairingChallengeResponse {
    pub(super) const fn checked(id: CanonicalUuid, expires_at: CanonicalDateTime) -> Self {
        Self {
            id,
            state: PendingState,
            expires_at,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedeemRequest {
    verifier: OpaqueSecret,
}

impl RedeemRequest {
    pub fn into_verifier(self) -> Zeroizing<String> {
        self.verifier.into_zeroizing()
    }
}

impl<'de> Deserialize<'de> for RedeemRequest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Raw {
            verifier: OpaqueSecret,
        }
        let raw = Raw::deserialize(deserializer)?;
        Ok(Self {
            verifier: raw.verifier,
        })
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RedeemPendingResponse {
    state: PendingState,
}

impl RedeemPendingResponse {
    pub const fn pending() -> Self {
        Self {
            state: PendingState,
        }
    }
}

#[derive(Serialize)]
pub struct RedeemResponse {
    token: OpaqueSecret,
    pairing: PairingResponse,
}

impl RedeemResponse {
    pub(super) const fn checked(token: OpaqueSecret, pairing: PairingResponse) -> Self {
        Self { token, pairing }
    }

    pub fn into_parts(self) -> (Zeroizing<String>, PairingResponse) {
        (self.token.into_zeroizing(), self.pairing)
    }
}

impl<'de> Deserialize<'de> for RedeemResponse {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Raw {
            token: OpaqueSecret,
            pairing: PairingResponse,
        }
        let raw = Raw::deserialize(deserializer)?;
        Ok(Self {
            token: raw.token,
            pairing: raw.pairing,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PairingResponse {
    id: CanonicalUuid,
    client_label: ClientLabel,
    scopes: ScopeList,
    created_at: CanonicalDateTime,
    last_used_at: CanonicalDateTime,
}

impl PairingResponse {
    pub(super) const fn checked(
        id: CanonicalUuid,
        client_label: ClientLabel,
        scopes: ScopeList,
        created_at: CanonicalDateTime,
        last_used_at: CanonicalDateTime,
    ) -> Self {
        Self {
            id,
            client_label,
            scopes,
            created_at,
            last_used_at,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RuntimeResponse {
    engine_id: EngineId,
    state: OperationalState,
    operational: RuntimeOperationalFalse,
    reason: PackUnverifiedReason,
}

impl RuntimeResponse {
    pub const fn non_operational() -> Self {
        Self {
            engine_id: EngineId,
            state: OperationalState,
            operational: RuntimeOperationalFalse,
            reason: PackUnverifiedReason,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EngineResponse {
    id: EngineId,
    state: OperationalState,
    operational: EngineOperationalFalse,
}

impl EngineResponse {
    pub const fn non_operational() -> Self {
        Self {
            id: EngineId,
            state: OperationalState,
            operational: EngineOperationalFalse,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EngineListResponse {
    engines: [EngineResponse; 1],
}

impl EngineListResponse {
    pub const fn non_operational() -> Self {
        Self {
            engines: [EngineResponse::non_operational()],
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VoiceResponse {
    id: VoiceId,
    engine_id: EngineId,
    available_in_pack: VoiceAvailableInPackTrue,
    operational: VoiceOperationalFalse,
}

impl VoiceResponse {
    pub const fn non_operational(id: VoiceId) -> Self {
        Self {
            id,
            engine_id: EngineId,
            available_in_pack: VoiceAvailableInPackTrue,
            operational: VoiceOperationalFalse,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct VoiceListResponse {
    voices: [VoiceResponse; 20],
}

impl VoiceListResponse {
    pub fn non_operational() -> Self {
        Self {
            voices: ALL_VOICE_IDS.map(|id| {
                VoiceResponse::non_operational(VoiceId::parse(id).expect("owned voice must parse"))
            }),
        }
    }
}

impl<'de> Deserialize<'de> for VoiceListResponse {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Raw {
            voices: [VoiceResponse; 20],
        }
        let raw = Raw::deserialize(deserializer)?;
        let unique = raw
            .voices
            .iter()
            .map(|voice| voice.id)
            .collect::<HashSet<_>>();
        if unique.len() != 20 {
            return Err(de::Error::custom("voice list identifiers must be unique"));
        }
        Ok(Self { voices: raw.voices })
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PackResponse {
    id: PackId,
    state: OperationalState,
    verified: PackVerifiedFalse,
    operational: PackOperationalFalse,
}

impl PackResponse {
    pub const fn non_operational() -> Self {
        Self {
            id: PackId,
            state: OperationalState,
            verified: PackVerifiedFalse,
            operational: PackOperationalFalse,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PackListResponse {
    packs: [PackResponse; 1],
}

impl PackListResponse {
    pub const fn non_operational() -> Self {
        Self {
            packs: [PackResponse::non_operational()],
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobCreateRequest {
    voice_id: VoiceId,
    text: SynthesisText,
}

impl JobCreateRequest {
    pub fn into_parts(self) -> (VoiceId, Zeroizing<String>) {
        (self.voice_id, self.text.into_zeroizing())
    }
}

impl<'de> Deserialize<'de> for JobCreateRequest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields, rename_all = "camelCase")]
        struct Raw {
            voice_id: VoiceId,
            text: SynthesisText,
        }
        let raw = Raw::deserialize(deserializer)?;
        Ok(Self {
            voice_id: raw.voice_id,
            text: raw.text,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct JobResponse {
    id: CanonicalUuid,
    voice_id: VoiceId,
    state: JobWireState,
    audio_available: JobAudioAvailableFalse,
    created_at: CanonicalDateTime,
}

impl JobResponse {
    pub(super) const fn checked(
        id: CanonicalUuid,
        voice_id: VoiceId,
        state: JobWireState,
        created_at: CanonicalDateTime,
    ) -> Self {
        Self {
            id,
            voice_id,
            state,
            audio_available: JobAudioAvailableFalse,
            created_at,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PackActionRequest {
    action: PackAction,
}

impl PackActionRequest {
    pub const fn into_action(self) -> PackAction {
        self.action
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PackActionResponse {
    id: CanonicalUuid,
    pack_id: PackId,
    action: PackAction,
    state: PendingNativeDecisionState,
}

impl PackActionResponse {
    pub const fn pending(id: CanonicalUuid, action: PackAction) -> Self {
        Self {
            id,
            pack_id: PackId,
            action,
            state: PendingNativeDecisionState,
        }
    }
}
