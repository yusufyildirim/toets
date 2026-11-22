import { PNG } from 'pngjs';
import type { Screenshot } from '../api.js';
import { DpadError, packageDocsLink } from '../errors.js';
import type { Rect } from '../snapshot.js';

const PNG_BYTES = Symbol('dpad.png');

interface ScreenshotData {
  readonly [PNG_BYTES]: Uint8Array;
}

export function createScreenshot(png: Uint8Array): Screenshot {
  const shot: ScreenshotData = { [PNG_BYTES]: png };
  return shot as unknown as Screenshot;
}

/** PNG bytes of a screenshot taken with `app.screenshot()` or `locator.screenshot()`. */
export function screenshotPng(shot: Screenshot): Uint8Array {
  const bytes = (shot as unknown as Partial<ScreenshotData>)[PNG_BYTES];
  if (!bytes) {
    throw new DpadError('INVALID_SCREENSHOT', 'Not a dpad screenshot.', {
      hint: 'Pass the value returned by app.screenshot() or locator.screenshot().',
      docs: packageDocsLink('core', 'screenshots'),
    });
  }
  return bytes;
}

function decode(png: Uint8Array): PNG {
  try {
    return PNG.sync.read(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
  } catch (cause) {
    throw new DpadError('INVALID_SCREENSHOT', 'The driver returned bytes that are not a PNG.', {
      hint: 'This is a driver bug: Driver.screenshot() must return PNG bytes.',
      docs: packageDocsLink('core', 'screenshots'),
      cause,
    });
  }
}

const encode = (png: PNG): Uint8Array => new Uint8Array(PNG.sync.write(png));

/**
 * Pixel rect for a rect in tree coordinates. Trees use logical pixels; screenshots may be
 * device pixels, so scale by the ratio of image width to viewport width.
 */
function toPixels(
  rect: Rect,
  scale: number,
  png: PNG,
): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.floor(rect.x * scale));
  const y = Math.max(0, Math.floor(rect.y * scale));
  const right = Math.min(png.width, Math.ceil((rect.x + rect.width) * scale));
  const bottom = Math.min(png.height, Math.ceil((rect.y + rect.height) * scale));
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/** Paints `rects` (tree coordinates) with opaque magenta, like Playwright masks. */
export function maskPng(
  png: Uint8Array,
  rects: readonly Rect[],
  viewportWidth: number,
): Uint8Array {
  if (!rects.length) return png;
  const image = decode(png);
  const scale = viewportWidth > 0 ? image.width / viewportWidth : 1;
  for (const rect of rects) {
    const p = toPixels(rect, scale, image);
    for (let yy = p.y; yy < p.y + p.h; yy++) {
      for (let xx = p.x; xx < p.x + p.w; xx++) {
        const i = (yy * image.width + xx) * 4;
        image.data[i] = 0xff;
        image.data[i + 1] = 0x00;
        image.data[i + 2] = 0xff;
        image.data[i + 3] = 0xff;
      }
    }
  }
  return encode(image);
}

/** Crops `rect` (tree coordinates) out of a viewport screenshot. */
export function cropPng(png: Uint8Array, rect: Rect, viewportWidth: number): Uint8Array {
  const image = decode(png);
  const scale = viewportWidth > 0 ? image.width / viewportWidth : 1;
  const p = toPixels(rect, scale, image);
  if (p.w === 0 || p.h === 0) {
    throw new DpadError('ELEMENT_OFFSCREEN', 'Cannot screenshot an element outside the viewport.', {
      hint: 'Bring it on screen first (navigate focus to it), then take the screenshot.',
      docs: packageDocsLink('core', 'screenshots'),
    });
  }
  const out = new PNG({ width: p.w, height: p.h });
  PNG.bitblt(image, out, p.x, p.y, p.w, p.h, 0, 0);
  return encode(out);
}
