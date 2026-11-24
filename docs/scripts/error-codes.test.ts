import { describe, expect, it } from 'vitest';
import { collectErrorCodes } from './error-codes.ts';

describe('error code index', () => {
  const codes = new Map(collectErrorCodes().map((c) => [c.code, c]));

  it('finds codes thrown with literals, constants and helpers', () => {
    expect(codes.get('ELEMENT_NOT_FOUND')?.docs).toContain('reference/core/docs/locators');
    expect(codes.get('MOCK_NO_ORIGIN')?.packages).toEqual(['mock']);
    expect(codes.get('TVOS_NO_DEVICE')?.packages).toEqual(['driver-tvos']);
    expect(codes.get('ANDROID_SDK_NOT_FOUND')?.docs).toContain(
      'reference/driver-android-tv/docs/setup',
    );
  });

  it('includes declared codes with their doc comments', () => {
    expect(codes.get('sdk.unknown-token')?.meaning).toMatch(/token this host never issued/);
    expect(codes.get('MOCK_CLIENT_ABORTED')?.meaning).toMatch(/closed the connection/);
  });

  it('ignores codes of test doubles and non-error strings', () => {
    expect(codes.has('PLAY_PAUSE')).toBe(false);
    expect(codes.has('TOETS_DEVICES')).toBe(false);
  });

  it('gives every code a meaning', () => {
    expect([...codes.values()].filter((c) => !c.meaning)).toEqual([]);
  });
});
