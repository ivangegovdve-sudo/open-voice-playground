import type { WorkerPort } from '../../providers';

export function createWorker(): WorkerPort {
  return new Worker(new URL('../supertonic.worker.ts', import.meta.url), {
    type: 'module',
    name: 'open-voice-supertonic',
  });
}
