---
description: Run Android TV emulators in CI on x86_64 Linux runners with KVM - enabling KVM, installing the system image and running the android-tv project.
---

# Android TV on Linux

Android TV emulators need hardware virtualization. On Linux that means **KVM on an x86_64 runner**; without it the emulator falls back to software emulation and is too slow to use. GitHub-hosted Ubuntu runners support KVM once it is enabled for the runner user.

```yaml
jobs:
  android-tv:
    runs-on: ubuntu-24.04
    timeout-minutes: 45
    env:
      ANDROID_TV_IMAGE: system-images;android-34;android-tv;x86
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm

      - name: Enable KVM
        run: |
          echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' \
            | sudo tee /etc/udev/rules.d/99-kvm4all.rules
          sudo udevadm control --reload-rules
          sudo udevadm trigger --name-match=kvm

      - name: Install emulator and Android TV image
        run: |
          sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
          yes | "$sdkmanager" --licenses > /dev/null
          "$sdkmanager" emulator platform-tools "$ANDROID_TV_IMAGE"

      - uses: actions/download-artifact@v5
        with:
          name: app-apk
          path: build

      - run: npm ci
      - run: npx playwright test --project=android-tv

      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: report-android-tv
          path: |
            playwright-report
            test-results
            toets-report
```

## Adapting it

- **Pick the image** with `sdkmanager --list | grep -E 'android-tv|google-tv'` and keep it in one variable. Match `osVersion` (the API level) in your config.
- **Managed mode does the rest.** toets creates the AVD, boots it headless, snapshots it and resets it between tests. Use `external` mode only if your CI already provides running emulators.
- **Workers:** a standard 4 vCPU runner hosts one or two emulators. For more parallelism, shard across jobs (`--shard=1/3`) rather than adding workers.
- **Cache** the system image and the AVD with its snapshot; see [Caching](./caching.md).

## Traps

- **arm64 Linux runners** usually lack nested virtualization. Use x86_64 runners and x86 images.
- **A cold boot takes minutes.** If every run cold-boots, the AVD snapshot is not being cached or restored.
- **Emulator crashes look like test failures.** Check the device logs attached to the first failing test before debugging the test.
