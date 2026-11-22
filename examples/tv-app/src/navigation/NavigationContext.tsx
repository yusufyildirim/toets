import { createContext, use, useMemo, useReducer, type ReactNode } from 'react';

import {
  canGoBack,
  initialNavigationState,
  navigationReducer,
  type NavigationState,
  type Route,
  type Tab,
} from './navigation';

interface Navigation {
  readonly state: NavigationState;
  selectTab(tab: Tab): void;
  push(route: Route): void;
  /** Goes back one level; returns false when there is nothing to go back to. */
  back(): boolean;
}

const NavigationContext = createContext<Navigation | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(navigationReducer, initialNavigationState);
  const navigation = useMemo<Navigation>(
    () => ({
      state,
      selectTab: (tab) => dispatch({ type: 'selectTab', tab }),
      push: (route) => dispatch({ type: 'push', route }),
      back: () => {
        if (!canGoBack(state)) return false;
        dispatch({ type: 'back' });
        return true;
      },
    }),
    [state],
  );
  return <NavigationContext value={navigation}>{children}</NavigationContext>;
}

export function useNavigation(): Navigation {
  const navigation = use(NavigationContext);
  if (!navigation) throw new Error('useNavigation must be used inside <NavigationProvider>');
  return navigation;
}
