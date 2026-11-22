# ESLint plugin

`@dpad-tv/eslint-plugin` catches the habits that make TV tests flaky or platform-specific: fixed waits, behavior assertions hidden in page objects, raw platform escape hatches and raw keycodes. Flat config only.

## Setup

Scope the plugin to your E2E folder so app code is never linted with test rules:

```js
// eslint.config.js
import dpad from '@dpad-tv/eslint-plugin';

export default [
  // ...your other configs
  { files: ['e2e/**/*.{ts,tsx,js}'], ...dpad.configs.recommended },
];
```

TypeScript files need a TS parser (for example `typescript-eslint`) configured as usual.

## Rules

| Rule                                                          | Recommended | What it prevents                               |
| ------------------------------------------------------------- | ----------- | ---------------------------------------------- |
| [`no-sleep`](./rules/no-sleep.md)                             | error       | Fixed waits (`sleep`, raw `setTimeout`)        |
| [`page-object-assertions`](./rules/page-object-assertions.md) | error       | Behavior assertions inside page objects        |
| [`no-platform-only`](./rules/no-platform-only.md)             | warn        | `app.platformOnly` escape hatches              |
| [`prefer-semantic-keys`](./rules/prefer-semantic-keys.md)     | error       | Raw keycodes and string keys in `remote.press` |

Override levels or options per rule as with any plugin:

```js nocheck
{
  files: ['e2e/**'],
  ...dpad.configs.recommended,
  rules: {
    ...dpad.configs.recommended.rules,
    '@dpad-tv/page-object-assertions': ['error', { files: ['e2e/screens/**'] }],
  },
}
```
