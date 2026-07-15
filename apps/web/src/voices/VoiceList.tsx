import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react';
import { Link } from 'react-router-dom';

import { RUNTIME_LABELS } from '../catalog/catalog';
import type { CatalogVoice } from '../catalog/filters';
import { calculateVariableVirtualRange } from '../catalog/virtual-range';
import { ArrowIcon, PlayIcon, StarIcon } from '../components/Icons';
import { useAppServices, useLocalState } from '../state/AppState';

const VIRTUALIZATION_THRESHOLD = 30;
const ESTIMATED_ROW_HEIGHT = 280;
const ESTIMATED_SAMPLE_ROW_HEIGHT = 440;

function estimatedHeight(voice: CatalogVoice): number {
  return voice.sample === null ? ESTIMATED_ROW_HEIGHT : ESTIMATED_SAMPLE_ROW_HEIGHT;
}

function VoiceRow({ voice }: { voice: CatalogVoice }) {
  const { preview } = useAppServices();
  const { snapshot, toggleFavorite, recordRecent } = useLocalState();
  const favorite = snapshot.favorites.includes(voice.id);
  const cacheStatus = snapshot.modelCache[voice.engineId] ?? 'not-cached';
  const runnable = !voice.runtimeModes.includes('sample-only');

  return (
    <article className="voice-row">
      <div className="voice-row__coordinate" aria-hidden="true">
        {voice.locale}
      </div>
      <div className="voice-row__main">
        <div className="voice-row__heading">
          <div>
            <h2>{voice.name}</h2>
            <Link className="subtle-link" to={`/engines/${voice.engineId}`}>
              {voice.engineName}
            </Link>
          </div>
          <button
            aria-label={
              favorite ? `Remove ${voice.name} from favorites` : `Add ${voice.name} to favorites`
            }
            className="icon-button favorite-button"
            onClick={() => void toggleFavorite(voice.id)}
            type="button"
          >
            <StarIcon fill={favorite ? 'currentColor' : 'none'} />
          </button>
        </div>
        <div className="voice-row__meta">
          <span>{voice.language}</span>
          <span>{voice.locale}</span>
          <span>Gender: {voice.gender}</span>
          {voice.styles.length > 0 ? <span>Style: {voice.styles.join(', ')}</span> : null}
        </div>
        <div className="runtime-list" aria-label="Runtime availability">
          {voice.runtimeModes.map((mode) => (
            <span className={`runtime-label runtime-label--${mode}`} key={mode}>
              {RUNTIME_LABELS[mode]}
            </span>
          ))}
        </div>

        {voice.sample === null ? (
          <p className="voice-row__notice">
            No verified preview is attached to this fixture preset.
          </p>
        ) : (
          <div className="sample-disclosure">
            <blockquote>{voice.sample.transcript}</blockquote>
            <p>
              License:{' '}
              <Link to={`/about/sources#${voice.sample.licenseId}`}>{voice.sample.licenseId}</Link>
              {' · '}Source:{' '}
              <Link to={`/about/sources#${voice.sample.sourceId}`}>{voice.sample.sourceId}</Link>
            </p>
            <div className="inline-actions">
              <button
                className="button button--primary"
                onClick={() => {
                  void recordRecent(voice.id);
                  void preview.play({
                    id: voice.sample!.id,
                    title: voice.name,
                    audioUrl: voice.sample!.audioUrl,
                    transcript: voice.sample!.transcript,
                    sourceId: voice.sample!.sourceId,
                    licenseId: voice.sample!.licenseId,
                  });
                }}
                type="button"
              >
                <PlayIcon />
                Play official sample
              </button>
              <a
                className="button button--secondary"
                href={voice.sample.officialPageUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open official demo
                <ArrowIcon />
              </a>
            </div>
          </div>
        )}
      </div>
      <div className="voice-row__actions">
        {runnable ? (
          <>
            <Link
              className="button button--primary"
              to={`/play?voice=${encodeURIComponent(voice.id)}`}
            >
              Use voice <ArrowIcon />
            </Link>
            <Link
              className="button button--quiet"
              to={`/compare?voice=${encodeURIComponent(voice.id)}`}
            >
              Add to compare
            </Link>
          </>
        ) : (
          <span className="sample-only-note">Listening only</span>
        )}
        {voice.runtimeModes.includes('browser') ? (
          <span className="cache-status">Model cache: {cacheStatus.replace('-', ' ')}</span>
        ) : null}
      </div>
    </article>
  );
}

function MeasuredVoiceItem({
  index,
  onMeasure,
  total,
  voice,
}: {
  index: number;
  onMeasure(voiceId: string, height: number): void;
  total: number;
  voice: CatalogVoice;
}) {
  const itemRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const item = itemRef.current;
    if (item === null) {
      return;
    }
    const measure = () => {
      const height = item.getBoundingClientRect().height;
      if (height > 0) {
        onMeasure(voice.id, height);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(item);
    return () => observer.disconnect();
  }, [onMeasure, voice.id]);

  return (
    <li
      aria-posinset={index + 1}
      aria-setsize={total}
      ref={itemRef}
      style={{ minHeight: estimatedHeight(voice) }}
    >
      <VoiceRow voice={voice} />
    </li>
  );
}

export function VoiceList({ voices }: { voices: CatalogVoice[] }) {
  const shouldVirtualize = voices.length > VIRTUALIZATION_THRESHOLD;
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(720);
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});

  const recordMeasuredHeight = useCallback((voiceId: string, height: number) => {
    setMeasuredHeights((current) =>
      Math.abs((current[voiceId] ?? 0) - height) < 1 ? current : { ...current, [voiceId]: height },
    );
  }, []);

  useEffect(() => {
    if (
      !shouldVirtualize ||
      viewportRef.current === null ||
      typeof ResizeObserver === 'undefined'
    ) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [shouldVirtualize]);

  if (voices.length === 0) {
    return (
      <div className="empty-state">
        <h2>No coordinates match</h2>
        <p>Clear one filter or broaden the search text.</p>
      </div>
    );
  }

  if (!shouldVirtualize) {
    return (
      <ol className="voice-list">
        {voices.map((voice) => (
          <li key={voice.id}>
            <VoiceRow voice={voice} />
          </li>
        ))}
      </ol>
    );
  }

  const rowHeights = voices.map((voice) => measuredHeights[voice.id] ?? estimatedHeight(voice));
  const range = calculateVariableVirtualRange({
    rowHeights,
    estimatedRowHeight: ESTIMATED_ROW_HEIGHT,
    scrollTop,
    viewportHeight,
    overscan: 4,
  });
  const visible = voices.slice(range.start, range.end);
  const handleScroll = (event: UIEvent<HTMLDivElement>) =>
    setScrollTop(event.currentTarget.scrollTop);

  return (
    <div
      aria-label="Virtualized voice results"
      className="voice-list-viewport"
      onScroll={handleScroll}
      ref={viewportRef}
      tabIndex={0}
    >
      <div className="voice-list-spacer" style={{ height: range.totalHeight }}>
        <ol
          className="voice-list voice-list--virtual"
          style={{ transform: `translateY(${range.offset}px)` }}
        >
          {visible.map((voice, visibleIndex) => (
            <MeasuredVoiceItem
              index={range.start + visibleIndex}
              key={voice.id}
              onMeasure={recordMeasuredHeight}
              total={voices.length}
              voice={voice}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}
