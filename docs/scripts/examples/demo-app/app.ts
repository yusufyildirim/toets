/**
 * The TV app the docs examples describe, as a FakeDriver: a side menu, a hero with play and like
 * buttons, rails of cards, details, a guide, a watchlist and a first-run flow. It talks to the
 * toets mock server like a real app (launch payload `mockUrl` plus the original origin header),
 * so network examples run against real MSW handlers.
 *
 * Test IDs are the ones used across the docs; change both together.
 */
import type { Capability, DriverLaunchOptions, Key, PressOptions } from '@toets/core';
import { FakeDriver, type FakeNodeSpec, type FakeSdkHost } from '@toets/core/testing';
import { ORIGINAL_ORIGIN_HEADER, type ProtocolNode } from '@toets/protocol';

/** Origin of the API the demo app calls; the mock server stands in for it. */
export const API_ORIGIN = 'https://api.example.com';

/** Remote of the demo platform: a full TV remote. */
export const DEMO_CAPABILITIES: readonly Capability[] = [
  'key.back',
  'key.home',
  'key.menu',
  'key.media.toggle',
  'key.media.discrete',
  'key.color',
  'key.longpress',
  'platform.events',
];

export interface RailData {
  readonly id: string;
  readonly titles: readonly string[];
}

/** Per worker process: the config's SDK host factory and the driver find each other here. */
export const registry: { app?: DemoTvApp; host?: FakeSdkHost } = {};

type Screen = 'terms' | 'profiles' | 'home' | 'details' | 'guide' | 'watchlist';

interface State {
  screen: Screen;
  rails: readonly RailData[];
  favorites: readonly unknown[];
  watchlist: readonly unknown[] | null;
  watchlistCount: number;
  toast: string | null;
  detailsTitle: string;
  continueWatching: boolean;
}

const VIEWPORT = { width: 960, height: 540 };
const CARD = { width: 120, height: 68, gap: 16 };
const MENU_ITEMS = ['home', 'watchlist'] as const;

const node = (testId: string, spec: Omit<FakeNodeSpec, 'testId'> = {}): FakeNodeSpec => ({
  id: testId,
  testId,
  ...spec,
});

const button = (testId: string, text: string, x: number, y: number): FakeNodeSpec =>
  node(testId, { text, focusable: true, bounds: { x, y, width: 120, height: 40 } });

export class DemoTvApp extends FakeDriver {
  private state: State = DemoTvApp.initialState();
  private onboarded = true;
  private mockUrl: string | undefined;

  constructor() {
    super({ root: { id: 'root' }, viewport: VIEWPORT }, DEMO_CAPABILITIES);
  }

  private static initialState(): State {
    return {
      screen: 'home',
      rails: [],
      favorites: [],
      watchlist: null,
      watchlistCount: 0,
      toast: null,
      detailsTitle: '',
      continueWatching: false,
    };
  }

  override async launch(opts: DriverLaunchOptions): Promise<void> {
    await super.launch(opts);
    if (opts.clearData) this.onboarded = false;
    this.mockUrl = opts.payload.mockUrl;
    this.state = {
      ...DemoTvApp.initialState(),
      screen: this.onboarded ? 'home' : 'terms',
      continueWatching: opts.payload.state === 'signed-in-with-history',
      rails: await this.api<RailData[]>('GET', '/v1/rails', []),
      favorites: await this.api<unknown[]>('GET', '/api/favorites', []),
    };
    this.render();
  }

  override async press(key: Key, opts?: PressOptions): Promise<void> {
    await super.press(key, opts);
    const focused = this.focusedNodeId();
    await this.handle(key, focused);
    this.render(focused);
  }

  /** The focused node's id (popular cards share a test ID, so the test ID is not enough). */
  private focusedNodeId(): string | null {
    const find = (n: ProtocolNode): string | null =>
      n.focused ? n.id : n.children.reduce<string | null>((hit, c) => hit ?? find(c), null);
    return find(this.protocolTree());
  }

