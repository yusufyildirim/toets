# Android TV key mapping

Every dpad key is a real Android `KeyEvent` injected into the system input pipeline, so the app's native focus engine handles it exactly like a remote button.

| Key                           | Android keycode                                      | Capability           |
| ----------------------------- | ---------------------------------------------------- | -------------------- |
| `UP` `DOWN` `LEFT` `RIGHT`    | `DPAD_UP` 19 ... `DPAD_RIGHT` 22                     | -                    |
| `SELECT`                      | `DPAD_CENTER` 23                                     | -                    |
| `BACK`                        | `BACK` 4                                             | `key.back`           |
| `HOME`                        | `HOME` 3                                             | `key.home`           |
| `MENU`                        | `MENU` 82                                            | `key.menu`           |
| `INFO`                        | `INFO` 165                                           | `key.info`           |
| `PLAY_PAUSE`                  | `MEDIA_PLAY_PAUSE` 85                                | `key.media.toggle`   |
| `PLAY` `PAUSE` `STOP`         | `MEDIA_PLAY` 126, `MEDIA_PAUSE` 127, `MEDIA_STOP` 86 | `key.media.discrete` |
| `FAST_FORWARD` `REWIND`       | `MEDIA_FAST_FORWARD` 90, `MEDIA_REWIND` 89           | `key.media.seek`     |
| `NEXT` `PREVIOUS`             | `MEDIA_NEXT` 87, `MEDIA_PREVIOUS` 88                 | `key.media.track`    |
| `RED` `GREEN` `YELLOW` `BLUE` | `PROG_RED` 183 ... `PROG_BLUE` 186                   | `key.color`          |
| `CHANNEL_UP` `CHANNEL_DOWN`   | `CHANNEL_UP` 166, `CHANNEL_DOWN` 167                 | `key.channel`        |
| `DIGIT_0` ... `DIGIT_9`       | `0` 7 ... `9` 16                                     | `key.numeric`        |

The table is `ANDROID_KEYCODES`. Which of these a target claims depends on the `remote` option: `android-tv` (default) claims all of them, `fire-tv` only what the Fire TV remote has (see [Fire TV](./fire-tv.md)).

## Long press

`app.remote.longPress(key, holdMs)` holds the key for exactly `holdMs` the way a held remote button does: key down, auto-repeat downs from the system long-press timeout (the first flagged `FLAG_LONG_PRESS`) every 50 ms, then key up. Apps see `isLongPress()`, `onKeyLongPress` and growing `repeatCount`, so hold-to-scrub works.

UiAutomator2 cannot hold keys, so holds run through a 2 KB helper the driver pushes to `/data/local/tmp` and starts with `app_process`. A hold costs about 1 s on top of `holdMs` (helper start-up).

## Trap

On Android `SELECT` is `DPAD_CENTER`, not `ENTER`. Apps that only handle `KEYCODE_ENTER` work with keyboards but not with remotes; dpad tests the remote.
