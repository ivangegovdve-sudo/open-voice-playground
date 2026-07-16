use std::{fmt, str};

use serde::{
    Deserialize, Deserializer, Serialize, Serializer,
    de::{self, SeqAccess, Visitor},
    ser::SerializeSeq,
};
use time::{Date, Month, OffsetDateTime, PrimitiveDateTime, Time, UtcOffset};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::secret::is_canonical_secret;

pub const PROTOCOL_MAJOR: u64 = 1;
pub const CLIENT_VERSION: &str = "1.0.0";

pub const ALL_VOICE_IDS: [&str; 20] = [
    "pocket:alba",
    "pocket:estelle",
    "pocket:anna",
    "pocket:vera",
    "pocket:fantine",
    "pocket:charles",
    "pocket:paul",
    "pocket:eponine",
    "pocket:azelma",
    "pocket:george",
    "pocket:mary",
    "pocket:jane",
    "pocket:michael",
    "pocket:eve",
    "pocket:bill_boerst",
    "pocket:caro_davy",
    "pocket:peter_yearsley",
    "pocket:stuart_bell",
    "pocket:marius",
    "pocket:javert",
];

pub const ALL_SCOPES: [&str; 7] = [
    "health:read",
    "runtime:read",
    "synthesis:create",
    "jobs:read",
    "jobs:cancel",
    "audio:read",
    "packs:request",
];

macro_rules! string_visitor {
    ($visitor:ident, $expecting:literal, $parse:path, $output:ty) => {
        struct $visitor;

        impl Visitor<'_> for $visitor {
            type Value = $output;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str($expecting)
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                $parse(value).map_err(E::custom)
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                $parse(&value).map_err(E::custom)
            }
        }
    };
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct VoiceId(&'static str);

impl VoiceId {
    pub fn parse(value: &str) -> Option<Self> {
        ALL_VOICE_IDS
            .iter()
            .copied()
            .find(|candidate| *candidate == value)
            .map(Self)
    }

    pub const fn as_str(self) -> &'static str {
        self.0
    }
}

impl Serialize for VoiceId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.0)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("unknown Pocket preset identifier")]
struct VoiceIdError;

fn parse_voice_id(value: &str) -> Result<VoiceId, VoiceIdError> {
    VoiceId::parse(value).ok_or(VoiceIdError)
}

string_visitor!(
    VoiceIdVisitor,
    "an exact Pocket voice identifier",
    parse_voice_id,
    VoiceId
);

impl<'de> Deserialize<'de> for VoiceId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_string(VoiceIdVisitor)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Scope(&'static str);

impl Scope {
    pub fn parse(value: &str) -> Option<Self> {
        ALL_SCOPES
            .iter()
            .copied()
            .find(|candidate| *candidate == value)
            .map(Self)
    }

    pub const fn as_str(self) -> &'static str {
        self.0
    }
}

impl Serialize for Scope {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.0)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("unknown companion scope")]
struct ScopeError;

fn parse_scope(value: &str) -> Result<Scope, ScopeError> {
    Scope::parse(value).ok_or(ScopeError)
}

string_visitor!(ScopeVisitor, "an exact companion scope", parse_scope, Scope);

impl<'de> Deserialize<'de> for Scope {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_string(ScopeVisitor)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("scope list must equal the fixed protocol tuple")]
pub struct ScopeListValidationError;

