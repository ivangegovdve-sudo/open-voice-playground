type IsNever<Value> = [Value] extends [never] ? true : false;
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

// This exported type makes the generated API fail compilation if a parser
// becomes uninhabitable or a constrained result loses its nominal evidence.
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
  Assert<IsStrictSubtype<ParsedEngine['synthesisControls'], readonly string[]>>,
];
