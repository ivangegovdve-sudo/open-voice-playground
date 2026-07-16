use std::collections::BTreeMap;

use open_voice_companion::protocol::{
    OPERATION_MESSAGE_CONTRACTS, OperationMessageContract, RequestMessage, ResponseBody,
    ResponseMessage,
};
use serde_json::{Map, Value};

const OPENAPI: &str = include_str!("../../openapi/openapi.yaml");

#[derive(Clone, Debug, Eq, PartialEq)]
enum OwnedRequest {
    None,
    Json {
        required: bool,
        media_type: String,
        schema_ref: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum OwnedBody {
    Empty,
    Json {
        media_type: String,
        schema_ref: String,
    },
    Audio {
        media_type: String,
        max_bytes: u64,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OwnedOperation {
    request: OwnedRequest,
    responses: BTreeMap<u16, OwnedBody>,
}

fn schema_ref(value: &Value) -> Result<String, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "schema reference is not an object".to_owned())?;
    if object.len() != 1 {
        return Err("schema reference has unsupported siblings".to_owned());
    }
    object
        .get("$ref")
        .and_then(Value::as_str)
        .and_then(|reference| reference.strip_prefix("#/components/schemas/"))
        .filter(|name| !name.is_empty() && !name.contains('/'))
        .map(str::to_owned)
        .ok_or_else(|| "schema reference is not canonical and local".to_owned())
}

fn resolve_response<'a>(document: &'a Value, candidate: &'a Value) -> Result<&'a Value, String> {
    let object = candidate
        .as_object()
        .ok_or_else(|| "response is not an object".to_owned())?;
    if let Some(reference) = object.get("$ref") {
        if object.len() != 1 {
            return Err("response reference has siblings".to_owned());
        }
        let name = reference
            .as_str()
            .and_then(|value| value.strip_prefix("#/components/responses/"))
            .ok_or_else(|| "response reference is not canonical and local".to_owned())?;
        return document["components"]["responses"]
            .get(name)
            .ok_or_else(|| "response reference is dangling".to_owned());
    }
    Ok(candidate)
}

fn extract_body(response: &Value) -> Result<OwnedBody, String> {
    let Some(content) = response.get("content") else {
        return Ok(OwnedBody::Empty);
    };
    let content = content
        .as_object()
        .filter(|content| content.len() == 1)
        .ok_or_else(|| "response content must contain exactly one media type".to_owned())?;
    let (media_type, media) = content.iter().next().unwrap();
    if media_type == "audio/wav" {
        let max_bytes = media
            .get("x-maxBodyBytes")
            .and_then(Value::as_u64)
            .ok_or_else(|| "audio response lacks a byte maximum".to_owned())?;
        return Ok(OwnedBody::Audio {
            media_type: media_type.clone(),
            max_bytes,
        });
    }
    Ok(OwnedBody::Json {
        media_type: media_type.clone(),
        schema_ref: schema_ref(
            media
                .get("schema")
                .ok_or_else(|| "JSON response lacks a schema".to_owned())?,
        )?,
    })
}

fn extract_request(operation: &Value) -> Result<OwnedRequest, String> {
    let Some(request) = operation.get("requestBody") else {
        return Ok(OwnedRequest::None);
    };
    let required = request
        .get("required")
        .and_then(Value::as_bool)
        .ok_or_else(|| "request requiredness is missing".to_owned())?;
    if !required {
        return Err("request body is not required".to_owned());
    }
    let content = request["content"]
        .as_object()
        .filter(|content| content.len() == 1)
        .ok_or_else(|| "request content must contain exactly one media type".to_owned())?;
    let (media_type, media) = content.iter().next().unwrap();
    Ok(OwnedRequest::Json {
        required,
        media_type: media_type.clone(),
        schema_ref: schema_ref(
            media
                .get("schema")
                .ok_or_else(|| "JSON request lacks a schema".to_owned())?,
        )?,
    })
}

fn extract_contracts(document: &Value) -> Result<BTreeMap<String, OwnedOperation>, String> {
    let paths = document["paths"]
        .as_object()
        .ok_or_else(|| "paths is not an object".to_owned())?;
    let mut contracts = BTreeMap::new();
    for path_item in paths.values() {
        let path_item = path_item
            .as_object()
            .ok_or_else(|| "path item is not an object".to_owned())?;
        for (method, operation) in path_item {
            if method == "parameters" {
                continue;
            }
            let operation_id = operation
                .get("operationId")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("{method} entry is not an operation"))?
                .to_owned();
            let responses = operation["responses"]
                .as_object()
                .ok_or_else(|| format!("{operation_id} responses are missing"))?;
            let mut extracted_responses = BTreeMap::new();
            for (status, response) in responses {
                if status.len() != 3
                    || !status.bytes().all(|byte| byte.is_ascii_digit())
                    || !matches!(status.as_bytes()[0], b'1'..=b'5')
                {
                    return Err(format!("{operation_id} has nonconcrete response {status}"));
                }
                let status = status
                    .parse::<u16>()
                    .map_err(|_| "response status is invalid".to_owned())?;
                let response = resolve_response(document, response)?;
                if extracted_responses
                    .insert(status, extract_body(response)?)
                    .is_some()
                {
                    return Err(format!("{operation_id} duplicates response {status}"));
                }
            }
            let operation = OwnedOperation {
                request: extract_request(operation)?,
                responses: extracted_responses,
            };
            if contracts.insert(operation_id.clone(), operation).is_some() {
                return Err(format!("duplicate operation id {operation_id}"));
            }
        }
    }
    Ok(contracts)
}

fn collect_rust_responses(
    responses: &[ResponseMessage],
) -> Result<BTreeMap<u16, OwnedBody>, String> {
    let mut collected = BTreeMap::new();
    for response in responses {
        let body = match response.body {
            ResponseBody::Empty => OwnedBody::Empty,
            ResponseBody::Json { media_type, schema } => OwnedBody::Json {
                media_type: media_type.to_owned(),
                schema_ref: schema.as_str().to_owned(),
            },
            ResponseBody::Audio {
                media_type,
                max_bytes,
            } => OwnedBody::Audio {
                media_type: media_type.to_owned(),
                max_bytes,
            },
        };
        if collected.insert(response.status, body).is_some() {
            return Err(format!(
                "duplicate Rust response status {}",
                response.status
            ));
        }
    }
    Ok(collected)
}

fn rust_contracts() -> BTreeMap<String, OwnedOperation> {
    OPERATION_MESSAGE_CONTRACTS
        .iter()
        .map(|operation: &OperationMessageContract| {
            let request = match operation.request {
                RequestMessage::None => OwnedRequest::None,
                RequestMessage::Json {
                    required,
                    media_type,
                    schema,
                } => OwnedRequest::Json {
                    required,
                    media_type: media_type.to_owned(),
                    schema_ref: schema.as_str().to_owned(),
                },
            };
            let responses = collect_rust_responses(operation.responses)
                .expect("Rust response statuses must be unique");
            (
                operation.operation_id.to_owned(),
                OwnedOperation { request, responses },
            )
        })
        .collect()
}

#[test]
fn rust_message_contract_rejects_identical_duplicate_statuses() {
    let operation = OPERATION_MESSAGE_CONTRACTS
        .iter()
        .find(|operation| operation.operation_id == "getHealth")
        .unwrap();
    let mut responses = operation.responses.to_vec();
    responses.push(operation.responses[0]);

    assert!(
        collect_rust_responses(&responses).is_err(),
        "identical duplicate response statuses must fail before map collection"
    );
}

fn operation_mut<'a>(document: &'a mut Value, id: &str) -> &'a mut Map<String, Value> {
    for path_item in document["paths"].as_object_mut().unwrap().values_mut() {
        for operation in path_item.as_object_mut().unwrap().values_mut() {
            if operation.get("operationId").and_then(Value::as_str) == Some(id) {
                return operation.as_object_mut().unwrap();
            }
        }
    }
    panic!("missing operation {id}");
}

