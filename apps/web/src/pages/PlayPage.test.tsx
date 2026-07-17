import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppView } from '../App';
import launchRaw from '../../../../packages/catalog/data/launch-catalog.public.json?raw';
import {
  createDefaultServices,
  createLaunchServices,
  type AppServices,
  type SupertonicWorkbench,
} from '../app-services';
import {
  StaticRuntimeRegistry,
  type RuntimeAdapter,
  type RuntimeOperationContext,
  type SynthesisOutput,
} from '../runtime/runtime';
import { createLocalDataStore } from '../state/local-store';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function runtimeAdapter(overrides: Partial<RuntimeAdapter> = {}): RuntimeAdapter {
  return {
    engineId: 'fixture-browser',
    async listVoices() {
      return ['fixture-browser:voice-a', 'fixture-browser:voice-b'];
    },
    async checkCapability(_voice, mode) {
      return {
        available: true,
        mode,
        reason: null,
        controls: [
          {
            id: 'speed',
            label: 'Speed',
            type: 'range',
            min: 0.5,
            max: 2,
            step: 0.1,
            defaultValue: 1,
          },
        ],
      };
    },
    async prepare(_request, context) {
      context?.onProgress?.({ phase: 'Preparing fixture runtime…', percent: 20 });
    },
    async synthesize(request, context) {
      context.onProgress?.({ phase: 'Generating fixture audio…', percent: 70 });
      return {
        blob: new Blob([request.text], { type: 'audio/wav' }),
        mimeType: 'audio/wav',
        filename: `${request.voice.id}.wav`,
      };
    },
    async cancel() {},
    async dispose() {},
    ...overrides,
  };
}

function servicesFor(adapter: RuntimeAdapter): AppServices {
  const defaults = createDefaultServices();
  return {
    ...defaults,
    store: createLocalDataStore({ indexedDB: null }),
    runtime: new StaticRuntimeRegistry([adapter]),
    now: () => new Date('2026-07-15T12:00:00.000Z'),
    createObjectUrl: vi.fn(() => 'blob:fixture-output'),
    revokeObjectUrl: vi.fn(),
  };
}

function renderPlay(services: AppServices, voiceId = 'fixture-browser:voice-a') {
  return render(
    <MemoryRouter initialEntries={[`/play?voice=${encodeURIComponent(voiceId)}`]}>
      <AppView services={services} />
    </MemoryRouter>,
  );
}

