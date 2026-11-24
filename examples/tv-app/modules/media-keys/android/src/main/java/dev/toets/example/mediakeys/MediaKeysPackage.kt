package dev.toets.example.mediakeys

import android.content.Context
import android.view.KeyEvent
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler

/**
 * Makes JS the only handler of the media keys the app reacts to.
 *
 * React Native delivers every key to JS but does not consume it, so Android then hands
 * unconsumed media keys to the active media session (expo-video's player): play/pause would
 * toggle twice, rewind would seek twice and stop would reset the player. Consuming them here,
 * after JS has received them, stops that second delivery.
 */
class MediaKeysPackage : Package {
  override fun createReactActivityHandlers(activityContext: Context?): List<ReactActivityHandler> =
    listOf(
      object : ReactActivityHandler {
        override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean = keyCode in HANDLED_KEYS

        override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean = keyCode in HANDLED_KEYS

        override fun onKeyLongPress(keyCode: Int, event: KeyEvent?): Boolean =
          keyCode in HANDLED_KEYS
      }
    )

  private companion object {
    /** Mirrors `MEDIA_KEYS` in src/remote/keys.ts. */
    val HANDLED_KEYS = setOf(
      KeyEvent.KEYCODE_MEDIA_PLAY,
      KeyEvent.KEYCODE_MEDIA_PAUSE,
      KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
      KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
      KeyEvent.KEYCODE_MEDIA_REWIND,
      KeyEvent.KEYCODE_MEDIA_STOP,
    )
  }
}