pub fn validate_scope_list(scopes: &[Scope]) -> Result<(), ScopeListValidationError> {
    let exact = ALL_SCOPES.map(|scope| Scope::parse(scope).expect("owned scope must parse"));
    if scopes == exact {
        Ok(())
    } else {
        Err(ScopeListValidationError)
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub struct ScopeList;

impl ScopeList {
    pub const fn fixed() -> Self {
        Self
    }

    pub fn as_array(self) -> [Scope; 7] {
        ALL_SCOPES.map(|scope| Scope::parse(scope).expect("owned scope must parse"))
    }
}

impl TryFrom<Vec<Scope>> for ScopeList {
    type Error = ScopeListValidationError;

    fn try_from(value: Vec<Scope>) -> Result<Self, Self::Error> {
        validate_scope_list(&value)?;
        Ok(Self)
    }
}

impl Serialize for ScopeList {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let scopes = self.as_array();
        let mut sequence = serializer.serialize_seq(Some(scopes.len()))?;
        for scope in scopes {
            sequence.serialize_element(&scope)?;
        }
        sequence.end()
    }
}

struct ScopeListVisitor;

impl<'de> Visitor<'de> for ScopeListVisitor {
    type Value = ScopeList;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the exact ordered seven-scope protocol tuple")
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut scopes = Vec::with_capacity(7);
        while let Some(scope) = sequence.next_element::<Scope>()? {
            scopes.push(scope);
            if scopes.len() > 7 {
                return Err(de::Error::invalid_length(scopes.len(), &self));
            }
        }
        ScopeList::try_from(scopes).map_err(de::Error::custom)
    }
}

impl<'de> Deserialize<'de> for ScopeList {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_seq(ScopeListVisitor)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("secret encoding is not canonical")]
pub struct OpaqueSecretValidationError;

pub fn validate_opaque_secret(value: &str) -> Result<(), OpaqueSecretValidationError> {
    if is_canonical_secret(value) {
        Ok(())
    } else {
        Err(OpaqueSecretValidationError)
    }
}

pub struct OpaqueSecret(Zeroizing<String>);

impl OpaqueSecret {
    pub(crate) fn from_zeroizing(
        value: Zeroizing<String>,
    ) -> Result<Self, OpaqueSecretValidationError> {
        validate_opaque_secret(value.as_str())?;
        Ok(Self(value))
    }

    pub fn into_zeroizing(self) -> Zeroizing<String> {
        self.0
    }
}

impl Serialize for OpaqueSecret {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.0.as_str())
    }
}

struct OpaqueSecretVisitor;

impl Visitor<'_> for OpaqueSecretVisitor {
    type Value = OpaqueSecret;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a canonical 43-character base64url secret")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.visit_string(value.to_owned())
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        let value = Zeroizing::new(value);
        validate_opaque_secret(value.as_str()).map_err(E::custom)?;
        Ok(OpaqueSecret(value))
    }
}

impl<'de> Deserialize<'de> for OpaqueSecret {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_string(OpaqueSecretVisitor)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("UUID text is not canonical")]
pub struct CanonicalUuidValidationError;

pub fn validate_canonical_uuid(value: &str) -> Result<(), CanonicalUuidValidationError> {
    if value.len() != 36
        || value.as_bytes().get(8) != Some(&b'-')
        || value.as_bytes().get(13) != Some(&b'-')
        || value.as_bytes().get(18) != Some(&b'-')
        || value.as_bytes().get(23) != Some(&b'-')
        || value.bytes().enumerate().any(|(index, byte)| {
            !matches!(index, 8 | 13 | 18 | 23) && !matches!(byte, b'0'..=b'9' | b'a'..=b'f')
        })
    {
        return Err(CanonicalUuidValidationError);
    }
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| CanonicalUuidValidationError)
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct CanonicalUuid(Uuid);

impl CanonicalUuid {
    pub fn parse(value: &str) -> Result<Self, CanonicalUuidValidationError> {
        validate_canonical_uuid(value)?;
        Uuid::parse_str(value)
            .map(Self)
            .map_err(|_| CanonicalUuidValidationError)
    }

    pub const fn as_uuid(self) -> Uuid {
        self.0
    }
}

impl From<Uuid> for CanonicalUuid {
    fn from(value: Uuid) -> Self {
        Self(value)
    }
}

impl Serialize for CanonicalUuid {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.collect_str(&self.0.as_hyphenated())
    }
}

string_visitor!(
    CanonicalUuidVisitor,
    "a lowercase hyphenated canonical UUID",
    CanonicalUuid::parse,
    CanonicalUuid
);

