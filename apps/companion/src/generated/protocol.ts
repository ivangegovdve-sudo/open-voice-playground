// Generated from openapi/openapi.yaml. Do not edit by hand.
export const COMPANION_API_ORIGIN = "http://127.0.0.1:17843" as const;
export const CLIENT_VERSION = "1.0.0" as const;
export const PROTOCOL_MAJOR = 1 as const;
export const ROUTES = {
  "getHealth": "GET /v1/health",
  "createPairingChallenge": "POST /v1/pairings/challenges",
  "redeemPairingChallenge": "POST /v1/pairings/challenges/{id}/redeem",
  "getCurrentPairing": "GET /v1/pairings/current",
  "revokeCurrentPairing": "DELETE /v1/pairings/current",
  "getRuntime": "GET /v1/runtime",
  "listEngines": "GET /v1/engines",
  "listVoices": "GET /v1/voices",
  "listPacks": "GET /v1/packs",
  "createJob": "POST /v1/jobs",
  "getJob": "GET /v1/jobs/{id}",
  "cancelJob": "DELETE /v1/jobs/{id}",
  "getJobAudio": "GET /v1/jobs/{id}/audio",
  "requestPackAction": "POST /v1/packs/{id}/actions"
} as const;

export type DeepLinkChallengeRequest = { readonly "state": OpaqueSecret; readonly "verifierHash": OpaqueSecret; readonly "clientLabel": string; readonly "scopes": ScopeList; };

export type EngineListResponse = { readonly "engines": readonly (EngineResponse)[]; };

export type EngineResponse = { readonly "id": "pocket"; readonly "state": "pack-unverified"; readonly "operational": false; readonly "synthesisControls": readonly (string)[]; };

export type HealthResponse = { readonly "app": "open-voice-companion"; readonly "protocolMajor": 1; readonly "listenerState": "listening" | "listener-conflict"; };

export type JobCreateRequest = { readonly "voiceId": VoiceId; readonly "text": string; };

export type JobResponse = { readonly "id": string; readonly "voiceId": VoiceId; readonly "state": "queued" | "starting" | "synthesizing" | "completed" | "cancelling" | "cancelled" | "failed" | "expired"; readonly "audioAvailable": boolean; readonly "createdAt": string; };

export type ManualChallengeRequest = { readonly "code": string; readonly "verifierHash": OpaqueSecret; readonly "clientLabel": string; readonly "scopes": ScopeList; };

export type OpaqueSecret = string;

export type OperationalState = "companion-not-installed" | "pack-unverified" | "ready" | "busy" | "degraded";

export type PackActionRequest = { readonly "action": "install" | "update" | "repair" | "remove"; };

export type PackActionResponse = { readonly "id": string; readonly "packId": PackId; readonly "action": "install" | "update" | "repair" | "remove"; readonly "state": "pending-native-decision"; };

export type PackId = "pocket-companion-pack";

export type PackListResponse = { readonly "packs": readonly (PackResponse)[]; };

export type PackResponse = { readonly "id": PackId; readonly "state": "pack-unverified"; readonly "verified": false; readonly "operational": false; };

export type PairingChallengeRequest = DeepLinkChallengeRequest | ManualChallengeRequest;

export type PairingChallengeResponse = { readonly "id": string; readonly "state": "pending"; readonly "expiresAt": string; };

export type PairingResponse = { readonly "id": string; readonly "clientLabel": string; readonly "scopes": ScopeList; readonly "createdAt": string; readonly "lastUsedAt": string; };

export type Problem = { readonly "type": string; readonly "title": string; readonly "status": number; readonly "detail": string; readonly "instance": string; readonly "code": ProblemCode; readonly "requestId": string; };

export type ProblemCode = "host-invalid" | "origin-missing" | "origin-denied" | "version-missing" | "version-unsupported" | "auth-missing" | "auth-invalid" | "auth-origin-mismatch" | "scope-denied" | "rate-limited" | "request-line-too-large" | "headers-too-large" | "body-too-large" | "body-timeout" | "header-timeout" | "schema-invalid" | "queue-full" | "ownership-denied" | "resource-not-found" | "conflict" | "handler-timeout" | "listener-conflict" | "pairing-not-found" | "pairing-pending" | "pairing-denied" | "pairing-expired" | "pairing-consumed" | "pairing-attempts-exhausted" | "pack-unverified" | "runtime-unavailable" | "method-not-allowed" | "content-type-unsupported" | "transfer-encoding-invalid" | "duplicate-header" | "text-invalid" | "action-invalid";

export type RedeemRequest = { readonly "verifier": OpaqueSecret; };

export type RedeemResponse = { readonly "token": OpaqueSecret; readonly "pairing": PairingResponse; };

export type RuntimeResponse = { readonly "engineId": "pocket"; readonly "state": OperationalState; readonly "operational": false; readonly "reason": "pack-unverified"; };

export type Scope = "health:read" | "runtime:read" | "synthesis:create" | "jobs:read" | "jobs:cancel" | "audio:read" | "packs:request";

export type ScopeList = readonly (Scope)[];

export type VoiceId = "pocket:alba" | "pocket:estelle" | "pocket:anna" | "pocket:vera" | "pocket:fantine" | "pocket:charles" | "pocket:paul" | "pocket:eponine" | "pocket:azelma" | "pocket:george" | "pocket:mary" | "pocket:jane" | "pocket:michael" | "pocket:eve" | "pocket:bill_boerst" | "pocket:caro_davy" | "pocket:peter_yearsley" | "pocket:stuart_bell" | "pocket:marius" | "pocket:javert";

export type VoiceListResponse = { readonly "voices": readonly (VoiceResponse)[]; };

export type VoiceResponse = { readonly "id": VoiceId; readonly "engineId": "pocket"; readonly "availableInPack": true; readonly "operational": false; };
