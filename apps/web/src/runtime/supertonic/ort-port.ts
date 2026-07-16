export type OrtTensorDataMap = {
  readonly float32: Float32Array;
  readonly int64: BigInt64Array;
};

export type OrtTensorType = keyof OrtTensorDataMap;
export type OrtTensorData<T extends OrtTensorType = OrtTensorType> = OrtTensorDataMap[T];

export interface OrtTensorLease<T extends OrtTensorType = OrtTensorType> {
  readonly type: T;
  readonly dims: readonly number[];
  getData(releaseData: true): Promise<OrtTensorData<T>>;
  dispose(): void;
}

export type OrtTensorMetadata =
  | {
      readonly name: string;
      readonly isTensor: true;
      readonly type: OrtTensorType;
      readonly shape: readonly (number | string)[];
    }
  | { readonly name: string; readonly isTensor: false };

export interface OrtSessionPort {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  readonly inputMetadata: readonly OrtTensorMetadata[];
  readonly outputMetadata: readonly OrtTensorMetadata[];
  run(
    feeds: Readonly<Record<string, OrtTensorLease>>,
  ): Promise<Readonly<Record<string, OrtTensorLease>>>;
}

export type SupertonicSessionTuple = readonly [
  durationPredictor: OrtSessionPort,
  textEncoder: OrtSessionPort,
  vectorEstimator: OrtSessionPort,
  vocoder: OrtSessionPort,
];

export interface SupertonicOrtPort {
  createTensor<T extends OrtTensorType>(
    type: T,
    data: OrtTensorData<T>,
    dims: readonly number[],
  ): OrtTensorLease<T>;
  readonly sessions: SupertonicSessionTuple;
}

const PREPARED_SUPERTONIC_ORT_PORT: unique symbol = Symbol('prepared-supertonic-ort-port');
const preparedSupertonicOrtPorts = new WeakSet<object>();

export type PreparedSupertonicOrtPort = SupertonicOrtPort & {
  readonly [PREPARED_SUPERTONIC_ORT_PORT]: true;
};

type MetadataExpectation = readonly [
  name: string,
  type: OrtTensorType,
  shape: readonly (number | null)[],
];

type SessionExpectation = {
  readonly inputs: readonly MetadataExpectation[];
  readonly outputs: readonly MetadataExpectation[];
  readonly error: string;
};

// Raw model names and ABI inspection stay in this port; the synthesis core only sees
// validated sessions and flat tensor leases.
const SESSION_EXPECTATIONS: readonly SessionExpectation[] = [
  {
    inputs: [
      ['text_ids', 'int64', [null, null]],
      ['style_dp', 'float32', [null, 8, 16]],
      ['text_mask', 'float32', [null, 1, null]],
    ],
    outputs: [['duration', 'float32', [null]]],
    error: 'Supertonic duration predictor ABI is invalid.',
  },
  {
    inputs: [
      ['text_ids', 'int64', [null, null]],
      ['style_ttl', 'float32', [null, 50, 256]],
      ['text_mask', 'float32', [null, 1, null]],
    ],
    outputs: [['text_emb', 'float32', [null, 256, null]]],
    error: 'Supertonic text encoder ABI is invalid.',
  },
  {
    inputs: [
      ['noisy_latent', 'float32', [null, 144, null]],
      ['text_emb', 'float32', [null, 256, null]],
      ['style_ttl', 'float32', [null, 50, 256]],
      ['latent_mask', 'float32', [null, 1, null]],
      ['text_mask', 'float32', [null, 1, null]],
      ['current_step', 'float32', [null]],
      ['total_step', 'float32', [null]],
    ],
    outputs: [['denoised_latent', 'float32', [null, 144, null]]],
    error: 'Supertonic vector estimator ABI is invalid.',
  },
  {
    inputs: [['latent', 'float32', [null, 144, null]]],
    outputs: [['wav_tts', 'float32', [null, null]]],
    error: 'Supertonic vocoder ABI is invalid.',
  },
] as const;

