import type { ToetsError } from '@toets/core';
import { describe, expect, it } from 'vitest';
import {
  describeIntent,
  intentArgs,
  translateAndroidDeepLink,
  type AndroidDeepLink,
  type AndroidIntent,
} from '../src/deep-link.js';

const link = new URL('myapp://details/42');
const intent = (mapped: string | AndroidDeepLink) =>
  translateAndroidDeepLink(link, () => mapped).data as AndroidIntent;

describe('translateAndroidDeepLink', () => {
  it('defaults to the link as a VIEW intent', () => {
    const t = translateAndroidDeepLink(link, undefined);
    expect(t.description).toBe('myapp://details/42');
    expect(t.data).toEqual({
      action: 'android.intent.action.VIEW',
      uri: 'myapp://details/42',
      categories: [],
      extras: [],
    });
  });

  it('takes a URI string or an intent from the mapper', () => {
    expect(translateAndroidDeepLink(link, (l) => `https://example.com/watch${l.pathname}`)).toEqual(
      {
        description: 'https://example.com/watch/42',
        data: {
          action: 'android.intent.action.VIEW',
          uri: 'https://example.com/watch/42',
          categories: [],
          extras: [],
        },
      },
    );
    expect(intent({ action: 'com.example.PLAY', extras: { id: '42' } })).toEqual({
      action: 'com.example.PLAY',
      categories: [],
      extras: [['id', '42']],
    });
    // A VIEW intent with more than a URI is described as an intent.
    expect(
      translateAndroidDeepLink(link, () => ({ uri: 'myapp://x', categories: ['a.B'] })).description,
    ).toBe('intent android.intent.action.VIEW myapp://x categories [a.B]');
  });

  it.each([
    ['', 'an empty string'],
    [42, '42'],
    [null, 'null'],
    [{}, 'an intent without uri or action'],
    [{ uri: '' }, 'uri ""'],
    [{ action: 3 }, 'action 3'],
    [{ action: 'a', categories: 'x' }, 'categories "x"'],
    [{ action: 'a', mimeType: '' }, 'mimeType ""'],
    [{ action: 'a', extras: [] }, 'extras []'],
    [{ action: 'a', extras: { n: Number.NaN } }, 'extra n = null'],
    [{ action: 'a', extras: { o: {} } }, 'extra o = {}'],
    [{ action: 'a', extras: { __toets: 'x' } }, 'the reserved extra "__toets"'],
  ])('refuses %j', (mapped, problem) => {
    let err: ToetsError | undefined;
    try {
      translateAndroidDeepLink(link, () => mapped as AndroidDeepLink);
    } catch (e) {
      err = e as ToetsError;
    }
    expect(err?.code).toBe('DEEPLINK_INVALID');
    expect(err?.message).toBe(
      `The android-tv deepLink mapper returned ${problem} for myapp://details/42.`,
    );
  });

  it('lets mapper errors through for the core to report', () => {
    expect(() =>
      translateAndroidDeepLink(link, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
  });
});

describe('intentArgs', () => {
  it('types extras and targets the package, never a component', () => {
    const args = intentArgs(
      intent({
        uri: 'myapp://x?a=1&b=2',
        action: 'com.example.PLAY',
        categories: ['c.One', 'c.Two'],
        mimeType: 'video/mp4',
        extras: { s: 'two words', t: true, f: false, i: -7, l: 2 ** 40, d: 1.5 },
      }),
      'com.example.tv',
    );
    expect(args).toEqual([
      '-a',
      'com.example.PLAY',
      '-d',
      'myapp://x?a=1&b=2',
      '-c',
      'c.One',
      '-c',
      'c.Two',
      '-t',
      'video/mp4',
      '--es',
      's',
      'two words',
      '--ez',
      't',
      'true',
      '--ez',
      'f',
      'false',
      '--ei',
      'i',
      '-7',
      '--el',
      'l',
      '1099511627776',
      '--ef',
      'd',
      '1.5',
      '-p',
      'com.example.tv',
    ]);
    expect(args).not.toContain('-n');
  });

  it('describes intents in one line', () => {
    expect(
      describeIntent(intent({ action: 'com.example.PLAY', extras: { contentId: '42', n: 1 } })),
    ).toBe('intent com.example.PLAY extras { contentId: "42", n: 1 }');
  });
});
