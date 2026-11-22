# TV traps on the web

Where desktop-web intuition misleads when testing TV apps in Chromium.

- **No click, no scroll.** The driver only presses keys. Element screenshots never scroll; off-screen elements fail with `WEB_ELEMENT_OFFSCREEN`. Move focus to bring things into view, as a user would.
- **Virtual focus.** Many TV apps never move DOM focus. If `focused()` is always `null`, configure [`focus` selectors](./options.md#virtual-focus).
- **BACK is `Escape`.** Real TV browsers send their own codes (Tizen 10009, webOS 461). Map them in [`keys`](./keys.md) if your build reads keyCodes.
- **Text is DOM text.** CSS `text-transform` is ignored: a label rendered as `PLAY` with `text-transform: uppercase` has text `Play`. Default text matching is case-insensitive anyway.
- **Clipping is approximated.** `inViewport` honors `overflow` clipping and `position: fixed`, not `clip-path` or absolutely positioned children escaping a clipping ancestor.
- **The viewport is the TV screen.** Driver-created contexts are 1920x1080. A borrowed page keeps its own viewport; set it to the TV resolution your layouts target.
- **Autoplay needs a gesture.** TV browsers autoplay; desktop Chromium blocks `play()` that no user gesture started (launch states, autoplaying heroes). Launch Chromium with `--autoplay-policy=no-user-gesture-required` (`platforms.web({ use: { launchOptions: { args: [...] } } })`).
- **Codecs differ by build.** Check `video.canPlayType()` for your stream format in the Chromium you run; switch `launchOptions.channel` (e.g. `chrome`) if a proprietary codec is missing.
- **Traces show dpad steps, not keyboard actions.** Keys go through CDP, so the Playwright trace shows them inside dpad's steps rather than as `keyboard.press` actions.
