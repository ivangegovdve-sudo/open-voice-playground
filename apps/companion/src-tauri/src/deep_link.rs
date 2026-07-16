use std::{
    collections::HashMap,
    ffi::OsString,
    sync::Mutex,
    time::{Duration, Instant},
};

use crate::secret::is_canonical_secret;

const PREFIX: &str = "ovp-companion://pair/";
const STATE_TTL: Duration = Duration::from_secs(120);
const MAX_RECORDED_STATES: usize = 128;

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum DeepLinkError {
    #[error("deep-link arguments are not an exact pairing invocation")]
    MixedArguments,
    #[error("the pairing deep link is invalid")]
    Invalid,
    #[error("the pairing deep link was already recorded")]
    Replay,
    #[error("the pairing deep link expired")]
    Expired,
    #[error("the pairing deep link was already claimed")]
    Consumed,
    #[error("the pairing deep link was not recorded")]
    NotFound,
}

#[derive(Clone, Copy)]
struct StateEntry {
    expires: Instant,
    claimed: bool,
}

pub struct DeepLinkRegistry {
    states: Mutex<HashMap<String, StateEntry>>,
}

impl Default for DeepLinkRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl DeepLinkRegistry {
    pub fn new() -> Self {
        Self {
            states: Mutex::new(HashMap::new()),
        }
    }

    pub fn record_argv(
        &self,
        arguments: &[OsString],
        now: Instant,
    ) -> Result<String, DeepLinkError> {
        if arguments.len() != 2 || arguments.iter().any(|argument| argument.to_str().is_none()) {
            return Err(DeepLinkError::MixedArguments);
        }
        let executable = std::env::current_exe().map_err(|_| DeepLinkError::MixedArguments)?;
        if arguments[0] != executable.as_os_str() {
            return Err(DeepLinkError::MixedArguments);
        }
        let raw = arguments[1].to_str().ok_or(DeepLinkError::MixedArguments)?;
        if !raw.is_ascii() || raw.contains('%') || !raw.starts_with(PREFIX) {
            return Err(DeepLinkError::Invalid);
        }
        let state = &raw[PREFIX.len()..];
        if !is_canonical_secret(state) || raw != format!("{PREFIX}{state}") {
            return Err(DeepLinkError::Invalid);
        }
        let mut states = self.states.lock().map_err(|_| DeepLinkError::Invalid)?;
        states.retain(|_, entry| now < entry.expires);
        if states.contains_key(state) {
            return Err(DeepLinkError::Replay);
        }
        if states.len() >= MAX_RECORDED_STATES {
            return Err(DeepLinkError::Invalid);
        }
        states.insert(
            state.to_owned(),
            StateEntry {
                expires: now + STATE_TTL,
                claimed: false,
            },
        );
        Ok(state.to_owned())
    }

    pub fn claim(&self, state: &str, now: Instant) -> Result<(), DeepLinkError> {
        if !is_canonical_secret(state) {
            return Err(DeepLinkError::Invalid);
        }
        let mut states = self.states.lock().map_err(|_| DeepLinkError::Invalid)?;
        let entry = states.get_mut(state).ok_or(DeepLinkError::NotFound)?;
        if now >= entry.expires {
            return Err(DeepLinkError::Expired);
        }
        if entry.claimed {
            return Err(DeepLinkError::Consumed);
        }
        entry.claimed = true;
        Ok(())
    }
}
