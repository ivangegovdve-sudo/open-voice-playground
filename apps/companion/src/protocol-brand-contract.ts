type IsStrictSubtype<Value, Base> = [Value] extends [Base]
  ? [Base] extends [Value]
    ? false
    : true
  : false;

type Assert<Condition extends true> = Condition;
type ProtocolModule = typeof import('./generated/protocol.js');
type ParsedOpaqueSecret = ReturnType<ProtocolModule['parseOpaqueSecret']>;
type ParsedJob = ReturnType<ProtocolModule['parseJobCreateRequest']>;
type ParsedPairingChallenge = ReturnType<ProtocolModule['parsePairingChallengeResponse']>;
type ParsedProblem = ReturnType<ProtocolModule['parseProblem']>;
type ParsedEngine = ReturnType<ProtocolModule['parseEngineResponse']>;

// This exported type makes the generated API fail compilation if constrained
// parser results silently regress to their unconstrained primitive shapes.
export type ProtocolBrandContract = readonly [
  Assert<IsStrictSubtype<ParsedOpaqueSecret, string>>,
  Assert<IsStrictSubtype<ParsedJob['text'], string>>,
  Assert<IsStrictSubtype<ParsedPairingChallenge['id'], string>>,
  Assert<IsStrictSubtype<ParsedProblem['status'], number>>,
  Assert<IsStrictSubtype<ParsedEngine['synthesisControls'], readonly string[]>>,
];
