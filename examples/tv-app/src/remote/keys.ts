/** Media keys the player reacts to. Not every remote has all of them (tvOS: playPause only). */
export type MediaKey = 'playPause' | 'play' | 'pause' | 'fastForward' | 'rewind' | 'stop';

export const MEDIA_KEYS: ReadonlySet<string> = new Set<MediaKey>([
  'playPause',
  'play',
  'pause',
  'fastForward',
  'rewind',
  'stop',
]);
