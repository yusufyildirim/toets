import { describe, expect, it } from 'vitest';
import {
  decodeLaunchPayload,
  encodeLaunchPayload,
  encodeLaunchPayloadParam,
  type LaunchPayload,
} from '../src/index.js';

const payload: LaunchPayload = {
  v: 1,
  sdkUrl: 'ws://localhost:9323',
  token: 'abc',
  mockUrl: 'http://localhost:9400',
  state: 'home • ünïcødé 🚀',
  flags: { a: true, b: 2, c: 'x' },
};

describe('launch payload codec', () => {
  it('round-trips the base64url form, including non-ASCII text', () => {
    const encoded = encodeLaunchPayloadParam(payload);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeLaunchPayload(encoded)).toEqual(payload);
  });

  it('matches Node base64url output', () => {
    const json = encodeLaunchPayload(payload);
    expect(encodeLaunchPayloadParam(payload)).toBe(Buffer.from(json).toString('base64url'));
  });

  it('accepts the JSON form, padded standard base64 and parsed objects', () => {
    const json = encodeLaunchPayload(payload);
    expect(decodeLaunchPayload(json)).toEqual(payload);
    expect(decodeLaunchPayload(` ${json} `)).toEqual(payload);
    expect(decodeLaunchPayload(Buffer.from(json).toString('base64'))).toEqual(payload);
    expect(decodeLaunchPayload({ v: 1 })).toEqual({ v: 1 });
  });

  it.each([
    null,
    undefined,
    '',
    'not base64 !',
    '{broken',
    '[]',
    JSON.stringify({ v: 2 }),
    JSON.stringify({ v: 1, sdkUrl: 'ws://x' }),
    JSON.stringify({ v: 1, state: 3 }),
    JSON.stringify({ v: 1, flags: { a: {} } }),
    JSON.stringify({ v: 1, flags: [] }),
    42,
  ])('returns null for malformed input %#', (raw) => {
    expect(decodeLaunchPayload(raw)).toBeNull();
  });
});
