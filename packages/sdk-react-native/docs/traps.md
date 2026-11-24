---
description: Where web or mobile intuition fails with the SDK in React Native TV apps.
---

# TV traps (React Native)

- **Reload loses the session.** The token is one-time; a full reload (Metro `r`, editing the entry file) starts a new JS context that the host refuses. Tests relaunch the app.
- **Cold start only on Android.** The payload is read from the launch intent once. A running activity receiving a new intent (`singleTask`) keeps the old one; drivers force-stop before launching.
- **Cleartext localhost.** Android release-like builds block `ws://` unless allowed. Add a network security config for `localhost`:

  ```xml
  <network-security-config>
    <domain-config cleartextTrafficPermitted="true">
      <domain includeSubdomains="false">localhost</domain>
    </domain-config>
  </network-security-config>
  ```

  tvOS needs `NSAppTransportSecurity > NSAllowsLocalNetworking` (the React Native template sets it).

- **tvOS argument parsing.** `NSUserDefaults` parses argument values that look like property lists. JSON payloads (`{...}`) would arrive mangled; drivers send base64url.
- **One root.** Tree and focus come from mounted `ToetsRoot`s. A screen rendered in a separate native root without the wrapper is invisible to the SDK.
- **Old architecture.** Supported best-effort: measurement is asynchronous (`measureInWindow`, 500 ms cap) and focus events depend on the platform implementation.
