// Generated from openapi/openapi.yaml. Do not edit by hand.
export const COMPANION_API_ORIGIN = "http://127.0.0.1:17843" as const;
export const CLIENT_VERSION = "1.0.0" as const;
export const PROTOCOL_MAJOR = 1 as const;
export const ROUTES = {
  "cancelJob": "DELETE /v1/jobs/{id}",
  "createJob": "POST /v1/jobs",
  "createPairingChallenge": "POST /v1/pairings/challenges",
  "getCurrentPairing": "GET /v1/pairings/current",
  "getHealth": "GET /v1/health",
  "getJob": "GET /v1/jobs/{id}",
  "getJobAudio": "GET /v1/jobs/{id}/audio",
  "getRuntime": "GET /v1/runtime",
  "listEngines": "GET /v1/engines",
  "listPacks": "GET /v1/packs",
  "listVoices": "GET /v1/voices",
  "redeemPairingChallenge": "POST /v1/pairings/challenges/{id}/redeem",
  "requestPackAction": "POST /v1/packs/{id}/actions",
  "revokeCurrentPairing": "DELETE /v1/pairings/current"
} as const;

declare const protocolBrand: unique symbol;
type Brand<Name extends string> = { readonly [protocolBrand]: { readonly [Key in Name]: true } };

export type CanonicalDateTime = (((string)) & Brand<"CanonicalDateTime">) & Brand<"CanonicalDateTime">;

export type CanonicalUuid = (((string)) & Brand<"CanonicalUuid">) & Brand<"CanonicalUuid">;

export type ClientLabel = (((string)) & Brand<"ClientLabel">) & Brand<"ClientLabel">;

export type ClientVersion = (((string)) & Brand<"ClientVersion">) & Brand<"ClientVersion">;

export type DeepLinkChallengeRequest = ((object) & ({ readonly "clientLabel": (ClientLabel); readonly "scopes": (ScopeList); readonly "state": (OpaqueSecret); readonly "verifierHash": (OpaqueSecret); })) & Brand<"DeepLinkChallengeRequest">;

export type EngineListResponse = ((object) & ({ readonly "engines": ((readonly ((EngineResponse))[])) & Brand<"EngineListResponse.engines">; })) & Brand<"EngineListResponse">;

export type EngineResponse = ((object) & ({ readonly "id": ("pocket") & (string); readonly "operational": (false) & (boolean); readonly "state": ("pack-unverified") & (string); })) & Brand<"EngineResponse">;

export type HealthResponse = ((object) & ({ readonly "app": ("open-voice-companion") & (string); readonly "listenerState": ("listener-conflict" | "listening") & (string); readonly "protocolMajor": ((1) & (number)) & Brand<"HealthResponse.protocolMajor">; })) & Brand<"HealthResponse">;

export type JobCreateRequest = ((object) & ({ readonly "text": (SynthesisText); readonly "voiceId": (VoiceId); })) & Brand<"JobCreateRequest">;

export type JobResponse = ((object) & ({ readonly "audioAvailable": (false) & (boolean); readonly "createdAt": (CanonicalDateTime); readonly "id": (CanonicalUuid); readonly "state": ("cancelled" | "cancelling" | "expired" | "failed" | "queued") & (string); readonly "voiceId": (VoiceId); })) & Brand<"JobResponse">;

export type ManualChallengeRequest = ((object) & ({ readonly "clientLabel": (ClientLabel); readonly "code": ((string)) & Brand<"ManualChallengeRequest.code">; readonly "scopes": (ScopeList); readonly "verifierHash": (OpaqueSecret); })) & Brand<"ManualChallengeRequest">;

export type OpaqueSecret = (((string)) & Brand<"OpaqueSecret">) & Brand<"OpaqueSecret">;

export type OperationalState = (("pack-unverified") & (string)) & Brand<"OperationalState">;

export type PackActionRequest = ((object) & ({ readonly "action": ("install" | "remove" | "repair" | "update") & (string); })) & Brand<"PackActionRequest">;

export type PackActionResponse = ((object) & ({ readonly "action": ("install" | "remove" | "repair" | "update") & (string); readonly "id": (CanonicalUuid); readonly "packId": (PackId); readonly "state": ("pending-native-decision") & (string); })) & Brand<"PackActionResponse">;

export type PackId = (("pocket-companion-pack") & (string)) & Brand<"PackId">;

export type PackListResponse = ((object) & ({ readonly "packs": ((readonly ((PackResponse))[])) & Brand<"PackListResponse.packs">; })) & Brand<"PackListResponse">;

export type PackResponse = ((object) & ({ readonly "id": (PackId); readonly "operational": (false) & (boolean); readonly "state": ("pack-unverified") & (string); readonly "verified": (false) & (boolean); })) & Brand<"PackResponse">;

export type PairingChallengeRequest = (((DeepLinkChallengeRequest) | (ManualChallengeRequest))) & Brand<"PairingChallengeRequest">;

export type PairingChallengeResponse = ((object) & ({ readonly "expiresAt": (CanonicalDateTime); readonly "id": (CanonicalUuid); readonly "state": ("pending") & (string); })) & Brand<"PairingChallengeResponse">;

export type PairingResponse = ((object) & ({ readonly "clientLabel": (ClientLabel); readonly "createdAt": (CanonicalDateTime); readonly "id": (CanonicalUuid); readonly "lastUsedAt": (CanonicalDateTime); readonly "scopes": (ScopeList); })) & Brand<"PairingResponse">;

