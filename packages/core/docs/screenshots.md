---
description: Screenshot assertions that settle animated TV screens: stable frames, masks, thresholds and per-platform baselines.
---

# Screenshots

```ts nocheck
await expect(app).toMatchScreenshot({ mask: [app.getByTestId('hero_video')] });
await expect(app.getByTestId('rail')).toMatchScreenshot({ maxDiffPixelRatio: 0.01 });

const shot = await app.screenshot(); // opaque; screenshotPng(shot) gives the PNG bytes
```

## Principles

- **Baselines are per platform.** Each project has its own baseline files; different platforms render differently and are never compared to each other. A missing baseline is written and the test fails once (Playwright's `toMatchSnapshot`); update with `--update-snapshots`. File names carry the host OS (`-darwin`, `-linux`): record baselines where CI runs.
- **Stable before compared.** `toMatchScreenshot` waits until two consecutive screenshots are identical, then compares with Playwright's image comparator (`threshold`, `maxDiffPixels`, `maxDiffPixelRatio`).
- **Mask what moves.** `mask` paints the given elements a solid color before comparing.
- **Element screenshots are crops** of the full screen on every platform, so they look the same everywhere. An element that is not on screen fails with `ELEMENT_OFFSCREEN`.
- **Prefer text snapshots** for structure and state; use screenshots for what only pixels show (focus rings, layout, artwork).

## TV trap: video and focus animations

A playing video, a focus scale animation or a shimmer placeholder never produces two identical frames, so the assertion times out with "the screen kept changing". Mask the video surface, assert after the focus animation settles, or assert a region that does not move.
