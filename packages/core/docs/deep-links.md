# Deep links

`app.launch({ deepLink })` starts the app from a link; `app.openDeepLink(url)` delivers a link to the running app. Tests pass one canonical absolute URL; each driver's `deepLink` mapper translates it to the platform's form. Concepts and traps: the `concepts/deep-links` page of the docs site.

```ts nocheck
await app.launch({ deepLink: 'myapp://details/42' });
await app.launch({ deepLink: 'myapp://details/42', state: 'signed-in', clearData: true });
await app.openDeepLink('myapp://details/43');
```

## API

| Call                                   | Capability        | Does                                                                                     |
| -------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `app.launch({ deepLink, ...options })` | `deeplink.launch` | Stops the app (and clears its data with `clearData`), then starts it from the link.      |
| `app.openDeepLink(url)`                | `deeplink.open`   | Delivers the link to the running app. Fails with `APP_NOT_LAUNCHED` before `app.launch`. |

The link is translated once per call, before the app is touched: an invalid link or a throwing mapper fails the step with `DEEPLINK_INVALID` and leaves the app as it was.

## Mappers

`type DeepLinkMapper<T> = (link: URL) => T`, set as `deepLink` in a platform's app config (`app.web`, `app.androidTV`, `app.tvOS`) or a project's `app`:

| Driver     | `T`                         | Default                                                                            |
| ---------- | --------------------------- | ---------------------------------------------------------------------------------- |
| web        | `string`                    | `myapp://details/42?t=1` → `details/42?t=1`; `https://x.com/watch/42` → `watch/42` |
| Android TV | `string \| AndroidDeepLink` | the link as a `VIEW` intent                                                        |
| tvOS       | `string`                    | the link                                                                           |

Web resolves the result against the app `url` like a link on its page (`details/42` keeps the `url` path, `/details/42` replaces it); it must end up http(s) or file. tvOS needs an absolute URL. Android takes a URI or an intent:

```ts nocheck
interface AndroidDeepLink {
  uri?: string; // -d
  action?: string; // -a, default android.intent.action.VIEW
  categories?: string[]; // -c
  mimeType?: string; // -t
  extras?: Record<string, string | number | boolean>; // --es, --ez, --ei (--el beyond 32 bits), --ef
}
```

## Per platform

**Web.** Browsers have no OS deep links. A deep link launch loads the translated page URL instead of `url`, with the launch payload in an init script (`window.__TOETS__`), never in the link's URL. A page that answers an HTTP error fails with `DEEPLINK_UNHANDLED`: serve the app on every route (SPA history fallback) or map the link to a URL the server serves. No `deeplink.open`.

**Android TV.** `am start -W` with the intent and `-p <package>`, never a component: the OS picks the activity from the app's intent filters, as for a real link. A deep link launch force-stops the app first (and clears its data with `clearData`) and adds the launch payload extra `__toets`; `openDeepLink` sends the same intent without either, so a running app gets it in `onNewIntent`. No resolving activity: `DEEPLINK_UNHANDLED`.

**tvOS.** The URL is opened in the app through XCTest (`XCUIApplication.open`); `simctl openurl` would stop at a system "Open in ...?" prompt. A deep link launch can not pass launch arguments, so the launch payload goes into the app's user defaults (`defaults write <bundleId> __toets`), where `UserDefaults.standard.string(forKey: "__toets")` and the SDK read it like the argument; toets removes it again on the next launch, terminate or stop. `launchArguments` and `launchEnvironment` do not apply to deep link launches. A URL whose scheme the app does not register in its Info.plist (`CFBundleURLTypes`) fails with `DEEPLINK_UNHANDLED`. Universal links (https) are not supported.

## Reports

Step titles and failure dumps show the link and, when it differs, its translation:

```text
launch (deepLink: myapp://details/42 → intent com.example.PLAY extras { contentId: "42" })
openDeepLink myapp://details/42 → http://localhost:8080/watch/42
```

The failure dump lists the `last launch` and `last deep link` of the test.

## Errors

| Code                 | When                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DEEPLINK_INVALID`   | The link is not an absolute URL, or the platform's mapper threw or returned something the platform can not open. |
| `DEEPLINK_UNHANDLED` | No activity, URL scheme or page of the app handles the translated link.                                          |
| `APP_NOT_LAUNCHED`   | `openDeepLink` before `app.launch`.                                                                              |
| `CAPABILITY_MISSING` | The platform lacks `deeplink.launch` or `deeplink.open`: declare it with `requires`.                             |

With a deep link launch, `SDK_NOT_CONNECTED` also points at Android trampoline activities that start the real activity without forwarding the extras.