  private async handle(key: Key, focused: string | null): Promise<void> {
    const s = this.state;
    s.toast = null;
    if (key === 'BACK') {
      s.screen = 'home';
      return;
    }
    if (key === 'RED' || key === 'GREEN') {
      s.screen = 'guide';
      return;
    }
    if (key === 'PLAY_PAUSE') {
      const session = registry.host?.session;
      if (session?.media) {
        const playing = session.media.state === 'playing';
        session.media = { ...session.media, state: playing ? 'paused' : 'playing' };
      }
      return;
    }
    if (key !== 'SELECT' || focused === null) return;
    if (focused === 'terms-accept') s.screen = 'profiles';
    else if (focused.startsWith('profile-')) {
      this.onboarded = true;
      s.screen = 'home';
    } else if (focused === 'menu-watchlist') {
      s.watchlist = await this.api<unknown[]>('GET', '/api/watchlist', []);
      s.screen = 'watchlist';
    } else if (focused === 'menu-home') s.screen = 'home';
    else if (focused === 'play-button') {
      const session = registry.host?.session;
      if (session) {
        session.media = { id: 'main', state: 'playing', position: 0, duration: 600, rate: 1 };
      }
    } else if (focused === 'like-button') {
      await this.api('POST', '/v1/likes', null, { videoId: 'v1' });
    } else if (/^rail-.+-card-\d+$/.test(focused)) {
      s.detailsTitle = this.titleOf(focused);
      s.screen = 'details';
    } else if (focused.startsWith('popular-')) {
      s.watchlistCount++;
      s.toast = 'Added to watchlist';
    }
  }

  private titleOf(cardId: string): string {
    const match = /^rail-(.+)-card-(\d+)$/.exec(cardId);
    const rail = this.state.rails.find((r) => r.id === match?.[1]);
    return rail?.titles[Number(match?.[2])] ?? 'Continue watching';
  }

