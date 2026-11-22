# Media

`useDpadMedia(id)` registers a react-native-video player for the `media` domain while the component is mounted and returns event props to spread on `<Video>`:

```tsx
import { useDpadMedia } from '@dpad-tv/sdk-react-native';

function Player({ source }) {
  const media = useDpadMedia('main');
  return (
    <Video
      source={source}
      {...media}
      onEnd={() => {
        media.onEnd();
        goBack();
      }}
    />
  );
}
```

It maps `onLoadStart`, `onLoad`, `onProgress`, `onBuffer`, `onPlaybackStateChanged`, `onPlaybackRateChange`, `onSeek`, `onEnd` and `onError` (v6 events) to `loading`, `buffering`, `playing`, `paused`, `ended` and `error`. When you need an event yourself, call the dpad handler from yours (as with `onEnd` above). Class components use `videoMediaProps(createMediaReporter('main'))`. Other players: `registerMedia` / `createMediaReporter` from the core API.

## TV trap

Players report "not playing" while buffering and after the end. The mapping keeps `buffering` and `ended` instead of flipping to `paused`, so media assertions see what the viewer sees.