function fetchLaunchCatalog() {
  return vi.fn(
    async () =>
      new Response(launchRaw, {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
  );
}

function coordinatorHarness() {
  const coordinator = {
    preparedKey: vi.fn(() => 'prepared-key'),
    buildPreparePayload: vi.fn(async () => ({ prepared: true }) as never),
    buildSynthesizeCommand: vi.fn(() => ({ synthesized: true }) as never),
  };
  const factory = vi.fn((_input: unknown) => coordinator);
  const loader = vi.fn(async () => factory);
  return { coordinator, factory, loader };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function managedAudio(): HTMLAudioElement | null {
  return document.querySelector('audio[controls]');
}

async function findManagedAudio(): Promise<HTMLAudioElement> {
  await waitFor(() => expect(managedAudio()).not.toBeNull());
  return managedAudio()!;
}

async function openSupertonicDisclosure(user: ReturnType<typeof userEvent.setup>) {
  const details = document.querySelector('details');
  const summary = details?.querySelector('summary');
  expect(details).not.toBeNull();
  expect(summary).not.toBeNull();
  await user.click(summary!);
  return details!;
}

function containsBinary(value: unknown, seen = new Set<object>()): boolean {
  if (value instanceof Blob || (typeof File !== 'undefined' && value instanceof File)) return true;
  if (typeof value !== 'object' || value === null || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((nested) => containsBinary(nested, seen));
}

async function launchServices({
  loader = coordinatorHarness().loader,
}: {
  loader?: ReturnType<typeof coordinatorHarness>['loader'];
} = {}) {
  const store = createLocalDataStore({ indexedDB: null });
  const launchAssetFetcher = fetchLaunchCatalog();
  const services = await createLaunchServices(launchAssetFetcher, {
    hasWebGpu: () => false,
    loadSupertonicCoordinator: loader,
    now: () => new Date('2026-07-17T07:00:00.000Z'),
    store,
  });
  return {
    ...services,
    createObjectUrl: vi.fn(() => 'blob:supertonic-output'),
    launchAssetFetcher,
    revokeObjectUrl: vi.fn(),
  };
}

function supertonicRuntime(
  workbench: SupertonicWorkbench,
  outputs: SynthesisOutput[],
  overrides: Partial<RuntimeAdapter> = {},
) {
  let outputIndex = 0;
  const prepare = vi.fn(async (request, context?: RuntimeOperationContext) => {
    const backend = request.controls.backend;
    if (backend !== 'wasm' && backend !== 'webgpu') {
      throw new Error('Expected an exact Supertonic backend.');
    }
    await workbench.buildPreparePayload({
      operationId: outputIndex,
      voiceId: request.voice.id,
      backend,
      ...(context?.signal === undefined ? {} : { signal: context.signal }),
      ...(context?.onProgress === undefined ? {} : { onProgress: context.onProgress }),
    });
  });
  const synthesize = vi.fn(async () => {
    const output = outputs[Math.min(outputIndex, outputs.length - 1)];
    outputIndex += 1;
    if (output === undefined) throw new Error('No fixture output was supplied.');
    return output;
  });
  const adapter: RuntimeAdapter = {
    engineId: 'supertonic',
    async listVoices() {
      return ['supertonic:F1', 'supertonic:F2'];
    },
    async checkCapability(_voice, mode) {
      return { available: true, mode, reason: null, controls: workbench.controls };
    },
    prepare,
    synthesize,
    async cancel() {},
    async dispose() {},
    ...overrides,
  };
  return { adapter, prepare, synthesize };
}

async function acceptCurrentSupertonicSelection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('checkbox', {
      name: 'I reviewed the exact selection and pinned OpenRAIL-M terms',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Accept exact selection' }));
}

describe('play workbench with an available adapter', () => {
  it('records a preset as recent when Play opens it and when the selection changes', async () => {
    const user = userEvent.setup();
    const services = servicesFor(runtimeAdapter());
    renderPlay(services);

    await waitFor(async () => {
      await expect(services.store.getSnapshot()).resolves.toMatchObject({
        recent: ['fixture-browser:voice-a'],
      });
    });

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Voice preset' }),
      'fixture-browser:voice-b',
    );

    await waitFor(async () => {
      await expect(services.store.getSnapshot()).resolves.toMatchObject({
        recent: ['fixture-browser:voice-b', 'fixture-browser:voice-a'],
      });
    });
  });

  it('shows readiness, engine controls, progress, WAV output, and completed local history', async () => {
    const user = userEvent.setup();
    const services = servicesFor(runtimeAdapter());
    renderPlay(services);

    expect(await screen.findByText('Runtime is ready.')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Speed' })).toHaveValue('1');

    await user.type(screen.getByRole('textbox', { name: 'Text to synthesize' }), 'A clear line.');
    await user.click(screen.getByRole('button', { name: 'Generate speech' }));

    expect(await screen.findByRole('status', { name: 'Generation status' })).toHaveTextContent(
      'WAV is ready on this device.',
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '100');
    expect(await findManagedAudio()).toHaveAttribute('src', 'blob:fixture-output');
    expect(screen.getByRole('link', { name: 'Download WAV' })).toHaveAttribute(
      'href',
      'blob:fixture-output',
    );
    expect(await screen.findByText('complete')).toBeInTheDocument();
    expect(services.createObjectUrl).toHaveBeenCalledOnce();
  });

  it('locks mutable inputs and cancels the adapter that owns the active operation', async () => {
    const user = userEvent.setup();
    const cancel = vi.fn(async () => {});
    const adapter = runtimeAdapter({
      cancel,
      synthesize(_request, context: RuntimeOperationContext): Promise<SynthesisOutput> {
        context.onProgress?.({ phase: 'Generating fixture audio…', percent: 45 });
        return new Promise((_resolve, reject) => {
          context.signal?.addEventListener('abort', () => {
            reject(new DOMException('Generation cancelled', 'AbortError'));
          });
        });
      },
    });
    renderPlay(servicesFor(adapter));

    expect(await screen.findByText('Runtime is ready.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Text to synthesize' }), 'Hold this run.');
    await user.click(screen.getByRole('button', { name: 'Generate speech' }));
    expect(await screen.findByRole('status', { name: 'Generation status' })).toHaveTextContent(
      'Generating fixture audio…',
    );

    expect(screen.getByRole('combobox', { name: 'Voice preset' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Runtime' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Text to synthesize' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Cancel generation' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(await screen.findByRole('status', { name: 'Generation status' })).toHaveTextContent(
      'Generation cancelled.',
    );
    expect(screen.queryByRole('link', { name: 'Download WAV' })).not.toBeInTheDocument();
  });

  it('turns capability-check rejection into an explicit error state', async () => {
    const adapter = runtimeAdapter({
      async checkCapability() {
        throw new Error('Capability probe failed.');
      },
    });
    renderPlay(servicesFor(adapter));

    expect(await screen.findByText('Capability probe failed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate speech' })).toBeDisabled();
  });

  it('rejects a capability response for a different runtime mode', async () => {
    const adapter = runtimeAdapter({
      async checkCapability() {
        return { available: true, mode: 'online', reason: null, controls: [] };
      },
    });
    renderPlay(servicesFor(adapter));

    expect(
      await screen.findByText(
        'Runtime adapter returned Online service for a Runs in browser request.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate speech' })).toBeDisabled();
  });
});

describe('Supertonic exact-selection workbench', () => {
  it('keeps every pre-generate interaction inference-free and persists only explicit acceptance', async () => {
    const user = userEvent.setup();
    const harness = coordinatorHarness();
    const globalFetch = vi.fn();
    const workerConstructor = vi.fn();
    const xmlHttpRequestConstructor = vi.fn();
    const cacheKeys = vi.fn(async () => []);
    const cacheMatch = vi.fn();
    const cacheWrite = vi.fn();
    const cacheDelete = vi.fn();
    const cacheOpen = vi.fn(async () => ({
      delete: cacheDelete,
      match: cacheMatch,
      put: cacheWrite,
    }));
    const storageAccess = vi.fn(() => ({
      estimate: vi.fn(),
      getDirectory: vi.fn(),
      persist: vi.fn(),
    }));
    const navigatorProxy = new Proxy(globalThis.navigator, {
      get(target, property, receiver) {
        return property === 'storage' ? storageAccess() : Reflect.get(target, property, receiver);
      },
    });
    vi.stubGlobal('Worker', workerConstructor);
    vi.stubGlobal('XMLHttpRequest', xmlHttpRequestConstructor);
    vi.stubGlobal('fetch', globalFetch);
    vi.stubGlobal('navigator', navigatorProxy);
    vi.stubGlobal('caches', { keys: cacheKeys, open: cacheOpen });
    const services = await launchServices({ loader: harness.loader });
    expect(services.launchAssetFetcher).toHaveBeenCalledOnce();
    services.launchAssetFetcher.mockClear();
    cacheKeys.mockClear();
    cacheOpen.mockClear();
    cacheMatch.mockClear();
    cacheWrite.mockClear();
    cacheDelete.mockClear();
    const expectNoAssetIo = () => {
      expect(services.launchAssetFetcher).not.toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();
      expect(workerConstructor).not.toHaveBeenCalled();
      expect(xmlHttpRequestConstructor).not.toHaveBeenCalled();
      expect(storageAccess).not.toHaveBeenCalled();
      expect(cacheKeys).not.toHaveBeenCalled();
      expect(cacheOpen).not.toHaveBeenCalled();
      expect(cacheMatch).not.toHaveBeenCalled();
      expect(cacheWrite).not.toHaveBeenCalled();
      expect(cacheDelete).not.toHaveBeenCalled();
    };
    const consentWrite = vi.spyOn(services.store, 'setSupertonicConsent');
    renderPlay(services, 'supertonic:F1');

    await waitFor(() => {
      expect(services.supertonicWorkbench!.getSnapshot().hydrated).toBe(true);
    });
    expect(
      screen.getByText('Nonconsensual impersonation is prohibited. Use preset voices responsibly.'),
    ).toBeVisible();
    expect(consentWrite).not.toHaveBeenCalled();
    expectNoAssetIo();
    expect(
      await screen.findByText(
        'Runtime verification is pending; no model download or Worker was started.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Backend' })).toHaveValue('wasm');
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('en');
    expect(screen.getByRole('slider', { name: 'Speed' })).toHaveValue('1.05');
    const generate = screen.getByRole('button', { name: 'Generate speech' });
    expect(generate).toBeDisabled();
    consentWrite.mockClear();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Voice preset' }),
      'supertonic:F2',
    );
    expectNoAssetIo();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'bg');
    expectNoAssetIo();
    fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), {
      target: { value: '1.15' },
    });
    expectNoAssetIo();
    await openSupertonicDisclosure(user);
    expectNoAssetIo();
    const accept = screen.getByRole('button', { name: 'Accept exact selection' });
    const checkbox = screen.getByRole('checkbox', {
      name: 'I reviewed the exact selection and pinned OpenRAIL-M terms',
    });
    expect(accept).toBeDisabled();
    await user.click(accept);
    await expect(services.store.getSupertonicConsent()).resolves.toBeNull();
    expect(consentWrite).not.toHaveBeenCalled();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(accept).toBeEnabled();
    expectNoAssetIo();

    await expect(services.store.getSupertonicConsent()).resolves.toBeNull();
    expect(consentWrite).not.toHaveBeenCalled();
    expect(harness.loader).not.toHaveBeenCalled();
    expectNoAssetIo();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Backend' }), 'webgpu');
    expect(checkbox).not.toBeChecked();
    expect(accept).toBeDisabled();
    expectNoAssetIo();
    consentWrite.mockClear();
    await user.click(checkbox);
    await user.click(accept);
    await expect(services.store.getSupertonicConsent()).resolves.toEqual({
      schemaVersion: 1,
      selectionId: 'supertonic-webgpu',
      selectionDigest: 'sha256:7190a762b081736eed0573efb7cd4ba7ebbeea9ebfc3afbc0ccf546331ce380e',
      acceptedLicenseIds: ['supertone-weights-license'],
      acceptedTermsHashes: [
        'sha256:0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f',
      ],
      acceptedAt: '2026-07-17T07:00:00.000Z',
    });
    expect(services.supertonicWorkbench!.isAccepted('webgpu')).toBe(true);
    expectNoAssetIo();
    expect(generate).toBeDisabled();
    await user.click(generate);
    expect(harness.loader).not.toHaveBeenCalled();
    expectNoAssetIo();

    consentWrite.mockClear();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Backend' }), 'wasm');
    expect(consentWrite).toHaveBeenCalledTimes(1);
    expect(consentWrite).toHaveBeenLastCalledWith(null);
    await expect(services.store.getSupertonicConsent()).resolves.toBeNull();
    expect(checkbox).not.toBeChecked();
    expect(accept).toBeDisabled();
    expectNoAssetIo();
    consentWrite.mockClear();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Backend' }), 'webgpu');
    await expect(services.store.getSupertonicConsent()).resolves.toBeNull();
    expect(generate).toBeDisabled();
    expect(harness.loader).not.toHaveBeenCalled();
    expectNoAssetIo();
  });

  it('discloses the exact closure, local handling, pinned terms, and preset-only boundary', async () => {
    const user = userEvent.setup();
    const services = await launchServices();
    renderPlay(services, 'supertonic:F1');
    await screen.findByRole('combobox', { name: 'Backend' });
    const details = await openSupertonicDisclosure(user);
    const disclosure = within(details);
    const expectFact = (label: string, value: string) => {
      const labelNode = disclosure.getByText(label);
      expect(labelNode.nextElementSibling).not.toBeNull();
      expect(labelNode.nextElementSibling).toHaveTextContent(value);
    };

    expect(details).toHaveTextContent('Selected backend: WASM. No automatic fallback.');
    expectFact('Model closure', '401,276,744 bytes');
    expectFact('ONNX Runtime', '13,479,978 bytes');
    expectFact('Selected closure', '414,756,722 bytes');
    expectFact('Conservative upper bound', '692,029,340 bytes');
    expect(details).toHaveTextContent(
      'Your script, inference, and generated audio stay on this device. The selected closure is the exact initial pinned asset download from reviewed sources. The conservative upper bound is the browser storage allowance checked before preparation.',
    );
    expect(details).toHaveTextContent(
      'ONNX Runtime is provided under the MIT license; this is a notice, not another click-through.',
    );
    expect(details).toHaveTextContent(
      'Preset voices only. No reference audio, voice upload, or voice cloning is supported.',
    );
    expect(details).toHaveTextContent('supertonic-wasm');
    expect(details).toHaveTextContent(
      'sha256:8d6cd80556261b7d1dd56e2796b7113febee04037f97f5de298e5e7b5a35feb9',
    );
    expect(disclosure.getByRole('link', { name: 'OpenRAIL-M' })).toHaveAttribute(
      'href',
      'https://huggingface.co/Supertone/supertonic-3/blob/3cadd1ee6394adea1bd021217a0e650ede09a323/LICENSE',
    );
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(document.querySelector('input[type="url"]')).toBeNull();
    const forbiddenControl = /reference|upload|clone|model|path|url/i;
    expect(screen.queryByLabelText(forbiddenControl)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', {
        name: forbiddenControl,
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: forbiddenControl })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: forbiddenControl })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Backend' }), 'webgpu');
    expect(details).toHaveTextContent('Selected backend: WebGPU. No automatic fallback.');
    expectFact('Model closure', '401,276,744 bytes');
    expectFact('ONNX Runtime', '26,827,543 bytes');
    expectFact('Selected closure', '428,104,287 bytes');
    expectFact('Conservative upper bound', '706,044,283 bytes');
    expect(details).toHaveTextContent('supertonic-webgpu');
    expect(details).toHaveTextContent(
      'sha256:7190a762b081736eed0573efb7cd4ba7ebbeea9ebfc3afbc0ccf546331ce380e',
    );
  });

  it('announces consent confirmation and persistence errors', async () => {
    const user = userEvent.setup();
    const services = await launchServices();
    vi.spyOn(services.store, 'setSupertonicConsent').mockRejectedValueOnce(
      new Error('Consent persistence failed.'),
    );
    renderPlay(services, 'supertonic:F1');
    await screen.findByRole('combobox', { name: 'Backend' });
    await openSupertonicDisclosure(user);
    await acceptCurrentSupertonicSelection(user);

    const confirmation = screen.getByRole('status', { name: 'Supertonic consent status' });
    expect(confirmation).toHaveTextContent('Exact WASM selection accepted.');
    expect(confirmation).toHaveAttribute('aria-live', 'polite');
    expect(confirmation).toHaveAttribute('aria-atomic', 'true');
    expect(await screen.findByRole('alert')).toHaveTextContent('Consent persistence failed.');
  });

  it('gates Generate on acceptance, then exposes one safe, associated audio URL', async () => {
    const user = userEvent.setup();
    const harness = coordinatorHarness();
    const maliciousOutput: SynthesisOutput = {
      blob: new Blob(['safe fixture audio'], { type: 'audio/wav' }),
      mimeType: 'audio/wav',
      filename: '../../voice-clone.exe',
    };
    const base = await launchServices({ loader: harness.loader });
    const cacheMatch = vi.fn();
    const cachePut = vi.fn();
    const cacheDelete = vi.fn();
    const cacheOpen = vi.fn(async () => ({
      delete: cacheDelete,
      match: cacheMatch,
      put: cachePut,
    }));
    const cacheStorageMatch = vi.fn();
    const cacheStorageDelete = vi.fn();
    vi.stubGlobal('caches', {
      delete: cacheStorageDelete,
      match: cacheStorageMatch,
      open: cacheOpen,
    });
    const runtime = supertonicRuntime(base.supertonicWorkbench!, [maliciousOutput]);
    const createObjectUrl = vi.fn((blob: Blob) =>
      blob === maliciousOutput.blob ? 'blob:exact-supertonic-f1' : 'blob:wrong-output',
    );
    const services: AppServices = {
      ...base,
      runtime: new StaticRuntimeRegistry([runtime.adapter]),
      createObjectUrl,
    };
    const view = renderPlay(services, 'supertonic:F1');

    expect(await screen.findByText('Runtime is ready.')).toBeInTheDocument();
    const generate = screen.getByRole('button', { name: 'Generate speech' });
    expect(generate).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Text to synthesize' }), 'Local only.');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'bg');
    fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), {
      target: { value: '1.15' },
    });
    await openSupertonicDisclosure(user);
    await user.click(
      screen.getByRole('checkbox', {
        name: 'I reviewed the exact selection and pinned OpenRAIL-M terms',
      }),
    );
    await expect(services.store.getSupertonicConsent()).resolves.toBeNull();
    expect(generate).toBeDisabled();
    expect(harness.loader).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Accept exact selection' }));
    expect(generate).toBeEnabled();
    expect(harness.loader).not.toHaveBeenCalled();

    const timeoutSpy = vi.spyOn(window, 'setTimeout');
    await act(async () => {
      fireEvent.click(generate);
      await Promise.resolve();
    });

    expect(screen.getByRole('status', { name: 'Generation status' })).toHaveTextContent(
      'WAV is ready on this device.',
    );
    expect(harness.loader).toHaveBeenCalledOnce();
    expect(runtime.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: expect.objectContaining({ id: 'supertonic:F1' }),
        controls: { backend: 'wasm', language: 'bg', speed: 1.15 },
      }),
      expect.any(Object),
    );
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(createObjectUrl).toHaveBeenCalledWith(maliciousOutput.blob);
    const audio = managedAudio();
    expect(audio).not.toBeNull();
    const download = screen.getByRole('link', { name: 'Download WAV' });
    expect(audio!).toHaveAttribute('controls');
    expect(audio!).toHaveAttribute('src', 'blob:exact-supertonic-f1');
    expect(download).toHaveAttribute('href', 'blob:exact-supertonic-f1');
    const downloadName = download.getAttribute('download') ?? '';
    expect(downloadName).toMatch(/^ai-generated-supertonic-[a-z0-9-]+\.wav$/);
    expect(downloadName).toContain('supertonic-f1');
    expect(downloadName).not.toContain(maliciousOutput.filename);
    const describedBy = (element: HTMLElement) =>
      element.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? [];
    const audioNotices = describedBy(audio!);
    const downloadNotices = describedBy(download);
    expect(audioNotices.length).toBeGreaterThan(0);
    expect([...downloadNotices].sort()).toEqual([...audioNotices].sort());
    const visibleNoticeText = (ids: string[]) =>
      ids
        .map((id) => {
          const notice = document.getElementById(id);
          expect(notice).not.toBeNull();
          expect(notice).toBeVisible();
          return notice?.textContent ?? '';
        })
        .join(' ');
    for (const noticeText of [
      visibleNoticeText(audioNotices),
      visibleNoticeText(downloadNotices),
    ]) {
      expect(noticeText).toContain('Machine-generated audio — not a human recording.');
      expect(noticeText).toMatch(
        /Shared copies need an AI-generated disclosure and applicable notices/i,
      );
      expect(noticeText).toMatch(/Nonconsensual impersonation is prohibited/i);
    }
    download.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(download);
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(managedAudio()).toBe(audio);
    expect(screen.getByRole('link', { name: 'Download WAV' })).toBe(download);
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(services.revokeObjectUrl).not.toHaveBeenCalled();
    expect(cacheOpen).not.toHaveBeenCalled();
    expect(cacheStorageMatch).not.toHaveBeenCalled();
    expect(cacheStorageDelete).not.toHaveBeenCalled();
    expect(cacheMatch).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
    timeoutSpy.mockRestore();
    const snapshot = await services.store.getSnapshot();
    expect(containsBinary(snapshot)).toBe(false);
    expect(Object.keys(snapshot.history[0] ?? {}).sort()).toEqual([
      'createdAt',
      'id',
      'outcome',
      'text',
      'voiceId',
    ]);
    expect(snapshot.history[0]).toMatchObject({
      voiceId: 'supertonic:F1',
      text: 'Local only.',
      outcome: 'complete',
    });
    expect(JSON.stringify(snapshot)).not.toContain(maliciousOutput.filename);
    expect(JSON.stringify(snapshot)).not.toContain('blob:exact-supertonic-f1');

    await user.type(screen.getByRole('textbox', { name: 'Text to synthesize' }), ' Again.');
    await waitFor(() => expect(services.revokeObjectUrl).toHaveBeenCalledOnce());
    expect(services.revokeObjectUrl).toHaveBeenCalledWith('blob:exact-supertonic-f1');
    expect(managedAudio()).toBeNull();
    expect(screen.queryByRole('link', { name: 'Download WAV' })).not.toBeInTheDocument();
    expect(base.supertonicWorkbench!.isAccepted('wasm')).toBe(true);
    await expect(services.store.getSupertonicConsent()).resolves.not.toBeNull();
    view.unmount();
    expect(services.revokeObjectUrl).toHaveBeenCalledOnce();
  });

  it('revokes output for voice, language, speed, and backend changes without revoking consent early', async () => {
    const user = userEvent.setup();
    const outputs = Array.from({ length: 4 }, (_, index) => ({
      blob: new Blob([`fixture-${index + 1}`], { type: 'audio/wav' }),
      mimeType: 'audio/wav' as const,
      filename: `malicious-${index + 1}.wav`,
    }));
    const base = await launchServices();
    const runtime = supertonicRuntime(base.supertonicWorkbench!, outputs);
    const urls = new Map(
      outputs.map((output, index) => [output.blob, `blob:fixture-${index + 1}`]),
    );
    const services: AppServices = {
      ...base,
      runtime: new StaticRuntimeRegistry([runtime.adapter]),
      createObjectUrl: vi.fn((blob) => urls.get(blob) ?? 'blob:unknown'),
    };
    const view = renderPlay(services, 'supertonic:F1');
    await screen.findByText('Runtime is ready.');
    await user.type(screen.getByRole('textbox', { name: 'Text to synthesize' }), 'Invalidate me.');
    await openSupertonicDisclosure(user);
    await acceptCurrentSupertonicSelection(user);

    const generateOutput = async (expectedUrl: string) => {
      await user.click(screen.getByRole('button', { name: 'Generate speech' }));
      expect(await findManagedAudio()).toHaveAttribute('src', expectedUrl);
    };
    await generateOutput('blob:fixture-1');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Voice preset' }),
      'supertonic:F2',
    );
    await waitFor(() => expect(services.revokeObjectUrl).toHaveBeenCalledTimes(1));
    expect(services.revokeObjectUrl).toHaveBeenNthCalledWith(1, 'blob:fixture-1');
    expect(base.supertonicWorkbench!.isAccepted('wasm')).toBe(true);
    await expect(services.store.getSupertonicConsent()).resolves.not.toBeNull();

    await screen.findByText('Runtime is ready.');
    await generateOutput('blob:fixture-2');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'bg');
    await waitFor(() => expect(services.revokeObjectUrl).toHaveBeenCalledTimes(2));
    expect(services.revokeObjectUrl).toHaveBeenNthCalledWith(2, 'blob:fixture-2');
    expect(base.supertonicWorkbench!.isAccepted('wasm')).toBe(true);
    await expect(services.store.getSupertonicConsent()).resolves.not.toBeNull();

    await generateOutput('blob:fixture-3');
    fireEvent.change(screen.getByRole('slider', { name: 'Speed' }), {
      target: { value: '1.2' },
    });
    await waitFor(() => expect(services.revokeObjectUrl).toHaveBeenCalledTimes(3));
    expect(services.revokeObjectUrl).toHaveBeenNthCalledWith(3, 'blob:fixture-3');
    expect(base.supertonicWorkbench!.isAccepted('wasm')).toBe(true);
    await expect(services.store.getSupertonicConsent()).resolves.not.toBeNull();

    await generateOutput('blob:fixture-4');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Backend' }), 'webgpu');
    await waitFor(() => expect(services.revokeObjectUrl).toHaveBeenCalledTimes(4));
    expect(services.revokeObjectUrl).toHaveBeenNthCalledWith(4, 'blob:fixture-4');
    expect(base.supertonicWorkbench!.isAccepted('webgpu')).toBe(false);
    await expect(services.store.getSupertonicConsent()).resolves.toBeNull();
    expect(screen.getByRole('button', { name: 'Generate speech' })).toBeDisabled();
    view.unmount();
    expect(services.revokeObjectUrl).toHaveBeenCalledTimes(4);
  });
});

