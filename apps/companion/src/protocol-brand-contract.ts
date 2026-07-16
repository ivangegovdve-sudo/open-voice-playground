import type {
  CanonicalUuid,
  CompanionClient,
  CompanionClientOperationId,
  CompanionResult,
  CompanionWav,
  EngineListResponse,
  HealthResponse,
  JobCreateRequest,
  JobResponse,
  OpaqueSecret,
  PackActionRequest,
  PackActionResponse,
  PackId,
  PackListResponse,
  PairingChallengeRequest,
  PairingChallengeResponse,
  PairingResponse,
  RedeemPendingResponse,
  RedeemRequest,
  RedeemResponse,
  RuntimeResponse,
  VoiceListResponse,
} from './generated/protocol.js';

type IsNever<Value> = [Value] extends [never] ? true : false;
type IsEqual<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <Value>() => Value extends Left ? 1 : 2
      ? true
      : false
    : false;
type IsStrictSubtype<Value, Base> =
  IsNever<Value> extends true
    ? false
    : [Value] extends [Base]
      ? [Base] extends [Value]
        ? false
        : true
      : false;

type Assert<Condition extends true> = Condition;
type AssertNever<Value extends never> = Value;
type ProtocolModule = typeof import('./generated/protocol.js');
type OwnedSchemaName = import('./generated/protocol.js').OwnedSchemaName;
type ParserResult<Name extends OwnedSchemaName> = ProtocolModule[`parse${Name}`] extends (
  value: unknown,
) => infer Result
  ? Result
  : never;
type NeverParserNames = {
  [Name in OwnedSchemaName]: IsNever<ParserResult<Name>> extends true ? Name : never;
}[OwnedSchemaName];
type ParsedOpaqueSecret = ReturnType<ProtocolModule['parseOpaqueSecret']>;
type ParsedJob = ReturnType<ProtocolModule['parseJobCreateRequest']>;
type ParsedPairingRequest = ReturnType<ProtocolModule['parsePairingChallengeRequest']>;
type ParsedPairingChallenge = ReturnType<ProtocolModule['parsePairingChallengeResponse']>;
type ParsedProblem = ReturnType<ProtocolModule['parseProblem']>;
type ParsedEngine = ReturnType<ProtocolModule['parseEngineResponse']>;

type ExpectedClientKeys =
  | 'cancelJob'
  | 'createJob'
  | 'createPairingChallenge'
  | 'getCurrentPairing'
  | 'getHealth'
  | 'getJob'
  | 'getJobAudio'
  | 'getRuntime'
  | 'listEngines'
  | 'listPacks'
  | 'listVoices'
  | 'redeemPairingChallenge'
  | 'requestPackAction'
  | 'revokeCurrentPairing';

type SignalOption = { readonly signal?: AbortSignal };
type BearerOption = { readonly token: OpaqueSecret };
type UuidOption = { readonly id: CanonicalUuid };

type ExpectedInputs = {
  readonly cancelJob: Readonly<UuidOption & BearerOption & SignalOption>;
  readonly createJob: Readonly<{ readonly body: JobCreateRequest } & BearerOption & SignalOption>;
  readonly createPairingChallenge: Readonly<
    { readonly body: PairingChallengeRequest } & SignalOption
  >;
  readonly getCurrentPairing: Readonly<BearerOption & SignalOption>;
  readonly getHealth: Readonly<SignalOption>;
  readonly getJob: Readonly<UuidOption & BearerOption & SignalOption>;
  readonly getJobAudio: Readonly<UuidOption & BearerOption & SignalOption>;
  readonly getRuntime: Readonly<BearerOption & SignalOption>;
  readonly listEngines: Readonly<BearerOption & SignalOption>;
  readonly listPacks: Readonly<BearerOption & SignalOption>;
  readonly listVoices: Readonly<BearerOption & SignalOption>;
  readonly redeemPairingChallenge: Readonly<
    UuidOption & { readonly body: RedeemRequest } & SignalOption
  >;
  readonly requestPackAction: Readonly<
    { readonly id: PackId; readonly body: PackActionRequest } & BearerOption & SignalOption
  >;
  readonly revokeCurrentPairing: Readonly<BearerOption & SignalOption>;
};

