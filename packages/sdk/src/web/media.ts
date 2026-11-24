import type { MediaInfo, MediaState } from '@toets/protocol';
import type { Toets } from '../runtime.js';

const EVENTS = [
  'loadstart',
  'loadedmetadata',
  'durationchange',
  'canplay',
  'play',
  'playing',
  'pause',
  'waiting',
  'stalled',
  'seeking',
  'seeked',
  'ended',
  'error',
  'ratechange',
  'emptied',
];

/**
 * Exposes every `<video>` and `<audio>` element as a player. Ids: the test id, else the
 * element id, else `media-<node id>`. Events are observed in the capture phase so players
 * created at any time are covered.
 */
export function trackMediaElements(
  toets: Toets,
  opts: { testIdAttribute: string; nodeId: (el: Element) => string },
): () => void {
  if (typeof document === 'undefined') return () => {};
  const idOf = (el: Element): string =>
    el.getAttribute(opts.testIdAttribute) || el.id || `media-${opts.nodeId(el)}`;
  const removeProvider = toets.media.addProvider(() => {
    const out: MediaInfo[] = [];
    const els = document.querySelectorAll('video, audio');
    for (let i = 0; i < els.length; i++) {
      const el = els[i] as HTMLMediaElement;
      out.push({ id: idOf(el), ...mediaElementSnapshot(el) });
    }
    return out;
  });
  const onEvent = (e: Event): void => {
    const el = e.target as Element | null;
    if (!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
    toets.media.changed(idOf(el), e.type === 'seeked');
  };
  for (const type of EVENTS) document.addEventListener(type, onEvent, true);
  return () => {
    removeProvider();
    for (const type of EVENTS) document.removeEventListener(type, onEvent, true);
  };
}

/** Maps an `HTMLMediaElement` to a protocol media snapshot. */
export function mediaElementSnapshot(el: HTMLMediaElement): Omit<MediaInfo, 'id'> {
  const duration = typeof el.duration === 'number' && isFinite(el.duration) ? el.duration : null;
  const snapshot = {
    state: mediaElementState(el),
    position: isFinite(el.currentTime) ? el.currentTime : 0,
    duration,
    rate: el.playbackRate,
  };
  if (el.error) {
    return {
      ...snapshot,
      error: `MediaError ${el.error.code}${el.error.message ? `: ${el.error.message}` : ''}`,
    };
  }
  return snapshot;
}

function mediaElementState(el: HTMLMediaElement): MediaState {
  if (el.error) return 'error';
  if (el.ended) return 'ended';
  const noSource = !el.currentSrc && !el.getAttribute('src') && el.networkState === 0;
  if (noSource) return 'idle';
  if (el.paused) {
    if (el.readyState === 0) return el.networkState === 2 ? 'loading' : 'idle';
    return 'paused';
  }
  if (el.readyState === 0) return 'loading';
  if (el.seeking || el.readyState < 3) return 'buffering';
  return 'playing';
}
