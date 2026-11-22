import { noPlatformOnly } from '../src/rules/no-platform-only.js';
import { ruleTester } from './rule-tester.js';

ruleTester.run('no-platform-only', noPlatformOnly, {
  valid: ['await app.launch();', 'if (app.platform.has("key.color")) await run();'],
  invalid: [
    {
      code: 'await app.platformOnly("web", async (page) => {});',
      errors: [{ messageId: 'platformOnly' }],
    },
    { code: 'await this.app?.platformOnly("tvos", fn);', errors: [{ messageId: 'platformOnly' }] },
  ],
});
