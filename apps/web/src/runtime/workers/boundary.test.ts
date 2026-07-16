import { afterEach, describe, expect, it, vi } from 'vitest';

import { installUnverifiedEngineBoundary } from './boundary';

type MessageListener = (event: MessageEvent) => void;

class BoundaryScope {
  listener: MessageListener | null = null;
  readonly messages: unknown[] = [];
  readonly close = vi.fn();

  addEventListener(_type: 'message', listener: MessageListener): void {
    this.listener = listener;
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  emit(data: unknown): void {
    this.listener?.(new MessageEvent('message', { data }));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('unverified Worker boundary', () => {
  it('parses messages, binds preset commands to its engine, and never closes for malformed input', () => {
    const scope = new BoundaryScope();
    vi.stubGlobal('self', scope);
    installUnverifiedEngineBoundary('kokoro');

    scope.emit({ command: 'dispose', operationId: 1, modelUrl: 'https://evil.invalid/model' });
    scope.emit({
      command: 'prepare',
      operationId: 2,
      engineId: 'kitten',
      voiceId: 'kitten:Bella',
    });
    scope.emit({ command: 'unknown', operationId: 3 });

    expect(scope.close).not.toHaveBeenCalled();
    expect(scope.messages).toEqual([
      { type: 'error', operationId: 1, message: 'Malformed worker command.' },
      { type: 'error', operationId: 2, message: 'Malformed worker command.' },
      { type: 'error', operationId: 3, message: 'Malformed worker command.' },
    ]);

    scope.emit({ command: 'cancel', operationId: 4 });
    scope.emit({ command: 'dispose', operationId: 5 });
    expect(scope.messages.at(-1)).toEqual({ type: 'cancelled', operationId: 4 });
    expect(scope.close).toHaveBeenCalledOnce();
  });
});
