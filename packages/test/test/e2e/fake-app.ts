/**
 * A fake TV app behind real driver modules, for the end-to-end smoke. Home has a side menu and
 * a rail of cards; SELECT on a card opens its details; BACK returns home; PLAY_PAUSE toggles
 * media in the fake SDK. Each launch records `GET <mockUrl>/api/home` on the fake mock server.
 */
import type { Capability, DriverCreateContext, DriverLaunchOptions, Platform } from '@toets/core';
import type { FakeMockServer, FakeSdkHost } from '@toets/core/testing';
import { FakeDriver, type FakeScreen } from '@toets/core/testing';

/** Shared per worker process: the config's factories and the driver find each other here. */
export const registry: {
  driver?: FakeTvApp;
  mock?: FakeMockServer;
  host?: FakeSdkHost;
  device?: string;
} = {};

const viewport = { width: 192, height: 108 };

export function home(): FakeScreen {
  return {
    initialFocus: 'menu_home',
    viewport,
    root: {
      id: 'root',
      children: [
        {
          testId: 'side_menu',
          bounds: { x: 0, y: 0, width: 20, height: 108 },
          children: [
            {
              id: 'menu_home',
              testId: 'menu_home',
              text: 'Home',
              focusable: true,
              bounds: { x: 0, y: 10, width: 20, height: 8 },
            },
            {
              id: 'menu_settings',
              testId: 'menu_settings',
              text: 'Settings',
              focusable: true,
              bounds: { x: 0, y: 20, width: 20, height: 8 },
            },
          ],
        },
        {
          testId: 'rail',
          bounds: { x: 24, y: 10, width: 168, height: 30 },
          children: [1, 2, 3].map((i) => ({
            id: `card_${i}`,
            testId: `card_${i}`,
            text: `Movie ${i}`,
            focusable: true,
            bounds: { x: 24 + (i - 1) * 34, y: 15, width: 30, height: 20 },
          })),
        },
      ],
    },
  };
}

function details(title: string): FakeScreen {
  return {
    initialFocus: 'play',
    viewport,
    root: {
      id: 'root',
      children: [
        { testId: 'details_title', text: title, bounds: { x: 10, y: 10, width: 100, height: 10 } },
        {
          id: 'play',
          testId: 'play',
          text: 'Play',
          focusable: true,
          bounds: { x: 10, y: 30, width: 30, height: 10 },
        },
      ],
    },
  };
}

export class FakeTvApp extends FakeDriver {
  constructor(
    platform: Platform,
    capabilities: Capability[],
    readonly ctx: DriverCreateContext,
  ) {
    super(home(), capabilities, { platform });
    this.keyHandlers.set('SELECT', (focused, d) => {
      if (focused?.startsWith('card_')) d.setScreen(details(`Movie ${focused.slice(5)}`));
    });
    this.keyHandlers.set('BACK', (_f, d) => d.setScreen(home()));
    this.keyHandlers.set('PLAY_PAUSE', () => {
      const session = registry.host?.session;
      if (!session) return;
      const playing = session.media?.state === 'playing';
      session.media = {
        id: 'main',
        state: playing ? 'paused' : 'playing',
        position: 3,
        duration: 60,
        rate: playing ? 0 : 1,
      };
    });
  }

  override async launch(opts: DriverLaunchOptions): Promise<void> {
    await super.launch(opts);
    this.setScreen(opts.payload.state === 'details' ? details('Movie 1') : home());
    if (opts.payload.mockUrl) registry.mock?.record({ url: `${opts.payload.mockUrl}/api/home` });
  }
}

export const WEB_CAPABILITIES: Capability[] = [
  'key.back',
  'key.media.toggle',
  'key.media.discrete',
  'key.media.seek',
  'key.media.track',
  'key.color',
  'key.longpress',
  'platform.events',
];

/** Like a real tvOS remote: no color, numeric or discrete media keys. */
export const TVOS_CAPABILITIES: Capability[] = [
  'key.back',
  'key.home',
  'key.media.toggle',
  'key.longpress',
];
