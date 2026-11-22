import { useEffect, useRef } from 'react';

/** Back key values of desktop keyboards and common TV browsers. */
const BACK_KEYS: ReadonlySet<string> = new Set([
  'Escape',
  'Backspace',
  'GoBack',
  'BrowserBack',
  'XF86Back',
]);

/** Web: routes back keys to `onBack` while `enabled`. */
export function useBackKey(onBack: () => void, enabled: boolean): void {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!BACK_KEYS.has(event.key) || event.defaultPrevented) return;
      event.preventDefault();
      onBackRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
