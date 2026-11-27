# Failure dumps

When a test fails, toets writes a `toets-failure.md` dump and a `toets-screenshot.png` to the test's output folder (`test-results/<test>/`) and attaches both to the Playwright report; the console prints their paths. The dump is everything needed to understand the failure without rerunning it:

````md
# toets failure dump

- platform: android-tv
- capabilities: key.back, key.color, key.media.toggle
- sdk: off (black-box)
- focused: card_1 "Movie 1"
- keyboard: none
- last keys: RIGHT, RIGHT, SELECT

## Screen

```yaml
- rail:
    - card_1 "Movie 1" [focused]
    - card_2 "Movie 2"
```
````

It also lists busy resources (when idle sync is on), recent app logs and recorded requests.

## Principles

- **Launch and deep link.** `last launch` and `last deep link` repeat the test's last `launch` and `openDeepLink` steps with the link's translation (`myapp://details/42 → intent com.example.PLAY ...`), so a link that landed on the wrong screen shows what the platform really opened ([deep links](./deep-links.md)).
- **Keyboard state.** The `keyboard` line names the open keyboard: a declared one with its layer (`search (layer: digits)`), `system`, or `none`. A test stuck behind an open keyboard shows here first ([text input](./text-input.md)).
- **Text first.** The screen is a [text snapshot](./text-snapshots.md), readable in CI logs and by AI agents. The screenshot is attached separately.
- **Never masks the real error.** Collecting the dump never throws; missing parts are left out.
- **Logs and network traffic** are attached for every test (`toets-logs`, `toets-network.har`), not only failures.
- **Failed requests stay.** The dump lists the last 20 requests plus any earlier failed ones (no route, upstream unreachable), with the failure reason.

## TV trap: the failing key was three presses ago

On a TV the assertion that fails is often far from the press that went wrong. The last keys and the focused element usually tell you which press moved focus somewhere unexpected.