describe('managed output URL lifecycle', () => {
  it('uses the exact replacement Blob and revokes each URL once on replacement and unmount', async () => {
    const user = userEvent.setup();
    const firstBlob = new Blob(['first'], { type: 'audio/wav' });
    const secondBlob = new Blob(['second'], { type: 'audio/wav' });
    let generation = 0;
    const adapter = runtimeAdapter({
      async synthesize() {
        generation += 1;
        return {
          blob: generation === 1 ? firstBlob : secondBlob,
          mimeType: 'audio/wav',
          filename: generation === 1 ? 'first.wav' : 'second.wav',
        };
      },
    });
    const base = servicesFor(adapter);
    const services: AppServices = {
      ...base,
      createObjectUrl: vi.fn((blob) => (blob === firstBlob ? 'blob:first' : 'blob:second')),
    };
    const view = renderPlay(services);
    await screen.findByText('Runtime is ready.');
    await user.type(screen.getByRole('textbox', { name: 'Text to synthesize' }), 'Replace output.');
    await user.click(screen.getByRole('button', { name: 'Generate speech' }));
    expect(await findManagedAudio()).toHaveAttribute('src', 'blob:first');
    expect(screen.getByRole('link', { name: 'Download WAV' })).toHaveAttribute(
      'href',
      'blob:first',
    );

    await user.click(screen.getByRole('button', { name: 'Generate speech' }));
    expect(await findManagedAudio()).toHaveAttribute('src', 'blob:second');
    expect(screen.getByRole('link', { name: 'Download WAV' })).toHaveAttribute(
      'href',
      'blob:second',
    );
    expect(services.createObjectUrl).toHaveBeenNthCalledWith(1, firstBlob);
    expect(services.createObjectUrl).toHaveBeenNthCalledWith(2, secondBlob);
    expect(services.revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(services.revokeObjectUrl).toHaveBeenCalledWith('blob:first');

    view.unmount();
    expect(services.revokeObjectUrl).toHaveBeenCalledTimes(2);
    expect(services.revokeObjectUrl).toHaveBeenLastCalledWith('blob:second');
  });

  it('revokes output when runtime changes', async () => {
    const user = userEvent.setup();
    const services = servicesFor(runtimeAdapter());
    const view = renderPlay(services, 'fixture-browser:voice-b');
    await screen.findByText('Runtime is ready.');
    await user.type(screen.getByRole('textbox', { name: 'Text to synthesize' }), 'Change runtime.');
    await user.click(screen.getByRole('button', { name: 'Generate speech' }));
    await findManagedAudio();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Runtime' }), 'companion');
    await waitFor(() => expect(services.revokeObjectUrl).toHaveBeenCalledOnce());
    expect(services.revokeObjectUrl).toHaveBeenCalledWith('blob:fixture-output');
    expect(managedAudio()).toBeNull();
    view.unmount();
    expect(services.revokeObjectUrl).toHaveBeenCalledOnce();
  });

  it('clears and revokes an old output before a new operation that errors', async () => {
    const user = userEvent.setup();
    let generation = 0;
    const failure = deferred<SynthesisOutput>();
    const adapter = runtimeAdapter({
      synthesize(request) {
        generation += 1;
        if (generation === 2) return failure.promise;
        return Promise.resolve({
          blob: new Blob([request.text], { type: 'audio/wav' }),
          mimeType: 'audio/wav' as const,
          filename: 'first.wav',
        });
      },
    });
    const services = servicesFor(adapter);
    const view = renderPlay(services);
    await screen.findByText('Runtime is ready.');
    await user.type(screen.getByRole('textbox', { name: 'Text to synthesize' }), 'Error later.');
    await user.click(screen.getByRole('button', { name: 'Generate speech' }));
    await findManagedAudio();

    await user.click(screen.getByRole('button', { name: 'Generate speech' }));
    await waitFor(() => expect(services.revokeObjectUrl).toHaveBeenCalledOnce());
    expect(services.revokeObjectUrl).toHaveBeenCalledWith('blob:fixture-output');
    expect(managedAudio()).toBeNull();
    expect(services.createObjectUrl).toHaveBeenCalledOnce();
    failure.reject(new Error('Fixture synthesis failed.'));
    expect(await screen.findByRole('status', { name: 'Generation status' })).toHaveTextContent(
      'Fixture synthesis failed.',
    );
    expect(managedAudio()).toBeNull();
    expect(services.revokeObjectUrl).toHaveBeenCalledOnce();
    expect(services.createObjectUrl).toHaveBeenCalledOnce();
    view.unmount();
    expect(services.revokeObjectUrl).toHaveBeenCalledOnce();
  });

  it('clears and revokes an old output before a new operation that is cancelled', async () => {
    const user = userEvent.setup();
    let generation = 0;
    const cancel = vi.fn(async () => {});
    const adapter = runtimeAdapter({
      cancel,
      synthesize(request, context) {
        generation += 1;
        if (generation === 1) {
          return Promise.resolve({
            blob: new Blob([request.text], { type: 'audio/wav' }),
            mimeType: 'audio/wav',
            filename: 'first.wav',
          });
        }
        context.onProgress?.({ phase: 'Waiting for cancellation…', percent: 50 });
        return new Promise((_resolve, reject) => {
          context.signal?.addEventListener('abort', () =>
            reject(new DOMException('Generation cancelled', 'AbortError')),
          );
        });
      },
    });
    const services = servicesFor(adapter);
    const view = renderPlay(services);
    await screen.findByText('Runtime is ready.');
    await user.type(screen.getByRole('textbox', { name: 'Text to synthesize' }), 'Cancel later.');
    await user.click(screen.getByRole('button', { name: 'Generate speech' }));
    await findManagedAudio();

    await user.click(screen.getByRole('button', { name: 'Generate speech' }));
    expect(await screen.findByRole('status', { name: 'Generation status' })).toHaveTextContent(
      'Waiting for cancellation…',
    );
    expect(managedAudio()).toBeNull();
    expect(services.revokeObjectUrl).toHaveBeenCalledOnce();
    expect(services.revokeObjectUrl).toHaveBeenCalledWith('blob:fixture-output');
    await user.click(screen.getByRole('button', { name: 'Cancel generation' }));
    expect(await screen.findByRole('status', { name: 'Generation status' })).toHaveTextContent(
      'Generation cancelled.',
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(services.createObjectUrl).toHaveBeenCalledOnce();
    view.unmount();
    expect(services.revokeObjectUrl).toHaveBeenCalledOnce();
  });
});
