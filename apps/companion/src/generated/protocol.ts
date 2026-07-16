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
type Brand<Name extends string> = { readonly [protocolBrand]: Name };

export type DeepLinkChallengeRequest = ({ readonly "clientLabel": (string) & Brand<"DeepLinkChallengeRequest.clientLabel">; readonly "scopes": ScopeList; readonly "state": OpaqueSecret; readonly "verifierHash": OpaqueSecret; }) & Brand<"DeepLinkChallengeRequest">;

export type EngineListResponse = ({ readonly "engines": (readonly (EngineResponse)[]) & Brand<"EngineListResponse.engines">; }) & Brand<"EngineListResponse">;

export type EngineResponse = ({ readonly "id": "pocket"; readonly "operational": false; readonly "state": "pack-unverified"; readonly "synthesisControls": (readonly (string)[]) & Brand<"EngineResponse.synthesisControls">; }) & Brand<"EngineResponse">;

export type HealthResponse = ({ readonly "app": "open-voice-companion"; readonly "listenerState": "listening" | "listener-conflict"; readonly "protocolMajor": 1; }) & Brand<"HealthResponse">;

export type JobCreateRequest = ({ readonly "text": (string) & Brand<"JobCreateRequest.text">; readonly "voiceId": VoiceId; }) & Brand<"JobCreateRequest">;

export type JobResponse = ({ readonly "audioAvailable": boolean; readonly "createdAt": (string) & Brand<"JobResponse.createdAt">; readonly "id": (string) & Brand<"JobResponse.id">; readonly "state": "queued" | "starting" | "synthesizing" | "completed" | "cancelling" | "cancelled" | "failed" | "expired"; readonly "voiceId": VoiceId; }) & Brand<"JobResponse">;

export type ManualChallengeRequest = ({ readonly "clientLabel": (string) & Brand<"ManualChallengeRequest.clientLabel">; readonly "code": (string) & Brand<"ManualChallengeRequest.code">; readonly "scopes": ScopeList; readonly "verifierHash": OpaqueSecret; }) & Brand<"ManualChallengeRequest">;

export type OpaqueSecret = ((string) & Brand<"OpaqueSecret">) & Brand<"OpaqueSecret">;

export type OperationalState = ("companion-not-installed" | "pack-unverified" | "ready" | "busy" | "degraded") & Brand<"OperationalState">;

export type PackActionRequest = ({ readonly "action": "install" | "update" | "repair" | "remove"; }) & Brand<"PackActionRequest">;

export type PackActionResponse = ({ readonly "action": "install" | "update" | "repair" | "remove"; readonly "id": (string) & Brand<"PackActionResponse.id">; readonly "packId": PackId; readonly "state": "pending-native-decision"; }) & Brand<"PackActionResponse">;

export type PackId = ("pocket-companion-pack") & Brand<"PackId">;

export type PackListResponse = ({ readonly "packs": (readonly (PackResponse)[]) & Brand<"PackListResponse.packs">; }) & Brand<"PackListResponse">;

export type PackResponse = ({ readonly "id": PackId; readonly "operational": false; readonly "state": "pack-unverified"; readonly "verified": false; }) & Brand<"PackResponse">;

export type PairingChallengeRequest = (DeepLinkChallengeRequest | ManualChallengeRequest) & Brand<"PairingChallengeRequest">;

export type PairingChallengeResponse = ({ readonly "expiresAt": (string) & Brand<"PairingChallengeResponse.expiresAt">; readonly "id": (string) & Brand<"PairingChallengeResponse.id">; readonly "state": "pending"; }) & Brand<"PairingChallengeResponse">;

export type PairingResponse = ({ readonly "clientLabel": (string) & Brand<"PairingResponse.clientLabel">; readonly "createdAt": (string) & Brand<"PairingResponse.createdAt">; readonly "id": (string) & Brand<"PairingResponse.id">; readonly "lastUsedAt": (string) & Brand<"PairingResponse.lastUsedAt">; readonly "scopes": ScopeList; }) & Brand<"PairingResponse">;