export type Problem = (((object) & ({ readonly "code": ("action-invalid") & (string); readonly "detail": ("The requested pack action is not accepted.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf0.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((400) & (number)) & Brand<"Problem.oneOf0.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:action-invalid") & (string); }) | (object) & ({ readonly "code": ("auth-invalid") & (string); readonly "detail": ("The bearer token is not valid.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf1.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((401) & (number)) & Brand<"Problem.oneOf1.status">; readonly "title": ("Authentication failed") & (string); readonly "type": ("urn:ovp:problem:auth-invalid") & (string); }) | (object) & ({ readonly "code": ("auth-missing") & (string); readonly "detail": ("A bearer token is required.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf2.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((401) & (number)) & Brand<"Problem.oneOf2.status">; readonly "title": ("Authentication failed") & (string); readonly "type": ("urn:ovp:problem:auth-missing") & (string); }) | (object) & ({ readonly "code": ("auth-origin-mismatch") & (string); readonly "detail": ("The bearer token is not valid for this origin.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf3.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((401) & (number)) & Brand<"Problem.oneOf3.status">; readonly "title": ("Authentication failed") & (string); readonly "type": ("urn:ovp:problem:auth-origin-mismatch") & (string); }) | (object) & ({ readonly "code": ("body-timeout") & (string); readonly "detail": ("The request body did not arrive within the deadline.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf4.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((408) & (number)) & Brand<"Problem.oneOf4.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:body-timeout") & (string); }) | (object) & ({ readonly "code": ("body-too-large") & (string); readonly "detail": ("The JSON request body exceeds the limit.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf5.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((413) & (number)) & Brand<"Problem.oneOf5.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:body-too-large") & (string); }) | (object) & ({ readonly "code": ("conflict") & (string); readonly "detail": ("The request conflicts with current state.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf6.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((409) & (number)) & Brand<"Problem.oneOf6.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:conflict") & (string); }) | (object) & ({ readonly "code": ("content-type-unsupported") & (string); readonly "detail": ("The request content type is not supported.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf7.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((415) & (number)) & Brand<"Problem.oneOf7.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:content-type-unsupported") & (string); }) | (object) & ({ readonly "code": ("duplicate-header") & (string); readonly "detail": ("A security-sensitive header was duplicated.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf8.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((400) & (number)) & Brand<"Problem.oneOf8.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:duplicate-header") & (string); }) | (object) & ({ readonly "code": ("handler-timeout") & (string); readonly "detail": ("The request handler exceeded its deadline.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf9.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((504) & (number)) & Brand<"Problem.oneOf9.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:handler-timeout") & (string); }) | (object) & ({ readonly "code": ("header-timeout") & (string); readonly "detail": ("The request headers did not arrive within the deadline.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf10.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((408) & (number)) & Brand<"Problem.oneOf10.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:header-timeout") & (string); }) | (object) & ({ readonly "code": ("headers-too-large") & (string); readonly "detail": ("The HTTP headers exceed the limit.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf11.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((431) & (number)) & Brand<"Problem.oneOf11.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:headers-too-large") & (string); }) | (object) & ({ readonly "code": ("host-invalid") & (string); readonly "detail": ("The request Host is not the companion loopback authority.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf12.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((400) & (number)) & Brand<"Problem.oneOf12.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:host-invalid") & (string); }) | (object) & ({ readonly "code": ("listener-conflict") & (string); readonly "detail": ("The fixed loopback port is already in use.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf13.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((503) & (number)) & Brand<"Problem.oneOf13.status">; readonly "title": ("Listener unavailable") & (string); readonly "type": ("urn:ovp:problem:listener-conflict") & (string); }) | (object) & ({ readonly "code": ("method-not-allowed") & (string); readonly "detail": ("The HTTP method is not supported for this route.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf14.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((405) & (number)) & Brand<"Problem.oneOf14.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:method-not-allowed") & (string); }) | (object) & ({ readonly "code": ("origin-denied") & (string); readonly "detail": ("The requesting origin is not allowed.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf15.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((403) & (number)) & Brand<"Problem.oneOf15.status">; readonly "title": ("Origin denied") & (string); readonly "type": ("urn:ovp:problem:origin-denied") & (string); }) | (object) & ({ readonly "code": ("origin-missing") & (string); readonly "detail": ("The Origin header is required.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf16.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((400) & (number)) & Brand<"Problem.oneOf16.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:origin-missing") & (string); }) | (object) & ({ readonly "code": ("ownership-denied") & (string); readonly "detail": ("The requested resource was not found.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf17.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((404) & (number)) & Brand<"Problem.oneOf17.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:ownership-denied") & (string); }) | (object) & ({ readonly "code": ("pack-unverified") & (string); readonly "detail": ("No verified Pocket pack is installed.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf18.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((503) & (number)) & Brand<"Problem.oneOf18.status">; readonly "title": ("Runtime unavailable") & (string); readonly "type": ("urn:ovp:problem:pack-unverified") & (string); }) | (object) & ({ readonly "code": ("pairing-attempts-exhausted") & (string); readonly "detail": ("The manual pairing attempts are exhausted.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf19.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((403) & (number)) & Brand<"Problem.oneOf19.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:pairing-attempts-exhausted") & (string); }) | (object) & ({ readonly "code": ("pairing-consumed") & (string); readonly "detail": ("The request conflicts with current state.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf20.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((409) & (number)) & Brand<"Problem.oneOf20.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:pairing-consumed") & (string); }) | (object) & ({ readonly "code": ("pairing-denied") & (string); readonly "detail": ("The native pairing request was denied.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf21.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((403) & (number)) & Brand<"Problem.oneOf21.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:pairing-denied") & (string); }) | (object) & ({ readonly "code": ("pairing-expired") & (string); readonly "detail": ("The pairing request has expired.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf22.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((410) & (number)) & Brand<"Problem.oneOf22.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:pairing-expired") & (string); }) | (object) & ({ readonly "code": ("pairing-not-found") & (string); readonly "detail": ("The requested resource was not found.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf23.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((404) & (number)) & Brand<"Problem.oneOf23.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:pairing-not-found") & (string); }) | (object) & ({ readonly "code": ("queue-full") & (string); readonly "detail": ("The synthesis queue is at capacity.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf24.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((503) & (number)) & Brand<"Problem.oneOf24.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:queue-full") & (string); }) | (object) & ({ readonly "code": ("rate-limited") & (string); readonly "detail": ("The request rate limit has been reached.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf25.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((429) & (number)) & Brand<"Problem.oneOf25.status">; readonly "title": ("Rate limit exceeded") & (string); readonly "type": ("urn:ovp:problem:rate-limited") & (string); }) | (object) & ({ readonly "code": ("request-line-too-large") & (string); readonly "detail": ("The HTTP request line exceeds the limit.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf26.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((414) & (number)) & Brand<"Problem.oneOf26.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:request-line-too-large") & (string); }) | (object) & ({ readonly "code": ("resource-not-found") & (string); readonly "detail": ("The requested resource was not found.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf27.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((404) & (number)) & Brand<"Problem.oneOf27.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:resource-not-found") & (string); }) | (object) & ({ readonly "code": ("runtime-unavailable") & (string); readonly "detail": ("The synthesis runtime is unavailable.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf28.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((503) & (number)) & Brand<"Problem.oneOf28.status">; readonly "title": ("Runtime unavailable") & (string); readonly "type": ("urn:ovp:problem:runtime-unavailable") & (string); }) | (object) & ({ readonly "code": ("schema-invalid") & (string); readonly "detail": ("The request body does not match the protocol schema.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf29.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((400) & (number)) & Brand<"Problem.oneOf29.status">; readonly "title": ("Invalid request") & (string); readonly "type": ("urn:ovp:problem:schema-invalid") & (string); }) | (object) & ({ readonly "code": ("scope-denied") & (string); readonly "detail": ("The bearer token lacks the required scope.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf30.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((403) & (number)) & Brand<"Problem.oneOf30.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:scope-denied") & (string); }) | (object) & ({ readonly "code": ("text-invalid") & (string); readonly "detail": ("The synthesis text is outside the accepted bounds.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf31.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((400) & (number)) & Brand<"Problem.oneOf31.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:text-invalid") & (string); }) | (object) & ({ readonly "code": ("transfer-encoding-invalid") & (string); readonly "detail": ("The HTTP transfer encoding is not supported.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf32.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((400) & (number)) & Brand<"Problem.oneOf32.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:transfer-encoding-invalid") & (string); }) | (object) & ({ readonly "code": ("version-missing") & (string); readonly "detail": ("The client version header is required.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf33.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((400) & (number)) & Brand<"Problem.oneOf33.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:version-missing") & (string); }) | (object) & ({ readonly "code": ("version-unsupported") & (string); readonly "detail": ("The client protocol major is not supported.") & (string); readonly "instance": ((string)) & Brand<"Problem.oneOf34.instance">; readonly "requestId": (CanonicalUuid); readonly "status": ((426) & (number)) & Brand<"Problem.oneOf34.status">; readonly "title": ("Request rejected") & (string); readonly "type": ("urn:ovp:problem:version-unsupported") & (string); }))) & Brand<"Problem">;

export type ProblemCode = (("action-invalid" | "auth-invalid" | "auth-missing" | "auth-origin-mismatch" | "body-timeout" | "body-too-large" | "conflict" | "content-type-unsupported" | "duplicate-header" | "handler-timeout" | "header-timeout" | "headers-too-large" | "host-invalid" | "listener-conflict" | "method-not-allowed" | "origin-denied" | "origin-missing" | "ownership-denied" | "pack-unverified" | "pairing-attempts-exhausted" | "pairing-consumed" | "pairing-denied" | "pairing-expired" | "pairing-not-found" | "queue-full" | "rate-limited" | "request-line-too-large" | "resource-not-found" | "runtime-unavailable" | "schema-invalid" | "scope-denied" | "text-invalid" | "transfer-encoding-invalid" | "version-missing" | "version-unsupported") & (string)) & Brand<"ProblemCode">;

export type RedeemPendingResponse = ((object) & ({ readonly "state": ("pending") & (string); })) & Brand<"RedeemPendingResponse">;

export type RedeemRequest = ((object) & ({ readonly "verifier": (OpaqueSecret); })) & Brand<"RedeemRequest">;

export type RedeemResponse = ((object) & ({ readonly "pairing": (PairingResponse); readonly "token": (OpaqueSecret); })) & Brand<"RedeemResponse">;

export type RuntimeResponse = ((object) & ({ readonly "engineId": ("pocket") & (string); readonly "operational": (false) & (boolean); readonly "reason": ("pack-unverified") & (string); readonly "state": (OperationalState); })) & Brand<"RuntimeResponse">;

export type Scope = (("audio:read" | "health:read" | "jobs:cancel" | "jobs:read" | "packs:request" | "runtime:read" | "synthesis:create") & (string)) & Brand<"Scope">;

export type ScopeList = (((readonly ["health:read", "runtime:read", "synthesis:create", "jobs:read", "jobs:cancel", "audio:read", "packs:request"]) & (readonly ((Scope))[])) & Brand<"ScopeList">) & Brand<"ScopeList">;

export type SynthesisText = (((string)) & Brand<"SynthesisText">) & Brand<"SynthesisText">;

export type VoiceId = (("pocket:alba" | "pocket:anna" | "pocket:azelma" | "pocket:bill_boerst" | "pocket:caro_davy" | "pocket:charles" | "pocket:eponine" | "pocket:estelle" | "pocket:eve" | "pocket:fantine" | "pocket:george" | "pocket:jane" | "pocket:javert" | "pocket:marius" | "pocket:mary" | "pocket:michael" | "pocket:paul" | "pocket:peter_yearsley" | "pocket:stuart_bell" | "pocket:vera") & (string)) & Brand<"VoiceId">;

export type VoiceListResponse = ((object) & ({ readonly "voices": ((readonly ((VoiceResponse))[])) & Brand<"VoiceListResponse.voices">; })) & Brand<"VoiceListResponse">;

export type VoiceResponse = ((object) & ({ readonly "availableInPack": (true) & (boolean); readonly "engineId": ("pocket") & (string); readonly "id": (VoiceId); readonly "operational": (false) & (boolean); })) & Brand<"VoiceResponse">;

export type OwnedSchemaName = "CanonicalDateTime" | "CanonicalUuid" | "ClientLabel" | "ClientVersion" | "DeepLinkChallengeRequest" | "EngineListResponse" | "EngineResponse" | "HealthResponse" | "JobCreateRequest" | "JobResponse" | "ManualChallengeRequest" | "OpaqueSecret" | "OperationalState" | "PackActionRequest" | "PackActionResponse" | "PackId" | "PackListResponse" | "PackResponse" | "PairingChallengeRequest" | "PairingChallengeResponse" | "PairingResponse" | "Problem" | "ProblemCode" | "RedeemPendingResponse" | "RedeemRequest" | "RedeemResponse" | "RuntimeResponse" | "Scope" | "ScopeList" | "SynthesisText" | "VoiceId" | "VoiceListResponse" | "VoiceResponse";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type RuntimeSchema = {
  readonly $ref?: string;
  readonly additionalProperties?: false;
  readonly const?: JsonValue;
  readonly enum?: readonly JsonValue[];
  readonly exclusiveMaximum?: number;
  readonly exclusiveMinimum?: number;
  readonly format?: "date-time" | "uuid";
  readonly items?: RuntimeSchema;
  readonly maxItems?: number;
  readonly maxLength?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly oneOf?: readonly RuntimeSchema[];
  readonly pattern?: string;
  readonly properties?: Readonly<Record<string, RuntimeSchema>>;
  readonly required?: readonly string[];
  readonly type?: "array" | "boolean" | "integer" | "number" | "object" | "string";
  readonly uniqueItems?: boolean;
  readonly "x-maxUtf8Bytes"?: number;
};

type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly path: string };

const validResult: ValidationResult = { valid: true };
const maximumJsonNodes = 10_000;
const maximumJsonDepth = 64;
const maximumSchemaDepth = 64;

function invalid(path: string): ValidationResult {
  return { valid: false, path };
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isSafeJson(
  value: unknown,
  budget: { remaining: number },
  ancestors: Set<object>,
  depth: number,
): boolean {
  if (depth > maximumJsonDepth || budget.remaining <= 0) return false;
  budget.remaining -= 1;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return isWellFormedUnicode(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || value.length > budget.remaining) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string")) return false;
    ancestors.add(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true ||
        !isSafeJson(descriptor.value, budget, ancestors, depth + 1)
      ) {
        ancestors.delete(value);
        return false;
      }
    }
    ancestors.delete(value);
    return true;
  }
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length > budget.remaining || keys.some((key) => typeof key !== "string")) return false;
  ancestors.add(value);
  for (const key of keys as string[]) {
    if (!isWellFormedUnicode(key)) {
      ancestors.delete(value);
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      !isSafeJson(descriptor.value, budget, ancestors, depth + 1)
    ) {
      ancestors.delete(value);
      return false;
    }
  }
  ancestors.delete(value);
  return true;
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]!));
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Readonly<Record<string, JsonValue>>;
    const rightRecord = right as Readonly<Record<string, JsonValue>>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          rightKeys[index] === key &&
          jsonEqual(leftRecord[key]!, rightRecord[key]!),
      )
    );
  }
  return false;
}

