import {
  RpcError,
  RpcErrorCode,
  type FocusGraphNode,
  type ProtocolNode,
  type Rect,
  type Viewport,
} from '@dpad-tv/protocol';
import { clearNativeTimeout, getGlobal, setNativeTimeout } from '@dpad-tv/sdk';
import { sameTarget, type FocusTarget } from './focus.js';

/**
 * The subset of a React fiber the mapper reads. Fiber tags and fields have been stable
 * across React 16-19; they are the same data React DevTools reads.
 */
export interface Fiber {
  readonly tag: number;
  readonly type: unknown;
  readonly memoizedProps: unknown;
  readonly memoizedState: unknown;
  readonly stateNode: unknown;
  readonly child: Fiber | null;
  readonly sibling: Fiber | null;
  readonly return: Fiber | null;
}

/** Props of a host view (`RCTView`, `RCTText`, ...) as React passes them to native. */
export type HostProps = Readonly<Record<string, unknown>>;

export interface FiberMapperOptions {
  /** Current `HostRoot` fibers of the mounted app roots. */
  roots(): readonly Fiber[];
  /** The focused host view, if known. */
  focused(): FocusTarget | null;
  viewport(): Viewport;
  /** `StyleSheet.flatten`. */
  flattenStyle(style: unknown): unknown;
  /** Prop holding test ids. Default `testID`. */
  readonly testIdProp?: string | undefined;
  /** Overrides focusability; return `undefined` to keep the default. */
  readonly isFocusable?: ((props: HostProps, type: string) => boolean | undefined) | undefined;
  /**
   * Components whose host view is a focus guide (react-native-tvos `TVFocusGuideView`). A guide
   * redirects focus to its children and is never focused itself, although its view carries
   * `isTVSelectable`.
   */
  readonly focusGuides?: readonly unknown[] | undefined;
  /** Upper bound for asynchronous measurement (old architecture). Default 500. */
  readonly measureTimeoutMs?: number | undefined;
}

type NodeInfo = Omit<ProtocolNode, 'id' | 'children' | 'bounds' | 'visible'>;

interface Draft {
  readonly id: string;
  readonly fiber: Fiber;
  readonly info: NodeInfo;
  readonly hidden: boolean;
  readonly children: Draft[];
}

/** Id of the synthetic node that holds every mounted app root. */
export const ROOT_ID = 'root';

const HOST_ROOT = 3;
const HOST_COMPONENT = 5;
const HOST_TEXT = 6;
const OFFSCREEN = 22;
const HOST_HOISTABLE = 26;
const HOST_SINGLETON = 27;

