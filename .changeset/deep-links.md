---
'@toets/core': minor
'@toets/test': minor
'@toets/driver-web': minor
'@toets/driver-android-tv': minor
'@toets/driver-tvos': minor
'@toets/mcp': minor
---

Deep links. `app.launch({ deepLink })` starts the app from a link (new capability `deeplink.launch`: web, Android TV, tvOS), combined with `state`, `flags` and `clearData`; `app.openDeepLink(url)` delivers a link to the running app (`deeplink.open`: Android TV, tvOS). Tests use one canonical absolute URL; each driver's `deepLink` mapper (`DeepLinkMapper<T>`) translates it: a page path on web, a URI or an intent (`AndroidDeepLink`: action, categories, MIME type, typed extras) on Android TV and Fire TV, a URL on tvOS. Android starts the intent with `am start -p <package>` so the app's intent filters resolve it; tvOS opens the URL through XCTest and passes the launch payload in the app's user defaults; web loads the link's page with the payload in an init script. Step titles and failure dumps show the translation (`last launch`, `last deep link`). New error codes `DEEPLINK_INVALID`, `DEEPLINK_UNHANDLED`, `APP_NOT_LAUNCHED`. MCP: `launch` takes `deepLink`, new `open_deep_link` tool, `capabilities` reports deep link support.
