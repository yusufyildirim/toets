---
description: Keep the Playwright report and test results from every CI run, merge sharded reports, and read the parity matrix.
---

# Artifacts and reports

dpad reports through Playwright: each action is a `test.step` with a screenshot and text snapshot, and each test carries device logs, network log, video and a failure dump as attachments. In CI, keep all of it, especially when the job fails.

## Upload always

Upload `playwright-report/` and `test-results/` on every run that was not cancelled, not only on failure; the parity matrix and flaky markers matter on green runs too.

```yaml
- uses: actions/upload-artifact@v4
  if: ${{ !cancelled() }}
  with:
    name: report-${{ matrix.project }}-${{ strategy.job-index }}
    path: |
      playwright-report
      test-results
    retention-days: 14
```

## Sharding and merging

Shard a platform across jobs with `--shard=<n>/<total>` and the `blob` reporter, then merge in a final job:

```sh
npx playwright test --project=android-tv --shard=1/3
npx playwright merge-reports --reporter html ./all-blob-reports
```

## Reading the report

- **Parity matrix:** which test ran on which platform, and the reason for every skip.
- **Steps:** every key press and assertion, with screenshot and text snapshot.
- **Failure dump:** focused element, surrounding tree, last keys, logs and requests. Start here; see [Debugging failures](../guides/debugging-failures.md).

## Traps

- **Videos are large.** Record on failure or first retry rather than always, and set a retention period.
- **Reports from different platforms belong together.** Merge them so one report shows the whole parity matrix.