const TEXT_TYPES = ['RCTText', 'RCTVirtualText', 'RCTParagraph'];
const INPUT_TYPES = [
  'AndroidTextInput',
  'RCTSinglelineTextInputView',
  'RCTMultilineTextInputView',
  'RCTTextInput',
];
const MAX_TEXT = 1000;
const ZERO: Rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Maps the React Native host tree (read from React's committed fibers) to protocol nodes.
 * Host views become nodes when they carry meaning for tests (test id, focusable, text,
 * label, role, state); structural wrappers are collapsed. Ids are stable per native view.
 */
export class FiberMapper {
  private readonly ids = new WeakMap<object, string>();
  private nextId = 1;
  private readonly opts: FiberMapperOptions;
  private readonly testIdProp: string;

  constructor(opts: FiberMapperOptions) {
    this.opts = opts;
    this.testIdProp = opts.testIdProp ?? 'testID';
  }

  async tree(rootId?: string): Promise<{ root: ProtocolNode; viewport: Viewport }> {
    const viewport = this.opts.viewport();
    const draft = this.draft(rootId);
    if (draft) return { root: await this.finish(draft), viewport };
    const children = await Promise.all(this.rootDrafts().map((d) => this.finish(d)));
    return { root: this.syntheticRoot(viewport, children), viewport };
  }

  async focused(): Promise<ProtocolNode | null> {
    const target = this.opts.focused();
    const fiber = target === null ? null : this.find((f) => matches(f, target));
    if (!fiber) return null;
    const draft = this.build(fiber, ancestorsHidden(fiber, this.opts), target, true)[0];
    return draft ? this.finish(draft) : null;
  }

  focusedId(): string | null {
    const target = this.opts.focused();
    const fiber = target === null ? null : this.find((f) => matches(f, target));
    return fiber ? this.idOf(fiber) : null;
  }

  /**
   * Focusable nodes with their declared neighbors (`nextFocusUp/Down/Left/Right`). A
   * neighbor pointing at the node itself means focus does not move; no prop = unknown.
   */
  async graph(rootId?: string): Promise<FocusGraphNode[]> {
    const draft = this.draft(rootId);
    const drafts = draft ? [draft] : this.rootDrafts();
    const focusable: Draft[] = [];
    const visit = (d: Draft): void => {
      if (d.info.focusable) focusable.push(d);
      d.children.forEach(visit);
    };
    drafts.forEach(visit);
    const byTag: Record<string, string> = {};
    const reported: Record<string, true> = {};
    for (const d of focusable) reported[d.id] = true;
    this.walkHosts((f) => {
      const tag = nativeTagOf(f);
      if (tag !== undefined) byTag[String(tag)] = this.idOf(f);
    });
    return focusable.map((d) => {
      const props = hostProps(d.fiber);
      const own = nativeTagOf(d.fiber);
      const node: { -readonly [K in keyof FocusGraphNode]: FocusGraphNode[K] } = { id: d.id };
      for (const dir of ['up', 'down', 'left', 'right'] as const) {
        const tag = props[`nextFocus${dir.charAt(0).toUpperCase()}${dir.slice(1)}`];
        if (typeof tag !== 'number') continue;
        if (tag === own) node[dir] = null;
        else {
          const target = byTag[String(tag)];
          if (target !== undefined && reported[target]) node[dir] = target;
        }
      }
      return node;
    });
  }

  private draft(rootId: string | undefined): Draft | null {
    if (rootId === undefined || rootId === ROOT_ID) return null;
    const fiber = this.find((f) => this.ids.get(identity(f) as object) === rootId);
    if (!fiber) throw new RpcError(RpcErrorCode.NotFound, `No node with id "${rootId}"`);
    return this.build(fiber, ancestorsHidden(fiber, this.opts), this.opts.focused(), true)[0]!;
  }

  private rootDrafts(): Draft[] {
    const focused = this.opts.focused();
    const out: Draft[] = [];
    for (const root of this.opts.roots()) this.collect(root.child, false, focused, out);
    return out;
  }

  private syntheticRoot(viewport: Viewport, children: ProtocolNode[]): ProtocolNode {
    return {
      id: ROOT_ID,
      bounds: { x: 0, y: 0, width: viewport.width, height: viewport.height },
      visible: true,
      focusable: false,
      focused: false,
      enabled: true,
      selected: false,
      busy: false,
      children,
    };
  }

  private idOf(fiber: Fiber): string {
    const key = identity(fiber);
    if (!key) return `f${this.nextId++}`;
    let id = this.ids.get(key);
    if (id === undefined) {
      id = `n${this.nextId++}`;
      this.ids.set(key, id);
    }
    return id;
  }

  private find(match: (fiber: Fiber) => boolean): Fiber | null {
    let found: Fiber | null = null;
    this.walkHosts((f) => {
      if (match(f)) {
        found = f;
        return true;
      }
      return false;
    });
    return found;
  }

  /** Visits every rendered host view; stops when `visit` returns true. */
  private walkHosts(visit: (fiber: Fiber) => boolean | void): void {
    const walk = (fiber: Fiber | null): boolean => {
      for (let f = fiber; f; f = f.sibling) {
        if (isHiddenOffscreen(f)) continue;
        if (isHost(f) && visit(f) === true) return true;
        if (walk(f.child)) return true;
      }
      return false;
    };
    for (const root of this.opts.roots()) if (walk(root.child)) return;
  }

  private collect(
    fiber: Fiber | null,
    hidden: boolean,
    focused: FocusTarget | null,
    out: Draft[],
  ): void {
    for (let f = fiber; f; f = f.sibling) {
      if (isHiddenOffscreen(f) || f.tag === HOST_TEXT) continue;
      if (isHost(f)) {
        const drafts = this.build(f, hidden, focused, false);
        for (const d of drafts) out.push(d);
      } else {
        this.collect(f.child, hidden, focused, out);
      }
    }
  }

  private build(
    fiber: Fiber,
    inheritedHidden: boolean,
    focused: FocusTarget | null,
    force: boolean,
  ): Draft[] {
    const props = hostProps(fiber);
    const type = String(fiber.type);
    const hidden = inheritedHidden || styleHidden(props.style, this.opts);
    const isText = TEXT_TYPES.indexOf(type) >= 0;
    const children: Draft[] = [];
    if (!isText) this.collect(fiber.child, hidden, focused, children);
    const info = this.describe(fiber, props, type, isText, focused);
    if (force || isMeaningful(info)) {
      return [{ id: this.idOf(fiber), fiber, info, hidden, children }];
    }
    return children;
  }

  /** Whether a component between `fiber` and the next host view up is a focus guide. */
  private isFocusGuide(fiber: Fiber): boolean {
    const guides = this.opts.focusGuides;
    if (!guides?.length) return false;
    for (let p = fiber.return; p && !isHost(p) && p.tag !== HOST_ROOT; p = p.return) {
      if (guides.includes(componentOf(p.type))) return true;
    }
    return false;
  }

  private describe(
    fiber: Fiber,
    props: HostProps,
    type: string,
    isText: boolean,
    focused: FocusTarget | null,
  ): NodeInfo {
    const isInput = INPUT_TYPES.indexOf(type) >= 0 || props.mostRecentEventCount !== undefined;
    const state = (
      typeof props.accessibilityState === 'object' && props.accessibilityState !== null
        ? props.accessibilityState
        : {}
    ) as Record<string, unknown>;
    const enabled = !(
      props['aria-disabled'] === true ||
      state.disabled === true ||
      (isInput && props.editable === false)
    );
    const custom = this.opts.isFocusable
      ? safe(() => this.opts.isFocusable!(props, type))
      : undefined;
    const focusable =
      custom !== undefined
        ? custom
        : isInput
          ? enabled
          : (props.focusable === true || props.isTVSelectable === true) &&
            !this.isFocusGuide(fiber);
    const info: { -readonly [K in keyof NodeInfo]?: NodeInfo[K] } = {
      focusable,
      focused: focused !== null && matches(fiber, focused),
      enabled,
      selected:
        props['aria-selected'] === true ||
        props['aria-checked'] === true ||
        state.selected === true ||
        state.checked === true,
      busy: props['aria-busy'] === true || state.busy === true,
    };
    const testId = props[this.testIdProp];
    if (typeof testId === 'string' && testId) info.testId = testId;
    const text = isText
      ? normalize(textOf(fiber.child))
      : isInput && props.secureTextEntry !== true
        ? normalize(firstString(props.text, props.value, props.defaultValue))
        : undefined;
    if (text) info.text = text;
    const label = firstString(
      props['aria-label'],
      props.accessibilityLabel,
      isInput ? props.placeholder : undefined,
    );
    if (label) info.label = label;
    const role = firstString(props.role, props.accessibilityRole);
    if (role && role !== 'none') info.role = role;
    return info as NodeInfo;
  }

  private async finish(draft: Draft): Promise<ProtocolNode> {
    const measured = this.measure(draft.fiber);
    const children = Promise.all(draft.children.map((d) => this.finish(d)));
    const bounds = await measured;
    return {
      id: draft.id,
      ...draft.info,
      bounds,
      visible: !draft.hidden && bounds.width > 0 && bounds.height > 0,
      children: await children,
    };
  }

  /**
   * Window-relative bounds: synchronous `getBoundingClientRect` (new architecture) when
   * available, otherwise `measureInWindow` with a timeout.
   */
  private measure(fiber: Fiber): Rect | Promise<Rect> {
    const node = fiber.stateNode as Record<string, unknown> | null;
    if (!node) return ZERO;
    const canonical = node.canonical as Record<string, unknown> | undefined;
    const instance = (canonical ? canonical.publicInstance : node) as Record<
      string,
      unknown
    > | null;
    try {
      if (instance && typeof instance.getBoundingClientRect === 'function') {
        const r = (instance.getBoundingClientRect as () => Record<string, number>)();
        return toRect(r.x ?? r.left, r.y ?? r.top, r.width, r.height);
      }
      const fabric = getGlobal().nativeFabricUIManager as Record<string, unknown> | undefined;
      if (canonical && node.node && fabric && typeof fabric.getBoundingClientRect === 'function') {
        const r = (fabric.getBoundingClientRect as (n: unknown, t: boolean) => unknown)(
          node.node,
          true,
        );
        if (Array.isArray(r) && r.length >= 4) return toRect(r[0], r[1], r[2], r[3]);
      }
    } catch {
      return ZERO;
    }
    if (instance && typeof instance.measureInWindow === 'function') {
      const measureInWindow = instance.measureInWindow as (
        cb: (x: number, y: number, w: number, h: number) => void,
      ) => void;
      return new Promise<Rect>((resolve) => {
        const timer = setNativeTimeout(() => resolve(ZERO), this.opts.measureTimeoutMs ?? 500);
        try {
          measureInWindow.call(instance, (x, y, w, h) => {
            clearNativeTimeout(timer);
            resolve(toRect(x, y, w, h));
          });
        } catch {
          clearNativeTimeout(timer);
          resolve(ZERO);
        }
      });
    }
    return ZERO;
  }
}

/** The current `HostRoot` fiber of the tree a mounted class component belongs to. */
export function hostRootOf(instance: object): Fiber | null {
  let fiber = (instance as { _reactInternals?: Fiber })._reactInternals ?? null;
  while (fiber && fiber.tag !== HOST_ROOT) fiber = fiber.return;
  if (!fiber) return null;
  const fiberRoot = fiber.stateNode as { current?: Fiber } | null;
  return (fiberRoot && fiberRoot.current) || null;
}

/** The function behind a fiber's type, unwrapping `memo` and `forwardRef`. */
function componentOf(type: unknown): unknown {
  let t = type;
  while (t !== null && typeof t === 'object') {
    const wrapper = t as { readonly type?: unknown; readonly render?: unknown };
    const inner = wrapper.type ?? wrapper.render;
    if (inner === undefined) break;
    t = inner;
  }
  return t;
}

function isHost(f: Fiber): boolean {
  return f.tag === HOST_COMPONENT || f.tag === HOST_HOISTABLE || f.tag === HOST_SINGLETON;
}

function isHiddenOffscreen(f: Fiber): boolean {
  return f.tag === OFFSCREEN && f.memoizedState !== null && f.memoizedState !== undefined;
}

function hostProps(f: Fiber): HostProps {
  const p = f.memoizedProps;
  return (typeof p === 'object' && p !== null ? p : {}) as HostProps;
}

/** Survives re-renders: Fabric keeps `canonical` across clones, Paper keeps the instance. */
function identity(f: Fiber): object | null {
  const node = f.stateNode as { canonical?: object } | null;
  if (!node || typeof node !== 'object') return null;
  return node.canonical ?? node;
}

function nativeTagOf(f: Fiber): number | undefined {
  const node = f.stateNode as Record<string, unknown> | null;
  if (!node) return undefined;
  const canonical = node.canonical as Record<string, unknown> | undefined;
  const tag = canonical ? canonical.nativeTag : (node._nativeTag ?? node.__nativeTag);
  return typeof tag === 'number' ? tag : undefined;
}

function matches(f: Fiber, target: FocusTarget): boolean {
  const node = f.stateNode as Record<string, unknown> | null;
  if (!node) return false;
  const canonical = node.canonical as Record<string, unknown> | undefined;
  const instance = canonical ? canonical.publicInstance : node;
  if (instance && instance === target) return true;
  const tag = nativeTagOf(f);
  return tag !== undefined && sameTarget(tag, target);
}

function styleHidden(style: unknown, opts: FiberMapperOptions): boolean {
  if (!style) return false;
  const flat = safe(() => opts.flattenStyle(style)) as Record<string, unknown> | undefined;
  if (!flat || typeof flat !== 'object') return false;
  return flat.display === 'none' || Number(flat.opacity) === 0;
}

function ancestorsHidden(fiber: Fiber, opts: FiberMapperOptions): boolean {
  for (let p = fiber.return; p; p = p.return) {
    if (isHiddenOffscreen(p)) return true;
    if (isHost(p) && styleHidden(hostProps(p).style, opts)) return true;
  }
  return false;
}

function isMeaningful(info: NodeInfo): boolean {
  return (
    info.focused ||
    info.testId !== undefined ||
    info.focusable ||
    info.text !== undefined ||
    info.label !== undefined ||
    info.role !== undefined ||
    info.busy ||
    info.selected
  );
}

function textOf(fiber: Fiber | null): string {
  let out = '';
  for (let f = fiber; f; f = f.sibling) {
    if (isHiddenOffscreen(f)) continue;
    if (f.tag === HOST_TEXT) {
      const t = f.memoizedProps;
      if (typeof t === 'string' || typeof t === 'number') out += String(t);
    } else {
      out += textOf(f.child);
    }
  }
  return out;
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

function normalize(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) : t;
}

function toRect(x: unknown, y: unknown, width: unknown, height: unknown): Rect {
  return { x: finite(x), y: finite(y), width: finite(width), height: finite(height) };
}

function finite(n: unknown): number {
  return typeof n === 'number' && isFinite(n) ? n : 0;
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
