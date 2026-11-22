import { DpadError, KEY_CAPABILITY, Key } from '@dpad-tv/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEY_MAP, keyCapabilities, resolveKeyMap, type WebKeyMap } from './keys.js';

describe('key map', () => {
  it('maps every key except HOME and MENU by default', () => {
    const unmapped = Object.values(Key).filter((k) => DEFAULT_KEY_MAP[k] === undefined);
    expect(unmapped.sort()).toEqual([Key.HOME, Key.MENU].sort());
  });

  it('uses distinct key values for distinct keys', () => {
    const values = Object.values(DEFAULT_KEY_MAP).map((s) => s.key);
    expect(new Set(values).size).toBe(values.length);
  });

  it('declares a key capability only when all its keys are mapped', () => {
    const all = keyCapabilities(DEFAULT_KEY_MAP);
    expect(all).not.toContain('key.home');
    expect(all).not.toContain('key.menu');
    expect(all).toContain('key.color');

    const noBlue = keyCapabilities(resolveKeyMap({ BLUE: null }));
    expect(noBlue).not.toContain('key.color');

    const withHome = keyCapabilities(resolveKeyMap({ HOME: { key: 'BrowserHome' } }));
    expect(withHome).toContain('key.home');
    // Universal keys never produce a capability.
    expect(withHome.every((c) => Object.values(KEY_CAPABILITY).includes(c))).toBe(true);
  });

  it('applies overrides without mutating the defaults', () => {
    const map = resolveKeyMap({ BACK: { key: 'GoBack', keyCode: 461 }, RED: null });
    expect(map.BACK).toEqual({ key: 'GoBack', keyCode: 461 });
    expect(map.RED).toBeUndefined();
    expect(DEFAULT_KEY_MAP.BACK?.key).toBe('Escape');
    expect(DEFAULT_KEY_MAP.RED).toBeDefined();
  });

  it.each<[string, unknown]>([
    ['unknown key', { OK: { key: 'Enter' } }],
    ['missing key value', { BACK: { keyCode: 461 } }],
    ['empty key value', { BACK: { key: '' } }],
    ['fractional keyCode', { BACK: { key: 'GoBack', keyCode: 4.5 } }],
    ['non-string code', { BACK: { key: 'GoBack', code: 1 } }],
    ['non-object map', 'Escape'],
  ])('rejects %s', (_, overrides) => {
    expect(() => resolveKeyMap(overrides as WebKeyMap)).toThrow(DpadError);
  });
});