function codePointLength(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) index += 1;
    length += 1;
  }
  return length;
}

function utf8Length(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) length += 1;
    else if (code <= 0x7ff) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      length += 4;
      index += 1;
    } else length += 3;
  }
  return length;
}

function matchesCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function matchesCanonicalDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]!) return false;
  const zone = match[7]!;
  if (zone === "-00:00") return false;
  if (zone !== "Z") {
    const zoneHour = Number(zone.slice(1, 3));
    const zoneMinute = Number(zone.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59) return false;
  }
  return true;
}

function propertyPath(path: string, property: string): string {
  return path + "/" + property.replaceAll("~", "~0").replaceAll("/", "~1");
}

function validateSchema(
  schema: RuntimeSchema,
  value: JsonValue,
  path: string,
  depth: number,
): ValidationResult {
  if (depth > maximumSchemaDepth) return invalid(path);
  if (schema.$ref !== undefined) {
    const name = schema.$ref.slice("#/components/schemas/".length) as OwnedSchemaName;
    const referenced = SCHEMAS[name] as RuntimeSchema | undefined;
    if (referenced === undefined) return invalid(path);
    const result = validateSchema(referenced, value, path, depth + 1);
    if (!result.valid) return result;
  }
  if (schema.oneOf !== undefined) {
    let matches = 0;
    for (const branch of schema.oneOf) {
      if (validateSchema(branch, value, path, depth + 1).valid) matches += 1;
    }
    if (matches !== 1) return invalid(path);
  }
  if (schema.const !== undefined && !jsonEqual(value, schema.const)) return invalid(path);
  if (schema.enum !== undefined && !schema.enum.some((item) => jsonEqual(value, item))) {
    return invalid(path);
  }
  if (schema.type === "string" && typeof value !== "string") return invalid(path);
  if (schema.type === "boolean" && typeof value !== "boolean") return invalid(path);
  if (schema.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    return invalid(path);
  }
  if (
    schema.type === "integer" &&
    (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value))
  ) {
    return invalid(path);
  }
  if (schema.type === "array" && !Array.isArray(value)) return invalid(path);
  if (
    schema.type === "object" &&
    (value === null || typeof value !== "object" || Array.isArray(value))
  ) {
    return invalid(path);
  }
  if (typeof value === "string") {
    const length = codePointLength(value);
    if (schema.minLength !== undefined && length < schema.minLength) return invalid(path);
    if (schema.maxLength !== undefined && length > schema.maxLength) return invalid(path);
    if (schema["x-maxUtf8Bytes"] !== undefined && utf8Length(value) > schema["x-maxUtf8Bytes"]!) {
      return invalid(path);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) {
      return invalid(path);
    }
    if (schema.format === "uuid" && !matchesCanonicalUuid(value)) return invalid(path);
    if (schema.format === "date-time" && !matchesCanonicalDateTime(value)) return invalid(path);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return invalid(path);
    if (schema.maximum !== undefined && value > schema.maximum) return invalid(path);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return invalid(path);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return invalid(path);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return invalid(path);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return invalid(path);
    if (schema.uniqueItems === true) {
      for (let left = 0; left < value.length; left += 1) {
        for (let right = left + 1; right < value.length; right += 1) {
          if (jsonEqual(value[left]!, value[right]!)) return invalid(path);
        }
      }
    }
    if (schema.items !== undefined) {
      for (let index = 0; index < value.length; index += 1) {
        const result = validateSchema(schema.items, value[index]!, path + "/" + index, depth + 1);
        if (!result.valid) return result;
      }
    }
  }
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    schema.properties !== undefined
  ) {
    const record = value as Readonly<Record<string, JsonValue>>;
    const keys = Object.keys(record);
    if (
      schema.additionalProperties === false &&
      keys.some((key) => !Object.prototype.hasOwnProperty.call(schema.properties, key))
    ) {
      return invalid(path);
    }
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(record, required)) return invalid(path);
    }
    for (const [name, propertySchema] of Object.entries(schema.properties)) {
      if (!Object.prototype.hasOwnProperty.call(record, name)) continue;
      const result = validateSchema(
        propertySchema,
        record[name]!,
        propertyPath(path, name),
        depth + 1,
      );
      if (!result.valid) return result;
    }
  }
  return validResult;
}