impl<'de> Deserialize<'de> for CanonicalUuid {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_string(CanonicalUuidVisitor)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ClientLabelValidationError {
    #[error("client label is empty")]
    Empty,
    #[error("client label exceeds 64 Unicode scalar values")]
    TooManyScalars,
    #[error("client label exceeds 128 UTF-8 bytes")]
    TooManyBytes,
    #[error("client label contains a disallowed scalar")]
    DisallowedScalar,
    #[error("client label is an unsafe repeated-scalar string")]
    RepeatedScalar,
}

pub fn validate_client_label(label: &str) -> Result<(), ClientLabelValidationError> {
    if label.is_empty() {
        return Err(ClientLabelValidationError::Empty);
    }
    if label.chars().count() > 64 {
        return Err(ClientLabelValidationError::TooManyScalars);
    }
    if label.len() > 128 {
        return Err(ClientLabelValidationError::TooManyBytes);
    }
    let prompt_punctuation = ['<', '>', '{', '}', '[', ']', '`'];
    if label.chars().any(|scalar| {
        matches!(
            scalar,
            '\u{0000}'..='\u{001f}'
                | '\u{007f}'
                | '\u{0080}'..='\u{009f}'
                | '\u{061c}'
                | '\u{200e}'..='\u{200f}'
                | '\u{2028}'..='\u{202e}'
                | '\u{2066}'..='\u{2069}'
        ) || prompt_punctuation.contains(&scalar)
    }) {
        return Err(ClientLabelValidationError::DisallowedScalar);
    }
    let mut scalars = label.chars();
    let first = scalars.next().expect("nonempty label has one scalar");
    if label.chars().count() > 32 && scalars.all(|scalar| scalar == first) {
        return Err(ClientLabelValidationError::RepeatedScalar);
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ClientLabel(String);

impl ClientLabel {
    pub fn parse(value: &str) -> Result<Self, ClientLabelValidationError> {
        validate_client_label(value)?;
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }
}

impl Serialize for ClientLabel {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

string_visitor!(
    ClientLabelVisitor,
    "a safe bounded client label",
    ClientLabel::parse,
    ClientLabel
);

impl<'de> Deserialize<'de> for ClientLabel {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_string(ClientLabelVisitor)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("client version is not canonical protocol major 1")]
pub struct ClientVersionValidationError;

fn validate_client_version(value: &str) -> Result<(), ClientVersionValidationError> {
    if !(5..=32).contains(&value.len()) || !value.is_ascii() {
        return Err(ClientVersionValidationError);
    }
    let mut parts = value.split('.');
    let Some(major) = parts.next() else {
        return Err(ClientVersionValidationError);
    };
    let Some(minor) = parts.next() else {
        return Err(ClientVersionValidationError);
    };
    let Some(patch) = parts.next() else {
        return Err(ClientVersionValidationError);
    };
    if parts.next().is_some()
        || major != "1"
        || [minor, patch].iter().any(|part| {
            part.is_empty()
                || !part.bytes().all(|byte| byte.is_ascii_digit())
                || (part.len() > 1 && part.starts_with('0'))
        })
    {
        return Err(ClientVersionValidationError);
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ClientVersion(String);

impl ClientVersion {
    pub fn parse(value: &str) -> Result<Self, ClientVersionValidationError> {
        validate_client_version(value)?;
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Serialize for ClientVersion {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

string_visitor!(
    ClientVersionVisitor,
    "a canonical protocol-major-1 semantic version",
    ClientVersion::parse,
    ClientVersion
);

impl<'de> Deserialize<'de> for ClientVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_string(ClientVersionVisitor)
    }
}

pub fn negotiate_version(value: Option<&str>) -> Result<(), super::ProblemCode> {
    let value = value.ok_or(super::ProblemCode::VersionMissing)?;
    ClientVersion::parse(value)
        .map(|_| ())
        .map_err(|_| super::ProblemCode::VersionUnsupported)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum TextValidationError {
    #[error("text is required")]
    Empty,
    #[error("text exceeds 8,000 UTF-8 bytes")]
    TooManyBytes,
    #[error("text exceeds 2,000 Unicode scalar values")]
    TooManyScalars,
    #[error("text contains NUL")]
    Nul,
    #[error("text contains a disallowed control character")]
    Control,
}

pub fn validate_synthesis_text(text: &str) -> Result<(), TextValidationError> {
    if text.is_empty() {
        return Err(TextValidationError::Empty);
    }
    if text.len() > 8_000 {
        return Err(TextValidationError::TooManyBytes);
    }
    if text.chars().count() > 2_000 {
        return Err(TextValidationError::TooManyScalars);
    }
    for scalar in text.chars() {
        if scalar == '\0' {
            return Err(TextValidationError::Nul);
        }
        if matches!(scalar, '\u{0001}'..='\u{0008}' | '\u{000e}'..='\u{001f}') {
            return Err(TextValidationError::Control);
        }
    }
    Ok(())
}

pub struct SynthesisText(Zeroizing<String>);

impl SynthesisText {
    pub fn into_zeroizing(self) -> Zeroizing<String> {
        self.0
    }
}

impl Serialize for SynthesisText {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.0.as_str())
    }
}

struct SynthesisTextVisitor;

impl Visitor<'_> for SynthesisTextVisitor {
    type Value = SynthesisText;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("bounded synthesis text")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.visit_string(value.to_owned())
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        let value = Zeroizing::new(value);
        validate_synthesis_text(value.as_str()).map_err(E::custom)?;
        Ok(SynthesisText(value))
    }
}

impl<'de> Deserialize<'de> for SynthesisText {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_string(SynthesisTextVisitor)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("manual pairing code is not canonical")]
pub struct ManualCodeValidationError;

fn validate_manual_code(value: &str) -> Result<(), ManualCodeValidationError> {
    const CROCKFORD: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    if value.len() == 12 && value.bytes().all(|byte| CROCKFORD.contains(&byte)) {
        Ok(())
    } else {
        Err(ManualCodeValidationError)
    }
}

pub struct ManualCode(Zeroizing<String>);

impl ManualCode {
    pub fn into_zeroizing(self) -> Zeroizing<String> {
        self.0
    }
}

impl Serialize for ManualCode {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.0.as_str())
    }
}

struct ManualCodeVisitor;

impl Visitor<'_> for ManualCodeVisitor {
    type Value = ManualCode;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("an exact 12-character Crockford pairing code")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.visit_string(value.to_owned())
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        let value = Zeroizing::new(value);
        validate_manual_code(value.as_str()).map_err(E::custom)?;
        Ok(ManualCode(value))
    }
}

