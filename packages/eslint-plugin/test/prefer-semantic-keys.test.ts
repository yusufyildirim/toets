import { preferSemanticKeys } from '../src/rules/prefer-semantic-keys.js';
import { ruleTester } from './rule-tester.js';

ruleTester.run('prefer-semantic-keys', preferSemanticKeys, {
  valid: [
    'await app.remote.press(Key.UP);',
    'await remote.press(key);',
    'await app.remote.longPress(Key.RIGHT, 800);',
    'await app.remote.sequence([Key.DOWN, Key.SELECT]);',
    'await app.remote.sequence(keys);',
    // Not a remote.
    'await button.press("Enter");',
    'await page.keyboard.press("ArrowUp");',
  ],
  invalid: [
    {
      code: 'await app.remote.press("UP");',
      errors: [
        {
          messageId: 'rawString',
          suggestions: [
            { messageId: 'useKey', data: { key: 'UP' }, output: 'await app.remote.press(Key.UP);' },
          ],
        },
      ],
    },
    {
      code: 'await app.remote.press("ArrowLeft" as Key);',
      errors: [
        {
          messageId: 'unknownKey',
          suggestions: [
            {
              messageId: 'useKey',
              data: { key: 'LEFT' },
              output: 'await app.remote.press(Key.LEFT);',
            },
          ],
        },
      ],
    },
    {
      code: 'await this.app.remote.press(19);',
      errors: [{ messageId: 'rawKeycode', data: { raw: '19' } }],
    },
    { code: 'await remote.repeat("Foo", 3);', errors: [{ messageId: 'unknownKey' }] },
    {
      code: 'await tvRemote.press("select");',
      errors: [
        {
          messageId: 'unknownKey',
          suggestions: [
            {
              messageId: 'useKey',
              data: { key: 'SELECT' },
              output: 'await tvRemote.press(Key.SELECT);',
            },
          ],
        },
      ],
    },
    { code: 'await app.remote.press(`UP`);', errors: [{ messageId: 'unknownKey' }] },
    {
      code: 'await app.remote.sequence([Key.DOWN, "KEYCODE_DPAD_CENTER", 4]);',
      errors: [
        {
          messageId: 'unknownKey',
          suggestions: [
            {
              messageId: 'useKey',
              data: { key: 'SELECT' },
              output: 'await app.remote.sequence([Key.DOWN, Key.SELECT, 4]);',
            },
          ],
        },
        { messageId: 'rawKeycode' },
      ],
    },
  ],
});
