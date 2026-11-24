/**
 * Canonical, semantic remote keys. Drivers map each key to what the platform's remote
 * really has; keys a platform lacks are unsupported there (see `KEY_CAPABILITY` in `@toets/core`).
 *
 * `PLAY`, `PAUSE` and `PLAY_PAUSE` are deliberately distinct: use `PLAY_PAUSE` to toggle.
 */
export const Key = {
  UP: 'UP',
  DOWN: 'DOWN',
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  SELECT: 'SELECT',
  BACK: 'BACK',
  HOME: 'HOME',
  MENU: 'MENU',
  INFO: 'INFO',
  PLAY_PAUSE: 'PLAY_PAUSE',
  PLAY: 'PLAY',
  PAUSE: 'PAUSE',
  STOP: 'STOP',
  FAST_FORWARD: 'FAST_FORWARD',
  REWIND: 'REWIND',
  NEXT: 'NEXT',
  PREVIOUS: 'PREVIOUS',
  RED: 'RED',
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  BLUE: 'BLUE',
  CHANNEL_UP: 'CHANNEL_UP',
  CHANNEL_DOWN: 'CHANNEL_DOWN',
  DIGIT_0: 'DIGIT_0',
  DIGIT_1: 'DIGIT_1',
  DIGIT_2: 'DIGIT_2',
  DIGIT_3: 'DIGIT_3',
  DIGIT_4: 'DIGIT_4',
  DIGIT_5: 'DIGIT_5',
  DIGIT_6: 'DIGIT_6',
  DIGIT_7: 'DIGIT_7',
  DIGIT_8: 'DIGIT_8',
  DIGIT_9: 'DIGIT_9',
} as const;

export type Key = (typeof Key)[keyof typeof Key];

export const TOETS_KEYS: readonly Key[] = [Key.UP, Key.DOWN, Key.LEFT, Key.RIGHT];

export type Direction = 'up' | 'down' | 'left' | 'right';

/** The D-pad keys: the keys that move focus. */
export type DirectionKey = typeof Key.UP | typeof Key.DOWN | typeof Key.LEFT | typeof Key.RIGHT;

export const DIRECTION_KEY: Readonly<Record<Direction, Key>> = {
  up: Key.UP,
  down: Key.DOWN,
  left: Key.LEFT,
  right: Key.RIGHT,
};

export interface PressOptions {
  /** Hold the key down for this long (long press). Requires `key.longpress`. */
  readonly holdMs?: number;
}

/**
 * App-level key override: how a canonical key is performed on a platform when the app
 * defines its own gesture for it (e.g. tvOS `FAST_FORWARD` = hold RIGHT for 800ms).
 * Overridden keys are flagged in reports.
 */
export interface KeyOverride {
  /** The key actually pressed. */
  readonly as: Key;
  /** Hold it this long; absent = a plain press. */
  readonly holdMs?: number;
}
