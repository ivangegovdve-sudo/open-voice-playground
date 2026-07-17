import {
  installSupertonicWorkerRuntime,
  type SupertonicOrtModulePort,
  type SupertonicWorkerScope,
} from '../supertonic/worker-runtime';

installSupertonicWorkerRuntime(self as unknown as SupertonicWorkerScope, {
  loadOrt: async (backend) =>
    backend === 'webgpu'
      ? ((await import('onnxruntime-web')) as unknown as SupertonicOrtModulePort)
      : ((await import('onnxruntime-web/wasm')) as unknown as SupertonicOrtModulePort),
});
