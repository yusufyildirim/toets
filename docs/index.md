---
layout: home
description: Cross-platform E2E testing for TV apps - one test for web, Android TV / Fire TV and tvOS, with focus and the remote as first-class primitives.
hero:
  name: dpad
  text: E2E tests for TV apps
  tagline: Write one test. Run it on web, Android TV / Fire TV and tvOS. Trust that it tests the same thing everywhere.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started/
    - theme: alt
      text: Concepts
      link: /concepts/locators-and-assertions
    - theme: alt
      text: For agents
      link: /getting-started/agents
---

<div class="vp-doc" style="max-width: 760px; margin: 0 auto; padding: 0 24px">

```ts run
import { test, expect, Key } from '@dpad-tv/test';

test('opens details from the first rail', async ({ app }) => {
  await app.launch();
  const card = app.getByTestId('rail-0-card-0');
  await app.focus.navigateTo(card);
  await expect(card).toBeFocused();
  await app.remote.press(Key.SELECT);
  await expect(app.getByTestId('details-screen')).toBeVisible();
});
```

Built on Playwright Test. Focus and the remote replace the pointer, matchers mean the same on every platform, and platform gaps are declared as capabilities instead of hidden. Pre-alpha.

</div>