export type Problem = ({ readonly "code": ProblemCode; readonly "detail": (string) & Brand<"Problem.detail">; readonly "instance": (string) & Brand<"Problem.instance">; readonly "requestId": (string) & Brand<"Problem.requestId">; readonly "status": (number) & Brand<"Problem.status">; readonly "title": (string) & Brand<"Problem.title">; readonly "type": (string) & Brand<"Problem.type">; }) & Brand<"Problem">;

export type ProblemCode = ("host-invalid" | "origin-missing" | "origin-denied" | "version-missing" | "version-unsupported" | "auth-missing" | "auth-invalid" | "auth-origin-mismatch" | "scope-denied" | "rate-limited" | "request-line-too-large" | "headers-too-large" | "body-too-large" | "body-timeout" | "header-timeout" | "schema-invalid" | "queue-full" | "ownership-denied" | "resource-not-found" | "conflict" | "handler-timeout" | "listener-conflict" | "pairing-not-found" | "pairing-pending" | "pairing-denied" | "pairing-expired" | "pairing-consumed" | "pairing-attempts-exhausted" | "pack-unverified" | "runtime-unavailable" | "method-not-allowed" | "content-type-unsupported" | "transfer-encoding-invalid" | "duplicate-header" | "text-invalid" | "action-invalid") & Brand<"ProblemCode">;

export type RedeemRequest = ({ readonly "verifier": OpaqueSecret; }) & Brand<"RedeemRequest">;

export type RedeemResponse = ({ readonly "pairing": PairingResponse; readonly "token": OpaqueSecret; }) & Brand<"RedeemResponse">;

export type RuntimeResponse = ({ readonly "engineId": "pocket"; readonly "operational": false; readonly "reason": "pack-unverified"; readonly "state": OperationalState; }) & Brand<"RuntimeResponse">;

export type Scope = ("health:read" | "runtime:read" | "synthesis:create" | "jobs:read" | "jobs:cancel" | "audio:read" | "packs:request") & Brand<"Scope">;

export type ScopeList = ((readonly (Scope)[]) & Brand<"ScopeList">) & Brand<"ScopeList">;

export type VoiceId = ("pocket:alba" | "pocket:estelle" | "pocket:anna" | "pocket:vera" | "pocket:fantine" | "pocket:charles" | "pocket:paul" | "pocket:eponine" | "pocket:azelma" | "pocket:george" | "pocket:mary" | "pocket:jane" | "pocket:michael" | "pocket:eve" | "pocket:bill_boerst" | "pocket:caro_davy" | "pocket:peter_yearsley" | "pocket:stuart_bell" | "pocket:marius" | "pocket:javert") & Brand<"VoiceId">;

export type VoiceListResponse = ({ readonly "voices": (readonly (VoiceResponse)[]) & Brand<"VoiceListResponse.voices">; }) & Brand<"VoiceListResponse">;

export type VoiceResponse = ({ readonly "availableInPack": true; readonly "engineId": "pocket"; readonly "id": VoiceId; readonly "operational": false; }) & Brand<"VoiceResponse">;