impl<'de> Deserialize<'de> for ManualCode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_string(ManualCodeVisitor)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
#[error("canonical date-time is invalid")]
pub struct CanonicalDateTimeError;

fn decimal(bytes: &[u8]) -> Result<u32, CanonicalDateTimeError> {
    if bytes.is_empty() || !bytes.iter().all(u8::is_ascii_digit) {
        return Err(CanonicalDateTimeError);
    }
    bytes.iter().try_fold(0_u32, |value, byte| {
        value
            .checked_mul(10)
            .and_then(|value| value.checked_add(u32::from(byte - b'0')))
            .ok_or(CanonicalDateTimeError)
    })
}

fn parse_date_time(value: &str) -> Result<OffsetDateTime, CanonicalDateTimeError> {
    let bytes = value.as_bytes();
    if !(20..=35).contains(&bytes.len())
        || !value.is_ascii()
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return Err(CanonicalDateTimeError);
    }
    let year = decimal(&bytes[0..4])? as i32;
    if year == 0 {
        return Err(CanonicalDateTimeError);
    }
    let month =
        Month::try_from(decimal(&bytes[5..7])? as u8).map_err(|_| CanonicalDateTimeError)?;
    let day = decimal(&bytes[8..10])? as u8;
    let hour = decimal(&bytes[11..13])? as u8;
    let minute = decimal(&bytes[14..16])? as u8;
    let second = decimal(&bytes[17..19])? as u8;

    let mut offset_start = 19;
    let mut nanosecond = 0_u32;
    if bytes.get(offset_start) == Some(&b'.') {
        let fraction_start = offset_start + 1;
        offset_start = fraction_start;
        while bytes.get(offset_start).is_some_and(u8::is_ascii_digit) {
            offset_start += 1;
        }
        let digits = offset_start - fraction_start;
        if !(1..=9).contains(&digits) {
            return Err(CanonicalDateTimeError);
        }
        nanosecond = decimal(&bytes[fraction_start..offset_start])?
            .checked_mul(10_u32.pow((9 - digits) as u32))
            .ok_or(CanonicalDateTimeError)?;
    }

    let offset = match bytes.get(offset_start) {
        Some(b'Z') if offset_start + 1 == bytes.len() => UtcOffset::UTC,
        Some(sign @ (b'+' | b'-')) if offset_start + 6 == bytes.len() => {
            if bytes[offset_start + 3] != b':' {
                return Err(CanonicalDateTimeError);
            }
            let offset_hour = decimal(&bytes[offset_start + 1..offset_start + 3])? as i8;
            let offset_minute = decimal(&bytes[offset_start + 4..offset_start + 6])? as i8;
            if offset_hour > 23
                || offset_minute > 59
                || (*sign == b'-' && offset_hour == 0 && offset_minute == 0)
            {
                return Err(CanonicalDateTimeError);
            }
            let direction = if *sign == b'-' { -1 } else { 1 };
            UtcOffset::from_hms(direction * offset_hour, direction * offset_minute, 0)
                .map_err(|_| CanonicalDateTimeError)?
        }
        _ => return Err(CanonicalDateTimeError),
    };
    let date = Date::from_calendar_date(year, month, day).map_err(|_| CanonicalDateTimeError)?;
    let time = Time::from_hms_nano(hour, minute, second, nanosecond)
        .map_err(|_| CanonicalDateTimeError)?;
    Ok(PrimitiveDateTime::new(date, time).assume_offset(offset))
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CanonicalDateTime {
    source: String,
    parsed: OffsetDateTime,
}

