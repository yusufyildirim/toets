# Reporting

toets reports through Playwright: every action is a step, artifacts are attachments, and a parity matrix shows which test ran where.

```text
toets parity (10 tests): web: 10 passed; tvos: 6 passed, 4 skipped
  differs: navigation.spec.ts > color keys work: web passed, tvos skipped (requires key.color: not available on tvos)
Parity matrix: toets-report/parity.md
```

## Steps and attachments

- **Steps:** `launch`, `press SELECT`, `pressUntilFocused RIGHT getByTestId('rail-0-card-2')`, `repeat RIGHT x3`, `platformOnly web`. Overridden keys read `press FAST_FORWARD (override: hold RIGHT 800ms)`.
- **On failure:** `toets-failure` (the [failure dump](../../core/docs/failure-dumps.md)) and `toets-screenshot`.
- **Always, when present:** `toets-logs` (app and driver logs) and `toets-network.har` (the test's mock server traffic as HAR 1.2, failed requests included).
- **Optional per step:** `steps: { screenshot: true, snapshot: true }` attaches the screen after every action.
- **Video:** `video: 'on' | 'retain-on-failure'` attaches `toets-video` where the driver supports `video`.

## Parity matrix

Written to `toets-report/parity.md` and `parity.json` next to the config after every run, one row per test and one column per toets project:

```md
| Test                              | web    | tvos                                                |
| --------------------------------- | ------ | --------------------------------------------------- |
| navigation.spec.ts > color keys   | passed | skipped (requires key.color: not available on tvos) |
| navigation.spec.ts > fast forward | passed | passed [overrides: FAST_FORWARD = hold RIGHT 800ms] |
```

Configure with `parityReport: { outputFile, summary }` (`outputFile` is relative to the config file, like Playwright reporter paths) or turn it off with `parityReport: false`.

## Principles

- **Parity is a first-class result.** A suite that is green everywhere but skips half its tests on one platform is not done; the matrix makes that visible.
- **Overrides are flagged, not hidden.** A test that only passes because a key is performed differently says so.

## TV trap: `--reporter` replaces the config's reporters

Passing `--reporter=list` on the command line replaces every configured reporter, including the parity reporter. Configure reporters in the config file instead.