export type OwnedSchemaName = "DeepLinkChallengeRequest" | "EngineListResponse" | "EngineResponse" | "HealthResponse" | "JobCreateRequest" | "JobResponse" | "ManualChallengeRequest" | "OpaqueSecret" | "OperationalState" | "PackActionRequest" | "PackActionResponse" | "PackId" | "PackListResponse" | "PackResponse" | "PairingChallengeRequest" | "PairingChallengeResponse" | "PairingResponse" | "Problem" | "ProblemCode" | "RedeemRequest" | "RedeemResponse" | "RuntimeResponse" | "Scope" | "ScopeList" | "VoiceId" | "VoiceListResponse" | "VoiceResponse";

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

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isCanonicalDateTime(value: string): boolean {
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
    if (schema.format === "uuid" && !isCanonicalUuid(value)) return invalid(path);
    if (schema.format === "date-time" && !isCanonicalDateTime(value)) return invalid(path);
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

const SCHEMAS = JSON.parse("{\"DeepLinkChallengeRequest\":{\"additionalProperties\":false,\"properties\":{\"clientLabel\":{\"maxLength\":64,\"minLength\":1,\"type\":\"string\"},\"scopes\":{\"$ref\":\"#/components/schemas/ScopeList\"},\"state\":{\"$ref\":\"#/components/schemas/OpaqueSecret\"},\"verifierHash\":{\"$ref\":\"#/components/schemas/OpaqueSecret\"}},\"required\":[\"state\",\"verifierHash\",\"clientLabel\",\"scopes\"],\"type\":\"object\"},\"EngineListResponse\":{\"additionalProperties\":false,\"properties\":{\"engines\":{\"items\":{\"$ref\":\"#/components/schemas/EngineResponse\"},\"maxItems\":1,\"minItems\":1,\"type\":\"array\"}},\"required\":[\"engines\"],\"type\":\"object\"},\"EngineResponse\":{\"additionalProperties\":false,\"properties\":{\"id\":{\"const\":\"pocket\",\"type\":\"string\"},\"operational\":{\"const\":false,\"type\":\"boolean\"},\"state\":{\"const\":\"pack-unverified\",\"type\":\"string\"},\"synthesisControls\":{\"items\":{\"type\":\"string\"},\"maxItems\":0,\"type\":\"array\"}},\"required\":[\"id\",\"state\",\"operational\",\"synthesisControls\"],\"type\":\"object\"},\"HealthResponse\":{\"additionalProperties\":false,\"properties\":{\"app\":{\"const\":\"open-voice-companion\",\"type\":\"string\"},\"listenerState\":{\"enum\":[\"listening\",\"listener-conflict\"],\"type\":\"string\"},\"protocolMajor\":{\"const\":1,\"type\":\"integer\"}},\"required\":[\"app\",\"protocolMajor\",\"listenerState\"],\"type\":\"object\"},\"JobCreateRequest\":{\"additionalProperties\":false,\"properties\":{\"text\":{\"maxLength\":2000,\"minLength\":1,\"type\":\"string\"},\"voiceId\":{\"$ref\":\"#/components/schemas/VoiceId\"}},\"required\":[\"voiceId\",\"text\"],\"type\":\"object\"},\"JobResponse\":{\"additionalProperties\":false,\"properties\":{\"audioAvailable\":{\"type\":\"boolean\"},\"createdAt\":{\"format\":\"date-time\",\"type\":\"string\"},\"id\":{\"format\":\"uuid\",\"type\":\"string\"},\"state\":{\"enum\":[\"queued\",\"starting\",\"synthesizing\",\"completed\",\"cancelling\",\"cancelled\",\"failed\",\"expired\"],\"type\":\"string\"},\"voiceId\":{\"$ref\":\"#/components/schemas/VoiceId\"}},\"required\":[\"id\",\"voiceId\",\"state\",\"audioAvailable\",\"createdAt\"],\"type\":\"object\"},\"ManualChallengeRequest\":{\"additionalProperties\":false,\"properties\":{\"clientLabel\":{\"maxLength\":64,\"minLength\":1,\"type\":\"string\"},\"code\":{\"maxLength\":12,\"minLength\":12,\"pattern\":\"^[0-9A-HJKMNP-TV-Z]{12}$\",\"type\":\"string\"},\"scopes\":{\"$ref\":\"#/components/schemas/ScopeList\"},\"verifierHash\":{\"$ref\":\"#/components/schemas/OpaqueSecret\"}},\"required\":[\"code\",\"verifierHash\",\"clientLabel\",\"scopes\"],\"type\":\"object\"},\"OpaqueSecret\":{\"maxLength\":43,\"minLength\":43,\"pattern\":\"^[A-Za-z0-9_-]{43}$\",\"type\":\"string\"},\"OperationalState\":{\"enum\":[\"companion-not-installed\",\"pack-unverified\",\"ready\",\"busy\",\"degraded\"],\"type\":\"string\"},\"PackActionRequest\":{\"additionalProperties\":false,\"properties\":{\"action\":{\"enum\":[\"install\",\"update\",\"repair\",\"remove\"],\"type\":\"string\"}},\"required\":[\"action\"],\"type\":\"object\"},\"PackActionResponse\":{\"additionalProperties\":false,\"properties\":{\"action\":{\"enum\":[\"install\",\"update\",\"repair\",\"remove\"],\"type\":\"string\"},\"id\":{\"format\":\"uuid\",\"type\":\"string\"},\"packId\":{\"$ref\":\"#/components/schemas/PackId\"},\"state\":{\"const\":\"pending-native-decision\",\"type\":\"string\"}},\"required\":[\"id\",\"packId\",\"action\",\"state\"],\"type\":\"object\"},\"PackId\":{\"const\":\"pocket-companion-pack\",\"type\":\"string\"},\"PackListResponse\":{\"additionalProperties\":false,\"properties\":{\"packs\":{\"items\":{\"$ref\":\"#/components/schemas/PackResponse\"},\"maxItems\":1,\"minItems\":1,\"type\":\"array\"}},\"required\":[\"packs\"],\"type\":\"object\"},\"PackResponse\":{\"additionalProperties\":false,\"properties\":{\"id\":{\"$ref\":\"#/components/schemas/PackId\"},\"operational\":{\"const\":false,\"type\":\"boolean\"},\"state\":{\"const\":\"pack-unverified\",\"type\":\"string\"},\"verified\":{\"const\":false,\"type\":\"boolean\"}},\"required\":[\"id\",\"state\",\"verified\",\"operational\"],\"type\":\"object\"},\"PairingChallengeRequest\":{\"oneOf\":[{\"$ref\":\"#/components/schemas/DeepLinkChallengeRequest\"},{\"$ref\":\"#/components/schemas/ManualChallengeRequest\"}]},\"PairingChallengeResponse\":{\"additionalProperties\":false,\"properties\":{\"expiresAt\":{\"format\":\"date-time\",\"type\":\"string\"},\"id\":{\"format\":\"uuid\",\"type\":\"string\"},\"state\":{\"const\":\"pending\",\"type\":\"string\"}},\"required\":[\"id\",\"state\",\"expiresAt\"],\"type\":\"object\"},\"PairingResponse\":{\"additionalProperties\":false,\"properties\":{\"clientLabel\":{\"maxLength\":64,\"minLength\":1,\"type\":\"string\"},\"createdAt\":{\"format\":\"date-time\",\"type\":\"string\"},\"id\":{\"format\":\"uuid\",\"type\":\"string\"},\"lastUsedAt\":{\"format\":\"date-time\",\"type\":\"string\"},\"scopes\":{\"$ref\":\"#/components/schemas/ScopeList\"}},\"required\":[\"id\",\"clientLabel\",\"scopes\",\"createdAt\",\"lastUsedAt\"],\"type\":\"object\"},\"Problem\":{\"additionalProperties\":false,\"properties\":{\"code\":{\"$ref\":\"#/components/schemas/ProblemCode\"},\"detail\":{\"maxLength\":160,\"minLength\":1,\"type\":\"string\"},\"instance\":{\"maxLength\":45,\"pattern\":\"^urn:uuid:[0-9a-f-]{36}$\",\"type\":\"string\"},\"requestId\":{\"format\":\"uuid\",\"type\":\"string\"},\"status\":{\"maximum\":599,\"minimum\":400,\"type\":\"integer\"},\"title\":{\"maxLength\":96,\"minLength\":1,\"type\":\"string\"},\"type\":{\"maxLength\":96,\"pattern\":\"^urn:ovp:problem:[a-z0-9-]+$\",\"type\":\"string\"}},\"required\":[\"type\",\"title\",\"status\",\"detail\",\"instance\",\"code\",\"requestId\"],\"type\":\"object\"},\"ProblemCode\":{\"enum\":[\"host-invalid\",\"origin-missing\",\"origin-denied\",\"version-missing\",\"version-unsupported\",\"auth-missing\",\"auth-invalid\",\"auth-origin-mismatch\",\"scope-denied\",\"rate-limited\",\"request-line-too-large\",\"headers-too-large\",\"body-too-large\",\"body-timeout\",\"header-timeout\",\"schema-invalid\",\"queue-full\",\"ownership-denied\",\"resource-not-found\",\"conflict\",\"handler-timeout\",\"listener-conflict\",\"pairing-not-found\",\"pairing-pending\",\"pairing-denied\",\"pairing-expired\",\"pairing-consumed\",\"pairing-attempts-exhausted\",\"pack-unverified\",\"runtime-unavailable\",\"method-not-allowed\",\"content-type-unsupported\",\"transfer-encoding-invalid\",\"duplicate-header\",\"text-invalid\",\"action-invalid\"],\"type\":\"string\"},\"RedeemRequest\":{\"additionalProperties\":false,\"properties\":{\"verifier\":{\"$ref\":\"#/components/schemas/OpaqueSecret\"}},\"required\":[\"verifier\"],\"type\":\"object\"},\"RedeemResponse\":{\"additionalProperties\":false,\"properties\":{\"pairing\":{\"$ref\":\"#/components/schemas/PairingResponse\"},\"token\":{\"$ref\":\"#/components/schemas/OpaqueSecret\"}},\"required\":[\"token\",\"pairing\"],\"type\":\"object\"},\"RuntimeResponse\":{\"additionalProperties\":false,\"properties\":{\"engineId\":{\"const\":\"pocket\",\"type\":\"string\"},\"operational\":{\"const\":false,\"type\":\"boolean\"},\"reason\":{\"const\":\"pack-unverified\",\"type\":\"string\"},\"state\":{\"$ref\":\"#/components/schemas/OperationalState\"}},\"required\":[\"engineId\",\"state\",\"operational\",\"reason\"],\"type\":\"object\"},\"Scope\":{\"enum\":[\"health:read\",\"runtime:read\",\"synthesis:create\",\"jobs:read\",\"jobs:cancel\",\"audio:read\",\"packs:request\"],\"type\":\"string\"},\"ScopeList\":{\"items\":{\"$ref\":\"#/components/schemas/Scope\"},\"maxItems\":7,\"minItems\":7,\"type\":\"array\",\"uniqueItems\":true},\"VoiceId\":{\"enum\":[\"pocket:alba\",\"pocket:estelle\",\"pocket:anna\",\"pocket:vera\",\"pocket:fantine\",\"pocket:charles\",\"pocket:paul\",\"pocket:eponine\",\"pocket:azelma\",\"pocket:george\",\"pocket:mary\",\"pocket:jane\",\"pocket:michael\",\"pocket:eve\",\"pocket:bill_boerst\",\"pocket:caro_davy\",\"pocket:peter_yearsley\",\"pocket:stuart_bell\",\"pocket:marius\",\"pocket:javert\"],\"type\":\"string\"},\"VoiceListResponse\":{\"additionalProperties\":false,\"properties\":{\"voices\":{\"items\":{\"$ref\":\"#/components/schemas/VoiceResponse\"},\"maxItems\":20,\"minItems\":20,\"type\":\"array\",\"uniqueItems\":true}},\"required\":[\"voices\"],\"type\":\"object\"},\"VoiceResponse\":{\"additionalProperties\":false,\"properties\":{\"availableInPack\":{\"const\":true,\"type\":\"boolean\"},\"engineId\":{\"const\":\"pocket\",\"type\":\"string\"},\"id\":{\"$ref\":\"#/components/schemas/VoiceId\"},\"operational\":{\"const\":false,\"type\":\"boolean\"}},\"required\":[\"id\",\"engineId\",\"availableInPack\",\"operational\"],\"type\":\"object\"}}") as Readonly<Record<OwnedSchemaName, RuntimeSchema>>;

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
