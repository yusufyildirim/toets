---
description: Keep the Playwright report and test results from every CI run, merge sharded reports, and read the parity matrix.
---

# Artifacts and reports

dpad reports through Playwright: each action is a `test.step`, and each test carries device logs, its network log (with mocking) and, on failure, a failure dump and screenshot as attachments; per-step screenshots and video are opt-in (`dpad.steps`, `dpad.video`). The parity matrix is written to `dpad-report/`. In CI, keep all of it, especially when the job fails.

## Upload always

Upload `playwright-report/`, `test-results/` and `dpad-report/` on every run that was not cancelled, not only on failure; the parity matrix and flaky markers matter on green runs too.

```yaml
- uses: actions/upload-artifact@v4
  if: ${{ !cancelled() }}
  with:
    name: report-${{ matrix.project }}-${{ strategy.job-index }}
    path: |
      playwright-report
      test-results
      dpad-report
    retention-days: 14
```

## Sharding and merging

Shard a platform across jobs with `--shard=<n>/<total>` and the `blob` reporter (set it in the config: `--reporter` on the command line drops the parity reporter), then merge in a final job. Add the parity reporter to the merge to get one matrix for all shards and platforms:

```sh
npx playwright test --project=android-tv --shard=1/3
npx playwright merge-reports --reporter html,@dpad-tv/test/reporter ./all-blob-reports
```

## Reading the report

- **Parity matrix:** which test ran on which platform, and the reason for every skip.
- **Steps:** every key press, navigation and launch, with a screenshot and text snapshot when `dpad.steps` is on.
- **Failure dump:** focused element, surrounding tree, last keys, logs and requests. Start here; see [Debugging failures](../guides/debugging-failures.md).

## Traps

- **Videos are large.** Record on failure or first retry rather than always, and set a retention period.
- **Reports from different platforms belong together.** Merge them so one report shows the whole parity matrix.
