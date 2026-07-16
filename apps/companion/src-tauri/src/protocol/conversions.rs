use crate::{
    pairing::{ChallengeHandle, PairingRecord, RedeemSuccess},
    scheduler::{JobSnapshot, JobState},
};

use super::{
    CanonicalDateTime, CanonicalUuid, ClientLabel, JobResponse, JobWireState, OpaqueSecret,
    PairingChallengeResponse, PairingResponse, RedeemResponse, ScopeList,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("native value cannot be represented by the non-operational wire protocol")]
pub struct ProtocolConversionError;

impl TryFrom<PairingRecord> for PairingResponse {
    type Error = ProtocolConversionError;

    fn try_from(value: PairingRecord) -> Result<Self, Self::Error> {
        let client_label =
            ClientLabel::parse(&value.client_label).map_err(|_| ProtocolConversionError)?;
        let scopes = ScopeList::try_from(value.scopes).map_err(|_| ProtocolConversionError)?;
        let created_at =
            CanonicalDateTime::try_from(value.created_at).map_err(|_| ProtocolConversionError)?;
        let last_used_at =
            CanonicalDateTime::try_from(value.last_used_at).map_err(|_| ProtocolConversionError)?;
        Ok(Self::checked(
            CanonicalUuid::from(value.id),
            client_label,
            scopes,
            created_at,
            last_used_at,
        ))
    }
}

impl TryFrom<RedeemSuccess> for RedeemResponse {
    type Error = ProtocolConversionError;

    fn try_from(value: RedeemSuccess) -> Result<Self, Self::Error> {
        let token = OpaqueSecret::from_zeroizing(value.token.into_zeroizing())
            .map_err(|_| ProtocolConversionError)?;
        let pairing = PairingResponse::try_from(value.pairing)?;
        Ok(Self::checked(token, pairing))
    }
}

impl TryFrom<ChallengeHandle> for PairingChallengeResponse {
    type Error = ProtocolConversionError;

    fn try_from(value: ChallengeHandle) -> Result<Self, Self::Error> {
        let expires_at =
            CanonicalDateTime::try_from(value.expires_at).map_err(|_| ProtocolConversionError)?;
        Ok(Self::checked(CanonicalUuid::from(value.id), expires_at))
    }
}

impl TryFrom<JobSnapshot> for JobResponse {
    type Error = ProtocolConversionError;

    fn try_from(value: JobSnapshot) -> Result<Self, Self::Error> {
        if value.audio_available {
            return Err(ProtocolConversionError);
        }
        let state = match value.state {
            JobState::Queued => JobWireState::Queued,
            JobState::Cancelling => JobWireState::Cancelling,
            JobState::Cancelled => JobWireState::Cancelled,
            JobState::Failed => JobWireState::Failed,
            JobState::Expired => JobWireState::Expired,
            JobState::Starting | JobState::Synthesizing | JobState::Completed => {
                return Err(ProtocolConversionError);
            }
        };
        let created_at =
            CanonicalDateTime::try_from(value.created_at).map_err(|_| ProtocolConversionError)?;
        Ok(Self::checked(
            CanonicalUuid::from(value.id),
            value.voice_id,
            state,
            created_at,
        ))
    }
}
