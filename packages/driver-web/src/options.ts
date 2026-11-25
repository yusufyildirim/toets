import { ToetsError, packageDocsLink } from '@toets/core';
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  LaunchOptions,
  Page,
} from 'playwright-core';
import { resolveKeyMap, type ResolvedKeyMap, type WebKeyMap } from './keys.js';

/** How the launch payload reaches the app. */
export type LaunchTransport = 'query' | 'initScript';

/** Navigation milestone after which `launch()` returns. */
export type LaunchWaitUntil = 'commit' | 'domcontentloaded' | 'load';

/**
 * Options of the web driver. Every field can be set in the app config (`app.web`, describes the
 * app) or in the platform options (`platforms.web({...})`, describes the project); platform
 * options win.
 *
 * The browser source is chosen by which of `page`, `context` and `browser` is set (at most one):
 * - `page`: drive this page. The driver never closes it.
 * - `context`: open the app page in this context. The driver closes only its page.
 * - `browser`: create a context (with `contextOptions`) in this browser. The driver closes it.
 * - none: launch Chromium (with `launchOptions`). The driver owns and closes it.
 */
export interface WebDriverOptions {
  /** URL the app is served at, e.g. `http://localhost:3000`. Required. */
  readonly url?: string;
  /** Attribute holding test IDs. Default `data-testid`. */
  readonly testIdAttribute?: string;
  /** Overrides of the default key map (see the keys docs page). */
  readonly keys?: WebKeyMap;
  /** How the launch payload reaches the app. Default `query` (`?__toets=`). */
  readonly launchTransport?: LaunchTransport;
  /** Navigation milestone after which `launch()` returns. Default `load`. */
  readonly waitUntil?: LaunchWaitUntil;
  /** Key auto-repeat timing during long presses. Default `{ delayMs: 500, intervalMs: 50 }`. */
  readonly keyRepeat?: { readonly delayMs?: number; readonly intervalMs?: number };
  /** Drive this existing page (e.g. Playwright Test's `page` fixture). */
  readonly page?: Page;
  /** Open the app page in this existing context. */
  readonly context?: BrowserContext;
  /** Create the context in this existing browser (e.g. Playwright Test's `browser` fixture). */
  readonly browser?: Browser;
  /** Chromium launch options when the driver launches its own browser. */
  readonly launchOptions?: LaunchOptions;
  /** Context options when the driver creates the context. Default viewport 1920x1080. */
  readonly contextOptions?: BrowserContextOptions;
}

/** Fully validated options. */
export interface ResolvedWebOptions {
  readonly url: URL;
  readonly testIdAttribute: string;
  readonly keys: ResolvedKeyMap;
  readonly launchTransport: LaunchTransport;
  readonly waitUntil: LaunchWaitUntil;
  readonly keyRepeat: { readonly delayMs: number; readonly intervalMs: number };
  readonly source:
    | { readonly kind: 'page'; readonly page: Page }
    | { readonly kind: 'context'; readonly context: BrowserContext }
    | {
        readonly kind: 'browser';
        readonly browser: Browser;
        readonly contextOptions: BrowserContextOptions;
      }
    | {
        readonly kind: 'launch';
        readonly launchOptions: LaunchOptions;
        readonly contextOptions: BrowserContextOptions;
      };
}

/** Default viewport of contexts the driver creates: a 1080p TV screen. */
export const DEFAULT_VIEWPORT = { width: 1920, height: 1080 } as const;

const DOCS = packageDocsLink('driver-web', 'options');

function invalid(message: string, hint: string): ToetsError {
  return new ToetsError('WEB_INVALID_CONFIG', message, { hint, docs: DOCS });
}

function optionalString(o: Record<string, unknown>, name: string): string | undefined {
  const v = o[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.trim() === '') {
    throw invalid(`\`${name}\` must be a non-empty string.`, `Fix \`${name}\` in the web config.`);
  }
  return v;
}

function oneOf<T extends string>(
  o: Record<string, unknown>,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const v = o[name];
  if (v === undefined) return fallback;
  if (!allowed.includes(v as T)) {
    throw invalid(
      `\`${name}\` must be one of ${allowed.join(', ')}.`,
      `Fix \`${name}\` in the web config.`,
    );
  }
  return v as T;
}

function positive(v: unknown, name: string, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw invalid(`\`${name}\` must be a positive number of milliseconds.`, `Fix \`${name}\`.`);
  }
  return v;
}

/**
 * Merges the app config and platform options (platform wins) and validates the result.
 * Throws `ToetsError` (`WEB_INVALID_CONFIG`) with a hint for anything malformed.
 */
export function resolveOptions(
  options: WebDriverOptions,
  app: Readonly<Record<string, unknown>> = {},
): ResolvedWebOptions {
  const merged: Record<string, unknown> = { ...app };
  for (const [k, v] of Object.entries(options)) if (v !== undefined) merged[k] = v;

  const rawUrl = optionalString(merged, 'url');
  if (rawUrl === undefined) {
    throw invalid(
      'The web app URL is missing.',
      "Set `app.web.url` in the toets config, e.g. `{ web: { url: 'http://localhost:3000' } }`.",
    );
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw invalid(
      `\`url\` is not an absolute URL: ${rawUrl}`,
      'Use a full URL such as `http://localhost:3000`.',
    );
  }

  if (merged.focus !== undefined) {
    throw invalid(
      'The web driver has no `focus` option: it reads DOM focus only.',
      'For a JS focus engine (virtual focus), remove `focus` and report focus from the app with `reportFocus()` from `@toets/sdk`.',
    );
  }

  const repeat = (merged.keyRepeat ?? {}) as Record<string, unknown>;

  const sources = (['page', 'context', 'browser'] as const).filter((k) => merged[k] !== undefined);
  if (sources.length > 1) {
    throw invalid(
      `Only one of \`page\`, \`context\` and \`browser\` may be set (got ${sources.join(', ')}).`,
      'Pass the most specific handle you have; the driver derives the rest.',
    );
  }
  const contextOptions: BrowserContextOptions = {
    viewport: DEFAULT_VIEWPORT,
    ...(merged.contextOptions as BrowserContextOptions | undefined),
  };
  let source: ResolvedWebOptions['source'];
  if (merged.page !== undefined) source = { kind: 'page', page: merged.page as Page };
  else if (merged.context !== undefined)
    source = { kind: 'context', context: merged.context as BrowserContext };
  else if (merged.browser !== undefined) {
    source = { kind: 'browser', browser: merged.browser as Browser, contextOptions };
  } else {
    source = {
      kind: 'launch',
      launchOptions: (merged.launchOptions as LaunchOptions | undefined) ?? {},
      contextOptions,
    };
  }

  return {
    url,
    testIdAttribute: optionalString(merged, 'testIdAttribute') ?? 'data-testid',
    keys: resolveKeyMap(merged.keys as WebKeyMap | undefined),
    launchTransport: oneOf(merged, 'launchTransport', ['query', 'initScript'], 'query'),
    waitUntil: oneOf(merged, 'waitUntil', ['commit', 'domcontentloaded', 'load'], 'load'),
    keyRepeat: {
      delayMs: positive(repeat.delayMs, 'keyRepeat.delayMs', 500),
      intervalMs: positive(repeat.intervalMs, 'keyRepeat.intervalMs', 50),
    },
    source,
  };
}
