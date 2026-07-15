import { useCallback, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';

import { CloseIcon, PauseIcon, PlayIcon } from '../components/Icons';
import { useAppServices } from '../state/AppState';

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '0:00';
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function MiniPlayer() {
  const { preview } = useAppServices();
  const subscribe = useCallback((listener: () => void) => preview.subscribe(listener), [preview]);
  const getSnapshot = useCallback(() => preview.getState(), [preview]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (state.track === null) {
    return null;
  }

  const isPlaying = state.status === 'playing' || state.status === 'loading';
  const duration = state.duration > 0 ? state.duration : 1;

  return (
    <aside aria-label="Audio player" className="mini-player">
      <div className="mini-player__identity">
        <span className="mini-player__signal" aria-hidden="true" />
        <div>
          <strong>{state.track.title}</strong>
          <span>{state.status === 'error' ? state.error : 'Official sample'}</span>
        </div>
      </div>
      <button
        aria-label={isPlaying ? 'Pause sample' : 'Resume sample'}
        className="icon-button"
        onClick={() => {
          if (isPlaying) {
            preview.pause();
          } else {
            void preview.resume();
          }
        }}
        type="button"
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="mini-player__timeline">
        <label className="sr-only" htmlFor="preview-progress">
          Sample position
        </label>
        <input
          id="preview-progress"
          max={duration}
          min="0"
          onChange={(event) => preview.seek(event.currentTarget.valueAsNumber)}
          step="0.1"
          type="range"
          value={Math.min(state.currentTime, duration)}
        />
        <span>
          {formatTime(state.currentTime)} / {formatTime(state.duration)}
        </span>
      </div>
      <details className="mini-player__details">
        <summary aria-label="Preview details: transcript, source, and license">Details</summary>
        <div className="mini-player__details-panel">
          <p>{state.track.transcript}</p>
          <p>
            <Link to={`/about/sources#${state.track.sourceId}`}>{state.track.sourceId}</Link>
            {' · '}
            <Link to={`/about/sources#${state.track.licenseId}`}>{state.track.licenseId}</Link>
          </p>
        </div>
      </details>
      <button
        aria-label="Close audio player"
        className="icon-button"
        onClick={() => preview.stop()}
        type="button"
      >
        <CloseIcon />
      </button>
    </aside>
  );
}
