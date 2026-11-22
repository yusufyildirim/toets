import { describe, expect, it } from 'vitest';
import { isProtocolCompatible, parseProtocolVersion, protocolSupportsMethod } from '../src/index.js';

describe('protocol versions', () => {
  it('parses semver and ignores suffixes', () => {
    expect(parseProtocolVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseProtocolVersion('1.2.3-beta.1')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseProtocolVersion('1.2')).toBeNull();
    expect(parseProtocolVersion(1)).toBeNull();
  });

  it('is compatible on equal majors only', () => {
    expect(isProtocolCompatible('1.0.0', '1.9.3')).toBe(true);
    expect(isProtocolCompatible('2.0.0', '1.0.0')).toBe(false);
    expect(isProtocolCompatible('x', '1.0.0')).toBe(false);
  });

  it('gates methods by the minor that introduced them', () => {
    expect(protocolSupportsMethod('1.0.0', 'tree.get')).toBe(true);
    expect(protocolSupportsMethod('2.0.0', 'tree.get')).toBe(false);
  });
});
