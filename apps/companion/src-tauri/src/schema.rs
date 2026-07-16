use std::collections::HashMap;

use jsonschema::Validator;
use serde_json::{Map, Value};

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
}
