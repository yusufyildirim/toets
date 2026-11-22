import { useCallback, useEffect, useRef } from 'react';
import { useTVEventHandler, type TVRemoteEvent } from 'react-native';

import { MEDIA_KEYS, type MediaKey } from './keys';

/** Native: media keys arrive as TV remote events (Android TV keycodes, Siri remote play/pause). */
export function useMediaKeys(handler: (key: MediaKey) => void): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  const onEvent = useCallback((event: TVRemoteEvent) => {
    // Android reports key down (0) and up (1); tvOS reports taps as up. Act once, on up.
    // The runtime value is a number despite the typings.
    if (Number(event.eventKeyAction) === 0) return;
    if (MEDIA_KEYS.has(event.eventType)) handlerRef.current(event.eventType as MediaKey);
  }, []);
  useTVEventHandler(onEvent);
}
