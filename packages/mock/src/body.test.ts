import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BodyCapture, decodeBody, encodeBytes } from './body.js';

describe('BodyCapture', () => {
  it('keeps up to the limit and counts everything', () => {
    const capture = new BodyCapture(5);
    capture.push(Buffer.from('abc'));
    capture.push(Buffer.from('defg'));
    capture.push(Buffer.from('h'));
    expect(capture.bytes().toString()).toBe('abcde');
    expect(capture.size).toBe(8);
    expect(capture.truncated).toBe(true);
  });

  it('is not truncated at exactly the limit', () => {
    const capture = BodyCapture.of(Buffer.from('abcde'), 5);
    expect(capture.truncated).toBe(false);
    capture.push(Buffer.alloc(0));
    expect(capture.truncated).toBe(false);
  });
});

describe('encodeBytes', () => {
  it('uses utf8 for valid UTF-8 and base64 otherwise', () => {
    expect(encodeBytes(Buffer.from('héllo ✓'))).toEqual({ text: 'héllo ✓', encoding: 'utf8' });
    expect(encodeBytes(Buffer.from([0xff, 0xfe, 0x00]))).toEqual({
      text: '//4A',
      encoding: 'base64',
    });
    expect(encodeBytes(Buffer.alloc(0))).toEqual({ text: null, encoding: 'utf8' });
  });
});

describe('decodeBody', () => {
  const json = Buffer.from('{"a":1}');
  const cases: Array<[string, Buffer]> = [
    ['gzip', zlib.gzipSync(json)],
    ['deflate', zlib.deflateSync(json)],
    ['deflate', zlib.deflateRawSync(json)],
    ['br', zlib.brotliCompressSync(json)],
    ['zstd', zlib.zstdCompressSync(json)],
    ['gzip, br', zlib.brotliCompressSync(zlib.gzipSync(json))],
  ];
  it.each(cases)('removes content-encoding %s', (encoding, bytes) => {
    const decoded = decodeBody(BodyCapture.of(bytes, 1024), encoding, 1024);
    expect(decoded).toEqual({ text: '{"a":1}', encoding: 'utf8', decodedSize: 7 });
  });

  it('keeps raw bytes when the capture is truncated or the coding is unknown or broken', () => {
    const gz = zlib.gzipSync(Buffer.from('x'.repeat(100)));
    const truncated = decodeBody(BodyCapture.of(gz, 5), 'gzip', 5);
    expect(truncated.encoding).toBe('base64');
    expect(truncated.decodedSize).toBeNull();
    expect(decodeBody(BodyCapture.of(json, 64), 'compress', 64).decodedSize).toBeNull();
    expect(decodeBody(BodyCapture.of(json, 64), 'gzip', 64).text).toBe('{"a":1}');
  });

  it('treats identity as no encoding', () => {
    expect(decodeBody(BodyCapture.of(json, 64), 'identity', 64).decodedSize).toBe(7);
  });
});
