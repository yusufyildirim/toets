import { useEffect, useRef } from 'react';

/** Back key values of desktop keyboards and common TV browsers. */
const BACK_KEYS: ReadonlySet<string> = new Set([
  'Escape',
  'Backspace',
  'GoBack',
  'BrowserBack',
  'XF86Back',
]);

/** Enabled handlers, oldest first: the newest one (an open dialog or keyboard) handles back. */
const handlers: (() => void)[] = [];

function onKeyDown(event: KeyboardEvent): void {
  const handler = handlers.at(-1);
  if (!handler || !BACK_KEYS.has(event.key) || event.defaultPrevented) return;
  event.preventDefault();
  handler();
}

/**
 * Web: routes back keys to `onBack` while `enabled`, like the native `BackHandler`: the most
 * recently enabled handler wins. Like many TV web apps, Backspace counts as back, even in a text
 * field: TV keyboards insert and delete text without key events.
 */
export function useBackKey(onBack: () => void, enabled: boolean): void {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => {
    if (!enabled) return;
    const handler = () => onBackRef.current();
    handlers.push(handler);
    if (handlers.length === 1) document.addEventListener('keydown', onKeyDown);
    return () => {
      handlers.splice(handlers.indexOf(handler), 1);
      if (handlers.length === 0) document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);
}
