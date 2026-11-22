# Test IDs

Stable `testID`s of the example app. They map to `data-testid` on web, the resource-id on Android TV and the accessibility identifier on tvOS. `<id>` is an item id from the API (e.g. `trending-1`), `<rail>` a rail id (`trending`, `new`, `documentaries`, `family`).

## Shell

| testID                       | Element                                  |
| ---------------------------- | ---------------------------------------- |
| `app_root`                   | Root view                                |
| `side_menu`                  | Side menu (visible on Home and Settings) |
| `menu_home`, `menu_settings` | Menu items; the active tab is `selected` |
| `screen_home`                | Home screen                              |
| `screen_settings`            | Settings screen                          |
| `screen_details`             | Details screen                           |
| `screen_player`              | Player screen                            |

## Home

| testID                              | Element                                       |
| ----------------------------------- | --------------------------------------------- |
| `home_loading`                      | Spinner while the catalog loads (`aria-busy`) |
| `home_error`, `home_error_message`  | Load error and its message                    |
| `home_retry`                        | Retry button                                  |
| `home_hero`                         | Hero area                                     |
| `home_hero_title`, `home_hero_meta` | Title and `year · genre` of the focused card  |
| `home_rails`                        | Vertical list of rails                        |
| `rail_<rail>`, `rail_<rail>_title`  | A rail and its title                          |
| `card_<id>`                         | A card (focusable)                            |

## Details

| testID                                                 | Element                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `details_loading`, `details_error`, `details_retry`    | Loading and error states                                                      |
| `details_title`, `details_meta`, `details_description` | Title, `year · genre · runtime`, description                                  |
| `details_play`, `details_play_label`                   | Play button and its label                                                     |
| `details_my_list`, `details_my_list_label`             | My List toggle (`selected` when added); label `Add to My List` / `In My List` |

## Player

| testID                                           | Element                                            |
| ------------------------------------------------ | -------------------------------------------------- |
| `player_loading`, `player_error`, `player_retry` | Loading and load error states                      |
| `player_video`                                   | Video surface                                      |
| `player_title`                                   | Title                                              |
| `player_playback_error`                          | Playback error message                             |
| `player_progress`                                | Progress bar                                       |
| `player_time`                                    | `m:ss / m:ss`                                      |
| `player_seek_back`, `player_seek_forward`        | -10s / +10s buttons                                |
| `player_play_pause`, `player_play_pause_label`   | Play/pause button; label `Play` / `Pause`          |
| `player_state`                                   | `Loading`, `Playing`, `Paused`, `Ended` or `Error` |

## Settings

| testID                    | Element                                             |
| ------------------------- | --------------------------------------------------- |
| `settings_autoplay`       | Autoplay switch (`checked` when on)                 |
| `settings_autoplay_value` | `On` / `Off`                                        |
| `settings_api_url`        | API base URL in use (the mock server's when mocked) |
| `settings_mock`           | `On` when API traffic goes to the dpad mock server  |
| `settings_platform`       | `web`, `android-tv` or `tvos`                       |

## Focus behavior

- **Initial focus:** first card of the first rail on Home; Play on Details; play/pause on the Player.
- **Rail memory:** entering a rail focuses its last focused card (first visit: its first card). Entering the rails from the menu restores the last focused card; entering the menu restores its last focused item.
- **Edges:** up from the first rail, down from the last rail and right from a rail's last card keep focus; left from a rail's first card goes to the menu; up/down never leave the menu.
- **Back:** Player to Details, Details to Home, each restoring the element that opened the next screen (Play, the card). From Settings, back goes to Home and focuses `menu_home`. On Home, back is left to the platform (exits on Android TV and tvOS).
- **Keys:** D-pad moves focus, select presses. Player: play/pause, play, pause, fast forward / rewind (±10s) and stop media keys where the remote has them (tvOS: play/pause only). Web back keys: `Escape`, `Backspace`, `GoBack`, `BrowserBack`, `XF86Back`.
