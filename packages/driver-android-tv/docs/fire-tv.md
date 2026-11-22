# Fire TV

Fire OS (Fire TV sticks and cubes before Vega OS) is Android, so the Android TV driver runs Fire TV apps unchanged. Amazon ships no Fire OS emulator: test on an Android TV emulator and set `remote: 'fire-tv'` so the capabilities match the Alexa Voice Remote.

```ts
platforms.androidTV({ remote: 'fire-tv' });
```

With `fire-tv`, the driver claims D-pad, `SELECT`, `BACK`, `HOME`, `MENU` and `PLAY_PAUSE`. Tests that `require` color, numeric, channel, info or discrete media keys are skipped with a reason instead of passing on a key no customer can press.

`FAST_FORWARD` and `REWIND` exist on the Fire TV remote, but `key.media.transport` also covers `NEXT`/`PREVIOUS`, which do not; the profile leaves the capability out to stay honest.

## Trap

Amazon services (IAP, ADM, Amazon Maps) are missing on Android TV images. Code paths that need them must be faked in the app's test build or covered by platform shims; the driver cannot provide them.

Vega OS (the non-Android Fire TV OS) is not supported by this driver.
