import type { Rect } from '@toets/core';
import { PNG } from 'pngjs';

/** Crops a PNG to `rect` (clamped to the image). Returns `null` when nothing is left. */
export function cropPng(png: Uint8Array, rect: Rect): Uint8Array | null {
  const src = PNG.sync.read(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
  const x = clamp(Math.round(rect.x), 0, src.width);
  const y = clamp(Math.round(rect.y), 0, src.height);
  const right = clamp(Math.round(rect.x + rect.width), 0, src.width);
  const bottom = clamp(Math.round(rect.y + rect.height), 0, src.height);
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) return null;
  const dst = new PNG({ width, height });
  PNG.bitblt(src, dst, x, y, width, height, 0, 0);
  return new Uint8Array(PNG.sync.write(dst));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