fn response_component_mut<'a>(
    document: &'a mut Value,
    operation_id: &str,
    status: &str,
) -> &'a mut Map<String, Value> {
    let reference = operation_mut(document, operation_id)["responses"][status]["$ref"]
        .as_str()
        .unwrap()
        .strip_prefix("#/components/responses/")
        .unwrap()
        .to_owned();
    document["components"]["responses"][reference]
        .as_object_mut()
        .unwrap()
}

fn assert_mutation_is_detected(mutator: impl FnOnce(&mut Value)) {
    let expected = rust_contracts();
    let mut document: Value = yaml_serde::from_str(OPENAPI).unwrap();
    mutator(&mut document);
    assert_ne!(extract_contracts(&document).ok().as_ref(), Some(&expected));
}

#[test]
fn rust_message_contracts_equal_c4_yaml_for_all_26_operations() {
    let document: Value = yaml_serde::from_str(OPENAPI).unwrap();
    let actual = extract_contracts(&document).unwrap();
    let expected = rust_contracts();
    assert_eq!(OPERATION_MESSAGE_CONTRACTS.len(), 26);
    assert_eq!(actual, expected);
    for operation in expected.values() {
        for (status, body) in &operation.responses {
            if *status >= 400 {
                assert_eq!(
                    body,
                    &OwnedBody::Json {
                        media_type: "application/problem+json".to_owned(),
                        schema_ref: "Problem".to_owned(),
                    }
                );
            } else {
                assert_ne!(
                    body,
                    &OwnedBody::Json {
                        media_type: "application/problem+json".to_owned(),
                        schema_ref: "Problem".to_owned(),
                    }
                );
            }
        }
    }
}

