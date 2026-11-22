import { AppRuntime, type AppRuntimeOptions, type Capability } from '../src/index.js';
import {
  FakeDriver,
  FakeSdkHost,
  type FakeNodeSpec,
  type FakeScreen,
  type FakeSdkHostOptions,
} from '../src/testing/index.js';

const card = (rail: string, i: number, y: number): FakeNodeSpec => ({
  id: `${rail}_${i}`,
  testId: `${rail}_${i}`,
  text: `${rail === 'trending' ? 'Trending' : 'New'} ${i}`,
  focusable: true,
  bounds: { x: 240 + (i - 1) * 340, y, width: 300, height: 200 },
});

/**
 * A TV home screen: side menu on the left, two rails of cards. `trending_6` is offscreen to the
 * right; `hidden_banner` is invisible.
 */
export function homeScreen(): FakeScreen {
  return {
    initialFocus: 'menu_home',
    viewport: { width: 1920, height: 1080 },
    root: {
      id: 'root',
      children: [
        {
          testId: 'side_menu',
          bounds: { x: 0, y: 0, width: 200, height: 1080 },
          children: [
            {
              testId: 'menu_home',
              text: 'Home',
              focusable: true,
              bounds: { x: 0, y: 100, width: 200, height: 80 },
            },
            {
              testId: 'menu_settings',
              text: 'Settings',
              focusable: true,
              bounds: { x: 0, y: 200, width: 200, height: 80 },
            },
          ],
        },
        {
          testId: 'rail_trending',
          bounds: { x: 240, y: 100, width: 1680, height: 260 },
          children: [
            { text: 'Trending', bounds: { x: 240, y: 100, width: 300, height: 40 } },
            ...[1, 2, 3, 4, 5, 6].map((i) => card('trending', i, 150)),
          ],
        },
        {
          testId: 'rail_new',
          bounds: { x: 240, y: 450, width: 1680, height: 260 },
          children: [
            { text: 'New', bounds: { x: 240, y: 450, width: 300, height: 40 } },
            ...[1, 2, 3].map((i) => card('new', i, 500)),
          ],
        },
        {
          testId: 'hidden_banner',
          text: 'Promo',
          visible: false,
          bounds: { x: 0, y: 900, width: 400, height: 100 },
        },
      ],
    },
  };
}

export const ALL_KEYS: Capability[] = [
  'key.back',
  'key.home',
  'key.menu',
  'key.info',
  'key.media.toggle',
  'key.media.discrete',
  'key.media.seek',
  'key.media.track',
  'key.color',
  'key.numeric',
  'key.channel',
  'key.longpress',
];

/** Fast timeouts for unit tests. */
export const FAST = { expectMs: 300, actionMs: 300, navigationSettleMs: 30, sdkConnectMs: 200 };

export function setup(
  opts: {
    screen?: FakeScreen;
    capabilities?: Capability[];
    runtime?: Partial<AppRuntimeOptions>;
    /** Connect a fake SDK (backed by the same fake driver) on launch. */
    sdk?: FakeSdkHostOptions | true;
  } = {},
) {
  const driver = new FakeDriver(opts.screen ?? homeScreen(), opts.capabilities ?? ALL_KEYS);
  const host = opts.sdk ? new FakeSdkHost(driver, opts.sdk === true ? {} : opts.sdk) : undefined;
  const runtime = new AppRuntime({
    driver,
    timeouts: FAST,
    remote: { intervalMs: 0 },
    ...(host ? { sdkHost: host } : {}),
    ...opts.runtime,
  });
  return { driver, runtime, app: runtime.app, host };
}
