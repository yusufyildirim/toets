# Android TV fixture app

Minimal native Android TV app (Kotlin, plain Views, no libraries) that the driver's integration test runs against. It proves the driver is framework neutral: resource IDs are the test IDs and the platform focus engine moves focus.

- Home: side menu, a rail of ten cards (partly scrolled out), a disabled button with a content description.
- Details: `SELECT` on a card; `play_button`, `favorite_button` (toggles selected); `BACK` restores focus to the card.
- Player: fake playback state driven by media keys (`player_state`, `player_position`).
- Status bar: last key received (`last_key`), key hold duration and repeats (`key_hold`), the `__toets` launch payload (`launch_payload`) and the response of `<mockUrl>/fixture/hello` (`mock_result`).

Build: `./gradlew assembleDebug` (needs `ANDROID_HOME` and a JDK 17+).