function validateOwned(name: OwnedSchemaName, value: unknown): ValidationResult {
  try {
    if (!isSafeJson(value, { remaining: maximumJsonNodes }, new Set(), 0)) return invalid("$");
    return validateSchema(SCHEMAS[name] as RuntimeSchema, value as JsonValue, "$", 0);
  } catch {
    return invalid("$");
  }
}

export class ProtocolValidationError extends Error {
  readonly schema: OwnedSchemaName;
  readonly path: string;

  constructor(schema: OwnedSchemaName, path: string) {
    super("Invalid " + schema + " value at " + path + ".");
    this.name = "ProtocolValidationError";
    this.schema = schema;
    this.path = path;
  }
}

const SCHEMAS = JSON.parse("{\"CanonicalDateTime\":{\"format\":\"date-time\",\"maxLength\":35,\"minLength\":20,\"pattern\":\"^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\\\.[0-9]{1,9})?(Z|\\\\+([01][0-9]|2[0-3]):[0-5][0-9]|-(?!00:00$)([01][0-9]|2[0-3]):[0-5][0-9])$\",\"type\":\"string\"},\"CanonicalUuid\":{\"format\":\"uuid\",\"maxLength\":36,\"minLength\":36,\"pattern\":\"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"ClientLabel\":{\"maxLength\":64,\"minLength\":1,\"pattern\":\"^(?!(.)\\\\1{32,}$)[^\\\\u0000-\\\\u001F\\\\u007F-\\\\u009F\\\\u061C\\\\u200E\\\\u200F\\\\u2028-\\\\u202E\\\\u2066-\\\\u2069<>{}\\\\[\\\\]`]+$\",\"type\":\"string\",\"x-maxUtf8Bytes\":128},\"ClientVersion\":{\"maxLength\":32,\"minLength\":5,\"pattern\":\"^1\\\\.(0|[1-9][0-9]*)\\\\.(0|[1-9][0-9]*)$\",\"type\":\"string\"},\"DeepLinkChallengeRequest\":{\"additionalProperties\":false,\"properties\":{\"clientLabel\":{\"$ref\":\"#/components/schemas/ClientLabel\"},\"scopes\":{\"$ref\":\"#/components/schemas/ScopeList\"},\"state\":{\"$ref\":\"#/components/schemas/OpaqueSecret\"},\"verifierHash\":{\"$ref\":\"#/components/schemas/OpaqueSecret\"}},\"required\":[\"clientLabel\",\"scopes\",\"state\",\"verifierHash\"],\"type\":\"object\"},\"EngineListResponse\":{\"additionalProperties\":false,\"properties\":{\"engines\":{\"items\":{\"$ref\":\"#/components/schemas/EngineResponse\"},\"maxItems\":1,\"minItems\":1,\"type\":\"array\"}},\"required\":[\"engines\"],\"type\":\"object\"},\"EngineResponse\":{\"additionalProperties\":false,\"properties\":{\"id\":{\"const\":\"pocket\",\"type\":\"string\"},\"operational\":{\"const\":false,\"type\":\"boolean\"},\"state\":{\"const\":\"pack-unverified\",\"type\":\"string\"}},\"required\":[\"id\",\"operational\",\"state\"],\"type\":\"object\"},\"HealthResponse\":{\"additionalProperties\":false,\"properties\":{\"app\":{\"const\":\"open-voice-companion\",\"type\":\"string\"},\"listenerState\":{\"enum\":[\"listener-conflict\",\"listening\"],\"type\":\"string\"},\"protocolMajor\":{\"const\":1,\"type\":\"integer\"}},\"required\":[\"app\",\"listenerState\",\"protocolMajor\"],\"type\":\"object\"},\"JobCreateRequest\":{\"additionalProperties\":false,\"properties\":{\"text\":{\"$ref\":\"#/components/schemas/SynthesisText\"},\"voiceId\":{\"$ref\":\"#/components/schemas/VoiceId\"}},\"required\":[\"text\",\"voiceId\"],\"type\":\"object\"},\"JobResponse\":{\"additionalProperties\":false,\"properties\":{\"audioAvailable\":{\"const\":false,\"type\":\"boolean\"},\"createdAt\":{\"$ref\":\"#/components/schemas/CanonicalDateTime\"},\"id\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"state\":{\"enum\":[\"cancelled\",\"cancelling\",\"expired\",\"failed\",\"queued\"],\"type\":\"string\"},\"voiceId\":{\"$ref\":\"#/components/schemas/VoiceId\"}},\"required\":[\"audioAvailable\",\"createdAt\",\"id\",\"state\",\"voiceId\"],\"type\":\"object\"},\"ManualChallengeRequest\":{\"additionalProperties\":false,\"properties\":{\"clientLabel\":{\"$ref\":\"#/components/schemas/ClientLabel\"},\"code\":{\"maxLength\":12,\"minLength\":12,\"pattern\":\"^[0-9A-HJKMNP-TV-Z]{12}$\",\"type\":\"string\"},\"scopes\":{\"$ref\":\"#/components/schemas/ScopeList\"},\"verifierHash\":{\"$ref\":\"#/components/schemas/OpaqueSecret\"}},\"required\":[\"clientLabel\",\"code\",\"scopes\",\"verifierHash\"],\"type\":\"object\"},\"OpaqueSecret\":{\"maxLength\":43,\"minLength\":43,\"pattern\":\"^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$\",\"type\":\"string\"},\"OperationalState\":{\"const\":\"pack-unverified\",\"type\":\"string\"},\"PackActionRequest\":{\"additionalProperties\":false,\"properties\":{\"action\":{\"enum\":[\"install\",\"remove\",\"repair\",\"update\"],\"type\":\"string\"}},\"required\":[\"action\"],\"type\":\"object\"},\"PackActionResponse\":{\"additionalProperties\":false,\"properties\":{\"action\":{\"enum\":[\"install\",\"remove\",\"repair\",\"update\"],\"type\":\"string\"},\"id\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"packId\":{\"$ref\":\"#/components/schemas/PackId\"},\"state\":{\"const\":\"pending-native-decision\",\"type\":\"string\"}},\"required\":[\"action\",\"id\",\"packId\",\"state\"],\"type\":\"object\"},\"PackId\":{\"const\":\"pocket-companion-pack\",\"type\":\"string\"},\"PackListResponse\":{\"additionalProperties\":false,\"properties\":{\"packs\":{\"items\":{\"$ref\":\"#/components/schemas/PackResponse\"},\"maxItems\":1,\"minItems\":1,\"type\":\"array\"}},\"required\":[\"packs\"],\"type\":\"object\"},\"PackResponse\":{\"additionalProperties\":false,\"properties\":{\"id\":{\"$ref\":\"#/components/schemas/PackId\"},\"operational\":{\"const\":false,\"type\":\"boolean\"},\"state\":{\"const\":\"pack-unverified\",\"type\":\"string\"},\"verified\":{\"const\":false,\"type\":\"boolean\"}},\"required\":[\"id\",\"operational\",\"state\",\"verified\"],\"type\":\"object\"},\"PairingChallengeRequest\":{\"oneOf\":[{\"$ref\":\"#/components/schemas/DeepLinkChallengeRequest\"},{\"$ref\":\"#/components/schemas/ManualChallengeRequest\"}]},\"PairingChallengeResponse\":{\"additionalProperties\":false,\"properties\":{\"expiresAt\":{\"$ref\":\"#/components/schemas/CanonicalDateTime\"},\"id\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"state\":{\"const\":\"pending\",\"type\":\"string\"}},\"required\":[\"expiresAt\",\"id\",\"state\"],\"type\":\"object\"},\"PairingResponse\":{\"additionalProperties\":false,\"properties\":{\"clientLabel\":{\"$ref\":\"#/components/schemas/ClientLabel\"},\"createdAt\":{\"$ref\":\"#/components/schemas/CanonicalDateTime\"},\"id\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"lastUsedAt\":{\"$ref\":\"#/components/schemas/CanonicalDateTime\"},\"scopes\":{\"$ref\":\"#/components/schemas/ScopeList\"}},\"required\":[\"clientLabel\",\"createdAt\",\"id\",\"lastUsedAt\",\"scopes\"],\"type\":\"object\"},\"Problem\":{\"oneOf\":[{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"action-invalid\",\"type\":\"string\"},\"detail\":{\"const\":\"The requested pack action is not accepted.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":400,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:action-invalid\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"auth-invalid\",\"type\":\"string\"},\"detail\":{\"const\":\"The bearer token is not valid.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":401,\"type\":\"integer\"},\"title\":{\"const\":\"Authentication failed\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:auth-invalid\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"auth-missing\",\"type\":\"string\"},\"detail\":{\"const\":\"A bearer token is required.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":401,\"type\":\"integer\"},\"title\":{\"const\":\"Authentication failed\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:auth-missing\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"auth-origin-mismatch\",\"type\":\"string\"},\"detail\":{\"const\":\"The bearer token is not valid for this origin.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":401,\"type\":\"integer\"},\"title\":{\"const\":\"Authentication failed\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:auth-origin-mismatch\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"body-timeout\",\"type\":\"string\"},\"detail\":{\"const\":\"The request body did not arrive within the deadline.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":408,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:body-timeout\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"body-too-large\",\"type\":\"string\"},\"detail\":{\"const\":\"The JSON request body exceeds the limit.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":413,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:body-too-large\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"conflict\",\"type\":\"string\"},\"detail\":{\"const\":\"The request conflicts with current state.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":409,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:conflict\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"content-type-unsupported\",\"type\":\"string\"},\"detail\":{\"const\":\"The request content type is not supported.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":415,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:content-type-unsupported\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"duplicate-header\",\"type\":\"string\"},\"detail\":{\"const\":\"A security-sensitive header was duplicated.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":400,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:duplicate-header\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"handler-timeout\",\"type\":\"string\"},\"detail\":{\"const\":\"The request handler exceeded its deadline.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":504,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:handler-timeout\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"header-timeout\",\"type\":\"string\"},\"detail\":{\"const\":\"The request headers did not arrive within the deadline.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":408,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:header-timeout\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"headers-too-large\",\"type\":\"string\"},\"detail\":{\"const\":\"The HTTP headers exceed the limit.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":431,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:headers-too-large\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"host-invalid\",\"type\":\"string\"},\"detail\":{\"const\":\"The request Host is not the companion loopback authority.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":400,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:host-invalid\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"listener-conflict\",\"type\":\"string\"},\"detail\":{\"const\":\"The fixed loopback port is already in use.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":503,\"type\":\"integer\"},\"title\":{\"const\":\"Listener unavailable\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:listener-conflict\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"method-not-allowed\",\"type\":\"string\"},\"detail\":{\"const\":\"The HTTP method is not supported for this route.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":405,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:method-not-allowed\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"origin-denied\",\"type\":\"string\"},\"detail\":{\"const\":\"The requesting origin is not allowed.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":403,\"type\":\"integer\"},\"title\":{\"const\":\"Origin denied\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:origin-denied\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"origin-missing\",\"type\":\"string\"},\"detail\":{\"const\":\"The Origin header is required.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":400,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:origin-missing\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"ownership-denied\",\"type\":\"string\"},\"detail\":{\"const\":\"The requested resource was not found.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":404,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:ownership-denied\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"pack-unverified\",\"type\":\"string\"},\"detail\":{\"const\":\"No verified Pocket pack is installed.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":503,\"type\":\"integer\"},\"title\":{\"const\":\"Runtime unavailable\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:pack-unverified\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"pairing-attempts-exhausted\",\"type\":\"string\"},\"detail\":{\"const\":\"The manual pairing attempts are exhausted.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":403,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:pairing-attempts-exhausted\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"pairing-consumed\",\"type\":\"string\"},\"detail\":{\"const\":\"The request conflicts with current state.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":409,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:pairing-consumed\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"pairing-denied\",\"type\":\"string\"},\"detail\":{\"const\":\"The native pairing request was denied.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":403,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:pairing-denied\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"pairing-expired\",\"type\":\"string\"},\"detail\":{\"const\":\"The pairing request has expired.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":410,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:pairing-expired\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"pairing-not-found\",\"type\":\"string\"},\"detail\":{\"const\":\"The requested resource was not found.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":404,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:pairing-not-found\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"queue-full\",\"type\":\"string\"},\"detail\":{\"const\":\"The synthesis queue is at capacity.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":503,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:queue-full\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"rate-limited\",\"type\":\"string\"},\"detail\":{\"const\":\"The request rate limit has been reached.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":429,\"type\":\"integer\"},\"title\":{\"const\":\"Rate limit exceeded\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:rate-limited\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"request-line-too-large\",\"type\":\"string\"},\"detail\":{\"const\":\"The HTTP request line exceeds the limit.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":414,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:request-line-too-large\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"resource-not-found\",\"type\":\"string\"},\"detail\":{\"const\":\"The requested resource was not found.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":404,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:resource-not-found\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"runtime-unavailable\",\"type\":\"string\"},\"detail\":{\"const\":\"The synthesis runtime is unavailable.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":503,\"type\":\"integer\"},\"title\":{\"const\":\"Runtime unavailable\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:runtime-unavailable\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"schema-invalid\",\"type\":\"string\"},\"detail\":{\"const\":\"The request body does not match the protocol schema.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":400,\"type\":\"integer\"},\"title\":{\"const\":\"Invalid request\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:schema-invalid\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"scope-denied\",\"type\":\"string\"},\"detail\":{\"const\":\"The bearer token lacks the required scope.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":403,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:scope-denied\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"text-invalid\",\"type\":\"string\"},\"detail\":{\"const\":\"The synthesis text is outside the accepted bounds.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":400,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:text-invalid\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"transfer-encoding-invalid\",\"type\":\"string\"},\"detail\":{\"const\":\"The HTTP transfer encoding is not supported.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":400,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:transfer-encoding-invalid\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"version-missing\",\"type\":\"string\"},\"detail\":{\"const\":\"The client version header is required.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":400,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:version-missing\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"},{\"additionalProperties\":false,\"properties\":{\"code\":{\"const\":\"version-unsupported\",\"type\":\"string\"},\"detail\":{\"const\":\"The client protocol major is not supported.\",\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"minLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$\",\"type\":\"string\"},\"requestId\":{\"$ref\":\"#/components/schemas/CanonicalUuid\"},\"status\":{\"const\":426,\"type\":\"integer\"},\"title\":{\"const\":\"Request rejected\",\"type\":\"string\"},\"type\":{\"const\":\"urn:ovp:problem:version-unsupported\",\"type\":\"string\"}},\"required\":[\"code\",\"detail\",\"instance\",\"requestId\",\"status\",\"title\",\"type\"],\"type\":\"object\"}]},\"ProblemCode\":{\"enum\":[\"action-invalid\",\"auth-invalid\",\"auth-missing\",\"auth-origin-mismatch\",\"body-timeout\",\"body-too-large\",\"conflict\",\"content-type-unsupported\",\"duplicate-header\",\"handler-timeout\",\"header-timeout\",\"headers-too-large\",\"host-invalid\",\"listener-conflict\",\"method-not-allowed\",\"origin-denied\",\"origin-missing\",\"ownership-denied\",\"pack-unverified\",\"pairing-attempts-exhausted\",\"pairing-consumed\",\"pairing-denied\",\"pairing-expired\",\"pairing-not-found\",\"queue-full\",\"rate-limited\",\"request-line-too-large\",\"resource-not-found\",\"runtime-unavailable\",\"schema-invalid\",\"scope-denied\",\"text-invalid\",\"transfer-encoding-invalid\",\"version-missing\",\"version-unsupported\"],\"type\":\"string\"},\"RedeemPendingResponse\":{\"additionalProperties\":false,\"properties\":{\"state\":{\"const\":\"pending\",\"type\":\"string\"}},\"required\":[\"state\"],\"type\":\"object\"},\"RedeemRequest\":{\"additionalProperties\":false,\"properties\":{\"verifier\":{\"$ref\":\"#/components/schemas/OpaqueSecret\"}},\"required\":[\"verifier\"],\"type\":\"object\"},\"RedeemResponse\":{\"additionalProperties\":false,\"properties\":{\"pairing\":{\"$ref\":\"#/components/schemas/PairingResponse\"},\"token\":{\"$ref\":\"#/components/schemas/OpaqueSecret\"}},\"required\":[\"pairing\",\"token\"],\"type\":\"object\"},\"RuntimeResponse\":{\"additionalProperties\":false,\"properties\":{\"engineId\":{\"const\":\"pocket\",\"type\":\"string\"},\"operational\":{\"const\":false,\"type\":\"boolean\"},\"reason\":{\"const\":\"pack-unverified\",\"type\":\"string\"},\"state\":{\"$ref\":\"#/components/schemas/OperationalState\"}},\"required\":[\"engineId\",\"operational\",\"reason\",\"state\"],\"type\":\"object\"},\"Scope\":{\"enum\":[\"audio:read\",\"health:read\",\"jobs:cancel\",\"jobs:read\",\"packs:request\",\"runtime:read\",\"synthesis:create\"],\"type\":\"string\"},\"ScopeList\":{\"const\":[\"health:read\",\"runtime:read\",\"synthesis:create\",\"jobs:read\",\"jobs:cancel\",\"audio:read\",\"packs:request\"],\"items\":{\"$ref\":\"#/components/schemas/Scope\"},\"maxItems\":7,\"minItems\":7,\"type\":\"array\",\"uniqueItems\":true},\"SynthesisText\":{\"maxLength\":2000,\"minLength\":1,\"pattern\":\"^[^\\\\u0000-\\\\u0008\\\\u000E-\\\\u001F]+$\",\"type\":\"string\",\"x-maxUtf8Bytes\":8000},\"VoiceId\":{\"enum\":[\"pocket:alba\",\"pocket:anna\",\"pocket:azelma\",\"pocket:bill_boerst\",\"pocket:caro_davy\",\"pocket:charles\",\"pocket:eponine\",\"pocket:estelle\",\"pocket:eve\",\"pocket:fantine\",\"pocket:george\",\"pocket:jane\",\"pocket:javert\",\"pocket:marius\",\"pocket:mary\",\"pocket:michael\",\"pocket:paul\",\"pocket:peter_yearsley\",\"pocket:stuart_bell\",\"pocket:vera\"],\"type\":\"string\"},\"VoiceListResponse\":{\"additionalProperties\":false,\"properties\":{\"voices\":{\"items\":{\"$ref\":\"#/components/schemas/VoiceResponse\"},\"maxItems\":20,\"minItems\":20,\"type\":\"array\",\"uniqueItems\":true}},\"required\":[\"voices\"],\"type\":\"object\"},\"VoiceResponse\":{\"additionalProperties\":false,\"properties\":{\"availableInPack\":{\"const\":true,\"type\":\"boolean\"},\"engineId\":{\"const\":\"pocket\",\"type\":\"string\"},\"id\":{\"$ref\":\"#/components/schemas/VoiceId\"},\"operational\":{\"const\":false,\"type\":\"boolean\"}},\"required\":[\"availableInPack\",\"engineId\",\"id\",\"operational\"],\"type\":\"object\"}}") as Readonly<Record<OwnedSchemaName, RuntimeSchema>>;

