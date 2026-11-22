# Conformance suite

Proves that an SDK speaks the [protocol](./spec.md) correctly, over the wire only, so it works for any SDK: JS, Kotlin, Swift, BrightScript. The suite plays the host, launches the app with fresh payloads and checks handshake, JSON-RPC handling, every announced domain, notifications and rejection behavior. Checks of domains the SDK does not announce are skipped, not failed.

## From code

```ts
import { formatConformanceReport, runConformance } from '@dpad-tv/protocol/conformance';

const report = await runConformance({
  name: 'my-sdk on Android TV',
  fixture: true,
  launch: ({ encoded }) =>
    exec(`adb shell am start -S -n com.example/.Main --es __dpad ${encoded}`),
  terminate: () => exec('adb shell am force-stop com.example'),
});
console.log(formatConformanceReport(report));
```

`launch` must start a fresh app instance each time (the suite launches several: main session, launch state, rejections); `terminate` stops it.

## From the command line

```sh
dpad-conformance --fixture --launch "node my-app.js --payload {payload}"
```

The payload is substituted for `{payload}` (base64url) and set as `DPAD_PAYLOAD`. Without `--terminate` the launch process is killed. `--only <id-prefix>` narrows the run (e.g. `--only fixture.`). Exit code 1 when a check fails, 2 on usage errors.

## The fixture

With `fixture: true` (`--fixture`) the suite also checks behavior. The app must render `CONFORMANCE_FIXTURE`:

- `conformance-a` and `conformance-b`: focusable, visible.
- `conformance-text`: not focusable, own text `Conformance`.
- An `onState` handler for `conformance:focus-a` / `conformance:focus-b` (move focus there), `conformance:log` (log `flags.marker` at info level through the normal console), `conformance:busy` (`markBusy` for `flags.ms` ms), `conformance:fail` (throw).

Reference fixtures: `packages/sdk/test/fixtures/conformance-app.ts` (web) and `packages/sdk-react-native/test/conformance.test.ts` (React Native).
