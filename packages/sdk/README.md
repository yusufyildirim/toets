# @toets/sdk

toets in-app SDK: the framework-neutral runtime (`@toets/sdk`), the web adapter (`@toets/sdk/web`) and an inert stand-in for production builds (`@toets/sdk/noop`). Inert unless the app is launched by toets.

```ts
import { startToets } from '@toets/sdk/web';
startToets();
```

Docs (shipped in `docs/`): [overview](./docs/overview.md), [web adapter](./docs/web.md), [idle](./docs/idle.md), [app state](./docs/state.md), [media](./docs/media.md), [production builds](./docs/production.md), [writing an adapter](./docs/adapters.md), [traps](./docs/traps.md). Project overview: [toets](https://github.com/yusufyildirim/toets#readme).