export function isCanonicalDateTime(value: unknown): value is CanonicalDateTime {
  return validateOwned("CanonicalDateTime", value).valid;
}

export function parseCanonicalDateTime(value: unknown): CanonicalDateTime {
  const result = validateOwned("CanonicalDateTime", value);
  if (!result.valid) throw new ProtocolValidationError("CanonicalDateTime", result.path);
  return value as CanonicalDateTime;
}

export function isCanonicalUuid(value: unknown): value is CanonicalUuid {
  return validateOwned("CanonicalUuid", value).valid;
}

export function parseCanonicalUuid(value: unknown): CanonicalUuid {
  const result = validateOwned("CanonicalUuid", value);
  if (!result.valid) throw new ProtocolValidationError("CanonicalUuid", result.path);
  return value as CanonicalUuid;
}

export function isClientLabel(value: unknown): value is ClientLabel {
  return validateOwned("ClientLabel", value).valid;
}

export function parseClientLabel(value: unknown): ClientLabel {
  const result = validateOwned("ClientLabel", value);
  if (!result.valid) throw new ProtocolValidationError("ClientLabel", result.path);
  return value as ClientLabel;
}

export function isClientVersion(value: unknown): value is ClientVersion {
  return validateOwned("ClientVersion", value).valid;
}

