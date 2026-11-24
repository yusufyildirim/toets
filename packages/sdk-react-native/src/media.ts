import { createMediaReporter, type MediaReporter, type MediaSnapshot } from '@toets/sdk';
import { useEffect, useMemo, useRef } from 'react';

/**
 * Event props for `react-native-video` (v6) that report the player to toets. Spread them on
 * `<Video>`; call them from your own handlers when you need those events too.
 */
export interface VideoMediaProps {
  onLoadStart(): void;
  onLoad(event: { currentTime?: number; duration?: number }): void;
  onProgress(event: { currentTime?: number }): void;
  onBuffer(event: { isBuffering?: boolean }): void;
  onPlaybackStateChanged(event: { isPlaying?: boolean }): void;
  onPlaybackRateChange(event: { playbackRate?: number }): void;
  onSeek(event: { currentTime?: number }): void;
  onEnd(): void;
  onError(event: unknown): void;
}

/**
 * {@link VideoMediaProps} that feed a reporter from `createMediaReporter` (or a getter for
 * one). For class components; function components use {@link useToetsMedia}.
 */
export function videoMediaProps(
  source: MediaReporter | (() => MediaReporter | null),
): VideoMediaProps {
  const reporter = typeof source === 'function' ? source : () => source;
  let playing = false;
  const update = (patch: Partial<MediaSnapshot>): void => reporter()?.update(patch);
  return {
    // `error: undefined` clears a previous error (the reporter merges patches).
    onLoadStart: () =>
      update({ state: 'loading', error: undefined } as unknown as Partial<MediaSnapshot>),
    onLoad: (e) => {
      const r = reporter();
      if (!r) return;
      const patch: { -readonly [K in keyof MediaSnapshot]?: MediaSnapshot[K] } = {
        duration: positive(e && e.duration),
        position: positive(e && e.currentTime) ?? 0,
      };
      // Autoplaying players may report playback before the load completes.
      if (r.snapshot.state === 'loading' || r.snapshot.state === 'idle') {
        patch.state = playing ? 'playing' : 'paused';
      }
      r.update(patch);
    },
    onProgress: (e) => update({ position: positive(e && e.currentTime) ?? 0 }),
    onBuffer: (e) =>
      update({ state: e && e.isBuffering ? 'buffering' : playing ? 'playing' : 'paused' }),
    onPlaybackStateChanged: (e) => {
      playing = !!(e && e.isPlaying);
      const state = reporter()?.snapshot.state;
      // Players report "not playing" while buffering, after the end and on errors.
      if (!playing && (state === 'ended' || state === 'error' || state === 'buffering')) return;
      update({ state: playing ? 'playing' : 'paused' });
    },
    onPlaybackRateChange: (e) => {
      const rate = e && typeof e.playbackRate === 'number' ? e.playbackRate : undefined;
      if (rate !== undefined) update({ rate });
    },
    onSeek: (e) => update({ position: positive(e && e.currentTime) ?? 0 }),
    onEnd: () => {
      playing = false;
      update({ state: 'ended' });
    },
    onError: (e) => {
      playing = false;
      update({ state: 'error', error: errorMessage(e) });
    },
  };
}

/**
 * Registers a `react-native-video` player as media `id` while the component is mounted.
 * Inert (but harmless) when the SDK is not running.
 *
 * @example
 * const media = useToetsMedia('main');
 * return <Video source={source} {...media} />;
 */
export function useToetsMedia(id: string): VideoMediaProps {
  const reporter = useRef<MediaReporter | null>(null);
  useEffect(() => {
    const r = createMediaReporter(id);
    reporter.current = r;
    return () => {
      if (reporter.current === r) reporter.current = null;
      r.dispose();
    };
  }, [id]);
  return useMemo(() => videoMediaProps(() => reporter.current), []);
}

function positive(n: unknown): number | null {
  return typeof n === 'number' && isFinite(n) && n >= 0 ? n : null;
}

function errorMessage(e: unknown): string {
  const err = (e && typeof e === 'object' && 'error' in e ? (e as { error: unknown }).error : e) as
    Record<string, unknown> | string | null | undefined;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    for (const key of ['errorString', 'localizedDescription', 'message', 'errorException']) {
      const v = err[key];
      if (typeof v === 'string' && v) return v;
    }
    if (err.code !== undefined) return `error ${String(err.code)}`;
  }
  return 'playback error';
}
