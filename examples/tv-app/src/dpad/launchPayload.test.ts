import { describe, expect, it } from 'vitest';

import { decodeWebLaunchParam, parseLaunchPayload } from './launchPayload';

const payload = { v: 1, mockUrl: 'http://localhost:9400', flags: { beta: true } };

describe('parseLaunchPayload', () => {
  it('accepts JSON strings and objects', () => {
    expect(parseLaunchPayload(JSON.stringify(payload))).toEqual(payload);
    expect(parseLaunchPayload(payload)).toEqual(payload);
  });

  it('stays inert on anything malformed', () => {
    expect(parseLaunchPayload(null)).toBeNull();
    expect(parseLaunchPayload('not json')).toBeNull();
    expect(parseLaunchPayload('{"v":2}')).toBeNull();
    expect(parseLaunchPayload({ v: 1, mockUrl: 'ftp://nope' })).toBeNull();
  });
});

describe('decodeWebLaunchParam', () => {
  it('decodes base64url JSON, including non-ASCII values', () => {
    const value = { ...payload, state: 'héllo' };
    const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(decodeWebLaunchParam(encoded)).toEqual(value);
  });

  it('accepts raw JSON and rejects garbage', () => {
    expect(decodeWebLaunchParam(JSON.stringify(payload))).toEqual(payload);
    expect(decodeWebLaunchParam('%%%')).toBeNull();
    expect(decodeWebLaunchParam(null)).toBeNull();
  });
});