export function parseClientVersion(value: unknown): ClientVersion {
  const result = validateOwned("ClientVersion", value);
  if (!result.valid) throw new ProtocolValidationError("ClientVersion", result.path);
  return value as ClientVersion;
}

export function isDeepLinkChallengeRequest(value: unknown): value is DeepLinkChallengeRequest {
  return validateOwned("DeepLinkChallengeRequest", value).valid;
}

export function parseDeepLinkChallengeRequest(value: unknown): DeepLinkChallengeRequest {
  const result = validateOwned("DeepLinkChallengeRequest", value);
  if (!result.valid) throw new ProtocolValidationError("DeepLinkChallengeRequest", result.path);
  return value as DeepLinkChallengeRequest;
}

export function isEngineListResponse(value: unknown): value is EngineListResponse {
  return validateOwned("EngineListResponse", value).valid;
}

export function parseEngineListResponse(value: unknown): EngineListResponse {
  const result = validateOwned("EngineListResponse", value);
  if (!result.valid) throw new ProtocolValidationError("EngineListResponse", result.path);
  return value as EngineListResponse;
}

export function isEngineResponse(value: unknown): value is EngineResponse {
  return validateOwned("EngineResponse", value).valid;
}

export function parseEngineResponse(value: unknown): EngineResponse {
  const result = validateOwned("EngineResponse", value);
  if (!result.valid) throw new ProtocolValidationError("EngineResponse", result.path);
  return value as EngineResponse;
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return validateOwned("HealthResponse", value).valid;
}

