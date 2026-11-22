import { encodeLaunchPayloadParam, type LaunchPayload } from '@dpad-tv/protocol';
import { createSdkHost, type SdkHost, type SdkSession } from '@dpad-tv/protocol/host';
import { vi } from 'vitest';
import type * as AdapterModule from '../src/index.js';
import type * as Mock from './mocks/react-native.js';

export type Adapter = typeof AdapterModule;
export type MockRN = typeof Mock;

/** Fresh adapter + SDK + mock React Native module state (module-level singletons reset). */
export async function load(os = 'android'): Promise<{ sdk: Adapter; RN: MockRN }> {
  vi.resetModules();
  const RN = (await import('react-native')) as unknown as MockRN;
  RN.Platform.OS = os;
  const sdk = await import('../src/index.js');
  return { sdk, RN };
}

const hosts: SdkHost[] = [];
const cleanups: Array<() => void> = [];

export interface Launch {
  host: SdkHost;
  token: string;
  /** Base64url payload. */
  payload: string;
  session(): Promise<SdkSession>;
}

export async function launch(extra: Partial<LaunchPayload> = {}): Promise<Launch> {
  const host = await createSdkHost({ heartbeatIntervalMs: 0 });
  hosts.push(host);
  const token = host.issueToken();
  const payload = encodeLaunchPayloadParam({ v: 1, sdkUrl: host.url, token, ...extra });
  return { host, token, payload, session: () => host.waitForSession(token, { timeoutMs: 5000 }) };
}

/** Runs after the test (unmounts, stops runtimes). */
export function onCleanup(fn: () => void): void {
  cleanups.push(fn);
}

export async function cleanup(): Promise<void> {
  for (const fn of cleanups.splice(0).reverse()) {
    try {
      fn();
    } catch {
      // keep cleaning
    }
  }
  for (const host of hosts.splice(0)) await host.close();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function eventually(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await sleep(10);
  }
}
