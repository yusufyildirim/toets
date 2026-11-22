package dev.dpad.example.launch

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Exposes the `__dpad` intent string extra the app was launched with. */
class DpadLaunchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DpadLaunch")

    Function("getRawPayload") {
      LaunchIntentStore.rawPayload
        ?: appContext.currentActivity?.intent?.getStringExtra(LaunchIntentStore.EXTRA)
    }
  }
}