export function parseHealthResponse(value: unknown): HealthResponse {
  const result = validateOwned("HealthResponse", value);
  if (!result.valid) throw new ProtocolValidationError("HealthResponse", result.path);
  return value as HealthResponse;
}

export function isJobCreateRequest(value: unknown): value is JobCreateRequest {
  return validateOwned("JobCreateRequest", value).valid;
}

export function parseJobCreateRequest(value: unknown): JobCreateRequest {
  const result = validateOwned("JobCreateRequest", value);
  if (!result.valid) throw new ProtocolValidationError("JobCreateRequest", result.path);
  return value as JobCreateRequest;
}

export function isJobResponse(value: unknown): value is JobResponse {
  return validateOwned("JobResponse", value).valid;
}

export function parseJobResponse(value: unknown): JobResponse {
  const result = validateOwned("JobResponse", value);
  if (!result.valid) throw new ProtocolValidationError("JobResponse", result.path);
  return value as JobResponse;
}

export function isManualChallengeRequest(value: unknown): value is ManualChallengeRequest {
  return validateOwned("ManualChallengeRequest", value).valid;
}

export function parseManualChallengeRequest(value: unknown): ManualChallengeRequest {
  const result = validateOwned("ManualChallengeRequest", value);
  if (!result.valid) throw new ProtocolValidationError("ManualChallengeRequest", result.path);
  return value as ManualChallengeRequest;
}

export function isOpaqueSecret(value: unknown): value is OpaqueSecret {
  return validateOwned("OpaqueSecret", value).valid;
}

export function parseOpaqueSecret(value: unknown): OpaqueSecret {
  const result = validateOwned("OpaqueSecret", value);
  if (!result.valid) throw new ProtocolValidationError("OpaqueSecret", result.path);
  return value as OpaqueSecret;
}

export function isOperationalState(value: unknown): value is OperationalState {
  return validateOwned("OperationalState", value).valid;
}

export function parseOperationalState(value: unknown): OperationalState {
  const result = validateOwned("OperationalState", value);
  if (!result.valid) throw new ProtocolValidationError("OperationalState", result.path);
  return value as OperationalState;
}

export function isPackActionRequest(value: unknown): value is PackActionRequest {
  return validateOwned("PackActionRequest", value).valid;
}

