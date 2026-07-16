use std::collections::HashMap;

use jsonschema::{Keyword, ValidationError, Validator, paths::Location};
use serde_json::{Map, Value};

use crate::protocol::OwnedSchemaName;

const OPENAPI: &str = include_str!("../../openapi/openapi.yaml");
const DIALECT: &str = "https://json-schema.org/draft/2020-12/schema";

#[derive(Debug, thiserror::Error)]
pub enum SchemaError {
    #[error("the embedded OpenAPI document is invalid")]
    InvalidDocument,
    #[error("the requested schema is not defined")]
    UnknownSchema,
    #[error("the request does not match the protocol schema")]
    InvalidInstance,
}

pub struct OpenApiSchemas {
    validators: HashMap<String, Validator>,
}

struct MaxUtf8Bytes(usize);

impl Keyword for MaxUtf8Bytes {
    fn validate<'i>(&self, instance: &'i Value) -> Result<(), ValidationError<'i>> {
        if self.is_valid(instance) {
            Ok(())
        } else {
            Err(ValidationError::custom(
                "string exceeds the protocol UTF-8 byte limit",
            ))
        }
    }

    fn is_valid(&self, instance: &Value) -> bool {
        instance.as_str().is_some_and(|value| value.len() <= self.0)
    }
}

fn max_utf8_bytes_factory<'a>(
    _parent: &'a Map<String, Value>,
    value: &'a Value,
    _path: Location,
) -> Result<Box<dyn Keyword>, ValidationError<'a>> {
    let limit = value
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| ValidationError::schema("x-maxUtf8Bytes must be a nonnegative integer"))?;
    Ok(Box::new(MaxUtf8Bytes(limit)))
}

impl OpenApiSchemas {
    pub fn embedded() -> Result<Self, SchemaError> {
        let document: Value =
            yaml_serde::from_str(OPENAPI).map_err(|_| SchemaError::InvalidDocument)?;
        let components = document
            .get("components")
            .and_then(Value::as_object)
            .ok_or(SchemaError::InvalidDocument)?;
        let schemas = components
            .get("schemas")
            .and_then(Value::as_object)
            .ok_or(SchemaError::InvalidDocument)?;

        let mut validators = HashMap::with_capacity(schemas.len());
        for (name, schema) in schemas {
            let schema_object = schema.as_object().ok_or(SchemaError::InvalidDocument)?;
            let mut root = Map::with_capacity(schema_object.len() + 2);
            root.insert("$schema".into(), Value::String(DIALECT.into()));
            root.insert("components".into(), Value::Object(components.clone()));
            root.extend(schema_object.clone());
            let validator = jsonschema::draft202012::options()
                .should_validate_formats(true)
                .should_ignore_unknown_formats(false)
                .with_keyword("x-maxUtf8Bytes", max_utf8_bytes_factory)
                .build(&Value::Object(root))
                .map_err(|_| SchemaError::InvalidDocument)?;
            validators.insert(name.clone(), validator);
        }
        Ok(Self { validators })
    }

    pub fn validate(&self, schema: &str, instance: &Value) -> Result<(), SchemaError> {
        let validator = self
            .validators
            .get(schema)
            .ok_or(SchemaError::UnknownSchema)?;
        validator
            .validate(instance)
            .map_err(|_| SchemaError::InvalidInstance)
    }

    pub fn validate_owned(
        &self,
        schema: OwnedSchemaName,
        instance: &Value,
    ) -> Result<(), SchemaError> {
        self.validate(schema.as_str(), instance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_utf8_limit_counts_bytes_independently_from_scalar_count() {
        let schema = serde_json::json!({
            "$schema": DIALECT,
            "type": "string",
            "minLength": 2,
            "maxLength": 2,
            "x-maxUtf8Bytes": 4
        });
        let validator = jsonschema::draft202012::options()
            .with_keyword("x-maxUtf8Bytes", max_utf8_bytes_factory)
            .build(&schema)
            .expect("synthetic UTF-8 boundary schema must compile");
        assert!(validator.is_valid(&Value::String("éé".to_owned())));
        assert!(validator.is_valid(&Value::String("e\u{0301}".to_owned())));
        assert!(!validator.is_valid(&Value::String("😀a".to_owned())));
    }
}
