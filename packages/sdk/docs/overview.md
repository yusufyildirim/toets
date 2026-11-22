# In-app SDK

The SDK is an optional library inside the app under test. dpad works black-box without it; with it, tests get a uniform element tree, reliable focus, idle sync (no polling sleeps), media state, app state launch and app logs.

- `@dpad-tv/sdk`: the framework-neutral runtime and the app-facing API below.
- `@dpad-tv/sdk/web`: web adapter ([web.md](./web.md)).
- `@dpad-tv/sdk-react-native`: React Native adapter (its own docs).

## Lifecycle

The adapter's `startDpad()` looks for the launch payload. Without one (a normal run, production) the SDK is **inert**: no hooks, no connection. With one it instruments the app (network, timers, console), connects to the host at `sdkUrl` and announces its domains. When the session ends every hook is removed.

## App-facing API

Safe to call unconditionally, before or without the SDK running:

```ts nocheck
import { getLaunchPayload, markBusy, onState } from '@dpad-tv/sdk';

onState(async (state, flags) => {
  if (state === 'logged-in') await session.loginAsTestUser();
});

const done = markBusy('hero video decode');
await player.ready();
done();

const api = getLaunchPayload()?.mockUrl ?? 'https://api.example.com';
```

| Function                                | Purpose                                                          |
| --------------------------------------- | ---------------------------------------------------------------- |
| `onState(handler)`                      | Launch into a named state, apply flags ([state.md](./state.md)). |
| `markBusy(description)`                 | Work the SDK cannot see ([idle.md](./idle.md)).                  |
| `registerMedia` / `createMediaReporter` | Players ([media.md](./media.md)).                                |
| `focusChanged()`                        | Custom focus engines: focus moved.                               |
| `getLaunchPayload()`                    | The launch payload (`mockUrl`, `state`, `flags`) or `null`.      |
| `getDpad()`                             | The running runtime (`status`, `domains`) or `null`.             |

`getDpad()` is `null` in black-box runs (dpad launched the app without the SDK session), while `getLaunchPayload()` still carries the `mockUrl`: route API traffic with it so mocking works with and without the SDK.

Related: [production.md](./production.md) (excluding the SDK), [adapters.md](./adapters.md) (new frameworks), [traps.md](./traps.md).
