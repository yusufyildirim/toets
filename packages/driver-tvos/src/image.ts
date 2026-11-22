import type { Rect } from '@dpad-tv/core';
import { PNG } from 'pngjs';

/**
 * Crops a viewport screenshot to an element. Element bounds are in points; the PNG is in
 * pixels (2x on Apple TV 4K at 4K, 1x on the 1080p models), so bounds are scaled by
 * `png.width / viewportWidth`. Returns `null` when the element is entirely off screen.
 */
export function cropPng(png: Uint8Array, bounds: Rect, viewportWidth: number): Uint8Array | null {
  const src = PNG.sync.read(Buffer.from(png));
  const scale = viewportWidth > 0 ? src.width / viewportWidth : 1;
  const x0 = clamp(Math.round(bounds.x * scale), 0, src.width);
  const y0 = clamp(Math.round(bounds.y * scale), 0, src.height);
  const x1 = clamp(Math.round((bounds.x + bounds.width) * scale), 0, src.width);
  const y1 = clamp(Math.round((bounds.y + bounds.height) * scale), 0, src.height);
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return null;
  const out = new PNG({ width, height });
  PNG.bitblt(src, out, x0, y0, width, height, 0, 0);
  return new Uint8Array(PNG.sync.write(out));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