#[test]
fn message_contract_mutations_fail_closed() {
    assert_mutation_is_detected(|document| {
        document["paths"]["/v1/health"]
            .as_object_mut()
            .unwrap()
            .remove("get");
    });
    assert_mutation_is_detected(|document| {
        let mut extra = document["paths"]["/v1/health"].clone();
        extra["get"]["operationId"] = Value::String("extraOperation".to_owned());
        document["paths"]["/v1/extra"] = extra;
    });
    assert_mutation_is_detected(|document| {
        operation_mut(document, "getHealth")["responses"]
            .as_object_mut()
            .unwrap()
            .remove("400");
    });
    assert_mutation_is_detected(|document| {
        let response = operation_mut(document, "getHealth")["responses"]["400"].clone();
        operation_mut(document, "getHealth")["responses"]["418"] = response;
    });
    assert_mutation_is_detected(|document| {
        operation_mut(document, "createPairingChallenge")["requestBody"]["required"] =
            Value::Bool(false);
    });
    assert_mutation_is_detected(|document| {
        let content = operation_mut(document, "createPairingChallenge")["requestBody"]["content"]
            .as_object_mut()
            .unwrap();
        let body = content.remove("application/json").unwrap();
        content.insert("text/json".to_owned(), body);
    });
    assert_mutation_is_detected(|document| {
        operation_mut(document, "createPairingChallenge")["requestBody"]["content"]["application/json"]
            ["schema"]["$ref"] = Value::String("#/components/schemas/JobCreateRequest".to_owned());
    });
    assert_mutation_is_detected(|document| {
        response_component_mut(document, "getJobAudio", "200")["content"]["audio/wav"]["x-maxBodyBytes"] =
            Value::from(67_108_863_u64);
    });
    assert_mutation_is_detected(|document| {
        let response = operation_mut(document, "getHealth")["responses"]["400"].clone();
        operation_mut(document, "getHealth")["responses"]["default"] = response;
    });
    assert_mutation_is_detected(|document| {
        let response = operation_mut(document, "getHealth")["responses"]["400"].clone();
        operation_mut(document, "getHealth")["responses"]["4XX"] = response;
    });
    assert_mutation_is_detected(|document| {
        let response = response_component_mut(document, "getHealth", "200");
        response["content"] = serde_json::json!({
            "application/problem+json": {
                "schema": { "$ref": "#/components/schemas/Problem" }
            }
        });
    });
    assert_mutation_is_detected(|document| {
        let response = response_component_mut(document, "getHealth", "400");
        response["content"] = serde_json::json!({
            "application/json": {
                "schema": { "$ref": "#/components/schemas/HealthResponse" }
            }
        });
    });
}
