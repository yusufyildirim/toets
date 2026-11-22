# App state

Tests should start where they need to be, not click through onboarding. The launch payload carries `state` and `flags`; the app applies them in an `onState` handler, which also serves `state.apply` from tests later.

```ts
import { onState } from '@dpad-tv/sdk';

onState(async (state, flags) => {
  featureFlags.override(flags);
  if (state === 'logged-in') await auth.signInAs('test-user');
  if (state === 'player') navigation.navigate('Player', { id: 'demo' });
});
```

- The handler receives the launch state as soon as it registers; register it early (app entry or root component).
- The app counts as busy until the returned promise settles, so the test waits for the state to be applied.
- A throwing handler fails `state.apply` (HandlerFailed). A failing launch state is reported as an `uncaught` app log.
- State names and flags are app-defined; keep them in one place shared with the tests.
- `getDpad()?.launchState` / `.flags` are available synchronously for apps that choose their initial route before rendering.

## TV trap

Do not use state launch to skip what a test verifies. A test about focus on the home screen should navigate there with the remote; state launch is for preconditions (signed in, onboarding done, a flag on).
