import { ToetsError } from '@toets/core';
import { describe, expect, it } from 'vitest';
import { defaultWebDeepLink, translateWebDeepLink } from '../src/launch.js';

const appUrl = new URL('http://localhost:8091/app/?lang=en');

describe('defaultWebDeepLink', () => {
  it.each([
    ['myapp://details/42', 'details/42'],
    ['myapp://details/42?t=1#x', 'details/42?t=1#x'],
    ['myapp://home', 'home'],
    ['myapp:///details/42', 'details/42'],
    ['https://example.com/watch/42?t=1', 'watch/42?t=1'],
    ['http://example.com/', ''],
  ])('%s -> %s', (link, route) => {
    expect(defaultWebDeepLink(new URL(link))).toBe(route);
  });
});

describe('translateWebDeepLink', () => {
  it('resolves the route against the app URL', () => {
    expect(translateWebDeepLink(appUrl, new URL('myapp://details/42'), undefined)).toEqual({
      description: 'http://localhost:8091/app/details/42',
      data: 'http://localhost:8091/app/details/42',
    });
  });

  it('takes absolute paths and URLs from the mapper', () => {
    const translate = (mapped: string) =>
      translateWebDeepLink(appUrl, new URL('myapp://x'), () => mapped).data;
    expect(translate('/watch/1')).toBe('http://localhost:8091/watch/1');
    expect(translate('?route=details')).toBe('http://localhost:8091/app/?route=details');
    expect(translate('https://tv.example.com/x')).toBe('https://tv.example.com/x');
  });

  it.each([
    ['myapp://details/42', '"myapp://details/42"'],
    ['javascript:alert(1)', '"javascript:alert(1)"'],
    [42, '42'],
    [undefined, 'undefined'],
  ])('refuses %j', (mapped, shown) => {
    let error: unknown;
    try {
      translateWebDeepLink(appUrl, new URL('myapp://x'), () => mapped as string);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ToetsError);
    expect((error as ToetsError).code).toBe('DEEPLINK_INVALID');
    expect((error as ToetsError).message).toBe(
      `The web deepLink mapper returned ${shown} for myapp://x, which is no page URL.`,
    );
  });
});
