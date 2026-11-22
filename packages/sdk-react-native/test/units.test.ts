import { IdleTracker, type MediaReporter, type MediaSnapshot } from '@dpad-tv/sdk';
import { describe, expect, it } from 'vitest';
import { FocusTracker } from '../src/focus.js';
import { instrumentInteractionManager } from '../src/idle.js';
import { videoMediaProps } from '../src/media.js';
import * as noop from '../src/noop.js';
import { payloadFromInitialProps } from '../src/payload.js';

function fakeReporter(): MediaReporter & { history: string[] } {
  let snapshot: MediaSnapshot = { state: 'idle', position: 0, duration: null, rate: 1 };
  const history: string[] = [];
  return {
    history,
    update(patch) {
      snapshot = { ...snapshot, ...patch };
      if (history[history.length - 1] !== snapshot.state) history.push(snapshot.state);
    },
    get snapshot() {
      return snapshot;
    },
    dispose() {},
  };
}

describe('videoMediaProps', () => {
  it('maps react-native-video events to media states', () => {
    const r = fakeReporter();
    const p = videoMediaProps(r);
    p.onLoadStart();
    p.onLoad({ duration: 120, currentTime: 0 });
    p.onPlaybackStateChanged({ isPlaying: true });
    p.onBuffer({ isBuffering: true });
    p.onPlaybackStateChanged({ isPlaying: false }); // reported while buffering
    p.onBuffer({ isBuffering: false });
    p.onPlaybackStateChanged({ isPlaying: true });
    p.onPlaybackRateChange({ playbackRate: 2 });
    p.onSeek({ currentTime: 30 });
    p.onEnd();
    p.onPlaybackStateChanged({ isPlaying: false });
    expect(r.history).toEqual([
      'loading',
      'paused',
      'playing',
      'buffering',
      'paused',
      'playing',
      'ended',
    ]);
    expect(r.snapshot).toMatchObject({ position: 30, duration: 120, rate: 2 });
  });

  it('reports errors and clears them on the next load', () => {
    const r = fakeReporter();
    const p = videoMediaProps(() => r);
    p.onError({ error: { errorString: 'HTTP 404' } });
    expect(r.snapshot).toMatchObject({ state: 'error', error: 'HTTP 404' });
    p.onLoadStart();
    expect(r.snapshot.error).toBeUndefined();
    p.onError({ error: { code: -11800 } });
    expect(r.snapshot.error).toBe('error -11800');
    p.onError('decoder failed');
    expect(r.snapshot.error).toBe('decoder failed');
  });

  it('treats unknown durations as null', () => {
    const r = fakeReporter();
    videoMediaProps(r).onLoad({ duration: NaN });
    expect(r.snapshot.duration).toBeNull();
  });
});

describe('FocusTracker', () => {
  it('ignores blur of a view that is not focused and unwraps refs', () => {
    const t = new FocusTracker();
    const a = { __nativeTag: 1 };
    const b = { __nativeTag: 2 };
    let changes = 0;
    t.onChange = () => changes++;
    t.focus(a);
    t.focus(b);
    t.blur(a);
    expect(t.current).toBe(b);
    t.blur(2); // a tag matches its instance
    expect(t.current).toBeNull();
    t.set({ current: a });
    expect(t.current).toBe(a);
    t.focus(undefined);
    expect(t.current).toBe(a);
    expect(changes).toBe(4);
  });
});

describe('InteractionManager', () => {
  it('tracks handles on versions that have it', async () => {
    const idle = new IdleTracker();
    let next = 1;
    const im = {
      createInteractionHandle: () => next++,
      clearInteractionHandle: (_h: number) => {},
    };
    const restore = instrumentInteractionManager(idle, () => im);
    const handle = im.createInteractionHandle();
    expect(idle.busy()).toContainEqual(expect.objectContaining({ kind: 'interaction' }));
    im.clearInteractionHandle(handle);
    expect(idle.busy()).toEqual([]);
    restore();
    im.createInteractionHandle();
    expect(idle.busy()).toEqual([]);
  });

  it('survives the removed module throwing on access', () => {
    const restore = instrumentInteractionManager(new IdleTracker(), () => {
      throw new Error('InteractionManager has been removed from react-native core');
    });
    expect(restore).toBeTypeOf('function');
    restore();
  });
});

describe('payloadFromInitialProps', () => {
  it('reads __dpad and ignores empties', () => {
    expect(payloadFromInitialProps({ __dpad: 'abc' })).toBe('abc');
    expect(payloadFromInitialProps({ __dpad: '' })).toBeUndefined();
    expect(payloadFromInitialProps(null)).toBeUndefined();
  });
});

describe('noop module', () => {
  it('mirrors the app-facing API without doing anything', () => {
    expect(noop.startDpad()).toBeUndefined();
    expect(noop.getDpad()).toBeNull();
    expect(noop.getLaunchPayload()).toBeNull();
    expect(noop.markBusy('x')).toBeTypeOf('function');
    const App = () => null;
    expect(noop.withDpad(App)).toBe(App);
    expect(noop.DpadRoot({ children: 'x' })).toBe('x');
    const props = noop.useDpadMedia('main');
    expect(Object.keys(props).sort()).toEqual(Object.keys(videoMediaProps(() => null)).sort());
    expect(Object.keys(noop.navigationIdleListeners()).sort()).toEqual([
      'transitionEnd',
      'transitionStart',
    ]);
  });
});
