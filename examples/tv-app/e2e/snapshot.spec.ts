import { expect, requires, test } from '@dpad-tv/test';

import { picksApi } from './data/catalog.js';
import { DetailsPage } from './pages/DetailsPage.js';
import { HomePage } from './pages/HomePage.js';

// Inline snapshots with mocked data: the same text on every platform is the parity claim. A rail
// keeps its children in every tree; a whole screen nests like the tree it is read from.
test.describe('text snapshots', requires('network.mock'), () => {
  test('a rail with the first card focused', async ({ app }) => {
    const home = new HomePage(app);
    app.network.use(...picksApi);
    await home.open();

    await expect(home.rail('picks')).toMatchTextSnapshot(`
      - rail_picks:
        - rail_picks_title "Test picks"
        - card_pick-1 [focused]:
          - text "First Pick"
          - text "2020 · Drama"
        - card_pick-2:
          - text "Second Pick"
          - text "2021 · Comedy"
    `);
  });

  test('the details screen', async ({ app, dpad }) => {
    test.skip(
      dpad?.platform === 'android-tv' && !dpad.options.sdk,
      "React Native's Android accessibility tree lists a plain View's children as its siblings",
    );
    const home = new HomePage(app);
    const details = new DetailsPage(app);
    app.network.use(...picksApi);
    await home.open();
    await home.openCard('pick-1');
    await details.waitUntilLoaded();

    await expect(app).toMatchTextSnapshot(`
      - app_root:
        - screen_details:
          - text "First Pick"
          - details_title "First Pick"
          - details_meta "2020 · Drama · 1h 15m"
          - details_description "A test title with a fixed description."
          - details_play [focused]:
            - details_play_label "Play"
          - details_my_list:
            - details_my_list_label "Add to My List"
    `);
  });
});
