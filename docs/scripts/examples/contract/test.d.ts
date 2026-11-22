/**
 * Phase 1 stand-in for `@dpad-tv/test`, used only by the docs example check while the real
 * package is being built. Derived from `packages/core/src/api.ts` and PLAN.md (S1).
 *
 * Phase 2: run the check with `--resolve=real` (then make it the default) and delete this
 * folder. Differences between this file and the real package are docs bugs to fix then.
 */
import type {
  Expect,
  MatcherReturnType,
  PlaywrightTestConfig,
  TestDetails,
  TestInfo,
  TestType,
} from '@playwright/test';
import type {
  App,
  Capability,
  Key as KeyName,
  KeyOverride,
  Locator,
  Media,
  Network,
} from '@dpad-tv/core';

export { Key } from '@dpad-tv/core';
export type {
  App,
  Capability,
  Direction,
  Focus,
  LaunchOptions,
  Locator,
  Media,
  Network,
  PlatformInfo,
  Remote,
  Screenshot,
} from '@dpad-tv/core';

export interface DpadFixtures {
  app: App;
}

export interface DpadTestDetails extends TestDetails {
  /** Capabilities the test needs. Unmet requirements skip the test with a reason. */
  requires?: readonly Capability[];
}

type Body = (args: DpadFixtures, testInfo: TestInfo) => Promise<unknown> | unknown;

export type DpadTest = {
  (title: string, details: DpadTestDetails, body: Body): void;
} & TestType<DpadFixtures, object>;

export declare const test: DpadTest;

interface Timeout {
  timeout?: number;
}

type M = Promise<MatcherReturnType>;

export interface DpadMatchers {
  toBeVisible(receiver: Locator, opts?: Timeout): M;
  toBeInViewport(receiver: Locator, opts?: Timeout): M;
  toBeFocused(receiver: Locator, opts?: Timeout): M;
  toHaveFocusWithin(receiver: Locator, opts?: Timeout): M;
  toBeEnabled(receiver: Locator, opts?: Timeout): M;
  toBeDisabled(receiver: Locator, opts?: Timeout): M;
  toBeSelected(receiver: Locator, opts?: Timeout): M;
  toBeBusy(receiver: Locator, opts?: Timeout): M;
  toHaveText(receiver: Locator, expected: string | RegExp, opts?: Timeout): M;
  toContainText(receiver: Locator, expected: string | RegExp, opts?: Timeout): M;
  toHaveCount(receiver: Locator, count: number, opts?: Timeout): M;
  toMatchScreenshot(receiver: Locator | App, name?: string, opts?: Timeout): M;
  toMatchTextSnapshot(receiver: Locator | App, name?: string, opts?: Timeout): M;
  toBePlaying(receiver: Media, opts?: Timeout): M;
  toBePaused(receiver: Media, opts?: Timeout): M;
  toHavePosition(receiver: Media, seconds: { min?: number; max?: number }, opts?: Timeout): M;
  toHaveRequested(
    receiver: Network,
    filter: { method?: string; url?: string | RegExp },
    opts?: Timeout,
  ): M;
}

export declare const expect: Expect<DpadMatchers>;

export interface WebAppConfig {
  url: string;
}

export interface AndroidTVAppConfig {
  apk?: string;
  package: string;
  activity?: string;
}

export interface TVOSAppConfig {
  app?: string;
  bundleId: string;
}

export interface ProjectOptions {
  /** Project name. Defaults to the platform name (`web`, `android-tv`, `tvos`). */
  name?: string;
  keyOverrides?: Partial<Record<KeyName, KeyOverride>>;
}

export interface DpadProject {
  readonly name: string;
}

export interface DpadConfig extends Omit<PlaywrightTestConfig, 'projects'> {
  app: { web?: WebAppConfig; androidTV?: AndroidTVAppConfig; tvOS?: TVOSAppConfig };
  projects: readonly DpadProject[];
}

export declare const platforms: {
  web(opts?: ProjectOptions): DpadProject;
  androidTV(opts?: ProjectOptions & { avd?: string; api?: number }): DpadProject;
  tvOS(opts?: ProjectOptions & { runtime?: string; model?: string }): DpadProject;
};

export declare function defineConfig(config: DpadConfig): PlaywrightTestConfig;
