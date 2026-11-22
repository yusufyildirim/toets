import { useEffect, useRef } from 'react';

import type { MediaKey } from './keys';

const WEB_MEDIA_KEYS: Readonly<Record<string, MediaKey>> = {
  MediaPlayPause: 'playPause',
  MediaPlay: 'play',
  MediaPause: 'pause',
  MediaFastForward: 'fastForward',
  MediaRewind: 'rewind',
  MediaStop: 'stop',
};

/** Web: media keys are `KeyboardEvent.key` values. */
export function useMediaKeys(handler: (key: MediaKey) => void): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = WEB_MEDIA_KEYS[event.key];
      if (!key) return;
      event.preventDefault();
      handlerRef.current(key);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
