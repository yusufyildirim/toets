import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { navigationIdle } from '../toets';
import { useNavigation } from '../navigation/NavigationContext';

interface FocusScopeValue {
  /** False while the scope's screen is hidden; hidden scopes never take focus. */
  readonly active: boolean;
  /** Key of the element that should take focus now, if any. */
  readonly requestedKey: string | null;
  /** Registers a mounted element; returns its unregister function. */
  register(key: string): () => void;
  /** Reports that the element with `key` received focus. */
  onFocused(key: string): void;
}

const FocusScopeContext = createContext<FocusScopeValue>({
  active: true,
  requestedKey: null,
  register: () => () => {},
  onFocused: () => {},
});

interface FocusScopeProps {
  /** Scope id, matched against navigation focus requests (`home`, `menu`, route scopes). */
  readonly id: string;
  readonly active: boolean;
  /**
   * Element to focus when the scope has nothing focused yet, or when its focused element went
   * away (e.g. a retry button replaced by content). Changing it re-applies the rule.
   */
  readonly initialFocusKey?: string | undefined;
  readonly children: ReactNode;
}

/**
 * Owns focus for one screen (or the side menu): initial focus, and focus restoration when
 * navigation asks for it (e.g. after going back to this screen). Elements opt in through
 * `Focusable`, identified by their `focusKey` (defaults to the testID).
 */
export function FocusScope({ id, active, initialFocusKey, children }: FocusScopeProps) {
  const { state } = useNavigation();
  const [requestedKey, setRequestedKey] = useState<string | null>(null);
  const mounted = useRef(new Set<string>());
  const lastKey = useRef<string | null>(null);
  const activeRef = useRef(active);
  const initialKey = useRef(initialFocusKey);
  activeRef.current = active;
  initialKey.current = initialFocusKey;

  /** The last focused element if it still exists, otherwise the initial one. */
  const restoreTarget = useCallback(() => {
    const last = lastKey.current;
    return last !== null && mounted.current.has(last) ? last : (initialKey.current ?? null);
  }, []);

  // Initial focus. Deliberately not re-run when the scope becomes active again: switching
  // tabs from the side menu must not pull focus out of the menu.
  useEffect(() => {
    if (activeRef.current && initialFocusKey) setRequestedKey(restoreTarget());
  }, [initialFocusKey, restoreTarget]);

  const request = state.focusRequest;
  useEffect(() => {
    if (request?.scope === id) setRequestedKey(request.key ?? restoreTarget());
  }, [request, id, restoreTarget]);

  // For toets idle sync: a pending focus request is a screen transition in progress.
  const transitioning = active && requestedKey !== null;
  useEffect(() => {
    if (!transitioning) return;
    navigationIdle.transitionStart({ target: id });
    return () => navigationIdle.transitionEnd({ target: id });
  }, [transitioning, id]);

  const register = useCallback((key: string) => {
    mounted.current.add(key);
    return () => {
      mounted.current.delete(key);
    };
  }, []);

  const onFocused = useCallback((key: string) => {
    lastKey.current = key;
    setRequestedKey(null);
  }, []);

  const value = useMemo(
    () => ({ active, requestedKey, register, onFocused }),
    [active, requestedKey, register, onFocused],
  );
  return <FocusScopeContext value={value}>{children}</FocusScopeContext>;
}

export function useFocusScope(): FocusScopeValue {
  return use(FocusScopeContext);
}
