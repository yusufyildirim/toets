# TV traps

Where web or mobile intuition fails with an in-app SDK on TV.

- **Reload is not relaunch.** Tokens are one-time. A dev reload (Metro, browser refresh) is refused by the host; tests relaunch the app.
- **Cleartext localhost.** The SDK talks `ws://localhost`. Android release-like builds block cleartext unless `network_security_config` allows `localhost`; iOS/tvOS ATS needs `NSAllowsLocalNetworking`.
- **Loopback only.** The SDK refuses a non-loopback `sdkUrl` by default (a crafted deep link must not exfiltrate the UI). Devices reach the host through `adb reverse` or the simulator's shared network, so `localhost` is always right.
- **Focus without DOM focus.** JS focus engines keep focus in app state and only style the focused element. Report it with `reportFocus()` ([focus.md](./focus.md)) or the SDK reports DOM focus, usually nothing.
- **Endless motion.** Shimmers, ambient video and carousels keep apps busy. Infinite animations are ignored; ignore the rest explicitly ([idle.md](./idle.md)).
- **Old engines.** Smart TV browsers can be years behind; the SDK targets ES2015. Polyfill `Promise`/`WeakMap` only if the engine predates them.
- **Ship it out.** Exclude the SDK from production builds ([production.md](./production.md)).
