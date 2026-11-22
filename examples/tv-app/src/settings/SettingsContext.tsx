import { createContext, use, useMemo, useState, type ReactNode } from 'react';

/** In-memory user preferences. They reset on every launch, which keeps test runs isolated. */
interface Settings {
  readonly autoplay: boolean;
  setAutoplay(value: boolean): void;
  readonly myList: ReadonlySet<string>;
  toggleMyList(itemId: string): void;
}

const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [autoplay, setAutoplay] = useState(true);
  const [myList, setMyList] = useState<ReadonlySet<string>>(new Set());
  const settings = useMemo<Settings>(
    () => ({
      autoplay,
      setAutoplay,
      myList,
      toggleMyList: (itemId) =>
        setMyList((current) => {
          const next = new Set(current);
          if (!next.delete(itemId)) next.add(itemId);
          return next;
        }),
    }),
    [autoplay, myList],
  );
  return <SettingsContext value={settings}>{children}</SettingsContext>;
}

export function useSettings(): Settings {
  const settings = use(SettingsContext);
  if (!settings) throw new Error('useSettings must be used inside <SettingsProvider>');
  return settings;
}