  /** Calls the API through the mock server; `fallback` without one or on errors. */
  private async api<T>(method: string, path: string, fallback: T, body?: unknown): Promise<T> {
    if (!this.mockUrl) return fallback;
    const res = await fetch(`${this.mockUrl}${path}`, {
      method,
      headers: { [ORIGINAL_ORIGIN_HEADER]: API_ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) return fallback;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : fallback;
  }

  /** Rebuilds the screen from the state, keeping focus where it is when it still exists. */
  private render(focused: string | null = null): void {
    const { screen } = this.state;
    const built =
      screen === 'terms'
        ? { root: node('terms-screen', { children: [button('terms-accept', 'Accept', 420, 300)] }) }
        : screen === 'profiles'
          ? {
              root: node('profile-picker', {
                children: [0, 1].map((i) =>
                  button(`profile-${i}`, `Profile ${i}`, 300 + i * 200, 250),
                ),
              }),
            }
          : screen === 'details'
            ? {
                root: node('details-screen', {
                  children: [
                    node('details-title', {
                      text: this.state.detailsTitle,
                      bounds: { x: 60, y: 60, width: 600, height: 40 },
                    }),
                    button('details-play', 'Play', 60, 140),
                  ],
                }),
              }
            : screen === 'guide'
              ? { root: node('guide', { text: 'Guide', bounds: { x: 0, y: 0, ...VIEWPORT } }) }
              : screen === 'watchlist'
                ? { root: this.watchlistScreen() }
                : { root: this.homeScreen(focused) };
    const initial = this.initialFocus(screen);
    this.setScreen({ ...built, viewport: VIEWPORT, initialFocus: initial });
    // Same screen: keep focus (the menu opens and closes around it). New screen: initial focus.
    if (focused && screen === this.lastScreen && this.has(focused)) this.focus(focused);
    this.lastScreen = screen;
  }

  private lastScreen: Screen | null = null;

  private has(id: string): boolean {
    const walk = (n: FakeNodeSpec): boolean =>
      n.id === id || (n.children ?? []).some((c) => walk(c));
    return walk(this.currentRoot);
  }

  private currentRoot: FakeNodeSpec = { id: 'root' };

  override setScreen(screen: Parameters<FakeDriver['setScreen']>[0]): void {
    this.currentRoot = screen.root;
    super.setScreen(screen);
  }

  private initialFocus(screen: Screen): string {
    switch (screen) {
      case 'terms':
        return 'terms-accept';
      case 'profiles':
        return 'profile-1';
      case 'details':
        return 'details-play';
      case 'watchlist':
        return 'menu-watchlist';
      case 'guide':
        return 'guide';
      default:
        return this.state.continueWatching
          ? 'rail-continue-watching-card-0'
          : this.state.rails.length > 0
            ? `rail-${this.state.rails[0]!.id}-card-0`
            : 'play-button';
    }
  }

  private menu(open: boolean): FakeNodeSpec {
    return node('side-menu', {
      visible: open,
      bounds: { x: 0, y: 0, width: 200, height: VIEWPORT.height },
      children: MENU_ITEMS.map((item, i) =>
        node(`menu-${item}`, {
          text: item === 'home' ? 'Home' : 'Watchlist',
          focusable: true,
          bounds: { x: 20, y: 100 + i * 60, width: 160, height: 40 },
          neighbors: { left: null },
        }),
      ),
    });
  }

  private homeScreen(focused: string | null): FakeNodeSpec {
    const s = this.state;
    const menuOpen = focused?.startsWith('menu-') ?? false;
    const rails: RailData[] = [
      ...(s.continueWatching ? [{ id: 'continue-watching', titles: ['Big Buck Bunny'] }] : []),
      ...s.rails,
    ];
    const content: FakeNodeSpec[] = [
      button('play-button', 'Play', 240, 40),
      button('like-button', 'Like', 380, 40),
      node('watchlist-count', {
        text: String(s.watchlistCount),
        bounds: { x: 880, y: 20, width: 40, height: 20 },
      }),
      ...(s.toast
        ? [node('toast', { text: s.toast, bounds: { x: 600, y: 480, width: 300, height: 30 } })]
        : []),
      ...(s.favorites.length === 0
        ? [
            node('favorites-empty', {
              text: 'No favorites yet',
              bounds: { x: 240, y: 500, width: 300, height: 30 },
            }),
          ]
        : []),
      ...(rails.length === 0
        ? [
            node('rails-empty', {
              text: 'Nothing to watch',
              bounds: { x: 240, y: 200, width: 300, height: 30 },
            }),
          ]
        : rails.map((rail, r) => this.rail(rail, 120 + r * (CARD.height + 40)))),
    ];
    return node('app-root', {
      children: [this.menu(menuOpen), node('home-screen', { children: content })],
    });
  }

  /** Popular cards share the test ID `card` (scoped through their rail); others are unique. */
  private rail(rail: RailData, y: number): FakeNodeSpec {
    const generic = rail.id === 'popular';
    return node(`rail-${rail.id}`, {
      bounds: { x: 240, y, width: 700, height: CARD.height },
      children: rail.titles.map((title, i) => {
        const id = generic ? `popular-${i}` : `rail-${rail.id}-card-${i}`;
        return {
          id,
          testId: generic ? 'card' : id,
          text: title,
          focusable: true,
          bounds: { x: 240 + i * (CARD.width + CARD.gap), y, ...CARD },
          ...(i === 0 ? { neighbors: { left: 'menu-home' } } : {}),
        };
      }),
    });
  }

  private watchlistScreen(): FakeNodeSpec {
    const empty = (this.state.watchlist ?? []).length === 0;
    return node('app-root', {
      children: [
        this.menu(true),
        node('watchlist-screen', {
          bounds: { x: 240, y: 0, width: 720, height: VIEWPORT.height },
          children: empty
            ? [
                node('watchlist-empty', {
                  text: 'Your watchlist is empty',
                  bounds: { x: 300, y: 200, width: 400, height: 30 },
                }),
              ]
            : [],
        }),
      ],
    });
  }
}
