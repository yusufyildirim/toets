import { Key, KEY_CAPABILITY } from '@toets/core';
import { describe, expect, it } from 'vitest';
import { ANDROID_KEYCODES, REMOTE_PROFILE_CAPABILITIES, keySupported } from '../src/keys.js';

describe('ANDROID_KEYCODES', () => {
  it('maps every toets key to a distinct Android keycode', () => {
    const keys = Object.values(Key);
    expect(Object.keys(ANDROID_KEYCODES).sort()).toEqual([...keys].sort());
    expect(new Set(Object.values(ANDROID_KEYCODES)).size).toBe(keys.length);
  });

  it('uses the Android TV keycodes', () => {
    expect(ANDROID_KEYCODES).toMatchObject({
      SELECT: 23,
      BACK: 4,
      PLAY_PAUSE: 85,
      PLAY: 126,
      PAUSE: 127,
      RED: 183,
      BLUE: 186,
      CHANNEL_UP: 166,
      DIGIT_0: 7,
      DIGIT_9: 16,
    });
  });
});

describe('remote profiles', () => {
  it('android-tv claims every key capability', () => {
    const claimed = new Set(REMOTE_PROFILE_CAPABILITIES['android-tv']);
    for (const cap of Object.values(KEY_CAPABILITY)) {
      if (cap) expect(claimed.has(cap)).toBe(true);
    }
  });

  it('fire-tv only claims what the Fire TV remote has', () => {
    const caps = new Set(REMOTE_PROFILE_CAPABILITIES['fire-tv']);
    expect(keySupported(Key.SELECT, caps)).toBe(true);
    expect(keySupported(Key.PLAY_PAUSE, caps)).toBe(true);
    expect(keySupported(Key.MENU, caps)).toBe(true);
    expect(keySupported(Key.FAST_FORWARD, caps)).toBe(true);
    expect(keySupported(Key.REWIND, caps)).toBe(true);
    expect(keySupported(Key.NEXT, caps)).toBe(false);
    expect(keySupported(Key.PLAY, caps)).toBe(false);
    expect(keySupported(Key.RED, caps)).toBe(false);
    expect(keySupported(Key.DIGIT_1, caps)).toBe(false);
    expect(keySupported(Key.CHANNEL_UP, caps)).toBe(false);
    expect(keySupported(Key.INFO, caps)).toBe(false);
  });
});
