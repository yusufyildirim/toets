import { test, expect } from '@dpad-tv/test';

test('resumes from the continue-watching rail', { requires: ['app.state'] }, async ({ app }) => {
  await app.launch({ state: 'signed-in-with-history' });
  await expect(app.getByTestId('rail-continue-watching')).toBeVisible();
});
