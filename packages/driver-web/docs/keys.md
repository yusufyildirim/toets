# Keys on the web

Remote keys become real keyboard events: trusted `keydown`/`keyup` (and `keypress` for keys that produce text) sent through the Chrome DevTools Protocol, the same path as physical input. The app's own key handling runs unchanged; dpad never calls app code to "press" a key.

## Default map

`key` follows W3C UI Events. `keyCode` follows the OIPF/HbbTV codes shared by Tizen, webOS and HbbTV browsers, except BACK.

| dpad key                    | `key`                                    | `keyCode`         |
| --------------------------- | ---------------------------------------- | ----------------- |
| UP / DOWN / LEFT / RIGHT    | `ArrowUp` ...                            | 38 / 40 / 37 / 39 |
| SELECT                      | `Enter`                                  | 13                |
| BACK                        | `Escape`                                 | 27                |
| INFO                        | `Info`                                   | 457               |
| PLAY_PAUSE                  | `MediaPlayPause`                         | 402               |
| PLAY / PAUSE / STOP         | `MediaPlay` / `MediaPause` / `MediaStop` | 415 / 19 / 413    |
| FAST_FORWARD / REWIND       | `MediaFastForward` / `MediaRewind`       | 417 / 412         |
| NEXT / PREVIOUS             | `MediaTrackNext` / `MediaTrackPrevious`  | 425 / 424         |
| RED / GREEN / YELLOW / BLUE | `ColorF0Red` ... `ColorF3Blue`           | 403 - 406         |
| CHANNEL_UP / CHANNEL_DOWN   | `ChannelUp` / `ChannelDown`              | 427 / 428         |
| DIGIT_0 - DIGIT_9           | `0` - `9`                                | 48 - 57           |
| HOME, MENU                  | unmapped                                 | -                 |

HOME and MENU are unmapped because TV operating systems keep them for themselves; web apps never receive them.

## Overrides

Map what your app listens to. A spec replaces the default; `null` removes the key and, with it, the capability (tests requiring it are skipped):

```ts
import { platforms } from '@dpad-tv/test';

// A Tizen build that reads keyCodes:
platforms.web({
  keys: {
    BACK: { key: 'XF86Back', keyCode: 10009 },
    PLAY_PAUSE: { key: 'MediaPlayPause', keyCode: 10252 },
    CHANNEL_UP: null,
  },
});
```

A spec is `{ key, code?, keyCode?, text? }`. `text` makes the key produce characters (`keypress`, form input): SELECT uses `'\r'` so Enter activates buttons.

**Trap:** `key` must be a standard UI Events value or one character. Chromium delivers anything else (like `XF86Back`) as an empty `key`; the `keyCode` still arrives verbatim, which is what such builds read.

## Long press

`press(key, { holdMs })` sends `keydown`, then auto-repeat `keydown`s (`event.repeat === true`) after `keyRepeat.delayMs` every `keyRepeat.intervalMs`, then `keyup` at `holdMs`. Match `keyRepeat` to the target device if your app counts repeats.
