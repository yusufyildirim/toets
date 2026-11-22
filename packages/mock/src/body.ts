import zlib from 'node:zlib';

/** How a recorded body string is encoded. Binary bodies are base64 so nothing is lost. */
export type BodyEncoding = 'utf8' | 'base64';

/** Collects up to `limit` bytes of a body while counting its full size. */
export class BodyCapture {
  private readonly chunks: Buffer[] = [];
  private captured = 0;
  /** Total bytes seen, including bytes beyond the capture limit. */
  size = 0;
  /** True when bytes beyond the limit were dropped. */
  truncated = false;

  constructor(private readonly limit: number) {}

  static of(buffer: Buffer, limit: number): BodyCapture {
    const capture = new BodyCapture(limit);
    capture.push(buffer);
    return capture;
  }

  push(chunk: Uint8Array): void {
    this.size += chunk.byteLength;
    const room = this.limit - this.captured;
    if (room <= 0) {
      if (chunk.byteLength > 0) this.truncated = true;
      return;
    }
    const kept = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
    if (kept.byteLength < chunk.byteLength) this.truncated = true;
    this.chunks.push(Buffer.from(kept));
    this.captured += kept.byteLength;
  }

  bytes(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

export interface DecodedBody {
  readonly text: string | null;
  readonly encoding: BodyEncoding;
  /** Size after removing `content-encoding`, when it could be decoded. */
  readonly decodedSize: number | null;
}

/**
 * Turns captured bytes into a recordable string. Removes `content-encoding` (gzip, deflate, br,
 * zstd) when the capture is complete, then uses UTF-8 when the bytes are valid UTF-8, base64
 * otherwise.
 */
export function decodeBody(
  capture: BodyCapture,
  contentEncoding: string | null,
  limit: number,
): DecodedBody {
  let bytes = capture.bytes();
  if (bytes.byteLength === 0) return { text: null, encoding: 'utf8', decodedSize: 0 };
  let decodedSize: number | null = capture.truncated ? null : bytes.byteLength;
  if (contentEncoding && !capture.truncated) {
    const inflated = decompress(bytes, contentEncoding, limit);
    if (inflated) {
      bytes = inflated;
      decodedSize = inflated.byteLength;
    } else {
      decodedSize = null;
    }
  }
  return { ...encodeBytes(bytes), decodedSize };
}

export function encodeBytes(bytes: Buffer): { text: string | null; encoding: BodyEncoding } {
  if (bytes.byteLength === 0) return { text: null, encoding: 'utf8' };
  try {
    return { text: utf8.decode(bytes), encoding: 'utf8' };
  } catch {
    return { text: bytes.toString('base64'), encoding: 'base64' };
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Decodes a (possibly multi-step) `content-encoding`. Returns null when unknown or invalid. */
function decompress(bytes: Buffer, contentEncoding: string, limit: number): Buffer | null {
  const codings = contentEncoding
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c !== '' && c !== 'identity')
    .reverse();
  const options = { maxOutputLength: Math.max(limit, 1) };
  try {
    let out = bytes;
    for (const coding of codings) {
      switch (coding) {
        case 'gzip':
        case 'x-gzip':
          out = zlib.gunzipSync(out, options);
          break;
        case 'deflate':
          out = inflateEither(out, options);
          break;
        case 'br':
          out = zlib.brotliDecompressSync(out, options);
          break;
        case 'zstd':
          out = zlib.zstdDecompressSync(out, options);
          break;
        default:
          return null;
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** `deflate` should be zlib-wrapped, but some servers send raw deflate; accept both. */
function inflateEither(bytes: Buffer, options: zlib.ZlibOptions): Buffer {
  try {
    return zlib.inflateSync(bytes, options);
  } catch {
    return zlib.inflateRawSync(bytes, options);
  }
}
