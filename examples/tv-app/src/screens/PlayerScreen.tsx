import { useEvent } from 'expo';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api, type ItemDetails } from '../api';
import { useRequest } from '../api/useRequest';
import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { StatusView } from '../components/StatusView';
import { FocusGroup } from '../focus/FocusGroup';
import type { MediaKey } from '../remote/keys';
import { useMediaKeys } from '../remote/useMediaKeys';
import { useSettings } from '../settings/SettingsContext';
import { CONTENT_INSET, colors, px } from '../theme';

const SEEK_SECONDS = 10;

interface PlayerScreenProps {
  readonly scope: string;
  readonly itemId: string;
  readonly visible: boolean;
}

/** Full-screen player. Initial focus: play/pause. Media keys: play/pause, play, pause, FF, RW, stop. */
export function PlayerScreen({ scope, itemId, visible }: PlayerScreenProps) {
  const item = useRequest(`item:${itemId}`, (signal) => api.getItem(itemId, signal));
  return (
    <Screen
      id={scope}
      testID="screen_player"
      visible={visible}
      initialFocusKey="player_play_pause"
      style={styles.screen}
    >
      {item.status === 'success' ? (
        <Player item={item.data} />
      ) : (
        <StatusView
          prefix="player"
          {...(item.status === 'error' ? { error: item.error } : {})}
          onRetry={item.retry}
        />
      )}
    </Screen>
  );
}

type PlaybackState = 'loading' | 'playing' | 'paused' | 'ended' | 'error';

function Player({ item }: { item: ItemDetails }) {
  // Autoplay applies when the player opens, not when the setting changes later.
  const [autoplay] = useState(useSettings().autoplay);
  const player = useVideoPlayer(item.streamUrl, (p) => {
    p.timeUpdateEventInterval = 0.5;
  });
  // After mount rather than in the setup callback: on web, play() needs the mounted <video>.
  useEffect(() => {
    if (autoplay) player.play();
  }, [player, autoplay]);
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status, error } = useEvent(player, 'statusChange', { status: player.status });
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });
  const duration = useDuration(player);
  const ended = useEnded(player, isPlaying);

  const state: PlaybackState =
    status === 'error'
      ? 'error'
      : isPlaying
        ? 'playing'
        : ended
          ? 'ended'
          : status === 'loading'
            ? 'loading'
            : 'paused';

  const togglePlay = () => {
    if (player.playing) player.pause();
    else if (ended) player.replay();
    else player.play();
  };

  useMediaKeys((key: MediaKey) => {
    switch (key) {
      case 'playPause':
        return togglePlay();
      case 'play':
        return player.play();
      case 'pause':
        return player.pause();
      case 'fastForward':
        return player.seekBy(SEEK_SECONDS);
      case 'rewind':
        return player.seekBy(-SEEK_SECONDS);
      case 'stop':
        player.pause();
        player.currentTime = 0;
    }
  });

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <View style={styles.container}>
      <VideoView
        testID="player_video"
        player={player}
        style={styles.video}
        nativeControls={false}
        contentFit="contain"
      />
      <View style={styles.overlay}>
        <Text testID="player_title" style={styles.title}>
          {item.title}
        </Text>
        {error ? (
          <Text testID="player_error" style={styles.error}>
            {error.message}
          </Text>
        ) : null}
        <View style={styles.timeline}>
          <View testID="player_progress" style={styles.track}>
            <View style={[styles.fill, { width: `${progress * 100}%` }]} />
          </View>
          <Text testID="player_time" style={styles.time}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </Text>
        </View>
        <View style={styles.controls}>
          <FocusGroup style={styles.buttons}>
            <Button
              testID="player_seek_back"
              label={`-${SEEK_SECONDS}s`}
              onPress={() => player.seekBy(-SEEK_SECONDS)}
            />
            <Button
              testID="player_play_pause"
              label={state === 'playing' ? 'Pause' : 'Play'}
              variant="primary"
              onPress={togglePlay}
            />
            <Button
              testID="player_seek_forward"
              label={`+${SEEK_SECONDS}s`}
              onPress={() => player.seekBy(SEEK_SECONDS)}
            />
          </FocusGroup>
          <Text testID="player_state" style={styles.state}>
            {STATE_LABELS[state]}
          </Text>
        </View>
      </View>
    </View>
  );
}

const STATE_LABELS: Record<PlaybackState, string> = {
  loading: 'Loading',
  playing: 'Playing',
  paused: 'Paused',
  ended: 'Ended',
  error: 'Error',
};

/** Duration from `sourceLoad` (native); web has no such event, so fall back to the live value. */
function useDuration(player: VideoPlayer): number {
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    const subscription = player.addListener('sourceLoad', (event) => setLoaded(event.duration));
    return () => subscription.remove();
  }, [player]);
  return loaded || player.duration || 0;
}

/** True after the end was reached, until playback starts again. */
function useEnded(player: VideoPlayer, isPlaying: boolean): boolean {
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    const subscription = player.addListener('playToEnd', () => setEnded(true));
    return () => subscription.remove();
  }, [player]);
  useEffect(() => {
    if (isPlaying) setEnded(false);
  }, [isPlaying]);
  return ended;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#000' },
  container: { flex: 1 },
  video: { ...StyleSheet.absoluteFill },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: CONTENT_INSET * 2,
    paddingTop: px(160),
    paddingBottom: px(72),
    backgroundImage: 'linear-gradient(0deg, rgba(0,0,0,0.85), transparent)',
  },
  title: { color: colors.text, fontSize: px(56), fontWeight: '800' },
  error: { color: colors.danger, fontSize: px(28), marginTop: px(12) },
  timeline: { flexDirection: 'row', alignItems: 'center', gap: px(24), marginTop: px(32) },
  track: {
    flex: 1,
    height: px(8),
    borderRadius: px(4),
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent },
  time: { color: colors.text, fontSize: px(28), minWidth: px(170), textAlign: 'right' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: px(32),
  },
  buttons: { flexDirection: 'row', gap: px(24) },
  state: { color: colors.textMuted, fontSize: px(28), fontWeight: '600' },
});
