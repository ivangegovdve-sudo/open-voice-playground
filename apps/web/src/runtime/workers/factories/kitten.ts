import type { WorkerPort } from '../../providers';

export function createWorker(): WorkerPort {
  return new Worker(new URL('../kitten.worker.ts', import.meta.url), {
    type: 'module',
    name: 'open-voice-kitten',
  });
}
