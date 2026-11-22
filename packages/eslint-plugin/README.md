# @dpad-tv/eslint-plugin

ESLint rules for writing good dpad tests: no fixed waits, stability-only page objects, no platform escape hatches, semantic keys. Flat config.

```js
import dpad from '@dpad-tv/eslint-plugin';

export default [{ files: ['e2e/**'], ...dpad.configs.recommended }];
```

Docs: [`docs/setup.md`](./docs/setup.md), one page per rule in [`docs/rules/`](./docs/rules). Project overview: [dpad](../../README.md).
