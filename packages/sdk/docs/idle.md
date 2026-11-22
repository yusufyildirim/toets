# Idle tracking

`sync.waitForIdle` answers as soon as the app has done no tracked work for a quiet window (100 ms by default). Assertions use it to settle instantly instead of polling, and negative assertions ("X is not shown") become fast. Idle is an accelerator, never a gate: when the app never settles, dpad falls back to polling and reports what kept it busy.

## What counts as busy

| Kind                        | Source                                                                 |
| --------------------------- | ---------------------------------------------------------------------- |
| `network`                   | fetch and XHR in flight (`GET https://api.example.com/home`).          |
| `timer`                     | `setTimeout` shorter than 1.5 s. Intervals and rAF never count.        |
| `animation`                 | Finite CSS animations/transitions (web), `Animated` (React Native).    |
| `navigation`, `interaction` | Adapter hooks (screen transitions, React Native `InteractionManager`). |
| `state`                     | `onState` handlers running.                                            |
| `custom`                    | `markBusy()`.                                                          |

## Tuning

```ts nocheck
startDpad({
  idle: {
    quietMs: 150,
    ignore: [
      '/analytics',
      /\/poll\b/,
      (r) => r.kind === 'timer' && r.description.includes('toast'),
    ],
  },
});
```

- **Never idle?** The report names the busy resources. Polling, analytics beacons, autoplaying carousels and long-poll sockets are the usual causes: add them to `ignore`.
- **Idle too early?** Work the SDK cannot see: native image decoding, WebGL, player startup, work scheduled with `requestAnimationFrame`. Wrap it in `markBusy()`.
- **SDK code is invisible:** `untracked()` scopes (adapters, `dpad.idle.untracked(fn)`) keep library internals out of idle.

## TV trap

TV apps animate constantly (focus scaling, shimmer placeholders, ambient backgrounds). Infinite animations are excluded by design; finite ones that restart in a loop through JS are not, so mark those with `ignore`.
