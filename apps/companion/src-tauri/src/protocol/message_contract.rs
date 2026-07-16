use super::OwnedSchemaName;

pub const JSON_MEDIA_TYPE: &str = "application/json";
pub const PROBLEM_MEDIA_TYPE: &str = "application/problem+json";
pub const WAV_MEDIA_TYPE: &str = "audio/wav";
pub const MAX_WAV_RESPONSE_BYTES: u64 = 67_108_864;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RequestMessage {
    None,
    Json {
        required: bool,
        media_type: &'static str,
        schema: OwnedSchemaName,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResponseBody {
    Empty,
    Json {
        media_type: &'static str,
        schema: OwnedSchemaName,
    },
    Audio {
        media_type: &'static str,
        max_bytes: u64,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ResponseMessage {
    pub status: u16,
    pub body: ResponseBody,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OperationMessageContract {
    pub operation_id: &'static str,
    pub request: RequestMessage,
    pub responses: &'static [ResponseMessage],
}

const fn json(status: u16, schema: OwnedSchemaName) -> ResponseMessage {
    ResponseMessage {
        status,
        body: ResponseBody::Json {
            media_type: JSON_MEDIA_TYPE,
            schema,
        },
    }
}

const fn problem(status: u16) -> ResponseMessage {
    ResponseMessage {
        status,
        body: ResponseBody::Json {
            media_type: PROBLEM_MEDIA_TYPE,
            schema: OwnedSchemaName::Problem,
        },
    }
}

const fn empty(status: u16) -> ResponseMessage {
    ResponseMessage {
        status,
        body: ResponseBody::Empty,
    }
}

const fn audio(status: u16) -> ResponseMessage {
    ResponseMessage {
        status,
        body: ResponseBody::Audio {
            media_type: WAV_MEDIA_TYPE,
            max_bytes: MAX_WAV_RESPONSE_BYTES,
        },
    }
}

macro_rules! response_set {
    ($name:ident, success [$($success:expr),+ $(,)?], errors [$($error:literal),* $(,)?]) => {
        const $name: &[ResponseMessage] = &[
            $($success),+,
            $(problem($error)),*
        ];
    };
}

response_set!(
    HEALTH_RESPONSES,
    success [json(200, OwnedSchemaName::HealthResponse)],
    errors [400, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504]
);
response_set!(
    PAIRING_CHALLENGE_RESPONSES,
    success [json(201, OwnedSchemaName::PairingChallengeResponse)],
    errors [
        400, 403, 404, 405, 408, 409, 413, 414, 415, 426, 429, 431, 503, 504
    ]
);
response_set!(
    REDEEM_RESPONSES,
    success [
        json(200, OwnedSchemaName::RedeemResponse),
        json(202, OwnedSchemaName::RedeemPendingResponse)
    ],
    errors [
        400, 403, 404, 405, 408, 409, 410, 413, 414, 415, 426, 429, 431, 503, 504
    ]
);
response_set!(
    CURRENT_PAIRING_RESPONSES,
    success [json(200, OwnedSchemaName::PairingResponse)],
    errors [400, 401, 403, 404, 405, 408, 413, 414, 426, 429, 431, 503, 504]
);
response_set!(
    REVOKE_PAIRING_RESPONSES,
    success [empty(204)],
    errors [400, 401, 403, 405, 408, 413, 414, 426, 431, 503, 504]
);
response_set!(
    RUNTIME_RESPONSES,
    success [json(200, OwnedSchemaName::RuntimeResponse)],
    errors [400, 401, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504]
);
response_set!(
    ENGINE_RESPONSES,
    success [json(200, OwnedSchemaName::EngineListResponse)],
    errors [400, 401, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504]
);
response_set!(
    VOICE_RESPONSES,
    success [json(200, OwnedSchemaName::VoiceListResponse)],
    errors [400, 401, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504]
);
response_set!(
    PACK_RESPONSES,
    success [json(200, OwnedSchemaName::PackListResponse)],
    errors [400, 401, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504]
);
response_set!(
    CREATE_JOB_RESPONSES,
    success [json(202, OwnedSchemaName::JobResponse)],
    errors [400, 401, 403, 405, 408, 413, 414, 415, 426, 429, 431, 503, 504]
);
response_set!(
    GET_JOB_RESPONSES,
    success [json(200, OwnedSchemaName::JobResponse)],
    errors [400, 401, 403, 404, 405, 408, 413, 414, 426, 429, 431, 503, 504]
);
response_set!(
    CANCEL_JOB_RESPONSES,
    success [json(202, OwnedSchemaName::JobResponse)],
    errors [400, 401, 403, 404, 405, 408, 413, 414, 426, 431, 503, 504]
);
response_set!(
    AUDIO_RESPONSES,
    success [audio(200)],
    errors [
        400, 401, 403, 404, 405, 408, 409, 410, 413, 414, 426, 429, 431, 503, 504
    ]
);
response_set!(
    PACK_ACTION_RESPONSES,
    success [json(202, OwnedSchemaName::PackActionResponse)],
    errors [
        400, 401, 403, 404, 405, 408, 409, 413, 414, 415, 426, 429, 431, 503, 504
    ]
);
response_set!(
    PREFLIGHT_RESPONSES,
    success [empty(204)],
    errors [400, 403, 405, 408, 413, 414, 431, 503]
);

const fn required_json(schema: OwnedSchemaName) -> RequestMessage {
    RequestMessage::Json {
        required: true,
        media_type: JSON_MEDIA_TYPE,
        schema,
    }
}

pub const OPERATION_MESSAGE_CONTRACTS: [OperationMessageContract; 26] = [
    OperationMessageContract {
        operation_id: "getHealth",
        request: RequestMessage::None,
        responses: HEALTH_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "preflightHealth",
        request: RequestMessage::None,
        responses: PREFLIGHT_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "createPairingChallenge",
        request: required_json(OwnedSchemaName::PairingChallengeRequest),
        responses: PAIRING_CHALLENGE_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "preflightPairingChallenges",
        request: RequestMessage::None,
        responses: PREFLIGHT_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "redeemPairingChallenge",
        request: required_json(OwnedSchemaName::RedeemRequest),
        responses: REDEEM_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "preflightPairingChallengeRedeem",
        request: RequestMessage::None,
        responses: PREFLIGHT_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "getCurrentPairing",
        request: RequestMessage::None,
        responses: CURRENT_PAIRING_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "revokeCurrentPairing",
        request: RequestMessage::None,
        responses: REVOKE_PAIRING_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "preflightCurrentPairing",
        request: RequestMessage::None,
        responses: PREFLIGHT_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "getRuntime",
        request: RequestMessage::None,
        responses: RUNTIME_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "preflightRuntime",
        request: RequestMessage::None,
        responses: PREFLIGHT_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "listEngines",
        request: RequestMessage::None,
        responses: ENGINE_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "preflightEngines",
        request: RequestMessage::None,
        responses: PREFLIGHT_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "listVoices",
        request: RequestMessage::None,
        responses: VOICE_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "preflightVoices",
        request: RequestMessage::None,
        responses: PREFLIGHT_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "listPacks",
        request: RequestMessage::None,
        responses: PACK_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "preflightPacks",
        request: RequestMessage::None,
        responses: PREFLIGHT_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "createJob",
        request: required_json(OwnedSchemaName::JobCreateRequest),
        responses: CREATE_JOB_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "preflightJobs",
        request: RequestMessage::None,
        responses: PREFLIGHT_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "getJob",
        request: RequestMessage::None,
        responses: GET_JOB_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "cancelJob",
        request: RequestMessage::None,
        responses: CANCEL_JOB_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "preflightJob",
        request: RequestMessage::None,
        responses: PREFLIGHT_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "getJobAudio",
        request: RequestMessage::None,
        responses: AUDIO_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "preflightJobAudio",
        request: RequestMessage::None,
        responses: PREFLIGHT_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "requestPackAction",
        request: required_json(OwnedSchemaName::PackActionRequest),
        responses: PACK_ACTION_RESPONSES,
    },
    OperationMessageContract {
        operation_id: "preflightPackActions",
        request: RequestMessage::None,
        responses: PREFLIGHT_RESPONSES,
    },
];
