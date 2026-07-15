export type AudioPort = {
  readonly src: string;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

export type PreviewTrack = {
  id: string;
  title: string;
  audioUrl: string;
  transcript: string;
  sourceId: string;
  licenseId: string;
};

export type PreviewStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type PreviewState = {
  status: PreviewStatus;
  track: PreviewTrack | null;
  currentTime: number;
  duration: number;
  error: string | null;
};

export class PreviewController {
  private state: PreviewState = {
    status: 'idle',
    track: null,
    currentTime: 0,
    duration: 0,
    error: null,
  };

  private audio: AudioPort | null = null;
  private playVersion = 0;
  private readonly listeners = new Set<() => void>();

  private readonly handlePlay: EventListener = () => {
    this.update({ status: 'playing', error: null });
  };

  private readonly handlePause: EventListener = () => {
    if (this.state.status === 'playing') {
      this.update({ status: 'paused' });
    }
  };

  private readonly handleEnded: EventListener = () => {
    this.update({
      status: 'ended',
      currentTime: this.audio?.currentTime ?? this.state.currentTime,
    });
  };

  private readonly handleTimeUpdate: EventListener = () => {
    if (this.audio !== null) {
      this.update({
        currentTime: Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0,
        duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
      });
    }
  };

  private readonly handleError: EventListener = () => {
    this.update({ status: 'error', error: 'This official sample could not be played.' });
  };

  constructor(private readonly createAudio: (url: string) => AudioPort) {}

  getState(): PreviewState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async play(track: PreviewTrack): Promise<void> {
    const playVersion = ++this.playVersion;
    this.releaseAudio();
    this.state = {
      status: 'loading',
      track,
      currentTime: 0,
      duration: 0,
      error: null,
    };
    this.emit();

    const audio = this.createAudio(track.audioUrl);
    this.audio = audio;
    this.addAudioListeners(audio);
    try {
      await audio.play();
      if (!this.isCurrentPlay(audio, playVersion)) {
        return;
      }
      this.update({
        status: 'playing',
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      });
    } catch {
      if (!this.isCurrentPlay(audio, playVersion)) {
        return;
      }
      this.update({ status: 'error', error: 'This official sample could not be played.' });
    }
  }

  pause(): void {
    this.audio?.pause();
    if (this.audio !== null) {
      this.update({ status: 'paused' });
    }
  }

  async resume(): Promise<void> {
    if (this.audio === null) {
      return;
    }
    const audio = this.audio;
    const playVersion = this.playVersion;
    try {
      await audio.play();
      if (!this.isCurrentPlay(audio, playVersion)) {
        return;
      }
      this.update({ status: 'playing', error: null });
    } catch {
      if (!this.isCurrentPlay(audio, playVersion)) {
        return;
      }
      this.update({ status: 'error', error: 'This official sample could not be played.' });
    }
  }

  seek(time: number): void {
    if (this.audio === null || !Number.isFinite(time)) {
      return;
    }
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : time;
    const nextTime = Math.max(0, Math.min(time, duration));
    this.audio.currentTime = nextTime;
    this.update({ currentTime: nextTime });
  }

  stop(): void {
    this.playVersion += 1;
    this.releaseAudio();
    this.state = {
      status: 'idle',
      track: null,
      currentTime: 0,
      duration: 0,
      error: null,
    };
    this.emit();
  }

  private isCurrentPlay(audio: AudioPort, playVersion: number): boolean {
    return this.audio === audio && this.playVersion === playVersion;
  }

  private update(patch: Partial<PreviewState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private addAudioListeners(audio: AudioPort): void {
    audio.addEventListener('play', this.handlePlay);
    audio.addEventListener('pause', this.handlePause);
    audio.addEventListener('ended', this.handleEnded);
    audio.addEventListener('timeupdate', this.handleTimeUpdate);
    audio.addEventListener('loadedmetadata', this.handleTimeUpdate);
    audio.addEventListener('error', this.handleError);
  }

  private releaseAudio(): void {
    if (this.audio === null) {
      return;
    }
    const audio = this.audio;
    audio.removeEventListener('play', this.handlePlay);
    audio.removeEventListener('pause', this.handlePause);
    audio.removeEventListener('ended', this.handleEnded);
    audio.removeEventListener('timeupdate', this.handleTimeUpdate);
    audio.removeEventListener('loadedmetadata', this.handleTimeUpdate);
    audio.removeEventListener('error', this.handleError);
    audio.pause();
    this.audio = null;
  }
}
