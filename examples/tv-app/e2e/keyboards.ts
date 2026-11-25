import { defineKeyboard } from '@toets/test';

/**
 * The app-drawn keyboards of the example app. The config loads this file, so it imports only
 * `defineKeyboard`: no fixtures, no page objects.
 */

/** The search screen's keyboard: lower, upper (one-shot Shift) and symbol layers. */
export const searchKeyboard = defineKeyboard({
  name: 'search',
  root: { testId: 'osk' },
  fields: [{ testId: 'search_query' }],
  layers: [{ testId: 'osk_shift' }, { testId: 'osk_symbols' }],
  space: { testId: 'osk_space' },
  backspace: { testId: 'osk_del' },
  clear: { testId: 'osk_clear' },
  submit: { testId: 'osk_go' },
});

/** The parental PIN pad in Settings: digits, delete and OK; the PIN shows masked. */
export const pinPad = defineKeyboard({
  name: 'pin',
  root: { testId: 'pin_pad' },
  fields: [{ testId: 'pin_value' }],
  backspace: { testId: 'pin_del' },
  submit: { testId: 'pin_ok' },
});

export const keyboards = [searchKeyboard, pinPad];
