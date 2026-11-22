import { pageObjectAssertions } from '../src/rules/page-object-assertions.js';
import { ruleTester } from './rule-tester.js';

const page = 'e2e/pages/home.ts';

ruleTester.run('page-object-assertions', pageObjectAssertions, {
  valid: [
    { filename: page, code: 'await expect(this.rail).toBeVisible();' },
    { filename: page, code: 'await expect(this.card).toBeFocused();' },
    { filename: page, code: 'await expect(this.spinner).not.toBeBusy();' },
    { filename: page, code: 'await expect(this.list).toHaveFocusWithin();' },
    { filename: 'e2e/HomePage.ts', code: 'await expect.soft(this.rail).toBeInViewport();' },
    // Not a page object: tests may assert anything.
    { filename: 'e2e/home.spec.ts', code: 'await expect(card).toHaveText("Alpha");' },
    // Not an expect chain.
    { filename: page, code: 'await this.app.remote.press(Key.SELECT);' },
    {
      filename: page,
      code: 'await expect(title).toHaveText("x");',
      options: [{ allowedMatchers: ['toHaveText'] }],
    },
    {
      filename: page,
      code: 'await expect(title).toHaveText("x");',
      options: [{ files: ['**/screens/**'] }],
    },
  ],
  invalid: [
    {
      filename: page,
      code: 'await expect(this.title).toHaveText("Home");',
      errors: [
        {
          messageId: 'notAllowed',
          data: {
            matcher: 'toHaveText',
            allowed:
              '`toBeVisible`, `toBeInViewport`, `toBeFocused`, `toHaveFocusWithin`, `toBeBusy`',
          },
        },
      ],
    },
    {
      filename: 'e2e/page-objects/player.ts',
      code: 'await expect(this.app.media).not.toBePlaying();',
      errors: [{ messageId: 'notAllowed' }],
    },
    {
      filename: 'e2e/details.page.ts',
      code: 'await expect.poll(() => this.count()).toBe(3);',
      errors: [{ messageId: 'notAllowed' }],
    },
    {
      filename: 'e2e/screens/home.ts',
      code: 'await expect(this.card).toBeFocused();',
      options: [{ files: ['**/screens/**'], allowedMatchers: ['toBeVisible'] }],
      errors: [
        { messageId: 'notAllowed', data: { matcher: 'toBeFocused', allowed: '`toBeVisible`' } },
      ],
    },
  ],
});
