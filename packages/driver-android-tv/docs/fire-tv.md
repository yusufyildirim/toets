# Fire TV

Fire OS (Fire TV sticks and cubes before Vega OS) is Android, so the Android TV driver runs Fire TV apps unchanged. Amazon ships no Fire OS emulator: test on an Android TV emulator and set `remote: 'fire-tv'` so the capabilities match the Alexa Voice Remote.

```ts
import { platforms } from '@toets/test';

platforms.androidTV({ remote: 'fire-tv' });
```

With `fire-tv`, the driver claims D-pad, `SELECT`, `BACK`, `HOME`, `MENU`, `PLAY_PAUSE` and `FAST_FORWARD`/`REWIND` (`key.media.seek`). Tests that `require` color, numeric, channel, info, discrete media or track keys (`key.media.track`: `NEXT`/`PREVIOUS`) are skipped with a reason instead of passing on a key no customer can press.

## Trap

Amazon services (IAP, ADM, Amazon Maps) are missing on Android TV images. Code paths that need them must be faked in the app's test build or covered by platform shims; the driver cannot provide them.

Vega OS (the non-Android Fire TV OS) is not supported by this driver.
