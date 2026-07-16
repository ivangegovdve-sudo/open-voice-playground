import { WorkerCommandSchema, WorkerResponseSchema } from '@open-voice/contracts';

type BoundaryScope = {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown): void;
  close(): void;
};

function operationIdFrom(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || !('operationId' in value)) return null;
  const operationId = (value as { operationId?: unknown }).operationId;
  return Number.isSafeInteger(operationId) && (operationId as number) >= 0
    ? (operationId as number)
    : null;
}

function postMalformed(scope: BoundaryScope, value: unknown): void {
  const operationId = operationIdFrom(value);
  if (operationId === null) return;
  scope.postMessage(
    WorkerResponseSchema.parse({
      type: 'error',
      operationId,
      message: 'Malformed worker command.',
    }),
  );
}

export function installUnverifiedEngineBoundary(engineId: string): void {
  const scope = self as unknown as BoundaryScope;
  scope.addEventListener('message', (event) => {
    const parsed = WorkerCommandSchema.safeParse(event.data);
    if (!parsed.success) {
      postMalformed(scope, event.data);
      return;
    }
    const command = parsed.data;
    if ('engineId' in command && command.engineId !== engineId) {
      postMalformed(scope, event.data);
      return;
    }
    if (command.command === 'dispose') {
      scope.close();
      return;
    }
    if (command.command === 'cancel') {
      scope.postMessage(
        WorkerResponseSchema.parse({ type: 'cancelled', operationId: command.operationId }),
      );
      return;
    }
    scope.postMessage(
      WorkerResponseSchema.parse({
        type: 'error',
        operationId: command.operationId,
        message: `${engineId} runtime-verification-pending`,
      }),
    );
  });
}
