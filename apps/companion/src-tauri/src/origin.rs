const DEBUG_VITE_ORIGINS: [&str; 1] = ["http://127.0.0.1:5173"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReleaseOriginConfig {
    Unconfigured,
}

#[derive(Clone, Debug)]
pub struct OriginPolicy {
    allowed: &'static [&'static str],
}

impl OriginPolicy {
    pub const fn production(config: ReleaseOriginConfig) -> Self {
        match config {
            ReleaseOriginConfig::Unconfigured => Self { allowed: &[] },
        }
    }

    #[cfg(debug_assertions)]
    pub const fn debug_local() -> Self {
        Self {
            allowed: &DEBUG_VITE_ORIGINS,
        }
    }

    pub const fn for_current_build() -> Self {
        #[cfg(debug_assertions)]
        {
            Self {
                allowed: &DEBUG_VITE_ORIGINS,
            }
        }
        #[cfg(not(debug_assertions))]
        {
            Self::production(ReleaseOriginConfig::Unconfigured)
        }
    }

    pub fn allows(&self, origin: &str) -> bool {
        self.allowed.contains(&origin)
    }

    pub const fn is_configured(&self) -> bool {
        !self.allowed.is_empty()
    }
}
