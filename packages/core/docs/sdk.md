# In-app SDK

The SDK is an optional library inside the app. It connects back to the test host when the app is launched by dpad and answers questions only the app can answer quickly: the element tree, the focus graph, idle state, media state, app state and logs.

```ts nocheck
// playwright.config.ts
export default defineConfig({ dpad: { sdk: true } /* ... */ });

// a test
await app.launch({ state: 'details:the-matrix' }); // needs app.state
await expect(app.media).toBePlaying(); // needs media.state
```

## How it fits

- **On launch** dpad issues a one-time token and passes a payload (`sdkUrl`, `token`, `mockUrl`, `state`, `flags`) to the app through the driver. The app connects and dpad waits up to `timeouts.sdkConnectMs`; if it never connects, launch fails with `SDK_NOT_CONNECTED`.
- **Composition:** the SDK answers tree, queries, focus, focus graph, media and idle; the driver still does input, launch and screenshots. If an SDK request fails, dpad falls back to the driver.
- **Without the payload the SDK is inert**, so production builds can ship it.

## Principles

- **Black-box parity.** Locators, focus, remote, screenshots and mocking work without the SDK. The SDK makes them faster and more reliable; it does not change what a test means.
- **Launch states replace click-throughs.** `launch({ state })` lets the app jump straight to a screen, so a test about the player does not navigate menus first.

## TV trap: the app is not a browser

There is no DOM to inspect on Android TV or tvOS, and native accessibility trees are slow and lossy. The SDK is how a React Native or native app reports focus and idle with the same fidelity as the web.
