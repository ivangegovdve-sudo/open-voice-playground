use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("operating-system randomness is unavailable")]
    Randomness,
    #[error("secret encoding is not canonical")]
    InvalidEncoding,
}

pub struct SecretString(Zeroizing<String>);

impl SecretString {
    pub fn from_encoded(value: String) -> Result<Self, SecretError> {
        let value = Zeroizing::new(value);
        decode_canonical_secret(value.as_str())?;
        Ok(Self(value))
    }

    pub fn expose(&self) -> &str {
        self.0.as_str()
    }
}

pub fn generate_secret() -> Result<SecretString, SecretError> {
    let mut bytes = Zeroizing::new([0_u8; 32]);
    getrandom::fill(bytes.as_mut()).map_err(|_| SecretError::Randomness)?;
    Ok(SecretString(Zeroizing::new(URL_SAFE_NO_PAD.encode(*bytes))))
}

pub fn decode_canonical_secret(value: &str) -> Result<Zeroizing<[u8; 32]>, SecretError> {
    if value.len() != 43
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(SecretError::InvalidEncoding);
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| SecretError::InvalidEncoding)?;
    let bytes: [u8; 32] = decoded
        .try_into()
        .map_err(|_| SecretError::InvalidEncoding)?;
    if URL_SAFE_NO_PAD.encode(bytes) != value {
        return Err(SecretError::InvalidEncoding);
    }
    Ok(Zeroizing::new(bytes))
}

pub fn is_canonical_secret(value: &str) -> bool {
    decode_canonical_secret(value).is_ok()
}

pub fn hash_bytes(value: &[u8]) -> [u8; 32] {
    Sha256::digest(value).into()
}

pub fn hash_for_transport(value: &[u8]) -> String {
    let hash = std::str::from_utf8(value)
        .ok()
        .and_then(|encoded| decode_canonical_secret(encoded).ok())
        .map_or_else(|| hash_bytes(value), |decoded| hash_bytes(decoded.as_ref()));
    URL_SAFE_NO_PAD.encode(hash)
}
