package dev.dpad.example.launch

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/** Captures the launch intent as soon as the main activity is created. */
class DpadLaunchPackage : Package {
  override fun createReactActivityLifecycleListeners(
    activityContext: Context?
  ): List<ReactActivityLifecycleListener> = listOf(
    object : ReactActivityLifecycleListener {
      override fun onCreate(activity: Activity?, savedInstanceState: Bundle?) {
        LaunchIntentStore.capture(activity?.intent)
      }

      override fun onNewIntent(intent: Intent?): Boolean {
        LaunchIntentStore.capture(intent)
        return false
      }
    }
  )
}
