import { expect, type App, type Locator } from '@dpad-tv/test';

/** The full-screen player. */
export class PlayerPage {
  readonly app: App;
  readonly screen: Locator;
  readonly error: Locator;
  readonly title: Locator;
  readonly time: Locator;
  readonly progress: Locator;
  readonly seekBack: Locator;
  readonly playPause: Locator;
  readonly playPauseLabel: Locator;
  readonly seekForward: Locator;
  /** `Loading`, `Playing`, `Paused`, `Ended` or `Error`: what the viewer sees. */
  readonly state: Locator;

  constructor(app: App) {
    this.app = app;
    this.screen = app.getByTestId('screen_player');
    this.error = app.getByTestId('player_error');
    this.title = app.getByTestId('player_title');
    this.time = app.getByTestId('player_time');
    this.progress = app.getByTestId('player_progress');
    this.seekBack = app.getByTestId('player_seek_back');
    this.playPause = app.getByTestId('player_play_pause');
    this.playPauseLabel = app.getByTestId('player_play_pause_label');
    this.seekForward = app.getByTestId('player_seek_forward');
    this.state = app.getByTestId('player_state');
  }

  /** Player open: play/pause holds the initial focus. */
  async waitUntilLoaded(): Promise<void> {
    await expect(this.playPause).toBeFocused();
  }
}
