package dev.dpad.example.launch

import android.content.Intent

/** Holds the payload of the intent that launched the activity, captured before JS starts. */
object LaunchIntentStore {
  const val EXTRA = "__dpad"

  @Volatile
  var rawPayload: String? = null
    private set

  fun capture(intent: Intent?) {
    rawPayload = intent?.getStringExtra(EXTRA)
  }
}
