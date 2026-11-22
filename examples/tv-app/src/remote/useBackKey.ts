import { useEffect, useRef } from 'react';
import { BackHandler, Platform, TVEventControl } from 'react-native';

const isTVOS = Platform.OS === 'ios' && Platform.isTV;

/**
 * Native: routes the remote's back key (Android TV back, Siri remote menu) to `onBack`.
 * `enabled = false` lets the platform handle it (exit to the launcher / tvOS home screen).
 */
export function useBackKey(onBack: () => void, enabled: boolean): void {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => {
    if (!enabled) return;
    // tvOS only delivers the menu key to the app while the menu key recognizer is enabled.
    if (isTVOS) TVEventControl.enableTVMenuKey();
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBackRef.current();
      return true;
    });
    return () => {
      subscription.remove();
      if (isTVOS) TVEventControl.disableTVMenuKey();
    };
  }, [enabled]);
}
