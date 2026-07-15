import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { RUNTIME_LABELS } from '../catalog/catalog';
import type { RuntimeMode } from '../catalog/filters';
import { DownloadIcon } from '../components/Icons';
import {
  MAX_SYNTHESIS_CHARACTERS,
  type RuntimeAdapter,
  type RuntimeCapability,
  type SynthesisOutput,
} from '../runtime/runtime';
import { useAppServices, useLocalState } from '../state/AppState';

type GenerationStatus =
  | 'idle'
  | 'preparing'
  | 'generating'
  | 'cancelling'
  | 'complete'
  | 'cancelled'
  | 'unavailable'
  | 'error';

type CapabilityStatus = 'checking' | 'ready' | 'unavailable' | 'error';

type InFlightOperation = {
  id: number;
  adapter: RuntimeAdapter;
  controller: AbortController;
  voiceId: string;
  mode: RuntimeMode;
  text: string;
};

export function PlayPage() {
  const services = useAppServices();
  const { snapshot, recordHistory, recordRecent } = useLocalState();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const runnableVoices = useMemo(
    () => services.catalog.voices.filter((voice) => !voice.runtimeModes.includes('sample-only')),
    [services.catalog.voices],
  );
  const requestedVoice = searchParameters.get('voice');
  const initialVoice =
    runnableVoices.find((voice) => voice.id === requestedVoice) ?? runnableVoices[0];
  const [voiceId, setVoiceId] = useState(initialVoice?.id ?? '');
  const selectedVoice = runnableVoices.find((voice) => voice.id === voiceId) ?? runnableVoices[0];
  const [mode, setMode] = useState(selectedVoice?.runtimeModes[0] ?? 'browser');
  const [text, setText] = useState('');
  const [capability, setCapability] = useState<RuntimeCapability | null>(null);
  const [capabilityStatus, setCapabilityStatus] = useState<CapabilityStatus>('checking');
  const [capabilityMessage, setCapabilityMessage] = useState('Checking runtime capability…');
  const [controls, setControls] = useState<Record<string, string | number | boolean>>({});
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('Choose a preset and enter text to begin.');
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<SynthesisOutput | null>(null);
  const operationSequence = useRef(0);
  const inFlightOperation = useRef<InFlightOperation | null>(null);

  useEffect(() => {
    if (selectedVoice === undefined) {
      return;
    }
    setCapability(null);
    setCapabilityStatus('checking');
    setCapabilityMessage('Checking runtime capability…');
    setControls({});
    const adapter = services.runtime.get(selectedVoice.engineId);
    if (adapter === null) {
      setCapability({
        available: false,
        mode,
        reason: `No runtime adapter is registered for ${selectedVoice.engineName}.`,
        controls: [],
      });
      setCapabilityStatus('unavailable');
      setCapabilityMessage(`No runtime adapter is registered for ${selectedVoice.engineName}.`);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const next = await adapter.checkCapability(selectedVoice, mode);
        if (!active) {
          return;
        }
        if (next.mode !== mode) {
          throw new Error(
            `Runtime adapter returned ${RUNTIME_LABELS[next.mode]} for a ${RUNTIME_LABELS[mode]} request.`,
          );
        }
        setCapability(next);
        setCapabilityStatus(next.available ? 'ready' : 'unavailable');
        setCapabilityMessage(
          next.available ? 'Runtime is ready.' : (next.reason ?? 'This runtime is unavailable.'),
        );
        setControls(
          next.available
            ? Object.fromEntries(next.controls.map((control) => [control.id, control.defaultValue]))
            : {},
        );
      } catch (error) {
        if (!active) {
          return;
        }
        setCapability(null);
        setCapabilityStatus('error');
        setCapabilityMessage(
          error instanceof Error ? error.message : 'Runtime capability could not be checked.',
        );
        setControls({});
      }
    })();
    return () => {
      active = false;
    };
  }, [mode, selectedVoice, services.runtime]);

  useEffect(
    () => () => {
      const operation = inFlightOperation.current;
      if (operation !== null) {
        operation.controller.abort();
        void operation.adapter.cancel();
        inFlightOperation.current = null;
      }
    },
    [],
  );

  if (selectedVoice === undefined) {
    return (
      <div className="page narrow-page">
        <h1>Make a line speak</h1>
        <p>No runnable presets are present in this catalog.</p>
      </div>
    );
  }

  const busy =
    generationStatus === 'preparing' ||
    generationStatus === 'generating' ||
    generationStatus === 'cancelling';
  const cacheStatus = snapshot.modelCache[selectedVoice.engineId] ?? 'not-cached';

  const saveHistory = (
    outcome: 'complete' | 'cancelled' | 'unavailable' | 'error',
    operation: Pick<InFlightOperation, 'voiceId' | 'text'>,
  ) => {
    const createdAt = services.now().toISOString();
    void recordHistory({
      id: `${createdAt}-${operation.voiceId}`,
      voiceId: operation.voiceId,
      text: operation.text,
      createdAt,
      outcome,
    });
  };

  const generate = async () => {
    if (inFlightOperation.current !== null) {
      return;
    }
    setOutput(null);
    setProgress(0);
    const operationVoice = selectedVoice;
    const operationMode = mode;
    const operationText = text;
    if (operationText.trim().length === 0) {
      setGenerationStatus('error');
      setStatusMessage('Enter some text before generating speech.');
      return;
    }
    const adapter = services.runtime.get(operationVoice.engineId);
    if (adapter === null) {
      const message = `No runtime adapter is registered for ${operationVoice.engineName}.`;
      setGenerationStatus('unavailable');
      setStatusMessage(message);
      saveHistory('unavailable', { voiceId: operationVoice.id, text: operationText });
      return;
    }

    const operationId = ++operationSequence.current;
    const controller = new AbortController();
    const operation: InFlightOperation = {
      id: operationId,
      adapter,
      controller,
      voiceId: operationVoice.id,
      mode: operationMode,
      text: operationText,
    };
    inFlightOperation.current = operation;
    const request = {
      voice: operationVoice,
      mode: operationMode,
      text: operationText,
      controls: { ...controls },
    };
    const isCurrent = () => inFlightOperation.current?.id === operationId;
    const context = {
      signal: controller.signal,
      onProgress: (next: { phase: string; percent: number }) => {
        if (!isCurrent() || controller.signal.aborted) {
          return;
        }
        setGenerationStatus('generating');
        setStatusMessage(next.phase);
        setProgress(Math.max(0, Math.min(100, next.percent)));
      },
    };

    try {
      setGenerationStatus('preparing');
      setStatusMessage(`Checking ${RUNTIME_LABELS[operationMode]} capability…`);
      const checked = await adapter.checkCapability(operationVoice, operationMode);
      if (!isCurrent() || controller.signal.aborted) {
        throw new DOMException('Generation cancelled', 'AbortError');
      }
      if (checked.mode !== operationMode) {
        throw new Error(
          `Runtime adapter returned ${RUNTIME_LABELS[checked.mode]} for a ${RUNTIME_LABELS[operationMode]} request.`,
        );
      }
      setCapability(checked);
      setCapabilityStatus(checked.available ? 'ready' : 'unavailable');
      setCapabilityMessage(
        checked.available
          ? 'Runtime is ready.'
          : (checked.reason ?? 'This runtime is unavailable.'),
      );
      if (!checked.available) {
        const message = checked.reason ?? 'This runtime is unavailable.';
        setGenerationStatus('unavailable');
        setStatusMessage(message);
        saveHistory('unavailable', operation);
        return;
      }

      setStatusMessage(`Preparing ${operationVoice.engineName}…`);
      await adapter.prepare(request, context);
      if (!isCurrent() || controller.signal.aborted) {
        throw new DOMException('Generation cancelled', 'AbortError');
      }
      setGenerationStatus('generating');
      setStatusMessage('Generating speech…');
      const nextOutput = await adapter.synthesize(request, context);
      if (!isCurrent() || controller.signal.aborted) {
        throw new DOMException('Generation cancelled', 'AbortError');
      }
      setOutput(nextOutput);
      setProgress(100);
      setGenerationStatus('complete');
      setStatusMessage('WAV is ready on this device.');
      void recordRecent(operationVoice.id);
      saveHistory('complete', operation);
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        setGenerationStatus('cancelled');
        setStatusMessage('Generation cancelled. No audio was saved.');
        saveHistory('cancelled', operation);
      } else {
        setGenerationStatus('error');
        setStatusMessage(error instanceof Error ? error.message : 'Generation failed.');
        saveHistory('error', operation);
      }
    } finally {
      if (isCurrent()) {
        inFlightOperation.current = null;
      }
    }
  };

  const cancel = async () => {
    const operation = inFlightOperation.current;
    if (operation === null) {
      return;
    }
    operation.controller.abort();
    setGenerationStatus('cancelling');
    setStatusMessage('Cancelling generation…');
    try {
      await operation.adapter.cancel();
    } catch (error) {
      if (inFlightOperation.current?.id === operation.id) {
        setStatusMessage(
          error instanceof Error ? error.message : 'The cancellation request failed.',
        );
      }
    }
  };

  const invalidateOutput = (message: string) => {
    if (output === null) {
      return;
    }
    setOutput(null);
    setProgress(0);
    setGenerationStatus('idle');
    setStatusMessage(message);
  };

  const download = () => {
    if (output === null) {
      return;
    }
    const url = services.createObjectUrl(output.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = output.filename;
    anchor.click();
    window.setTimeout(() => services.revokeObjectUrl(url), 0);
  };

  return (
    <div className="page page--play">
      <header className="page-intro page-intro--split">
        <div>
          <h1>Make a line speak</h1>
          <p>
            Use one preset, one explicit runtime, and controls declared by that engine. Nothing
            falls back silently.
          </p>
        </div>
        <div className="atlas-coordinate" aria-hidden="true">
          WORKBENCH / LOCAL-FIRST
        </div>
      </header>

      <div className="workbench">
        <section aria-labelledby="script-heading" className="workbench__script">
          <div className="workbench__section-heading">
            <span>01</span>
            <h2 id="script-heading">Script</h2>
          </div>
          <div className="textarea-field">
            <label htmlFor="synthesis-text">Text to synthesize</label>
            <textarea
              disabled={busy}
              id="synthesis-text"
              maxLength={MAX_SYNTHESIS_CHARACTERS}
              onChange={(event) => {
                setText(event.currentTarget.value.slice(0, MAX_SYNTHESIS_CHARACTERS));
                invalidateOutput('Script changed. Generate speech again.');
              }}
              placeholder="Write up to 2,000 characters…"
              rows={11}
              value={text}
            />
            <span className="character-count">
              {text.length.toLocaleString('en-US')} /{' '}
              {MAX_SYNTHESIS_CHARACTERS.toLocaleString('en-US')}
            </span>
          </div>
        </section>

        <section aria-labelledby="voice-heading" className="workbench__voice">
          <div className="workbench__section-heading">
            <span>02</span>
            <h2 id="voice-heading">Voice &amp; runtime</h2>
          </div>
          <label className="select-field" htmlFor="play-voice">
            <span>Voice preset</span>
            <select
              disabled={busy}
              id="play-voice"
              onChange={(event) => {
                const nextId = event.currentTarget.value;
                const nextVoice = runnableVoices.find((voice) => voice.id === nextId);
                setVoiceId(nextId);
                setMode(nextVoice?.runtimeModes[0] ?? 'browser');
                setSearchParameters({ voice: nextId }, { replace: true });
                setGenerationStatus('idle');
                setStatusMessage('Voice changed. Check the runtime, then generate speech.');
                setProgress(0);
                setOutput(null);
              }}
              value={selectedVoice.id}
            >
              {runnableVoices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name} — {voice.engineName}
                </option>
              ))}
            </select>
          </label>
          <label className="select-field" htmlFor="play-mode">
            <span>Runtime</span>
            <select
              disabled={busy}
              id="play-mode"
              onChange={(event) => {
                setMode(event.currentTarget.value as RuntimeMode);
                setGenerationStatus('idle');
                setStatusMessage('Runtime changed. Capability is being checked.');
                setProgress(0);
                setOutput(null);
              }}
              value={mode}
            >
              {selectedVoice.runtimeModes.map((runtimeMode) => (
                <option key={runtimeMode} value={runtimeMode}>
                  {RUNTIME_LABELS[runtimeMode]}
                </option>
              ))}
            </select>
          </label>

          <div className="capability-note">
            <strong>{RUNTIME_LABELS[mode as keyof typeof RUNTIME_LABELS]}</strong>
            <p>{capabilityMessage}</p>
            <span>Model cache: {cacheStatus.replace('-', ' ')}</span>
          </div>

          <div className="engine-controls">
            <h3>Engine controls</h3>
            {capabilityStatus === 'ready' &&
            capability !== null &&
            capability.controls.length > 0 ? (
              capability.controls.map((control) =>
                control.type === 'range' ? (
                  <label className="range-field" htmlFor={`control-${control.id}`} key={control.id}>
                    <span>{control.label}</span>
                    <input
                      id={`control-${control.id}`}
                      disabled={busy}
                      max={control.max}
                      min={control.min}
                      onChange={(event) => {
                        invalidateOutput('Engine controls changed. Generate speech again.');
                        setControls((current) => ({
                          ...current,
                          [control.id]: event.currentTarget.valueAsNumber,
                        }));
                      }}
                      step={control.step}
                      type="range"
                      value={Number(controls[control.id] ?? control.defaultValue)}
                    />
                  </label>
                ) : (
                  <label
                    className="select-field"
                    htmlFor={`control-${control.id}`}
                    key={control.id}
                  >
                    <span>{control.label}</span>
                    <select
                      disabled={busy}
                      id={`control-${control.id}`}
                      onChange={(event) => {
                        invalidateOutput('Engine controls changed. Generate speech again.');
                        setControls((current) => ({
                          ...current,
                          [control.id]: event.currentTarget.value,
                        }));
                      }}
                      value={String(controls[control.id] ?? control.defaultValue)}
                    >
                      {control.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              )
            ) : (
              <p>No engine controls are exposed while this runtime is unavailable.</p>
            )}
          </div>
        </section>

        <section aria-labelledby="output-heading" className="workbench__output">
          <div className="workbench__section-heading">
            <span>03</span>
            <h2 id="output-heading">Output</h2>
          </div>
          <p
            aria-live="polite"
            className={`generation-status generation-status--${generationStatus}`}
            role="status"
          >
            {statusMessage}
          </p>
          <label className="progress-label" htmlFor="generation-progress">
            <span>Progress</span>
            <progress id="generation-progress" max="100" value={progress} />
            <span>{progress}%</span>
          </label>
          <div className="workbench__actions">
            <button
              className="button button--primary"
              disabled={busy || capabilityStatus === 'checking' || capabilityStatus === 'error'}
              onClick={() => void generate()}
              type="button"
            >
              Generate speech
            </button>
            <button
              className="button button--secondary"
              disabled={!busy || generationStatus === 'cancelling'}
              onClick={() => void cancel()}
              type="button"
            >
              Cancel generation
            </button>
            <button
              className="button button--quiet"
              disabled={output === null}
              onClick={download}
              type="button"
            >
              <DownloadIcon /> Download WAV
            </button>
          </div>
          <p className="capability-disclosure">
            Audio is created only when the selected adapter reports available. This shell never
            invents audio or substitutes another runtime.
          </p>
        </section>
      </div>

      <section aria-labelledby="local-history-heading" className="local-history">
        <div className="section-heading">
          <h2 id="local-history-heading">Local history</h2>
          <span>
            {snapshot.storage === 'indexeddb'
              ? 'Saved in this browser'
              : 'Memory fallback for this session'}
          </span>
        </div>
        {snapshot.history.length === 0 ? (
          <p className="quiet-empty">
            Generation attempts will appear here without uploading text or audio.
          </p>
        ) : (
          <ol>
            {snapshot.history.slice(0, 8).map((entry) => {
              const historyVoice = services.catalog.voices.find(
                (voice) => voice.id === entry.voiceId,
              );
              return (
                <li key={entry.id}>
                  <strong>{historyVoice?.name ?? entry.voiceId}</strong>
                  <span>{entry.outcome}</span>
                  <time dateTime={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleString()}
                  </time>
                  <p>{entry.text}</p>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
