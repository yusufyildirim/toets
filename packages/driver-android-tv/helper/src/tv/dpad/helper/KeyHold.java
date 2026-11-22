package tv.dpad.helper;

import android.os.SystemClock;
import android.view.InputDevice;
import android.view.InputEvent;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import android.view.ViewConfiguration;
import java.lang.reflect.Method;

/**
 * Holds one key for a given duration the way a real remote does: a key down, auto-repeat downs
 * (the first one flagged as a long press) at the system key-repeat timing, then a key up.
 *
 * Neither `input keyevent` nor UiAutomator2 can hold a key for an arbitrary time with repeats,
 * so dpad pushes this class to the device and runs it with `app_process` (shell user, which
 * may inject input events).
 *
 * Usage: CLASSPATH=dpad-key-hold.jar app_process / tv.dpad.helper.KeyHold <keycode> <holdMs>
 * Prints `repeats=<n>` on success.
 */
public final class KeyHold {
    private static final int INJECT_WAIT_FOR_RESULT = 1;
    private static final long KEY_REPEAT_DELAY_MS = 50;

    private KeyHold() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("usage: KeyHold <keycode> <holdMs>");
            System.exit(2);
        }
        int keyCode = Integer.parseInt(args[0]);
        long holdMs = Long.parseLong(args[1]);

        Object inputManager = inputManager();
        Method inject =
                inputManager.getClass().getMethod("injectInputEvent", InputEvent.class, int.class);

        long down = SystemClock.uptimeMillis();
        long up = down + holdMs;
        KeyEvent event =
                new KeyEvent(
                        down,
                        down,
                        KeyEvent.ACTION_DOWN,
                        keyCode,
                        0,
                        0,
                        KeyCharacterMap.VIRTUAL_KEYBOARD,
                        0,
                        0,
                        InputDevice.SOURCE_KEYBOARD);
        inject(inject, inputManager, event);

        int repeats = 0;
        for (long next = down + ViewConfiguration.getLongPressTimeout();
                next < up;
                next += KEY_REPEAT_DELAY_MS) {
            sleepUntil(next);
            repeats++;
            int flags = repeats == 1 ? KeyEvent.FLAG_LONG_PRESS : 0;
            inject(inject, inputManager, KeyEvent.changeTimeRepeat(event, next, repeats, flags));
        }

        sleepUntil(up);
        inject(
                inject,
                inputManager,
                KeyEvent.changeTimeRepeat(
                        KeyEvent.changeAction(event, KeyEvent.ACTION_UP), up, 0, 0));
        System.out.println("repeats=" + repeats);
    }

    private static void inject(Method inject, Object inputManager, KeyEvent event)
            throws Exception {
        Object ok = inject.invoke(inputManager, event, INJECT_WAIT_FOR_RESULT);
        if (!Boolean.TRUE.equals(ok)) {
            throw new IllegalStateException("injectInputEvent refused " + event);
        }
    }

    /** `InputManagerGlobal` on API 34+, `InputManager` before. */
    private static Object inputManager() throws Exception {
        try {
            Class<?> global = Class.forName("android.hardware.input.InputManagerGlobal");
            return global.getMethod("getInstance").invoke(null);
        } catch (ClassNotFoundException e) {
            Class<?> legacy = Class.forName("android.hardware.input.InputManager");
            return legacy.getMethod("getInstance").invoke(null);
        }
    }

    private static void sleepUntil(long uptimeMs) {
        long delay = uptimeMs - SystemClock.uptimeMillis();
        if (delay > 0) SystemClock.sleep(delay);
    }
}
