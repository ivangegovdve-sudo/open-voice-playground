import type { WorkerCommand } from '@open-voice/contracts';

type BoundaryScope = {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerCommand>) => void): void;
  postMessage(message: unknown): void;
  close(): void;
};

export function installUnverifiedEngineBoundary(engineId: string): void {
  const scope = self as unknown as BoundaryScope;
  scope.addEventListener('message', (event) => {
    const command = event.data;
    if (command.command === 'dispose') {
      scope.close();
      return;
    }
    if (command.command === 'cancel') {
      scope.postMessage({ type: 'cancelled', operationId: command.operationId });
      return;
    }
    scope.postMessage({
      type: 'error',
      operationId: command.operationId,
      message: `${engineId} runtime-verification-pending`,
    });
  });
}
