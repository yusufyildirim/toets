import { describe, expect, it } from 'vitest';

import {
  canGoBack,
  initialNavigationState,
  MENU_SCOPE,
  navigationReducer,
  routeScope,
  type NavigationAction,
} from './navigation';

const run = (...actions: NavigationAction[]) =>
  actions.reduce(navigationReducer, initialNavigationState);

describe('navigationReducer', () => {
  it('restores focus on the revealed screen when going back', () => {
    const details = { name: 'details', itemId: 'a' } as const;
    const state = run(
      { type: 'push', route: details },
      { type: 'push', route: { name: 'player', itemId: 'a' } },
      { type: 'back' },
    );
    expect(state.stack).toEqual([details]);
    expect(state.focusRequest).toMatchObject({ scope: routeScope(details, 0) });
    expect(run({ type: 'push', route: details }, { type: 'back' }).focusRequest).toMatchObject({
      scope: 'home',
    });
  });

  it('goes from another tab back to home, focusing the home menu item', () => {
    const state = run({ type: 'selectTab', tab: 'settings' }, { type: 'back' });
    expect(state.tab).toBe('home');
    expect(state.focusRequest).toMatchObject({ scope: MENU_SCOPE, key: 'menu_home' });
  });

  it('lets the platform handle back on the home root', () => {
    expect(canGoBack(initialNavigationState)).toBe(false);
    expect(navigationReducer(initialNavigationState, { type: 'back' })).toBe(
      initialNavigationState,
    );
  });
});
