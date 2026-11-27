import { describe, expect, it } from 'vitest';

import {
  canGoBack,
  deepLinkActions,
  initialNavigationState,
  launchStateActions,
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

describe('launchStateActions', () => {
  it('opens details, and the player on top of its details', () => {
    expect(run(...launchStateActions('details:new-2')).stack).toEqual([
      { name: 'details', itemId: 'new-2' },
    ]);
    expect(run(...launchStateActions('player:new-2')).stack).toEqual([
      { name: 'details', itemId: 'new-2' },
      { name: 'player', itemId: 'new-2' },
    ]);
  });

  it('rejects unknown states', () => {
    expect(() => launchStateActions('details')).toThrow(/Unknown launch state "details"/);
    expect(() => launchStateActions('nowhere:1')).toThrow(/Unknown launch state/);
  });
});

describe('deepLinkActions', () => {
  const details = (itemId: string) => launchStateActions(`details:${itemId}`);

  it('routes app links and the same path on web', () => {
    expect(deepLinkActions('toetstv://details/new-2')).toEqual(details('new-2'));
    expect(deepLinkActions('toetstv://player/trending-1?t=1')).toEqual(
      launchStateActions('player:trending-1'),
    );
    expect(deepLinkActions('http://localhost:8090/details/new-2?__toets=x#top')).toEqual(
      details('new-2'),
    );
  });

  it('ignores links it does not route', () => {
    expect(deepLinkActions('http://localhost:8090/')).toBeNull();
    expect(deepLinkActions('http://localhost:8090/?__toets=abc')).toBeNull();
    expect(deepLinkActions('toetstv://details')).toBeNull();
    expect(deepLinkActions('toetstv://settings/x')).toBeNull();
    expect(deepLinkActions('otherapp://details/new-2')).toBeNull();
    expect(deepLinkActions('not a url')).toBeNull();
  });
});
