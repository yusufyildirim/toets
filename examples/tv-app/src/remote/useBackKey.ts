import { useEffect, useRef } from 'react';
import { BackHandler, Platform, TVEventControl } from 'react-native';

const isTVOS = Platform.OS === 'ios' && Platform.isTV;

/** Hooks wanting the tvOS menu key; it stays delivered to the app while any does. */
let menuKeyUsers = 0;

/**
 * Native: routes the remote's back key (Android TV back, Siri remote menu) to `onBack`. The most
 * recently enabled handler wins (an open dialog or keyboard). `enabled = false` lets the platform
 * handle it (exit to the launcher / tvOS home screen).
 */
export function useBackKey(onBack: () => void, enabled: boolean): void {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => {
    if (!enabled) return;
    // tvOS only delivers the menu key to the app while the menu key recognizer is enabled.
    if (isTVOS && menuKeyUsers++ === 0) TVEventControl.enableTVMenuKey();
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBackRef.current();
      return true;
    });
    return () => {
      subscription.remove();
      if (isTVOS && --menuKeyUsers === 0) TVEventControl.disableTVMenuKey();
    };
  }, [enabled]);
}
