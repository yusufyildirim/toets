---
description: Tests open the app from one canonical link. Each platform's form of it (a web path, an Android intent) is a translation in the config, so the test means the same everywhere.
---

# Deep links

A deep link opens the app on a screen: a link in a launcher row, a voice command, a notification, a partner app. toets opens links the way the platform does: the OS resolves the app from its declared URL schemes or intent filters, starts it or delivers the link to the running instance, and the app routes. A test checks that whole chain, not only the router.

```ts run
import { expect, Key, requires, test } from '@toets/test';

test('a link starts the app on details', requires('deeplink.launch'), async ({ app }) => {
  await app.launch({ deepLink: 'demotv://details/sintel' });
  // Landing with nothing focused is the classic deep link bug on TV: assert focus first.
  await expect(app.getByTestId('details-play')).toBeFocused();
  await expect(app.getByTestId('details-title')).toHaveText('Sintel');
});

test('a link opens details in the running app', requires('deeplink.open'), async ({ app }) => {
  await app.launch();
  await app.openDeepLink('demotv://details/coffee-run');
  await expect(app.getByTestId('details-play')).toBeFocused();
  await expect(app.getByTestId('details-title')).toHaveText('Coffee Run');

  await app.remote.press(Key.BACK);
  await expect(app.getByTestId('rail-0-card-0')).toBeFocused();
});
```

## One link, translated per platform

Tests use **one canonical link**: an absolute URL, usually the app's own scheme (`myapp://details/42`). Where a platform takes another form, the config translates it. Each driver has a `deepLink` mapper, `(link: URL) => ...`, set in `app` or on a project:

| Platform   | Mapper returns                                                      | Default                                                                         |
| ---------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| web        | a page URL or path, resolved against `url`                          | host, path, query and hash as a path (`details/42`); http(s) links: path, query |
| Android TV | a URI, or an intent `{ uri, action, categories, mimeType, extras }` | the link as a `VIEW` intent                                                     |
| tvOS       | a URL                                                               | the link                                                                        |

```ts
import { defineConfig, platforms } from '@toets/test';

export default defineConfig({
  app: {
    web: { url: 'http://localhost:8080', deepLink: (link) => `/watch${link.pathname}` },
    androidTV: { package: 'com.example.tv' },
    tvOS: { bundleId: 'com.example.tv' },
  },
  projects: [
    platforms.web(),
    platforms.androidTV(),
    platforms.tvOS(),
    // Fire TV opens content with an intent: a custom action and extras, no URI.
    platforms.androidTV({
      name: 'fire-tv',
      remote: 'fire-tv',
      app: {
        deepLink: (link) => ({
          action: 'com.example.PLAY',
          extras: { contentId: link.pathname.slice(1) },
        }),
      },
    }),
  ],
});
```

The step title shows the translation, and so does the failure dump: `launch (deepLink: myapp://details/42 → intent com.example.PLAY extras { contentId: "42" })`.

## Cold and running

- `app.launch({ deepLink })` stops the app and starts it **from the link** (`deeplink.launch`): the system starts the app for the link, as a launcher does. It combines with `state`, `flags` and `clearData`; the launch payload reaches the app as usual.
- `app.openDeepLink(url)` delivers the link to the **running** app (`deeplink.open`), which routes without restarting. The app must be launched first.

| Platform   | `deeplink.launch`                                         | `deeplink.open`                      |
| ---------- | --------------------------------------------------------- | ------------------------------------ |
| web        | loads the link's page URL instead of `url`                | no: a running page receives no links |
| Android TV | `am start` of the intent, resolved by the OS              | the same intent, app still running   |
| tvOS       | the URL opened in the app, which the system starts for it | the URL opened in the running app    |

A link no app handles fails with `DEEPLINK_UNHANDLED`, naming the translated form. Details per platform: [deep links reference](../reference/core/docs/deep-links.md).

## Traps

- **Assert focus after landing.** A screen opened from a link often renders with nothing focused, because focus was set by the navigation the link skipped. A test that only checks the title passes while the remote does nothing. Assert `toBeFocused()` on the element a user expects first.
- **Trampoline activities must forward extras.** On Android the launch payload rides on the intent as the extra `__toets`. A splash or router activity that starts the real activity with a new intent drops it, and the SDK never connects (`SDK_NOT_CONNECTED`). Copy the extras (`newIntent.putExtras(intent)`) or start the real activity from the link directly.
- **Translate, do not branch.** Platform differences in link format belong in the config's mappers. A test that builds `/watch/42` on web and `myapp://details/42` elsewhere tests two different things.
- **A link one platform does not have is app scope.** When an app handles a link only on some platforms, run that test only there: a project `testMatch`/`testIgnore` or a tag `grep`. Never translate it into another screen's link on the rest; the test would pass on a screen it does not test.
- **Running links are a separate path.** Apps often read the start link and listen for later links in different places (React Native: `Linking.getInitialURL()` and the `url` event; Android: `onCreate` and `onNewIntent`). Test both.