type ExpectedResults = {
  readonly cancelJob: Promise<CompanionResult<202, JobResponse>>;
  readonly createJob: Promise<CompanionResult<202, JobResponse>>;
  readonly createPairingChallenge: Promise<CompanionResult<201, PairingChallengeResponse>>;
  readonly getCurrentPairing: Promise<CompanionResult<200, PairingResponse>>;
  readonly getHealth: Promise<CompanionResult<200, HealthResponse>>;
  readonly getJob: Promise<CompanionResult<200, JobResponse>>;
  readonly getJobAudio: Promise<CompanionResult<200, CompanionWav>>;
  readonly getRuntime: Promise<CompanionResult<200, RuntimeResponse>>;
  readonly listEngines: Promise<CompanionResult<200, EngineListResponse>>;
  readonly listPacks: Promise<CompanionResult<200, PackListResponse>>;
  readonly listVoices: Promise<CompanionResult<200, VoiceListResponse>>;
  readonly redeemPairingChallenge: Promise<
    CompanionResult<200, RedeemResponse> | CompanionResult<202, RedeemPendingResponse>
  >;
  readonly requestPackAction: Promise<CompanionResult<202, PackActionResponse>>;
  readonly revokeCurrentPairing: Promise<CompanionResult<204, undefined>>;
};

type InputMismatches = {
  [Name in ExpectedClientKeys]: IsEqual<
    Parameters<CompanionClient[Name]>,
    [options: ExpectedInputs[Name]]
  > extends true
    ? never
    : Name;
}[ExpectedClientKeys];
type ResultMismatches = {
  [Name in ExpectedClientKeys]: IsEqual<
    ReturnType<CompanionClient[Name]>,
    ExpectedResults[Name]
  > extends true
    ? never
    : Name;
}[ExpectedClientKeys];

// This exported type makes the generated API fail compilation if a parser,
// client operation, input envelope, or status/body correlation drifts.
export type ProtocolBrandContract = readonly [
  AssertNever<NeverParserNames>,
  Assert<IsStrictSubtype<ParsedOpaqueSecret, string>>,
  Assert<IsStrictSubtype<ParsedJob['text'], string>>,
  Assert<
    IsStrictSubtype<
      ParsedPairingRequest,
      | import('./generated/protocol.js').DeepLinkChallengeRequest
      | import('./generated/protocol.js').ManualChallengeRequest
    >
  >,
  Assert<IsStrictSubtype<ParsedPairingChallenge['id'], string>>,
  Assert<IsStrictSubtype<ParsedProblem['status'], number>>,
  Assert<IsStrictSubtype<ParsedEngine['state'], string>>,
  Assert<IsEqual<keyof CompanionClient, ExpectedClientKeys>>,
  Assert<IsEqual<CompanionClientOperationId, ExpectedClientKeys>>,
  Assert<string extends keyof CompanionClient ? false : true>,
  AssertNever<
    Extract<'request' | 'options' | 'preflight' | 'url' | 'baseUrl', keyof CompanionClient>
  >,
  AssertNever<InputMismatches>,
  AssertNever<ResultMismatches>,
];

function clientCallContract(
  client: CompanionClient,
  id: CanonicalUuid,
  packId: PackId,
  token: OpaqueSecret,
  job: JobCreateRequest,
  challenge: PairingChallengeRequest,
  redeem: RedeemRequest,
  packAction: PackActionRequest,
): void {
  void client.getHealth({});
  void client.cancelJob({ id, token });
  void client.createJob({ body: job, token });
  void client.createPairingChallenge({ body: challenge });
  void client.redeemPairingChallenge({ id, body: redeem });
  void client.requestPackAction({ id: packId, body: packAction, token });

  // @ts-expect-error Every operation requires one options object.
  void client.getHealth();
  // @ts-expect-error Origin-only operations prohibit bearer tokens.
  void client.getHealth({ token });
  // @ts-expect-error Callers cannot provide or redirect the request URL.
  void client.getHealth({ url: 'http://attacker.invalid/' });
  // @ts-expect-error Callers cannot override request headers.
  void client.getHealth({ headers: {} });
  // @ts-expect-error Branded path identifiers cannot be supplied as raw strings.
  void client.getJob({ id: '123e4567-e89b-12d3-a456-426614174000', token });
  // @ts-expect-error Bearer operations require a token.
  void client.getJob({ id });
  // @ts-expect-error JSON operations require their exact body.
  void client.createJob({ token });
  // @ts-expect-error Pack identifiers cannot be replaced with UUID identifiers.
  void client.requestPackAction({ id, body: packAction, token });
}

void clientCallContract;
