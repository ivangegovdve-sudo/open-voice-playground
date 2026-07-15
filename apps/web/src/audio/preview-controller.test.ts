import { describe, expect, it } from 'vitest';

import { PreviewController, type AudioPort, type PreviewTrack } from './preview-controller';

class FakeAudio implements AudioPort {
  currentTime = 0;
  duration = 12;
  paused = true;
  readonly listeners = new Map<string, Set<EventListener>>();

  constructor(
    readonly src: string,
    private readonly playError: Error | null = null,
  ) {}

  async play(): Promise<void> {
    if (this.playError !== null) {
      throw this.playError;
    }
    this.paused = false;
    this.emit('play');
  }

  pause(): void {
    this.paused = true;
    this.emit('pause');
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new Event(type));
    }
  }
}

class DeferredAudio extends FakeAudio {
  private readonly playResult: Promise<void>;
  private resolvePlay!: () => void;
  private rejectPlay!: (error: Error) => void;

  constructor(src: string, duration = 12) {
    super(src);
    this.duration = duration;
    this.playResult = new Promise<void>((resolve, reject) => {
      this.resolvePlay = resolve;
      this.rejectPlay = reject;
    }).then(() => {
      this.paused = false;
      this.emit('play');
    });
  }

  override play(): Promise<void> {
    return this.playResult;
  }

  resolve(): void {
    this.resolvePlay();
  }

  reject(error = new Error('decode failed')): void {
    this.rejectPlay(error);
  }
}

class DeferredResumeAudio extends FakeAudio {
  private playCount = 0;
  private readonly resumeResult: Promise<void>;
  private resolveResume!: () => void;
  private rejectResume!: (error: Error) => void;

  constructor(src: string) {
    super(src);
    this.resumeResult = new Promise<void>((resolve, reject) => {
      this.resolveResume = resolve;
      this.rejectResume = reject;
    }).then(() => {
      this.paused = false;
      this.emit('play');
    });
  }

  override play(): Promise<void> {
    this.playCount += 1;
    return this.playCount === 1 ? super.play() : this.resumeResult;
  }

  resolve(): void {
    this.resolveResume();
  }

  reject(error = new Error('decode failed')): void {
    this.rejectResume(error);
  }
}

const firstTrack: PreviewTrack = {
  id: 'sample-a',
  title: 'Sample A',
  audioUrl: '/sample-a.wav',
  transcript: 'First sample transcript.',
  sourceId: 'source-a',
  licenseId: 'license-a',
};

const secondTrack: PreviewTrack = {
  ...firstTrack,
  id: 'sample-b',
  title: 'Sample B',
  audioUrl: '/b.wav',
};

