# Fire TV

Fire OS (Fire TV sticks and cubes before Vega OS) is Android, so the Android TV driver runs Fire TV apps unchanged. Amazon ships no Fire OS emulator: test on an Android TV emulator and set `remote: 'fire-tv'` so the capabilities match the Alexa Voice Remote.

```ts
import { platforms } from '@toets/test';

platforms.androidTV({ remote: 'fire-tv' });
```

With `fire-tv`, the driver claims D-pad, `SELECT`, `BACK`, `HOME`, `MENU`, `PLAY_PAUSE` and `FAST_FORWARD`/`REWIND` (`key.media.seek`). Tests that `require` color, numeric, channel, info, discrete media or track keys (`key.media.track`: `NEXT`/`PREVIOUS`) are skipped with a reason instead of passing on a key no customer can press.

## Content intents

Fire TV launchers and voice open content with an intent of the app's own (a custom action and extras, often no URI), not a link. Tests keep the app's canonical link; the Fire TV project translates it with `deepLink`:

```ts
import { platforms } from '@toets/test';

platforms.androidTV({
  name: 'fire-tv',
  remote: 'fire-tv',
  app: {
    deepLink: (link) =>
      link.host === 'details'
        ? { action: 'com.example.PLAY', extras: { contentId: link.pathname.slice(1) } }
        : link.href,
  },
});
```

`await app.launch({ deepLink: 'myapp://details/42' })` then starts `com.example.PLAY` with the string extra `contentId=42`, resolved by the app's intent filters. See [deep links](../../core/docs/deep-links.md).

## Trap

Amazon services (IAP, ADM, Amazon Maps) are missing on Android TV images. Code paths that need them must be faked in the app's test build or covered by platform shims; the driver cannot provide them.

Vega OS (the non-Android Fire TV OS) is not supported by this driver.
