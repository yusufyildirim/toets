# Writing an adapter

An adapter connects a UI framework to the runtime. The runtime owns the protocol, the connection, idle tracking, logs, state and media; the adapter answers what only the framework knows: the tree and focus.

```ts nocheck
import { createToets } from '@toets/sdk';

export function startToets(options = {}) {
  const toets = createToets({ payload: discoverPayload(), framework: 'my-framework', ...options });
  if (!toets.active) return toets; // inert: install nothing

  toets.handle('tree.get', ({ rootId }) => ({ root: mapTree(rootId), viewport: viewport() }));
  toets.handle('focus.get', () => ({ node: mapFocused() }));
  toets.handle('focus.graph', ({ rootId }) => ({ nodes: neighbors(rootId) }));
  toets.setFocusSource({ current: () => focusedNodeId() });
  framework.onFocusChange(() => toets.focusChanged());
  toets.onStop(installFrameworkIdleHooks(toets.idle)); // returns a cleanup
  toets.start();
  return toets;
}
```

## Rules

- **Inert first.** Do nothing (no patches, no listeners) unless `toets.active`. Register cleanups with `onStop`; they run when the session ends.
- **Domains follow handlers.** `tree` is announced when `tree.get` is registered, `focus` when `tree.get`, `focus.get` and `focus.graph` are. Register before `start()`. Without a reliable focus source, do not register focus handlers: wrong focus data is worse than none (toets falls back to driver focus).
- **Nodes:** ids unique and stable per element (a `WeakMap` from element to id), own text only, collapse structural wrappers, at most one `focused`. Throw `RpcError(RpcErrorCode.NotFound)` for an unknown `rootId`.
- **Focus graph edges:** a node id, `null` (focus does not move), or absent (unknown). Never guess.
- **Idle hooks:** `toets.idle.begin(kind, description, maxMs)` returns a release function; add probes with `toets.idle.addProbe(() => busyResources)`. Use `setNativeTimeout` for the adapter's own scheduling so it never counts as app work.
- **Old engines:** build for ES2015, avoid `globalThis` (use `getGlobal()`), no heavy dependencies.
- **Prove it:** run the conformance suite with a fixture app (`@toets/protocol` docs, `conformance.md`).

Non-JS SDKs (Kotlin, Swift, BrightScript) implement the protocol spec directly and use the same conformance suite through `toets-conformance`.