describe('preview controller', () => {
  it('stops the prior audio before starting another preview', async () => {
    const created: FakeAudio[] = [];
    const controller = new PreviewController((url) => {
      const audio = new FakeAudio(url);
      created.push(audio);
      return audio;
    });

    await controller.play(firstTrack);
    await controller.play(secondTrack);

    expect(created[0]?.paused).toBe(true);
    expect(created[1]?.paused).toBe(false);
    expect(controller.getState()).toMatchObject({ status: 'playing', track: secondTrack });
  });

  it('surfaces playback failures instead of pretending the sample played', async () => {
    const controller = new PreviewController(
      (url) => new FakeAudio(url, new Error('decode failed')),
    );

    await controller.play(firstTrack);

    expect(controller.getState()).toMatchObject({
      status: 'error',
      error: 'This official sample could not be played.',
    });
  });

  it('supports pause, resume, seek, and ended state for an accessible mini-player', async () => {
    const audio = new FakeAudio(firstTrack.audioUrl);
    const controller = new PreviewController(() => audio);
    await controller.play(firstTrack);

    controller.pause();
    controller.seek(6);
    await controller.resume();
    audio.emit('ended');

    expect(audio.currentTime).toBe(6);
    expect(controller.getState().status).toBe('ended');
  });

  it('ignores an earlier play resolution while the newer preview is still loading', async () => {
    const firstAudio = new DeferredAudio(firstTrack.audioUrl, 5);
    const secondAudio = new DeferredAudio(secondTrack.audioUrl, 19);
    const controller = new PreviewController((url) =>
      url === firstTrack.audioUrl ? firstAudio : secondAudio,
    );

    const firstPlay = controller.play(firstTrack);
    const secondPlay = controller.play(secondTrack);
    firstAudio.resolve();
    await firstPlay;

    expect(controller.getState()).toMatchObject({
      status: 'loading',
      track: secondTrack,
      duration: 0,
      error: null,
    });

    secondAudio.resolve();
    await secondPlay;
    expect(controller.getState()).toMatchObject({
      status: 'playing',
      track: secondTrack,
      duration: 19,
    });
  });

  it('ignores an earlier play rejection after a newer preview starts', async () => {
    const firstAudio = new DeferredAudio(firstTrack.audioUrl);
    const secondAudio = new DeferredAudio(secondTrack.audioUrl);
    const controller = new PreviewController((url) =>
      url === firstTrack.audioUrl ? firstAudio : secondAudio,
    );

    const firstPlay = controller.play(firstTrack);
    const secondPlay = controller.play(secondTrack);
    firstAudio.reject();
    await firstPlay;

    expect(controller.getState()).toMatchObject({
      status: 'loading',
      track: secondTrack,
      error: null,
    });

    secondAudio.resolve();
    await secondPlay;
  });

  it('stays idle when a pending play resolves after stop', async () => {
    const audio = new DeferredAudio(firstTrack.audioUrl);
    const controller = new PreviewController(() => audio);

    const pendingPlay = controller.play(firstTrack);
    controller.stop();
    audio.resolve();
    await pendingPlay;

    expect(controller.getState()).toEqual({
      status: 'idle',
      track: null,
      currentTime: 0,
      duration: 0,
      error: null,
    });
  });

  it('stays idle when a pending play rejects after stop', async () => {
    const audio = new DeferredAudio(firstTrack.audioUrl);
    const controller = new PreviewController(() => audio);

    const pendingPlay = controller.play(firstTrack);
    controller.stop();
    audio.reject();
    await pendingPlay;

    expect(controller.getState()).toEqual({
      status: 'idle',
      track: null,
      currentTime: 0,
      duration: 0,
      error: null,
    });
  });

  it('stays intentionally paused when a pending play resolves after pause', async () => {
    const audio = new DeferredAudio(firstTrack.audioUrl);
    const controller = new PreviewController(() => audio);

    const pendingPlay = controller.play(firstTrack);
    controller.pause();
    audio.resolve();
    await pendingPlay;

    expect(audio.paused).toBe(true);
    expect(controller.getState()).toMatchObject({
      status: 'paused',
      track: firstTrack,
      error: null,
    });
  });

  it('stays intentionally paused when a pending play rejects after pause', async () => {
    const audio = new DeferredAudio(firstTrack.audioUrl);
    const controller = new PreviewController(() => audio);

    const pendingPlay = controller.play(firstTrack);
    controller.pause();
    audio.reject();
    await pendingPlay;

    expect(audio.paused).toBe(true);
    expect(controller.getState()).toMatchObject({
      status: 'paused',
      track: firstTrack,
      error: null,
    });
  });

  it('ignores a pending resume resolution after a newer preview starts', async () => {
    const firstAudio = new DeferredResumeAudio(firstTrack.audioUrl);
    const secondAudio = new DeferredAudio(secondTrack.audioUrl);
    const controller = new PreviewController((url) =>
      url === firstTrack.audioUrl ? firstAudio : secondAudio,
    );
    await controller.play(firstTrack);
    controller.pause();

    const pendingResume = controller.resume();
    const secondPlay = controller.play(secondTrack);
    firstAudio.resolve();
    await pendingResume;

    expect(controller.getState()).toMatchObject({
      status: 'loading',
      track: secondTrack,
      error: null,
    });

    secondAudio.resolve();
    await secondPlay;
  });

  it('stays idle when a pending resume rejects after stop', async () => {
    const audio = new DeferredResumeAudio(firstTrack.audioUrl);
    const controller = new PreviewController(() => audio);
    await controller.play(firstTrack);
    controller.pause();

    const pendingResume = controller.resume();
    controller.stop();
    audio.reject();
    await pendingResume;

    expect(controller.getState()).toEqual({
      status: 'idle',
      track: null,
      currentTime: 0,
      duration: 0,
      error: null,
    });
  });

  it('stays intentionally paused when a pending resume resolves after pause', async () => {
    const audio = new DeferredResumeAudio(firstTrack.audioUrl);
    const controller = new PreviewController(() => audio);
    await controller.play(firstTrack);
    controller.pause();

    const pendingResume = controller.resume();
    controller.pause();
    audio.resolve();
    await pendingResume;

    expect(audio.paused).toBe(true);
    expect(controller.getState()).toMatchObject({
      status: 'paused',
      track: firstTrack,
      error: null,
    });
  });

  it('stays intentionally paused when a pending resume rejects after pause', async () => {
    const audio = new DeferredResumeAudio(firstTrack.audioUrl);
    const controller = new PreviewController(() => audio);
    await controller.play(firstTrack);
    controller.pause();

    const pendingResume = controller.resume();
    controller.pause();
    audio.reject();
    await pendingResume;

    expect(audio.paused).toBe(true);
    expect(controller.getState()).toMatchObject({
      status: 'paused',
      track: firstTrack,
      error: null,
    });
  });
});
