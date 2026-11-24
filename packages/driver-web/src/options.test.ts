import { ToetsError } from '@toets/core';
import type { Browser, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEWPORT, resolveOptions, type WebDriverOptions } from './options.js';

const url = 'http://localhost:3000/app';

function invalid(options: WebDriverOptions, app?: Record<string, unknown>): ToetsError {
  try {
    resolveOptions(options, app);
  } catch (error) {
    expect(error).toBeInstanceOf(ToetsError);
    expect((error as ToetsError).code).toBe('WEB_INVALID_CONFIG');
    expect((error as ToetsError).hint).toBeTruthy();
    return error as ToetsError;
  }
  throw new Error('expected resolveOptions to throw');
}

describe('resolveOptions', () => {
  it('applies defaults', () => {
    const o = resolveOptions({ url });
    expect(o.url.href).toBe(url);
    expect(o.testIdAttribute).toBe('data-testid');
    expect(o.launchTransport).toBe('query');
    expect(o.waitUntil).toBe('load');
    expect(o.keyRepeat).toEqual({ delayMs: 500, intervalMs: 50 });
    expect(o.focusedSelector).toBeNull();
    expect(o.source).toEqual({
      kind: 'launch',
      launchOptions: {},
      contextOptions: { viewport: DEFAULT_VIEWPORT },
    });
  });

  it('merges app config and platform options, platform winning', () => {
    const o = resolveOptions(
      { testIdAttribute: 'data-test' },
      { url, testIdAttribute: 'data-qa', focus: { focused: '.focused' } },
    );
    expect(o.url.href).toBe(url);
    expect(o.testIdAttribute).toBe('data-test');
    expect(o.focusedSelector).toBe('.focused');
    expect(o.focusableSelector).toBeNull();
  });

  it('picks the browser source', () => {
    const page = {} as Page;
    const browser = {} as Browser;
    expect(resolveOptions({ url, page }).source).toEqual({ kind: 'page', page });
    expect(resolveOptions({ url, browser, contextOptions: { viewport: null } }).source).toEqual({
      kind: 'browser',
      browser,
      contextOptions: { viewport: null },
    });
    expect(invalid({ url, page, browser }).message).toContain('page, browser');
  });

  it('explains a missing or relative URL', () => {
    expect(invalid({}).hint).toContain('app.web.url');
    invalid({ url: '/relative' });
  });

  it.each<[string, WebDriverOptions]>([
    ['empty testIdAttribute', { url, testIdAttribute: ' ' }],
    ['unknown transport', { url, launchTransport: 'hash' as never }],
    ['unknown waitUntil', { url, waitUntil: 'networkidle' as never }],
    ['non-positive repeat delay', { url, keyRepeat: { delayMs: 0 } }],
    ['empty focus selector', { url, focus: { focused: '' } }],
    ['bad key map', { url, keys: { BACK: { key: '' } } }],
  ])('rejects %s', (_, options) => {
    invalid(options);
  });
});
