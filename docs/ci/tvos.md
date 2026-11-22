---
description: Run tvOS simulators in CI on macOS runners - selecting Xcode, making sure the tvOS runtime exists, building for the simulator and running the tvos project.
---

# tvOS on macOS

tvOS simulators run only on macOS with Xcode. A CI job selects an Xcode version, makes sure the tvOS simulator runtime is installed, builds the app for the simulator and runs the `tvos` project.

```yaml
jobs:
  tvos:
    runs-on: macos-15
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm

      - name: Select Xcode
        run: sudo xcode-select -s /Applications/Xcode_16.4.app

      - name: Ensure the tvOS simulator runtime
        run: xcrun simctl list runtimes | grep -q tvOS || xcodebuild -downloadPlatform tvOS

      - name: Build for the simulator
        run: |
          xcodebuild -workspace ios/Example.xcworkspace -scheme Example-tvOS \
            -sdk appletvsimulator -configuration Debug -derivedDataPath build/xcode
          cp -R build/xcode/Build/Products/Debug-appletvsimulator/Example.app build/

      - run: npm ci
      - run: npx playwright test --project=tvos

      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: report-tvos
          path: |
            playwright-report
            test-results
            dpad-report
```

## Adapting it

- **Pin Xcode** and the tvOS runtime together; match `osVersion` in your config. Runner images change their default Xcode over time.
- **Managed mode** creates and boots Apple TV simulators and resets them between tests. Simulators are lighter than emulators; two workers fit on a standard macOS runner.
- **Build once.** If several jobs need the `.app`, build it in one job and pass it as an artifact.
- **Cache** WebDriverAgent and Appium drivers; see [Caching](./caching.md).

## Traps

- **The first run builds WebDriverAgent**, which takes minutes. Without a cache, every run pays it.
- **Device builds do not run on simulators.** The `.app` must come from `-sdk appletvsimulator`.
- **macOS minutes are expensive.** Run the fast web project first and gate the tvOS job on it.