function namesMatch(actual: readonly string[], expected: readonly MetadataExpectation[]): boolean {
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]?.[0]) return false;
  }
  return true;
}

function metadataMatch(
  actual: readonly OrtTensorMetadata[],
  expected: readonly MetadataExpectation[],
): boolean {
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    const value = actual[index];
    const required = expected[index];
    if (
      value === undefined ||
      required === undefined ||
      !value.isTensor ||
      value.name !== required[0] ||
      value.type !== required[1] ||
      value.shape.length !== required[2].length
    ) {
      return false;
    }
    for (let axis = 0; axis < required[2].length; axis += 1) {
      const fixed = required[2][axis];
      const actualAxis = value.shape[axis];
      if (fixed !== null && actualAxis !== fixed) return false;
      if (fixed === null && typeof actualAxis !== 'string' && typeof actualAxis !== 'number') {
        return false;
      }
    }
  }
  return true;
}

function sessionMatches(session: OrtSessionPort, expected: SessionExpectation): boolean {
  return (
    namesMatch(session.inputNames, expected.inputs) &&
    namesMatch(session.outputNames, expected.outputs) &&
    metadataMatch(session.inputMetadata, expected.inputs) &&
    metadataMatch(session.outputMetadata, expected.outputs)
  );
}

function tensorShape(
  session: OrtSessionPort,
  direction: 'input' | 'output',
  name: string,
): readonly (number | string)[] | null {
  const metadata = direction === 'input' ? session.inputMetadata : session.outputMetadata;
  const value = metadata.find((entry) => entry.name === name);
  return value?.isTensor ? value.shape : null;
}

function axesMatch(
  left: readonly (number | string)[] | null,
  leftAxes: readonly number[],
  right: readonly (number | string)[] | null,
  rightAxes: readonly number[],
): boolean {
  if (left === null || right === null || leftAxes.length !== rightAxes.length) return false;
  for (let index = 0; index < leftAxes.length; index += 1) {
    const leftAxis = leftAxes[index];
    const rightAxis = rightAxes[index];
    if (leftAxis === undefined || rightAxis === undefined || left[leftAxis] !== right[rightAxis]) {
      return false;
    }
  }
  return true;
}

type AxisReference = readonly [shape: readonly (number | string)[] | null, axis: number];

function joinedAxesAreCompatible(
  references: readonly AxisReference[],
  requiredConcrete?: number,
): boolean {
  let concrete = requiredConcrete;
  for (const [shape, axis] of references) {
    const dimension = shape?.[axis];
    if (dimension === undefined) return false;
    if (typeof dimension === 'number') {
      if (!Number.isSafeInteger(dimension) || dimension < 1) return false;
      if (concrete !== undefined && dimension !== concrete) return false;
      concrete = dimension;
    }
  }
  return true;
}

