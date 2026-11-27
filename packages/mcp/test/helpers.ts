import type { Capability, DriverModule } from '@toets/core';
import {
  FakeDriver,
  type FakeDriverOptions,
  type FakeNodeSpec,
  type FakeScreen,
} from '@toets/core/testing';
import { Client, InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { afterEach } from 'vitest';
import type { McpConfig, McpTargetConfig } from '../src/config.js';
import { createToetsMcp, type ToetsMcpOptions } from '../src/server.js';

const card = (id: string, label: string, x: number, y: number): FakeNodeSpec => ({
  id,
  testId: id,
  text: label,
  focusable: true,
  bounds: { x, y, width: 200, height: 120 },
});

/** A TV home screen: side menu, two rails (one card offscreen), a hidden node. */
export const homeScreen: FakeScreen = {
  initialFocus: 'card_1',
  viewport: { width: 1920, height: 1080 },
  root: {
    testId: 'app',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    children: [
      {
        testId: 'menu',
        bounds: { x: 0, y: 0, width: 220, height: 1080 },
        children: [card('menu_home', 'Home', 0, 100), card('menu_settings', 'Settings', 0, 300)],
      },
      {
        bounds: { x: 260, y: 0, width: 1660, height: 1080 },
        children: [
          { text: 'Welcome back', bounds: { x: 300, y: 20, width: 400, height: 40 } },
          {
            testId: 'rail_popular',
            bounds: { x: 260, y: 100, width: 1660, height: 120 },
            children: [
              card('card_1', 'Movie 1', 300, 100),
              card('card_2', 'Movie 2', 520, 100),
              card('card_3', 'Movie 3', 740, 100),
              card('card_9', 'Movie 9', 2000, 100),
            ],
          },
          {
            testId: 'rail_new',
            bounds: { x: 260, y: 300, width: 1660, height: 120 },
            children: [card('new_1', 'New 1', 300, 300), card('new_2', 'New 2', 520, 300)],
          },
          { text: 'Secret', visible: false, bounds: { x: 0, y: 0, width: 10, height: 10 } },
        ],
      },
    ],
  },
};

export const detailsScreen: FakeScreen = {
  initialFocus: 'play',
  root: {
    testId: 'details',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    children: [
      {
        testId: 'details_title',
        text: 'Movie 2',
        bounds: { x: 100, y: 100, width: 600, height: 80 },
      },
      { ...card('play', 'Play', 100, 300), busy: false },
      { ...card('trailer', 'Trailer', 320, 300), enabled: false },
    ],
  },
};

export interface Harness {
  readonly client: Client;
  readonly driver: FakeDriver;
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  /** Text of a successful call; fails the test on a tool error. */
  ok(name: string, args?: Record<string, unknown>): Promise<string>;
  /** Text of a failed call; fails the test when the call succeeds. */
  err(name: string, args?: Record<string, unknown>): Promise<string>;
  /** Stops the server's target (device, driver, SDK host, mock server). */
  dispose(): Promise<void>;
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

/** A driver module over a fresh FakeDriver; SELECT on `card_2` opens the details screen. */
export function fakeDriverModule(
  capabilities: Capability[] = ['key.back', 'key.longpress'],
  driverOptions?: FakeDriverOptions,
): {
  module: DriverModule<never>;
  driver: () => FakeDriver;
} {
  let instance: FakeDriver | undefined;
  return {
    driver: () => {
      if (!instance) throw new Error('driver not created yet');
      return instance;
    },
    module: {
      platform: 'web',
      async createDriver() {
        instance = new FakeDriver(homeScreen, capabilities, driverOptions);
        instance.keyHandlers.set('SELECT', (focused, d) => {
          if (focused === 'card_2') d.setScreen(detailsScreen);
        });
        instance.keyHandlers.set('BACK', (_focused, d) => d.setScreen(homeScreen));
        return instance;
      },
    },
  };
}

/** Fast timeouts for the default `web` target (unit-test speed, same semantics). */
export const FAST_TIMEOUTS = { actionMs: 500, navigationSettleMs: 50, sdkConnectMs: 200 };

/** Connects an MCP client to a toets MCP server over an in-memory transport. */
export async function connect(
  opts: {
    capabilities?: Capability[];
    driverOptions?: FakeDriverOptions;
    config?: McpConfig | null;
    /** Extra fields of the default `web` target (SDK, mock, key overrides, ...). */
    target?: (driver: () => FakeDriver) => Partial<McpTargetConfig>;
  } & Omit<ToetsMcpOptions, 'config'> = {},
): Promise<Harness> {
  const fake = fakeDriverModule(opts.capabilities, opts.driverOptions);
  const { target: extras, capabilities: _caps, driverOptions: _driver, ...rest } = opts;
  const extra = extras?.(fake.driver) ?? {};
  const config: McpConfig | null =
    opts.config === undefined
      ? {
          targets: {
            web: {
              driver: fake.module,
              ...extra,
              toets: { ...extra.toets, timeouts: { ...FAST_TIMEOUTS, ...extra.toets?.timeouts } },
            },
          },
        }
      : opts.config;
  const toets = createToetsMcp({ log: () => {}, ...rest, config });
  const server = toets.createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'toets-test', version: '0.0.0' });
  await client.connect(clientTransport);
  cleanups.push(async () => {
    await client.close();
    await server.close();
    await toets.close();
  });

  const call = (name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> =>
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
  const textOf = (r: CallToolResult): string =>
    r.content.map((c) => (c.type === 'text' ? c.text : `<${c.type}>`)).join('\n');

  return {
    client,
    get driver() {
      return fake.driver();
    },
    call,
    async ok(name, args) {
      const result = await call(name, args);
      if (result.isError) throw new Error(`${name} failed:\n${textOf(result)}`);
      return textOf(result);
    },
    async err(name, args) {
      const result = await call(name, args);
      if (!result.isError) throw new Error(`${name} unexpectedly passed:\n${textOf(result)}`);
      return textOf(result);
    },
    dispose: () => toets.close(),
  };
}
