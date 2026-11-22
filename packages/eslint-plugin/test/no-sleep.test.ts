import { noSleep } from '../src/rules/no-sleep.js';
import { ruleTester } from './rule-tester.js';

ruleTester.run('no-sleep', noSleep, {
  valid: [
    'await expect(app.getByTestId("card")).toBeFocused();',
    'await app.focus.waitForChange(() => app.remote.press(Key.RIGHT));',
    'test.setTimeout(120_000);',
    'testInfo.setTimeout(60_000);',
    // MSW latency simulation inside mock handlers is not a fixed wait in the test.
    'http.get("/api", async () => { await delay(300); return HttpResponse.json({}); });',
    'await locator.waitFor();',
    { code: 'await sleep(100);', options: [{ functions: ['nap'] }] },
  ],
  invalid: [
    { code: 'await sleep(1000);', errors: [{ messageId: 'fixedWait', data: { name: 'sleep' } }] },
    { code: 'await utils.wait(500);', errors: [{ messageId: 'fixedWait' }] },
    { code: 'await page.waitForTimeout(500);', errors: [{ messageId: 'fixedWait' }] },
    {
      code: 'await new Promise((r) => setTimeout(r, 1000));',
      errors: [{ messageId: 'timer', data: { name: 'setTimeout' } }],
    },
    { code: 'globalThis.setTimeout(done, 10);', errors: [{ messageId: 'timer' }] },
    { code: 'window.setInterval(poll, 10);', errors: [{ messageId: 'timer' }] },
    // `node:timers/promises` setTimeout
    { code: 'await setTimeout(1000);', errors: [{ messageId: 'timer' }] },
    {
      code: 'await nap(1);',
      options: [{ functions: ['nap'] }],
      errors: [{ messageId: 'fixedWait', data: { name: 'nap' } }],
    },
  ],
});
