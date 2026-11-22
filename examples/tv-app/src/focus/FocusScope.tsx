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

import { useNavigation } from '../navigation/NavigationContext';

interface FocusScopeValue {
  /** False while the scope's screen is hidden; hidden scopes never take focus. */
  readonly active: boolean;
  /** Key of the element that should take focus now, if any. */
  readonly requestedKey: string | null;
  /** Reports that the element with `key` received focus. */
  onFocused(key: string): void;
}

const FocusScopeContext = createContext<FocusScopeValue>({
  active: true,
  requestedKey: null,
  onFocused: () => {},
});

interface FocusScopeProps {
  /** Scope id, matched against navigation focus requests (`home`, `menu`, route scopes). */
  readonly id: string;
  readonly active: boolean;
  /** Element focused the first time the scope is active (e.g. the first card). */
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
  const lastKey = useRef<string | null>(null);
  const initialKey = useRef(initialFocusKey);
  initialKey.current = initialFocusKey;

  useEffect(() => {
    if (active && initialFocusKey && lastKey.current === null) setRequestedKey(initialFocusKey);
  }, [active, initialFocusKey]);

  const request = state.focusRequest;
  useEffect(() => {
    if (request?.scope !== id) return;
    setRequestedKey(request.key ?? lastKey.current ?? initialKey.current ?? null);
  }, [request, id]);

  const onFocused = useCallback((key: string) => {
    lastKey.current = key;
    setRequestedKey(null);
  }, []);

  const value = useMemo(
    () => ({ active, requestedKey, onFocused }),
    [active, requestedKey, onFocused],
  );
  return <FocusScopeContext value={value}>{children}</FocusScopeContext>;
}

export function useFocusScope(): FocusScopeValue {
  return use(FocusScopeContext);
}
