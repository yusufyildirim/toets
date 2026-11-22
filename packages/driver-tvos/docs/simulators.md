# Simulators

Each worker drives one tvOS simulator, held exclusively for the run (VISION decision 7). Where it comes from is the project's device mode.

## `managed` (default)

dpad creates one Apple TV simulator per worker, named `dpad-<model>-<os>-w<worker>`, boots it and reuses it on later runs. Simulators it booted are shut down when the run ends; set `managed: { keepBooted: true }` to keep them warm for local iteration.

- `model`: an exact simulator device type, default `Apple TV 4K (3rd generation) (at 1080p)`. The 1080p variant renders at 1920x1080, the same as its point size, so screenshots and videos are 4x smaller than 4K.
- `osVersion`: a tvOS version prefix (`18` matches `18.4`). Default: the newest installed tvOS runtime.

- `namePrefix`: default `dpad`. The provider only creates, reuses and shuts down simulators whose names start with it, and it must start with `dpad`, so other simulators on the machine (an iOS fleet, a lease broker's devices) are never touched. Two checkouts running at once need different prefixes (`dpad-ci`, `dpad-local`), or they share `w0`.

A missing runtime fails with `TVOS_RUNTIME_MISSING` and the install command.

The XCUITest driver wants a simulator window: a session on a simulator booted without one restarts it with the window visible (opening the Simulator app), which costs one extra boot per run. dpad lets it, because the alternative (headless mode) quits the Simulator app, and with it the windows of every other simulator on the machine.

dpad never deletes simulators. Remove them with `xcrun simctl delete <udid>`; `xcrun simctl list devices | grep dpad-` lists them.

## `external` and `command`

You hand dpad simulator UDIDs (a fixed list, or a lease broker command that prints JSON). The driver checks the device exists and runs tvOS, boots it if needed and waits for boot to finish. Errors name the UDID and the device set searched.

## Device sets

Simulators can live outside Xcode's default set, for example in a lease broker's own set. Tell dpad where:

- driver option `deviceSet: '/path/to/set'`, or
- lease metadata `meta.deviceSet`, or `meta.environment.SIMLOCK_IOS_DEVICE_SET` (simlock leases).

Everything dpad runs then targets that set (`simctl --set`, XCUITest's `simulatorDevicesSetPath`). The default prebuilt WebDriverAgent mode is what makes this work: `xcodebuild -destination id=<udid>` cannot see simulators in other sets.

## Trap

Never share one simulator between workers or with a human: focus is global to the device, so two drivers on one simulator steal each other's focus.
