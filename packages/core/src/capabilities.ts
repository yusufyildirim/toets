import { Key } from './keys.js';

/**
 * What a target can do. The union of the driver's capabilities and the capabilities
 * granted by a connected in-app SDK. Tests declare `requires`; unmet requirements skip
 * the test with a reason instead of failing it.
 */
export type Capability =
  | 'key.back'
  | 'key.home'
  | 'key.menu'
  | 'key.info'
  | 'key.media.toggle'
  | 'key.media.discrete'
  | 'key.media.seek'
  | 'key.media.track'
  | 'key.color'
  | 'key.numeric'
  | 'key.channel'
  | 'key.longpress'
  | 'focus.graph'
  | 'sync.idle'
  | 'media.state'
  | 'app.state'
  | 'network.mock'
  | 'screenshot.element'
  | 'platform.events'
  | 'logs'
  | 'video';

/** Capability required to press each key. D-pad and SELECT are universal (`null`). */
export const KEY_CAPABILITY: Readonly<Record<Key, Capability | null>> = {
  UP: null,
  DOWN: null,
  LEFT: null,
  RIGHT: null,
  SELECT: null,
  BACK: 'key.back',
  HOME: 'key.home',
  MENU: 'key.menu',
  INFO: 'key.info',
  PLAY_PAUSE: 'key.media.toggle',
  PLAY: 'key.media.discrete',
  PAUSE: 'key.media.discrete',
  STOP: 'key.media.discrete',
  FAST_FORWARD: 'key.media.seek',
  REWIND: 'key.media.seek',
  NEXT: 'key.media.track',
  PREVIOUS: 'key.media.track',
  RED: 'key.color',
  GREEN: 'key.color',
  YELLOW: 'key.color',
  BLUE: 'key.color',
  CHANNEL_UP: 'key.channel',
  CHANNEL_DOWN: 'key.channel',
  DIGIT_0: 'key.numeric',
  DIGIT_1: 'key.numeric',
  DIGIT_2: 'key.numeric',
  DIGIT_3: 'key.numeric',
  DIGIT_4: 'key.numeric',
  DIGIT_5: 'key.numeric',
  DIGIT_6: 'key.numeric',
  DIGIT_7: 'key.numeric',
  DIGIT_8: 'key.numeric',
  DIGIT_9: 'key.numeric',
};

void Key;
