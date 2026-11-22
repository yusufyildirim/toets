package tv.dpad.fixture

import android.app.Activity
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/**
 * Minimal native Android TV app used by the dpad driver integration tests. It proves the driver
 * is framework neutral: plain Views, resource IDs as test IDs, the platform focus engine.
 *
 * Screens: home (side menu + rail of cards), details (play / favorite) and a fake player that
 * reacts to media keys. A status bar echoes every key the activity receives, how long it was
 * held, the `__dpad` launch payload and the result of a request to the payload's `mockUrl`.
 */
class MainActivity : Activity() {
    private enum class Screen { HOME, DETAILS, PLAYER }

    private val cardIds = intArrayOf(
        R.id.card_0, R.id.card_1, R.id.card_2, R.id.card_3, R.id.card_4,
        R.id.card_5, R.id.card_6, R.id.card_7, R.id.card_8, R.id.card_9,
    )

    private lateinit var home: View
    private lateinit var details: View
    private lateinit var player: View
    private lateinit var playerState: TextView
    private lateinit var playerPosition: TextView
    private lateinit var lastKey: TextView
    private lateinit var keyHold: TextView

    private var screen = Screen.HOME
    private var currentItem = 0
    private var playing = false
    private var position = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        home = findViewById(R.id.home)
        details = findViewById(R.id.details)
        player = findViewById(R.id.player)
        playerState = findViewById(R.id.player_state)
        playerPosition = findViewById(R.id.player_position)
        lastKey = findViewById(R.id.last_key)
        keyHold = findViewById(R.id.key_hold)
        lastKey.text = "last key: none"
        keyHold.text = "hold: none"

        buildRail()
        findViewById<View>(R.id.menu_home).isSelected = true
        findViewById<View>(R.id.play_button).setOnClickListener { showPlayer() }
        findViewById<View>(R.id.favorite_button).setOnClickListener { it.isSelected = !it.isSelected }

        readLaunchPayload()
        showHome(focusItem = 0)
    }

    private fun buildRail() {
        val rail = findViewById<LinearLayout>(R.id.rail_items)
        cardIds.forEachIndexed { index, id ->
            val card = Button(this, null, 0, R.style.Card)
            card.id = id
            card.text = "Item $index"
            card.layoutParams = LinearLayout.LayoutParams(dp(200), dp(112)).apply {
                setMargins(dp(8), dp(8), dp(8), dp(8))
            }
            card.setOnClickListener { showDetails(index) }
            rail.addView(card)
        }
    }

    private fun readLaunchPayload() {
        val raw = intent.getStringExtra("__dpad")
        val label = findViewById<TextView>(R.id.launch_payload)
        val mock = findViewById<TextView>(R.id.mock_result)
        mock.text = "mock: none"
        if (raw == null) {
            label.text = "payload: none"
            return
        }
        Log.i(TAG, "launch payload: $raw")
        val payload = runCatching { JSONObject(decodePayload(raw)) }.getOrNull()
        if (payload == null) {
            label.text = "payload: invalid"
            return
        }
        label.text = "payload: state=${payload.optString("state", "-")}"
        val mockUrl = payload.optString("mockUrl", "")
        if (mockUrl.isNotEmpty()) fetchMock(mockUrl, mock)
    }

    /** dpad sends base64url(JSON); plain JSON is accepted too. */
    private fun decodePayload(raw: String): String =
        if (raw.trimStart().startsWith("{")) raw
        else String(Base64.decode(raw, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP), Charsets.UTF_8)

    /** Proves `adb reverse`: the payload URL says `localhost`, which only works if reversed. */
    private fun fetchMock(base: String, target: TextView) {
        target.text = "mock: loading"
        Thread {
            val result = runCatching {
                val conn = URL("$base/fixture/hello").openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                try {
                    conn.inputStream.bufferedReader().readText().trim()
                } finally {
                    conn.disconnect()
                }
            }.getOrElse { "error ${it.javaClass.simpleName}" }
            runOnUiThread { target.text = "mock: $result" }
        }.start()
    }

    private fun showHome(focusItem: Int) {
        setScreen(Screen.HOME)
        findViewById<View>(cardIds[focusItem]).requestFocus()
    }

    private fun showDetails(index: Int) {
        currentItem = index
        findViewById<TextView>(R.id.details_title).text = "Item $index"
        setScreen(Screen.DETAILS)
        findViewById<View>(R.id.play_button).requestFocus()
    }

    private fun showPlayer() {
        findViewById<TextView>(R.id.player_title).text = "Now playing: Item $currentItem"
        position = 0
        setPlaying(true)
        setScreen(Screen.PLAYER)
        player.requestFocus()
    }

    private fun setScreen(next: Screen) {
        screen = next
        home.visibility = if (next == Screen.HOME) View.VISIBLE else View.GONE
        details.visibility = if (next == Screen.DETAILS) View.VISIBLE else View.GONE
        player.visibility = if (next == Screen.PLAYER) View.VISIBLE else View.GONE
    }

    private fun setPlaying(value: Boolean) {
        playing = value
        render()
    }

    private fun render() {
        playerState.text = if (playing) "playing" else "paused"
        playerPosition.text = "position: $position"
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val name = KeyEvent.keyCodeToString(event.keyCode)
        when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                lastKey.text = "last key: $name"
                if (event.repeatCount > 0) {
                    keyHold.text = "hold: $name repeats=${event.repeatCount} long=${event.isLongPress}"
                }
            }
            KeyEvent.ACTION_UP -> {
                if (event.eventTime - event.downTime >= 300) {
                    keyHold.text = "hold: $name ms=${event.eventTime - event.downTime}"
                }
            }
        }
        Log.d(TAG, "key ${event.action} $name repeat=${event.repeatCount}")
        return super.dispatchKeyEvent(event)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (screen == Screen.PLAYER && handlePlayerKey(keyCode)) return true
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            when (screen) {
                Screen.PLAYER -> {
                    setPlaying(false)
                    showDetails(currentItem)
                    return true
                }
                Screen.DETAILS -> {
                    showHome(focusItem = currentItem)
                    return true
                }
                Screen.HOME -> Unit
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun handlePlayerKey(keyCode: Int): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_DPAD_CENTER -> setPlaying(!playing)
            KeyEvent.KEYCODE_MEDIA_PLAY -> setPlaying(true)
            KeyEvent.KEYCODE_MEDIA_PAUSE -> setPlaying(false)
            KeyEvent.KEYCODE_MEDIA_STOP -> {
                position = 0
                setPlaying(false)
            }
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                position += 10
                render()
            }
            KeyEvent.KEYCODE_MEDIA_REWIND -> {
                position = maxOf(0, position - 10)
                render()
            }
            else -> return false
        }
        return true
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private companion object {
        const val TAG = "DpadFixture"
    }
}
