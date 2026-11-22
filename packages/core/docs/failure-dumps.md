# Failure dumps

When a test fails, dpad attaches a `dpad-failure` Markdown dump and a `dpad-screenshot` to the Playwright report. The dump is everything needed to understand the failure without rerunning it:

````md
# dpad failure dump

- platform: android-tv
- capabilities: key.back, key.color, key.media.toggle
- sdk: off (black-box)
- focused: card_1 "Movie 1"
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

- **Text first.** The screen is a [text snapshot](./text-snapshots.md), readable in CI logs and by AI agents. The screenshot is attached separately.
- **Never masks the real error.** Collecting the dump never throws; missing parts are left out.
- **Logs and requests** are attached for every test (`dpad-logs`, `dpad-requests`), not only failures.

## TV trap: the failing key was three presses ago

On a TV the assertion that fails is often far from the press that went wrong. The last keys and the focused element usually tell you which press moved focus somewhere unexpected.
