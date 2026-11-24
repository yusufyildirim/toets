# @toets/eslint-plugin

ESLint rules for writing good toets tests: no fixed waits, stability-only page objects, no platform escape hatches, semantic keys. Flat config.

```js
import toets from '@toets/eslint-plugin';

export default [{ files: ['e2e/**'], ...toets.configs.recommended }];
```

Docs: [`docs/setup.md`](./docs/setup.md), one page per rule in `docs/rules/`. Project overview: [toets](https://github.com/yusufyildirim/toets#readme).