function validateCrossSessionJoins(sessions: SupertonicSessionTuple): void {
  const [duration, textEncoder, vectorEstimator, vocoder] = sessions;
  const durationIds = tensorShape(duration, 'input', 'text_ids');
  const durationStyle = tensorShape(duration, 'input', 'style_dp');
  const durationMask = tensorShape(duration, 'input', 'text_mask');
  if (
    !axesMatch(durationIds, [0], durationStyle, [0]) ||
    !axesMatch(durationIds, [0, 1], durationMask, [0, 2])
  ) {
    throw new Error('Supertonic duration predictor ABI is invalid.');
  }

  const encoderIds = tensorShape(textEncoder, 'input', 'text_ids');
  const encoderStyle = tensorShape(textEncoder, 'input', 'style_ttl');
  const encoderMask = tensorShape(textEncoder, 'input', 'text_mask');
  const encoderText = tensorShape(textEncoder, 'output', 'text_emb');
  const vectorTextInput = tensorShape(vectorEstimator, 'input', 'text_emb');
  const vectorTextInputMask = tensorShape(vectorEstimator, 'input', 'text_mask');
  if (
    !axesMatch(encoderIds, [0], encoderStyle, [0]) ||
    !axesMatch(encoderIds, [0, 1], encoderMask, [0, 2]) ||
    !axesMatch(durationIds, [0, 1], encoderIds, [0, 1]) ||
    !axesMatch(durationMask, [0, 1, 2], encoderMask, [0, 1, 2]) ||
    !joinedAxesAreCompatible(
      [
        [encoderIds, 0],
        [encoderMask, 0],
        [encoderText, 0],
        [vectorTextInput, 0],
        [vectorTextInputMask, 0],
      ],
      1,
    ) ||
    !joinedAxesAreCompatible([
      [encoderIds, 1],
      [encoderMask, 2],
      [encoderText, 2],
      [vectorTextInput, 2],
      [vectorTextInputMask, 2],
    ])
  ) {
    throw new Error('Supertonic text encoder ABI is invalid.');
  }

  const noisyLatent = tensorShape(vectorEstimator, 'input', 'noisy_latent');
  const vectorText = tensorShape(vectorEstimator, 'input', 'text_emb');
  const vectorStyle = tensorShape(vectorEstimator, 'input', 'style_ttl');
  const latentMask = tensorShape(vectorEstimator, 'input', 'latent_mask');
  const vectorTextMask = tensorShape(vectorEstimator, 'input', 'text_mask');
  const currentStep = tensorShape(vectorEstimator, 'input', 'current_step');
  const totalStep = tensorShape(vectorEstimator, 'input', 'total_step');
  const denoisedLatent = tensorShape(vectorEstimator, 'output', 'denoised_latent');
  if (
    !axesMatch(encoderStyle, [0, 1, 2], vectorStyle, [0, 1, 2]) ||
    !axesMatch(encoderMask, [0, 1, 2], vectorTextMask, [0, 1, 2]) ||
    !axesMatch(vectorText, [0, 2], vectorTextMask, [0, 2]) ||
    !axesMatch(noisyLatent, [0, 2], latentMask, [0, 2]) ||
    !axesMatch(noisyLatent, [0, 1, 2], denoisedLatent, [0, 1, 2]) ||
    !axesMatch(noisyLatent, [0], currentStep, [0]) ||
    !axesMatch(noisyLatent, [0], totalStep, [0])
  ) {
    throw new Error('Supertonic vector estimator ABI is invalid.');
  }

  const vocoderLatent = tensorShape(vocoder, 'input', 'latent');
  if (!axesMatch(denoisedLatent, [0, 1, 2], vocoderLatent, [0, 1, 2])) {
    throw new Error('Supertonic vocoder ABI is invalid.');
  }
}

export function assertPreparedSupertonicOrtPort(
  port: unknown,
): asserts port is PreparedSupertonicOrtPort {
  if (typeof port !== 'object' || port === null || !preparedSupertonicOrtPorts.has(port)) {
    throw new Error('Supertonic ORT port has not passed ABI preparation.');
  }
}

export function prepareSupertonicOrtPort(port: SupertonicOrtPort): PreparedSupertonicOrtPort {
  if (port.sessions.length !== SESSION_EXPECTATIONS.length) {
    throw new Error('Supertonic four-session ABI is invalid.');
  }
  for (let index = 0; index < SESSION_EXPECTATIONS.length; index += 1) {
    const session = port.sessions[index];
    const expected = SESSION_EXPECTATIONS[index];
    if (session === undefined || expected === undefined || !sessionMatches(session, expected)) {
      throw new Error(expected?.error ?? 'Supertonic four-session ABI is invalid.');
    }
  }
  validateCrossSessionJoins(port.sessions);
  const sessions = Object.freeze([...port.sessions]) as unknown as SupertonicSessionTuple;
  const prepared = Object.freeze({
    createTensor: <T extends OrtTensorType>(
      type: T,
      data: OrtTensorData<T>,
      dims: readonly number[],
    ) => port.createTensor(type, data, dims),
    sessions,
  }) as PreparedSupertonicOrtPort;
  preparedSupertonicOrtPorts.add(prepared);
  return prepared;
}
