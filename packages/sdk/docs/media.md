# Media

The `media` domain reports players (state, position, duration, rate, error) without OS-level scraping. `media.get` without an id returns the most recently active player.

Pull (the SDK reads the player when asked):

```ts nocheck
import { registerMedia } from '@toets/sdk';

const unregister = registerMedia('main', {
  getSnapshot: () => ({
    state: player.isPlaying ? 'playing' : 'paused',
    position: player.currentTime,
    duration: player.duration ?? null,
    rate: player.rate,
  }),
});
```

Push (from player events; emits `media.changed`):

```ts nocheck
import { createMediaReporter } from '@toets/sdk';

const media = createMediaReporter('main');
player.on('waiting', () => media.update({ state: 'buffering' }));
player.on('timeupdate', () => media.update({ position: player.currentTime }));
// media.dispose() when the player goes away
```

States: `idle`, `loading`, `buffering`, `playing`, `paused`, `ended`, `error`. Position and duration are seconds; `duration: null` for live or unknown. Adapters cover common players: the web adapter maps `<video>`/`<audio>`, the React Native adapter provides `useToetsMedia()` for react-native-video.

## TV trap

`media.changed` fires on state, rate, duration and error changes, not on every position tick. Assert on position by polling `media.get` (toets's media matchers do).
