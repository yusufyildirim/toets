import { useDpadMedia } from '@dpad-tv/sdk-react-native';
import type { VideoPlayer } from 'expo-video';
import { useEffect } from 'react';

/**
 * Reports an expo-video player to dpad's `media` domain as `main` (`expect(app.media)` in tests).
 * `useDpadMedia` speaks react-native-video's event props; expo-video emits player events
 * instead, so this forwards them to the same handlers.
 */
export function usePlayerMedia(player: VideoPlayer): void {
  const media = useDpadMedia('main');
  useEffect(() => {
    // expo-video goes back to `loading` while buffering or seeking: only the first one loads.
    let loaded = false;
    const onStatus = (status: VideoPlayer['status'], message?: string) => {
      if (status === 'loading') {
        if (loaded) media.onBuffer({ isBuffering: true });
        else media.onLoadStart();
      } else if (status === 'readyToPlay') {
        if (loaded) media.onBuffer({ isBuffering: false });
        else media.onLoad({ duration: player.duration, currentTime: player.currentTime });
        loaded = true;
      } else if (status === 'error') {
        media.onError({ error: { message } });
      }
    };
    // The player may be past its first events by the time this effect runs.
    if (player.playing) media.onPlaybackStateChanged({ isPlaying: true });
    onStatus(player.status);

    const subscriptions = [
      player.addListener('statusChange', ({ status, error }) => onStatus(status, error?.message)),
      player.addListener('sourceLoad', ({ duration }) =>
        media.onLoad({ duration, currentTime: player.currentTime }),
      ),
      player.addListener('playingChange', ({ isPlaying }) =>
        media.onPlaybackStateChanged({ isPlaying }),
      ),
      player.addListener('timeUpdate', ({ currentTime }) => media.onProgress({ currentTime })),
      player.addListener('playbackRateChange', ({ playbackRate }) =>
        media.onPlaybackRateChange({ playbackRate }),
      ),
      player.addListener('playToEnd', () => media.onEnd()),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [player, media]);
}