export function parsePackActionRequest(value: unknown): PackActionRequest {
  const result = validateOwned("PackActionRequest", value);
  if (!result.valid) throw new ProtocolValidationError("PackActionRequest", result.path);
  return value as PackActionRequest;
}

export function isPackActionResponse(value: unknown): value is PackActionResponse {
  return validateOwned("PackActionResponse", value).valid;
}

export function parsePackActionResponse(value: unknown): PackActionResponse {
  const result = validateOwned("PackActionResponse", value);
  if (!result.valid) throw new ProtocolValidationError("PackActionResponse", result.path);
  return value as PackActionResponse;
}

export function isPackId(value: unknown): value is PackId {
  return validateOwned("PackId", value).valid;
}

export function parsePackId(value: unknown): PackId {
  const result = validateOwned("PackId", value);
  if (!result.valid) throw new ProtocolValidationError("PackId", result.path);
  return value as PackId;
}

export function isPackListResponse(value: unknown): value is PackListResponse {
  return validateOwned("PackListResponse", value).valid;
}

export function parsePackListResponse(value: unknown): PackListResponse {
  const result = validateOwned("PackListResponse", value);
  if (!result.valid) throw new ProtocolValidationError("PackListResponse", result.path);
  return value as PackListResponse;
}

export function isPackResponse(value: unknown): value is PackResponse {
  return validateOwned("PackResponse", value).valid;
}

export function parsePackResponse(value: unknown): PackResponse {
  const result = validateOwned("PackResponse", value);
  if (!result.valid) throw new ProtocolValidationError("PackResponse", result.path);
  return value as PackResponse;
}

export function isPairingChallengeRequest(value: unknown): value is PairingChallengeRequest {
  return validateOwned("PairingChallengeRequest", value).valid;
}

export function parsePairingChallengeRequest(value: unknown): PairingChallengeRequest {
  const result = validateOwned("PairingChallengeRequest", value);
  if (!result.valid) throw new ProtocolValidationError("PairingChallengeRequest", result.path);
  return value as PairingChallengeRequest;
}

export function isPairingChallengeResponse(value: unknown): value is PairingChallengeResponse {
  return validateOwned("PairingChallengeResponse", value).valid;
}

export function parsePairingChallengeResponse(value: unknown): PairingChallengeResponse {
  const result = validateOwned("PairingChallengeResponse", value);
  if (!result.valid) throw new ProtocolValidationError("PairingChallengeResponse", result.path);
  return value as PairingChallengeResponse;
}

export function isPairingResponse(value: unknown): value is PairingResponse {
  return validateOwned("PairingResponse", value).valid;
}

export function parsePairingResponse(value: unknown): PairingResponse {
  const result = validateOwned("PairingResponse", value);
  if (!result.valid) throw new ProtocolValidationError("PairingResponse", result.path);
  return value as PairingResponse;
}

export function isProblem(value: unknown): value is Problem {
  return validateOwned("Problem", value).valid;
}

export function parseProblem(value: unknown): Problem {
  const result = validateOwned("Problem", value);
  if (!result.valid) throw new ProtocolValidationError("Problem", result.path);
  return value as Problem;
}

export function isProblemCode(value: unknown): value is ProblemCode {
  return validateOwned("ProblemCode", value).valid;
}

export function parseProblemCode(value: unknown): ProblemCode {
  const result = validateOwned("ProblemCode", value);
  if (!result.valid) throw new ProtocolValidationError("ProblemCode", result.path);
  return value as ProblemCode;
}

export function isRedeemPendingResponse(value: unknown): value is RedeemPendingResponse {
  return validateOwned("RedeemPendingResponse", value).valid;
}

export function parseRedeemPendingResponse(value: unknown): RedeemPendingResponse {
  const result = validateOwned("RedeemPendingResponse", value);
  if (!result.valid) throw new ProtocolValidationError("RedeemPendingResponse", result.path);
  return value as RedeemPendingResponse;
}

export function isRedeemRequest(value: unknown): value is RedeemRequest {
  return validateOwned("RedeemRequest", value).valid;
}

export function parseRedeemRequest(value: unknown): RedeemRequest {
  const result = validateOwned("RedeemRequest", value);
  if (!result.valid) throw new ProtocolValidationError("RedeemRequest", result.path);
  return value as RedeemRequest;
}

export function isRedeemResponse(value: unknown): value is RedeemResponse {
  return validateOwned("RedeemResponse", value).valid;
}

export function parseRedeemResponse(value: unknown): RedeemResponse {
  const result = validateOwned("RedeemResponse", value);
  if (!result.valid) throw new ProtocolValidationError("RedeemResponse", result.path);
  return value as RedeemResponse;
}

export function isRuntimeResponse(value: unknown): value is RuntimeResponse {
  return validateOwned("RuntimeResponse", value).valid;
}

export function parseRuntimeResponse(value: unknown): RuntimeResponse {
  const result = validateOwned("RuntimeResponse", value);
  if (!result.valid) throw new ProtocolValidationError("RuntimeResponse", result.path);
  return value as RuntimeResponse;
}

export function isScope(value: unknown): value is Scope {
  return validateOwned("Scope", value).valid;
}

export function parseScope(value: unknown): Scope {
  const result = validateOwned("Scope", value);
  if (!result.valid) throw new ProtocolValidationError("Scope", result.path);
  return value as Scope;
}

export function isScopeList(value: unknown): value is ScopeList {
  return validateOwned("ScopeList", value).valid;
}

export function parseScopeList(value: unknown): ScopeList {
  const result = validateOwned("ScopeList", value);
  if (!result.valid) throw new ProtocolValidationError("ScopeList", result.path);
  return value as ScopeList;
}

export function isSynthesisText(value: unknown): value is SynthesisText {
  return validateOwned("SynthesisText", value).valid;
}

export function parseSynthesisText(value: unknown): SynthesisText {
  const result = validateOwned("SynthesisText", value);
  if (!result.valid) throw new ProtocolValidationError("SynthesisText", result.path);
  return value as SynthesisText;
}

export function isVoiceId(value: unknown): value is VoiceId {
  return validateOwned("VoiceId", value).valid;
}

export function parseVoiceId(value: unknown): VoiceId {
  const result = validateOwned("VoiceId", value);
  if (!result.valid) throw new ProtocolValidationError("VoiceId", result.path);
  return value as VoiceId;
}

export function isVoiceListResponse(value: unknown): value is VoiceListResponse {
  return validateOwned("VoiceListResponse", value).valid;
}

export function parseVoiceListResponse(value: unknown): VoiceListResponse {
  const result = validateOwned("VoiceListResponse", value);
  if (!result.valid) throw new ProtocolValidationError("VoiceListResponse", result.path);
  return value as VoiceListResponse;
}

export function isVoiceResponse(value: unknown): value is VoiceResponse {
  return validateOwned("VoiceResponse", value).valid;
}

export function parseVoiceResponse(value: unknown): VoiceResponse {
  const result = validateOwned("VoiceResponse", value);
  if (!result.valid) throw new ProtocolValidationError("VoiceResponse", result.path);
  return value as VoiceResponse;
}
