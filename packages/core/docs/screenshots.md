---
description: Screenshot assertions that settle animated TV screens - stable frames, masks, thresholds and per-platform baselines.
---

# Screenshots

```ts nocheck
await expect(app).toMatchScreenshot({ mask: [app.getByTestId('hero-video')] });
await expect(app.getByTestId('rail')).toMatchScreenshot({ maxDiffPixelRatio: 0.01 });

const shot = await app.screenshot(); // opaque; screenshotPng(shot) gives the PNG bytes
```

## Principles

- **Baselines are per project, never per host.** Each project (platform and device) has its own baseline files; different platforms render differently and are never compared to each other. A missing baseline is written and the test fails once (Playwright's `toMatchSnapshot`); update with `--update-snapshots`. toets projects default `snapshotPathTemplate` to Playwright's default without the host OS suffix (`{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{ext}`), so a baseline recorded on a laptop is the one CI compares to. Set `snapshotPathTemplate` to change it.
- **Stable before compared.** `toMatchScreenshot` waits until two consecutive screenshots are identical, then compares with Playwright's image comparator (`threshold`, `maxDiffPixels`, `maxDiffPixelRatio`).
- **Mask what moves.** `mask` paints the given elements a solid color before comparing.
- **Element screenshots are crops** of the full screen on every platform, so they look the same everywhere. An element that is not on screen fails with `ELEMENT_OFFSCREEN`.
- **Prefer text snapshots** for structure and state; use screenshots for what only pixels show (focus rings, layout, artwork).

## TV trap: video and focus animations

A playing video, a focus scale animation or a shimmer placeholder never produces two identical frames, so the assertion times out with "the screen kept changing". Mask the video surface, assert after the focus animation settles, or assert a region that does not move.

## Web trap: the browser renders with the host's fonts

Emulator and simulator screenshots come from the device and do not depend on the host. Chromium does: fonts and anti-aliasing differ between macOS and Linux. Record web baselines in the environment CI runs (for example Playwright's Docker image), or keep web screenshot assertions to regions without text.
