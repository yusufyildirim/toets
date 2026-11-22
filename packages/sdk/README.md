# @dpad-tv/sdk

dpad in-app SDK: the framework-neutral runtime (`@dpad-tv/sdk`), the web adapter (`@dpad-tv/sdk/web`) and an inert stand-in for production builds (`@dpad-tv/sdk/noop`). Inert unless the app is launched by dpad.

```ts
import { startDpad } from '@dpad-tv/sdk/web';
startDpad();
```

Docs (shipped in `docs/`): [overview](./docs/overview.md), [web adapter](./docs/web.md), [idle](./docs/idle.md), [app state](./docs/state.md), [media](./docs/media.md), [production builds](./docs/production.md), [writing an adapter](./docs/adapters.md), [traps](./docs/traps.md). Project overview: [dpad](https://github.com/yusufyildirim/dpad#readme).
