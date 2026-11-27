# Setup

The tvOS driver needs a Mac with Xcode, the tvOS platform (`xcodebuild -downloadPlatform tvOS`) and Node 24+. Nothing else: Appium and the XCUITest driver are pinned dependencies of this package, so every project runs the same, tested versions.

## App config

The app under test is user config, never toets code:

```ts
import { defineConfig, platforms } from '@toets/test';

export default defineConfig({
  app: {
    tvOS: {
      bundleId: 'com.example.tv',
      app: './build/Example.app', // simulator build; installed when a worker starts
    },
  },
  projects: [platforms.tvOS()],
});
```

`bundleId` is required. Omit `app` to test an app that is already installed. `launchArguments` and `launchEnvironment` pass extra arguments and environment to every launch except deep link launches. `deepLink` (`(link: URL) => string`) translates a canonical deep link into the URL the app opens; default: the link.

## What happens per worker

1. The simulator is prepared (booted, verified to run tvOS). See [simulators](./simulators.md).
2. toets starts its pinned Appium server on a free localhost port. Its log is `appium-w<worker>.log` in the worker's artifacts dir: the first place to look when a session fails.
3. WebDriverAgent (the on-device automation server) is built once per WDA and Xcode version for the generic tvOS Simulator and cached in `~/Library/Caches/toets/tvos-wda`. Sessions install that bundle instead of compiling: the first run takes about a minute longer, later sessions start in seconds. toets copies the XCTest frameworks of Xcode's tvOS Simulator platform into the bundle, because a runner launched without `xcodebuild test` has no other way to load them.
4. An XCUITest session opens, the app is installed and its unified log is streamed.

`launch` terminates the app and starts it with the launch payload (`@toets/protocol`) as launch arguments `-__toets <value>`, where the value is unpadded base64url of the JSON (`encodeLaunchPayloadParam`). The app (or the toets SDK) reads it with `UserDefaults.standard.string(forKey: "__toets")` and decodes it. Payload URLs use `localhost`: the simulator shares the host's network.

A deep link launch (`app.launch({ deepLink })`) opens the URL instead, so the system starts the app for it; launch arguments can not ride along. The payload goes into the app's user defaults (`defaults write <bundleId> __toets <value>`), where the same `UserDefaults` read finds it, and is removed on the next launch, terminate or stop. See [deep links](../../core/docs/deep-links.md).

## Driver options

All optional, passed to `platforms.tvOS({ ... })`:

| Option                 | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `udid`, `deviceSet`    | Drive a specific simulator without a device provider                        |
| `appium.url`           | Use your own Appium server instead of the pinned one                        |
| `wda.mode`             | `prebuilt` (default) or `xcodebuild` (XCUITest builds WDA per session)      |
| `wda.path`             | A ready WebDriverAgent runner `.app`, e.g. from a CI cache                  |
| `capabilities`         | Extra Appium capabilities, merged last                                      |
| `logs.enabled/process` | App log collection (default on, filtered to the app's `CFBundleExecutable`) |
| `managed`              | Options of the `managed` device provider                                    |

## CI

Cache `~/Library/Caches/toets/tvos-wda` keyed by the Xcode version to skip the one-time WDA build. Boot timeouts default to 5 minutes; cold CI machines need them.
