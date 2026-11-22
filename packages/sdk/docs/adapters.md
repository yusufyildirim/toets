# Writing an adapter

An adapter connects a UI framework to the runtime. The runtime owns the protocol, the connection, idle tracking, logs, state and media; the adapter answers what only the framework knows: the tree and focus.

```ts
import { createDpad } from '@dpad-tv/sdk';

export function startDpad(options = {}) {
  const dpad = createDpad({ payload: discoverPayload(), framework: 'my-framework', ...options });
  if (!dpad.active) return dpad; // inert: install nothing

  dpad.handle('tree.get', ({ rootId }) => ({ root: mapTree(rootId), viewport: viewport() }));
  dpad.handle('focus.get', () => ({ node: mapFocused() }));
  dpad.handle('focus.graph', ({ rootId }) => ({ nodes: neighbors(rootId) }));
  dpad.setFocusSource({ current: () => focusedNodeId() });
  framework.onFocusChange(() => dpad.focusChanged());
  dpad.onStop(installFrameworkIdleHooks(dpad.idle)); // returns a cleanup
  dpad.start();
  return dpad;
}
```

## Rules

- **Inert first.** Do nothing (no patches, no listeners) unless `dpad.active`. Register cleanups with `onStop`; they run when the session ends.
- **Domains follow handlers.** `tree` is announced when `tree.get` is registered, `focus` when `tree.get`, `focus.get` and `focus.graph` are. Register before `start()`. Without a reliable focus source, do not register focus handlers: wrong focus data is worse than none (dpad falls back to driver focus).
- **Nodes:** ids unique and stable per element (a `WeakMap` from element to id), own text only, collapse structural wrappers, at most one `focused`. Throw `RpcError(RpcErrorCode.NotFound)` for an unknown `rootId`.
- **Focus graph edges:** a node id, `null` (focus does not move), or absent (unknown). Never guess.
- **Idle hooks:** `dpad.idle.begin(kind, description, maxMs)` returns a release function; add probes with `dpad.idle.addProbe(() => busyResources)`. Use `setNativeTimeout` for the adapter's own scheduling so it never counts as app work.
- **Old engines:** build for ES2015, avoid `globalThis` (use `getGlobal()`), no heavy dependencies.
- **Prove it:** run the conformance suite with a fixture app (`@dpad-tv/protocol` docs, `conformance.md`).

Non-JS SDKs (Kotlin, Swift, BrightScript) implement the protocol spec directly and use the same conformance suite through `dpad-conformance`.
