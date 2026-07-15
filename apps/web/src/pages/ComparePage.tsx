import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { RUNTIME_LABELS } from '../catalog/catalog';
import type { CatalogVoice, RuntimeMode } from '../catalog/filters';
import { DownloadIcon } from '../components/Icons';
import {
  MAX_SYNTHESIS_CHARACTERS,
  runSequentialComparison,
  type ComparisonResult,
} from '../runtime/runtime';
import { useAppServices, useLocalState } from '../state/AppState';

const SLOT_LABELS = ['A', 'B', 'C'] as const;

function defaultComparisonMode(voice: CatalogVoice): RuntimeMode {
  return voice.runtimeModes.find((mode) => mode !== 'sample-only') ?? 'browser';
}

export function ComparePage() {
  const services = useAppServices();
  const { recordHistory } = useLocalState();
  const [searchParameters] = useSearchParams();
  const runnableVoices = useMemo(
    () => services.catalog.voices.filter((voice) => !voice.runtimeModes.includes('sample-only')),
    [services.catalog.voices],
  );
  const initialVoice = searchParameters.get('voice');
  const [selectedIds, setSelectedIds] = useState<string[]>(
    initialVoice !== null && runnableVoices.some((voice) => voice.id === initialVoice)
      ? [initialVoice]
      : [],
  );
  const [modesByVoiceId, setModesByVoiceId] = useState<Record<string, RuntimeMode>>(() =>
    Object.fromEntries(runnableVoices.map((voice) => [voice.id, defaultComparisonMode(voice)])),
  );
  const [text, setText] = useState('The cartographer marked the quiet inlet at dawn.');
  const [status, setStatus] = useState(
    'Choose up to three presets. They will run one after another.',
  );
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ComparisonResult[]>([]);

  const toggleVoice = (id: string) => {
    if (running) {
      return;
    }
    setResults([]);
    setStatus('Queue changed. Run the comparison again.');
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id].slice(0, 3),
    );
  };

  const compare = async () => {
    if (selectedIds.length === 0) {
      setStatus('Choose at least one preset.');
      return;
    }
    if (text.trim().length === 0) {
      setStatus('Enter comparison text.');
      return;
    }
    const selected = selectedIds
      .map((id) => runnableVoices.find((voice) => voice.id === id))
      .filter((voice) => voice !== undefined)
      .map((voice) => ({
        voice,
        mode: modesByVoiceId[voice.id] ?? defaultComparisonMode(voice),
      }));
    setRunning(true);
    setResults([]);
    setStatus(`Running ${selected.length} preset${selected.length === 1 ? '' : 's'} sequentially…`);
    try {
      const next = await runSequentialComparison(selected, text, services.runtime);
      setResults(next);
      setStatus('Comparison finished. Unavailable runtimes stayed unavailable.');
      for (const result of next) {
        void recordHistory({
          id: `${services.now().toISOString()}-${result.key}`,
          voiceId: result.voiceId,
          text,
          createdAt: services.now().toISOString(),
          outcome:
            result.status === 'complete'
              ? 'complete'
              : result.status === 'cancelled'
                ? 'cancelled'
                : result.status === 'error'
                  ? 'error'
                  : 'unavailable',
        });
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Comparison failed.');
    } finally {
      setRunning(false);
    }
  };

  const download = (result: ComparisonResult) => {
    if (result.output === null) {
      return;
    }
    const url = services.createObjectUrl(result.output.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.output.filename;
    anchor.click();
    window.setTimeout(() => services.revokeObjectUrl(url), 0);
  };

  return (
    <div className="page page--compare">
      <header className="page-intro page-intro--split">
        <div>
          <h1>Compare the same words</h1>
          <p>
            Queue A, B, and C with identical text. Each adapter finishes before the next begins.
          </p>
        </div>
        <div className="atlas-coordinate" aria-hidden="true">
          A / B / C · SEQUENTIAL
        </div>
      </header>

      <div className="compare-layout">
        <section aria-labelledby="compare-text-heading" className="compare-script">
          <h2 id="compare-text-heading">Shared script</h2>
          <div className="textarea-field">
            <label htmlFor="comparison-text">Text for every preset</label>
            <textarea
              disabled={running}
              id="comparison-text"
              maxLength={MAX_SYNTHESIS_CHARACTERS}
              onChange={(event) => {
                setText(event.currentTarget.value.slice(0, MAX_SYNTHESIS_CHARACTERS));
                setResults([]);
                setStatus('Script changed. Run the comparison again.');
              }}
              rows={7}
              value={text}
            />
            <span className="character-count">
              {text.length.toLocaleString('en-US')} /{' '}
              {MAX_SYNTHESIS_CHARACTERS.toLocaleString('en-US')}
            </span>
          </div>
          <p className="sample-exclusion">
            Sample-only presets stay in the listening atlas and cannot enter generation comparison.
          </p>
        </section>

        <section aria-labelledby="compare-voices-heading" className="compare-picker">
          <div className="section-heading">
            <h2 id="compare-voices-heading">Preset queue</h2>
            <span>{selectedIds.length} / 3 selected</span>
          </div>
          <ul className="compare-choice-list">
            {runnableVoices.map((voice) => {
              const selected = selectedIds.includes(voice.id);
              const selectedMode = modesByVoiceId[voice.id] ?? defaultComparisonMode(voice);
              return (
                <li key={voice.id}>
                  <label>
                    <input
                      aria-label={`Compare ${voice.name}`}
                      checked={selected}
                      disabled={running || (!selected && selectedIds.length >= 3)}
                      onChange={() => toggleVoice(voice.id)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{voice.name}</strong>
                      <small>
                        {voice.engineName} ·{' '}
                        {voice.runtimeModes.map((mode) => RUNTIME_LABELS[mode]).join(' / ')}
                      </small>
                    </span>
                  </label>
                  {voice.runtimeModes.length > 1 ? (
                    <label className="compare-mode-choice">
                      <span>Runtime for {voice.name}</span>
                      <select
                        aria-label={`Runtime for ${voice.name}`}
                        disabled={running}
                        onChange={(event) => {
                          const nextMode = event.currentTarget.value as RuntimeMode;
                          setModesByVoiceId((current) => ({
                            ...current,
                            [voice.id]: nextMode,
                          }));
                          setResults([]);
                          setStatus('Runtime changed. Run the comparison again.');
                        }}
                        value={selectedMode}
                      >
                        {voice.runtimeModes.map((mode) => (
                          <option key={mode} value={mode}>
                            {RUNTIME_LABELS[mode]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section aria-labelledby="comparison-run-heading" className="comparison-run">
        <div className="comparison-slots" aria-label="Comparison slots">
          {SLOT_LABELS.map((label, index) => {
            const voice = runnableVoices.find((candidate) => candidate.id === selectedIds[index]);
            const selectedMode =
              voice === undefined
                ? undefined
                : (modesByVoiceId[voice.id] ?? defaultComparisonMode(voice));
            const result =
              voice === undefined || selectedMode === undefined
                ? undefined
                : results.find((item) => item.voiceId === voice.id && item.mode === selectedMode);
            return (
              <div className="comparison-slot" key={label}>
                <span>{label}</span>
                <strong>{voice?.name ?? 'Open slot'}</strong>
                {selectedMode === undefined ? null : <em>{RUNTIME_LABELS[selectedMode]}</em>}
                <small>
                  {result?.status ?? (voice === undefined ? 'Choose a preset' : 'Ready')}
                </small>
                {result?.message !== null && result?.message !== undefined ? (
                  <p>{result.message}</p>
                ) : null}
                <button
                  className="button button--quiet"
                  disabled={result?.output === null || result?.output === undefined}
                  onClick={() => result !== undefined && download(result)}
                  type="button"
                >
                  <DownloadIcon /> WAV
                </button>
              </div>
            );
          })}
        </div>
        <div className="comparison-command">
          <div>
            <h2 id="comparison-run-heading">Sequential run</h2>
            <p aria-live="polite" role="status">
              {status}
            </p>
          </div>
          <button
            className="button button--primary button--large"
            disabled={running}
            onClick={() => void compare()}
            type="button"
          >
            {running ? 'Running…' : 'Run comparison'}
          </button>
        </div>
      </section>
    </div>
  );
}
