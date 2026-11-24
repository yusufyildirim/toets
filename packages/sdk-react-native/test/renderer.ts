/**
 * A tiny React renderer whose host instances look like React Native Fabric's
 * (`{ node, canonical: { nativeTag, publicInstance } }`), so the adapter walks real React
 * fibers in tests. Layout comes from `style.left/top/width/height` (relative to the parent).
 */
import { createContext, type ReactNode } from 'react';
import Reconciler from 'react-reconciler';
import { DefaultEventPriority, LegacyRoot } from 'react-reconciler/constants.js';

export interface FakeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What refs and `event.target` point at (React Native's `ReactNativeElement`). */
export class FakeElement {
  readonly __nativeTag: number;
  constructor(readonly instance: FakeInstance) {
    this.__nativeTag = instance.tag;
  }
  getBoundingClientRect(): FakeRect {
    return rectOf(this.instance);
  }
}

export interface FakeInstance {
  readonly type: string;
  props: Record<string, unknown>;
  readonly children: Array<FakeInstance | FakeText>;
  parent: FakeInstance | null;
  readonly tag: number;
  /** Fabric only. */
  readonly node?: { readonly instance: FakeInstance };
  /** Fabric only. */
  readonly canonical?: { nativeTag: number; publicInstance: FakeElement | null };
}

/** An old-architecture host instance: the fiber points at it directly, async measurement. */
export class PaperElement implements FakeInstance {
  readonly children: Array<FakeInstance | FakeText> = [];
  parent: FakeInstance | null = null;
  readonly _nativeTag: number;
  constructor(
    readonly type: string,
    public props: Record<string, unknown>,
    readonly tag: number,
  ) {
    this._nativeTag = tag;
  }
  measureInWindow(cb: (x: number, y: number, w: number, h: number) => void): void {
    const r = rectOf(this);
    setTimeout(() => cb(r.x, r.y, r.width, r.height), 1);
  }
}

export interface FakeText {
  text: string;
  parent: FakeInstance | null;
}

/**
 * - `fabric`: public instances exist (as when refs or events touched them).
 * - `fabric-lazy`: public instances are created on demand; measurement goes through
 *   `nativeFabricUIManager.getBoundingClientRect(node)`.
 * - `paper`: old architecture.
 */
export type InstanceMode = 'fabric' | 'fabric-lazy' | 'paper';

let nextTag = 1;
let mode: InstanceMode = 'fabric';

export function setInstanceMode(m: InstanceMode): void {
  mode = m;
}

export function rectOf(instance: FakeInstance): FakeRect {
  const style = flatten(instance.props.style);
  const parent = instance.parent ? rectOf(instance.parent) : { x: 0, y: 0 };
  return {
    x: parent.x + num(style.left),
    y: parent.y + num(style.top),
    width: num(style.width),
    height: num(style.height),
  };
}

function flatten(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return style as Record<string, unknown>;
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

/** The public instance React hands to refs and events (created on demand). */
export function publicInstanceOf(instance: FakeInstance): object {
  const canonical = instance.canonical;
  if (!canonical) return instance;
  if (!canonical.publicInstance) canonical.publicInstance = new FakeElement(instance);
  return canonical.publicInstance;
}

function createInstance(type: string, props: Record<string, unknown>): FakeInstance {
  const tag = nextTag++;
  if (mode === 'paper') return new PaperElement(type, props, tag);
  const instance = {
    type,
    props,
    children: [],
    parent: null,
    tag,
    canonical: { nativeTag: tag, publicInstance: null },
  } as { -readonly [K in keyof FakeInstance]: FakeInstance[K] };
  instance.node = { instance };
  if (mode === 'fabric') instance.canonical!.publicInstance = new FakeElement(instance);
  return instance;
}

interface Container {
  children: FakeInstance[];
}

function detach(list: Array<FakeInstance | FakeText>, child: FakeInstance | FakeText): void {
  const i = list.indexOf(child);
  if (i >= 0) list.splice(i, 1);
}

let currentPriority = 0;

const hostConfig = {
  rendererPackageName: 'toets-fake-fabric',
  rendererVersion: '0.0.0',
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,
  isPrimaryRenderer: false,
  warnsIfNotActing: false,
  noTimeout: -1,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  NotPendingTransition: null,
  HostTransitionContext: createContext(null),
  createInstance: (type: string, props: Record<string, unknown>) => createInstance(type, props),
  createTextInstance: (text: string): FakeText => ({ text, parent: null }),
  appendInitialChild(parent: FakeInstance, child: FakeInstance | FakeText) {
    child.parent = parent;
    parent.children.push(child);
  },
  appendChild(parent: FakeInstance, child: FakeInstance | FakeText) {
    detach(parent.children, child);
    child.parent = parent;
    parent.children.push(child);
  },
  appendChildToContainer(container: Container, child: FakeInstance) {
    detach(container.children, child);
    child.parent = null;
    container.children.push(child);
  },
  insertBefore(parent: FakeInstance, child: FakeInstance, before: FakeInstance) {
    detach(parent.children, child);
    child.parent = parent;
    parent.children.splice(parent.children.indexOf(before), 0, child);
  },
  insertInContainerBefore(container: Container, child: FakeInstance, before: FakeInstance) {
    detach(container.children, child);
    container.children.splice(container.children.indexOf(before), 0, child);
  },
  removeChild(parent: FakeInstance, child: FakeInstance | FakeText) {
    detach(parent.children, child);
    child.parent = null;
  },
  removeChildFromContainer(container: Container, child: FakeInstance) {
    detach(container.children, child);
  },
  clearContainer(container: Container) {
    container.children.length = 0;
  },
  commitUpdate(
    instance: FakeInstance,
    _type: string,
    _old: Record<string, unknown>,
    next: Record<string, unknown>,
  ) {
    instance.props = next;
  },
  commitTextUpdate(text: FakeText, _old: string, next: string) {
    text.text = next;
  },
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  getRootHostContext: () => ({}),
  getChildHostContext: (parent: object) => parent,
  getPublicInstance: (instance: FakeInstance) => publicInstanceOf(instance),
  prepareForCommit: () => null,
  resetAfterCommit() {},
  preparePortalMount() {},
  resetTextContent() {},
  hideInstance() {},
  unhideInstance() {},
  hideTextInstance() {},
  unhideTextInstance() {},
  detachDeletedInstance() {},
  getInstanceFromNode: () => null,
  getInstanceFromScope: () => null,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  prepareScopeUpdate() {},
  getCurrentUpdatePriority: () => currentPriority,
  setCurrentUpdatePriority(p: number) {
    currentPriority = p;
  },
  resolveUpdatePriority: () => currentPriority || DefaultEventPriority,
  maySuspendCommit: () => false,
  maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false,
  preloadInstance: () => true,
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady: () => null,
  getSuspendedCommitReason: () => null,
  resetFormInstance() {},
  requestPostPaintCallback() {},
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent() {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
};

const reconciler = Reconciler(hostConfig as never);

export interface Rendered {
  readonly container: Container;
  update(element: ReactNode): void;
  unmount(): void;
  /** Host instance with `testID`. Throws when missing. */
  byTestId(testId: string): FakeInstance;
}

/** Renders synchronously into a new root. */
export function render(element: ReactNode): Rendered {
  const container: Container = { children: [] };
  const noop = (): void => {};
  const root = (reconciler.createContainer as unknown as (...args: unknown[]) => unknown)(
    container,
    LegacyRoot,
    null,
    false,
    null,
    '',
    noop,
    noop,
    noop,
    noop,
    null,
  );
  const run = (el: ReactNode): void => {
    reconciler.updateContainerSync(el as never, root as never, null, null);
    reconciler.flushSyncWork();
  };
  run(element);
  return {
    container,
    update: run,
    unmount: () => run(null),
    byTestId(testId) {
      const found = find(container.children, (i) => i.props.testID === testId);
      if (!found) throw new Error(`no host instance with testID ${testId}`);
      return found;
    },
  };
}

function find(
  list: ReadonlyArray<FakeInstance | FakeText>,
  match: (i: FakeInstance) => boolean,
): FakeInstance | null {
  for (const node of list) {
    if (!('props' in node)) continue;
    if (match(node)) return node;
    const inner = find(node.children, match);
    if (inner) return inner;
  }
  return null;
}

/**
 * Dispatches a native focus or blur event the way React Native does: capture listeners
 * (`onFocusCapture`) from the root down to the target, with `event.target` set to the
 * target's public instance.
 */
export function fire(kind: 'focus' | 'blur', target: FakeInstance): void {
  const path: FakeInstance[] = [];
  for (let n: FakeInstance | null = target; n; n = n.parent) path.unshift(n);
  const prop = kind === 'focus' ? 'onFocusCapture' : 'onBlurCapture';
  const event = {
    target: publicInstanceOf(target),
    nativeEvent: { target: target.tag },
  };
  reconciler.batchedUpdates(() => {
    for (const n of path) {
      const handler = n.props[prop];
      if (typeof handler === 'function') handler(event);
    }
  }, null);
}
