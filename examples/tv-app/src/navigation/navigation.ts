/** Pure navigation state: a tab (side menu destination) plus a stack of full-screen routes. */

export type Tab = 'home' | 'settings';

export type Route =
  | { readonly name: 'details'; readonly itemId: string }
  | { readonly name: 'player'; readonly itemId: string };

/** Asks the focus scope `scope` to restore focus (to `key`, or to what it remembers). */
export interface FocusRequest {
  readonly scope: string;
  readonly key?: string;
  readonly seq: number;
}

export interface NavigationState {
  readonly tab: Tab;
  readonly stack: readonly Route[];
  readonly focusRequest: FocusRequest | null;
}

export type NavigationAction =
  | { readonly type: 'selectTab'; readonly tab: Tab }
  | { readonly type: 'push'; readonly route: Route }
  | { readonly type: 'back' };

export const MENU_SCOPE = 'menu';

export const initialNavigationState: NavigationState = {
  tab: 'home',
  stack: [],
  focusRequest: null,
};

/** Scope id of the route at `index` in the stack. */
export function routeScope(route: Route, index: number): string {
  return `${route.name}:${route.itemId}:${index}`;
}

/** Whether `back` would do something (otherwise the platform handles it, e.g. exits). */
export function canGoBack(state: NavigationState): boolean {
  return state.stack.length > 0 || state.tab !== 'home';
}

export function navigationReducer(
  state: NavigationState,
  action: NavigationAction,
): NavigationState {
  const seq = (state.focusRequest?.seq ?? 0) + 1;
  switch (action.type) {
    case 'selectTab':
      return { tab: action.tab, stack: [], focusRequest: null };
    case 'push':
      return { ...state, stack: [...state.stack, action.route], focusRequest: null };
    case 'back': {
      if (state.stack.length > 0) {
        const stack = state.stack.slice(0, -1);
        const top = stack.at(-1);
        // The revealed screen restores the focus it had before the push.
        const scope = top ? routeScope(top, stack.length - 1) : state.tab;
        return { ...state, stack, focusRequest: { scope, seq } };
      }
      if (state.tab !== 'home') {
        return {
          tab: 'home',
          stack: [],
          focusRequest: { scope: MENU_SCOPE, key: 'menu_home', seq },
        };
      }
      return state;
    }
  }
}

/**
 * Navigation actions that open a toets launch state (`app.launch({ state })`): `details:<id>` or
 * `player:<id>` (on top of its details screen, so back behaves as if the user got there).
 */
export function launchStateActions(state: string): NavigationAction[] {
  const [name, itemId] = splitOnce(state, ':');
  const home: NavigationAction = { type: 'selectTab', tab: 'home' };
  const details: NavigationAction = { type: 'push', route: { name: 'details', itemId } };
  if (itemId && name === 'details') return [home, details];
  if (itemId && name === 'player') {
    return [home, details, { type: 'push', route: { name: 'player', itemId } }];
  }
  throw new Error(`Unknown launch state "${state}": expected details:<id> or player:<id>`);
}

function splitOnce(value: string, separator: string): [string, string] {
  const i = value.indexOf(separator);
  return i < 0 ? [value, ''] : [value.slice(0, i), value.slice(i + 1)];
}