impl CanonicalDateTime {
    pub fn parse(value: &str) -> Result<Self, CanonicalDateTimeError> {
        let parsed = parse_date_time(value)?;
        Ok(Self {
            source: value.to_owned(),
            parsed,
        })
    }

    pub const fn parsed(&self) -> OffsetDateTime {
        self.parsed
    }
}

impl Serialize for CanonicalDateTime {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.source)
    }
}

string_visitor!(
    CanonicalDateTimeVisitor,
    "a canonical RFC 3339 date-time",
    CanonicalDateTime::parse,
    CanonicalDateTime
);

impl<'de> Deserialize<'de> for CanonicalDateTime {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_string(CanonicalDateTimeVisitor)
    }
}

impl TryFrom<OffsetDateTime> for CanonicalDateTime {
    type Error = CanonicalDateTimeError;

    fn try_from(value: OffsetDateTime) -> Result<Self, Self::Error> {
        let value = value.to_offset(UtcOffset::UTC);
        if !(1..=9999).contains(&value.year()) {
            return Err(CanonicalDateTimeError);
        }
        let mut source = format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}",
            value.year(),
            u8::from(value.month()),
            value.day(),
            value.hour(),
            value.minute(),
            value.second()
        );
        if value.nanosecond() != 0 {
            let fraction = format!("{:09}", value.nanosecond());
            source.push('.');
            source.push_str(fraction.trim_end_matches('0'));
        }
        source.push('Z');
        Self::parse(&source)
    }
}

macro_rules! fixed_string_type {
    ($name:ident, $value:literal) => {
        #[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
        pub struct $name;

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

fixed_string_type!(PackId, "pocket-companion-pack");
fixed_string_type!(OperationalState, "pack-unverified");
