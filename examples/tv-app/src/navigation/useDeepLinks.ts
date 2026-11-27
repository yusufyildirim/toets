import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';

/**
 * Calls `handler` with the link that started the app (cold start) and with every link the OS
 * delivers while it runs (Android `onNewIntent`, tvOS `application(_:open:)`). On web the
 * initial link is the page URL.
 */
export function useDeepLinks(handler: (url: string) => void): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    let active = true;
    void Linking.getInitialURL().then((url) => {
      if (active && url) ref.current(url);
    });
    const subscription = Linking.addEventListener('url', ({ url }) => ref.current(url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
}
