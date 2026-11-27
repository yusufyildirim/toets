import { expect, requires, test } from '@toets/test';

import { DetailsPage } from './pages/DetailsPage.js';
import { HomePage } from './pages/HomePage.js';
import { PlayerPage } from './pages/PlayerPage.js';

// One canonical link per screen, the app's own URL. Each platform's form (a web path, the Fire
// TV content intent) is translated in playwright.config.ts, never here.
const details = (itemId: string) => `toetstv://details/${itemId}`;

test.describe('deep links', requires('deeplink.launch'), () => {
  test('a link cold-starts the app on details, Play focused', async ({ app }) => {
    const page = new DetailsPage(app);
    await app.launch({ deepLink: details('new-2') });

    // Landing with nothing focused is the classic deep link bug on TV: assert focus first.
    await expect(page.play).toBeFocused();
    await expect(page.title).toHaveText('Ironwood');
  });

  test('launch flags apply to a launch from a link', requires('app.state'), async ({ app }) => {
    const page = new DetailsPage(app);
    const player = new PlayerPage(app);
    await app.launch({ deepLink: details('trending-1'), flags: { autoplay: false } });
    await page.waitUntilLoaded();
    await expect(page.title).toHaveText('Northern Lights');

    await page.startPlayback();
    await player.waitUntilLoaded();
    await expect(player.state).toHaveText('Paused');
  });
});

// The OS delivers links to the running app. Browsers have no OS deep links: skipped on web.
test.describe('deep links while running', requires('deeplink.open'), () => {
  test('a link opens details over home', async ({ app }) => {
    const home = new HomePage(app);
    const page = new DetailsPage(app);
    await home.open();

    await app.openDeepLink(details('new-2'));
    await expect(page.play).toBeFocused();
    await expect(page.title).toHaveText('Ironwood');

    await app.openDeepLink(details('trending-1'));
    await expect(page.play).toBeFocused();
    await expect(page.title).toHaveText('Northern Lights');
  });

  test('a link no app handles fails', async ({ app }) => {
    const home = new HomePage(app);
    const unknown = 'toetstv-unknown://details/new-2';
    await expect(app.launch({ deepLink: unknown })).rejects.toMatchObject({
      code: 'DEEPLINK_UNHANDLED',
    });

    await home.open();
    await expect(app.openDeepLink(unknown)).rejects.toMatchObject({
      code: 'DEEPLINK_UNHANDLED',
    });
    await expect(home.rails).toHaveFocusWithin();
  });
});
