import { ToetsError, packageDocsLink, KEY_CAPABILITY, Key, type Capability } from '@toets/core';

/**
 * How one semantic {@link Key} is delivered to the page as a real (trusted) keyboard event.
 *
 * TV web runtimes disagree on key events: modern code reads `KeyboardEvent.key`, many TV
 * builds read numeric `keyCode`s (e.g. Tizen BACK = 10009, webOS BACK = 461). Describe what
 * your app listens to; the driver sends exactly that.
 */
export interface WebKeySpec {
  /**
   * `KeyboardEvent.key`. Must be a W3C UI Events key value (e.g. `ArrowUp`, `MediaPlayPause`,
   * `ColorF0Red`) or a single character; Chromium reports anything else as an empty string.
   */
  readonly key: string;
  /** `KeyboardEvent.code` (physical key). Default: empty string. */
  readonly code?: string;
  /** `KeyboardEvent.keyCode` / `which`, passed through verbatim. Default: `0`. */
  readonly keyCode?: number;
  /** Text the key produces (generates `keypress`/`input`), e.g. `'\r'` for Enter. */
  readonly text?: string;
}

/**
 * Per-app key map overrides. A {@link WebKeySpec} replaces the default for that key, `null`
 * removes it (and the key's capability, so tests requiring it are skipped).
 */
export type WebKeyMap = Readonly<Partial<Record<Key, WebKeySpec | null>>>;

/** The resolved key map: only mapped keys are present. */
export type ResolvedKeyMap = Readonly<Partial<Record<Key, WebKeySpec>>>;

const digit = (n: number): WebKeySpec => ({
  key: String(n),
  code: `Digit${n}`,
  keyCode: 48 + n,
  text: String(n),
});

/**
 * Default key map. `key` values follow W3C UI Events. `keyCode`s follow the OIPF/HbbTV
 * (CEA-2014) virtual key codes that Tizen, webOS and HbbTV browsers share, except BACK, which
 * is `Escape` (27): the key browser builds of TV apps conventionally handle. HOME and MENU are
 * unmapped: TV operating systems do not deliver them to web apps.
 */
export const DEFAULT_KEY_MAP: ResolvedKeyMap = {
  [Key.UP]: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  [Key.DOWN]: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  [Key.LEFT]: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  [Key.RIGHT]: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  [Key.SELECT]: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  [Key.BACK]: { key: 'Escape', code: 'Escape', keyCode: 27 },
  [Key.INFO]: { key: 'Info', keyCode: 457 },
  [Key.PLAY_PAUSE]: { key: 'MediaPlayPause', code: 'MediaPlayPause', keyCode: 402 },
  [Key.PLAY]: { key: 'MediaPlay', code: 'MediaPlay', keyCode: 415 },
  [Key.PAUSE]: { key: 'MediaPause', code: 'MediaPause', keyCode: 19 },
  [Key.STOP]: { key: 'MediaStop', code: 'MediaStop', keyCode: 413 },
  [Key.FAST_FORWARD]: { key: 'MediaFastForward', code: 'MediaFastForward', keyCode: 417 },
  [Key.REWIND]: { key: 'MediaRewind', code: 'MediaRewind', keyCode: 412 },
  [Key.NEXT]: { key: 'MediaTrackNext', code: 'MediaTrackNext', keyCode: 425 },
  [Key.PREVIOUS]: { key: 'MediaTrackPrevious', code: 'MediaTrackPrevious', keyCode: 424 },
  [Key.RED]: { key: 'ColorF0Red', keyCode: 403 },
  [Key.GREEN]: { key: 'ColorF1Green', keyCode: 404 },
  [Key.YELLOW]: { key: 'ColorF2Yellow', keyCode: 405 },
  [Key.BLUE]: { key: 'ColorF3Blue', keyCode: 406 },
  [Key.CHANNEL_UP]: { key: 'ChannelUp', keyCode: 427 },
  [Key.CHANNEL_DOWN]: { key: 'ChannelDown', keyCode: 428 },
  [Key.DIGIT_0]: digit(0),
  [Key.DIGIT_1]: digit(1),
  [Key.DIGIT_2]: digit(2),
  [Key.DIGIT_3]: digit(3),
  [Key.DIGIT_4]: digit(4),
  [Key.DIGIT_5]: digit(5),
  [Key.DIGIT_6]: digit(6),
  [Key.DIGIT_7]: digit(7),
  [Key.DIGIT_8]: digit(8),
  [Key.DIGIT_9]: digit(9),
};

const KNOWN_KEYS = new Set<string>(Object.values(Key));

/** Applies app overrides to {@link DEFAULT_KEY_MAP}, validating them. */
export function resolveKeyMap(overrides: WebKeyMap | undefined): ResolvedKeyMap {
  const out: Partial<Record<Key, WebKeySpec>> = { ...DEFAULT_KEY_MAP };
  if (overrides === undefined) return out;
  if (typeof overrides !== 'object' || overrides === null) {
    throw invalidKeys('`keys` must be an object mapping toets keys to key specs.');
  }
  for (const [name, spec] of Object.entries(overrides) as [string, unknown][]) {
    if (!KNOWN_KEYS.has(name)) {
      throw invalidKeys(
        `\`keys.${name}\` is not a toets key.`,
        `Use one of: ${[...KNOWN_KEYS].join(', ')}.`,
      );
    }
    const key = name as Key;
    if (spec === null) {
      delete out[key];
      continue;
    }
    out[key] = validateSpec(key, spec);
  }
  return out;
}

function validateSpec(key: Key, spec: unknown): WebKeySpec {
  const s = spec as Partial<Record<keyof WebKeySpec, unknown>> | undefined;
  if (typeof s !== 'object' || s === null || typeof s.key !== 'string' || s.key === '') {
    throw invalidKeys(`\`keys.${key}\` must be \`null\` or an object with a non-empty \`key\`.`);
  }
  if (s.code !== undefined && typeof s.code !== 'string') {
    throw invalidKeys(`\`keys.${key}.code\` must be a string.`);
  }
  if (s.keyCode !== undefined && (typeof s.keyCode !== 'number' || !Number.isInteger(s.keyCode))) {
    throw invalidKeys(`\`keys.${key}.keyCode\` must be an integer.`);
  }
  if (s.text !== undefined && typeof s.text !== 'string') {
    throw invalidKeys(`\`keys.${key}.text\` must be a string.`);
  }
  return {
    key: s.key,
    ...(s.code === undefined ? {} : { code: s.code }),
    ...(s.keyCode === undefined ? {} : { keyCode: s.keyCode }),
    ...(s.text === undefined ? {} : { text: s.text }),
  };
}

function invalidKeys(message: string, hint?: string): ToetsError {
  return new ToetsError('WEB_INVALID_CONFIG', message, {
    hint: hint ?? 'Fix the `keys` option of the web app config.',
    docs: packageDocsLink('driver-web', 'keys'),
  });
}

/**
 * Key capabilities the map supports: a capability is declared only when every key that
 * requires it is mapped (e.g. `key.color` needs all four color keys).
 */
export function keyCapabilities(map: ResolvedKeyMap): Capability[] {
  const byCapability = new Map<Capability, boolean>();
  for (const [key, capability] of Object.entries(KEY_CAPABILITY) as [Key, Capability | null][]) {
    if (capability === null) continue;
    const mapped = map[key] !== undefined;
    byCapability.set(capability, (byCapability.get(capability) ?? true) && mapped);
  }
  return [...byCapability].filter(([, ok]) => ok).map(([c]) => c);
}
