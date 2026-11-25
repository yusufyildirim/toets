/**
 * In-memory driver for unit tests across all toets packages. Models a TV screen as a tree of
 * nodes with real focus movement (explicit neighbors, otherwise nearest node in the pressed
 * direction), key handlers and a press log. Not a platform: never ship it to users.
 */
import type { ProtocolNode } from '@toets/protocol';
import { PNG } from 'pngjs';
import type { PlatformEvent } from '../api.js';
import type { Capability } from '../capabilities.js';
import type { Driver, DriverLaunchOptions, DriverTextInput } from '../driver.js';
import { DIRECTION_KEY, type Direction, type Key, type PressOptions } from '../keys.js';
import type { Platform } from '../platform.js';
import type { SelectorChain } from '../selectors.js';
import { evaluateChain } from '../runtime/tree.js';
import type { ElementRef, ElementSnapshot, LogEntry, Rect, UINode, UITree } from '../snapshot.js';

export interface FakeNodeSpec {
  readonly id?: string;
  readonly testId?: string;
  readonly text?: string;
  readonly bounds?: Rect;
  readonly visible?: boolean;
  readonly focusable?: boolean;
  readonly enabled?: boolean;
  readonly selected?: boolean;
  readonly busy?: boolean;
  /** A system text field; its initial value is `value` (default `''`). */
  readonly editable?: boolean;
  readonly value?: string;
  /** A password field: value and text are masked. */
  readonly secure?: boolean;
  /**
   * Explicit focus neighbors by node id; `null` = focus does not move that way. Missing
   * directions fall back to geometry.
   */
  readonly neighbors?: Partial<Record<Direction, string | null>>;
  readonly children?: readonly FakeNodeSpec[];
}

export interface FakeScreen {
  readonly root: FakeNodeSpec;
  /** Node id focused initially. */
  readonly initialFocus?: string;
  readonly viewport?: { width: number; height: number };
}

export interface FakeDriverOptions {
  /** Platform reported by the driver. Default `web`. */
  readonly platform?: Platform;
}

interface FakeNode {
  id: string;
  spec: FakeNodeSpec;
  parent: FakeNode | null;
  children: FakeNode[];
}

const DIRECTION_OF: Partial<Record<Key, Direction>> = Object.fromEntries(
  Object.entries(DIRECTION_KEY).map(([d, k]) => [k, d as Direction]),
);

export class FakeDriver implements Driver {
  readonly platform: Platform;
  readonly capabilities: ReadonlySet<Capability>;
  /** Every key press, in order. */
  readonly presses: { key: Key; opts: PressOptions | undefined }[] = [];
  /** Every launch, in order. */
  readonly launches: DriverLaunchOptions[] = [];
  /** Every emitted platform event, in order. */
  readonly events: PlatformEvent[] = [];
  started = false;
  stopped = false;
  /** Handlers for non-directional keys; receive the focused node id. */
  readonly keyHandlers = new Map<Key, (focusedId: string | null, driver: FakeDriver) => void>();
  launched = false;
  /** System text entry; present when the driver declares `text.input`. */
  readonly text?: DriverTextInput;
  /** System text calls, in order: `replace:a@b`, `insert:x`, `delete:2`, `submit`, `close`. */
  readonly textCalls: string[] = [];
  /** Called on a system keyboard `submit()` with the focused node id. */
  onSubmit: ((focusedId: string | null) => void) | null = null;
  /** Values of editable nodes by node id. */
  readonly values = new Map<string, string>();

  private nodes = new Map<string, FakeNode>();
  private rootNode!: FakeNode;
  private focusedId: string | null = null;
  private logs: LogEntry[] = [];
  private viewport = { width: 1920, height: 1080 };
  private counter = 0;

  constructor(
    screen: FakeScreen,
    capabilities: Iterable<Capability> = [],
    opts: FakeDriverOptions = {},
  ) {
    this.platform = opts.platform ?? 'web';
    this.capabilities = new Set(capabilities);
    this.setScreen(screen);
    if (this.capabilities.has('text.input')) this.text = this.systemText();
  }

  /** Value of an editable node. */
  valueOf(id: string): string {
    return this.values.get(id) ?? '';
  }

  /** Web-like system text entry over the focused editable node. */
  private systemText(): DriverTextInput {
    const focusedField = () => {
      const n = this.focusedId ? this.nodes.get(this.focusedId) : undefined;
      return n?.spec.editable ? n.id : null;
    };
    const edit = (change: (value: string) => string) => {
      const id = focusedField();
      if (id) this.values.set(id, change(this.valueOf(id)));
    };
    return {
      isOpen: async () => focusedField() !== null,
      replace: async (_field, text) => {
        this.textCalls.push(`replace:${text}`);
        edit(() => text);
      },
      insert: async (text) => {
        this.textCalls.push(`insert:${text}`);
        edit((v) => v + text);
      },
      deleteBackward: async (count) => {
        this.textCalls.push(`delete:${count}`);
        edit((v) => [...v].slice(0, Math.max(0, [...v].length - count)).join(''));
      },
      submit: async () => {
        this.textCalls.push('submit');
        this.onSubmit?.(this.focusedId);
      },
      close: async () => {
        this.textCalls.push('close');
      },
    };
  }

  /** Replaces the whole screen (simulates navigation). */
  setScreen(screen: FakeScreen): void {
    this.nodes.clear();
    this.values.clear();
    this.rootNode = this.build(screen.root, null);
    this.focusedId = screen.initialFocus ?? null;
    if (screen.viewport) this.viewport = screen.viewport;
  }

  focus(id: string | null): void {
    this.focusedId = id;
  }

  log(level: LogEntry['level'], message: string): void {
    this.logs.push({ level, message, timestamp: Date.now(), source: 'app' });
  }

  async start(): Promise<void> {
    this.started = true;
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
  async launch(opts: DriverLaunchOptions): Promise<void> {
    this.launches.push(opts);
    this.launched = true;
  }
  async terminate(): Promise<void> {
    this.launched = false;
  }
  async reset(): Promise<void> {}

  /** Selectors are evaluated by the core over {@link tree}, like every real driver. */
  async query(chain: SelectorChain): Promise<readonly ElementSnapshot[]> {
    return evaluateChain(await this.tree(), chain);
  }

  async focused(): Promise<ElementSnapshot | null> {
    const n = this.focusedId ? this.nodes.get(this.focusedId) : undefined;
    return n ? this.snapshotOf(n) : null;
  }

  async tree(): Promise<UITree> {
    return { root: this.uiNode(this.rootNode), viewport: this.viewport };
  }

  async press(key: Key, opts?: PressOptions): Promise<void> {
    this.presses.push({ key, opts });
    const direction = DIRECTION_OF[key];
    if (direction) {
      const next = this.neighbor(direction);
      if (next) this.focusedId = next;
      return;
    }
    this.keyHandlers.get(key)?.(this.focusedId, this);
  }

  /**
   * A deterministic PNG of the viewport: black background, each visible node with bounds as a
   * gray box (lighter when deeper), the focused node white.
   */
  async screenshot(): Promise<Uint8Array> {
    const { width, height } = this.viewport;
    const png = new PNG({ width, height });
    png.data.fill(0);
    for (let i = 3; i < png.data.length; i += 4) png.data[i] = 0xff;
    const paint = (n: FakeNode, depth: number) => {
      if (!this.isVisible(n)) return;
      if (n.spec.bounds) {
        const shade = n.id === this.focusedId ? 0xff : Math.min(0x30 + depth * 0x20, 0xe0);
        const b = n.spec.bounds;
        for (let y = Math.max(0, b.y); y < Math.min(height, b.y + b.height); y++) {
          for (let x = Math.max(0, b.x); x < Math.min(width, b.x + b.width); x++) {
            const i = (y * width + x) * 4;
            png.data[i] = png.data[i + 1] = png.data[i + 2] = shade;
          }
        }
      }
      for (const c of n.children) paint(c, depth + 1);
    };
    paint(this.rootNode, 0);
    return new Uint8Array(PNG.sync.write(png));
  }

  async emit(event: PlatformEvent): Promise<void> {
    this.events.push(event);
  }

  /** The screen as an SDK would report it (`tree.get`): own text, no concatenation. */
  protocolTree(): ProtocolNode {
    const convert = (n: FakeNode): ProtocolNode => ({
      id: n.id,
      ...(n.spec.testId === undefined ? {} : { testId: n.spec.testId }),
      ...(n.spec.text === undefined ? {} : { text: n.spec.text }),
      bounds: this.protocolBounds(n),
      visible: n.spec.visible !== false,
      focusable: !!n.spec.focusable,
      focused: n.id === this.focusedId,
      enabled: n.spec.enabled !== false,
      selected: !!n.spec.selected,
      busy: !!n.spec.busy,
      ...(n.spec.editable
        ? { editable: true, value: this.shownValue(n), ...(n.spec.secure ? { secure: true } : {}) }
        : {}),
      children: n.children.map(convert),
    });
    return convert(this.rootNode);
  }

  /** Real SDKs always report bounds: use the union of the children's, else the viewport. */
  private protocolBounds(n: FakeNode): Rect {
    if (n.spec.bounds) return n.spec.bounds;
    if (n === this.rootNode) return { x: 0, y: 0, ...this.viewport };
    const rects = n.children.map((c) => this.protocolBounds(c));
    if (!rects.length) return { x: 0, y: 0, ...this.viewport };
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    const right = Math.max(...rects.map((r) => r.x + r.width));
    const bottom = Math.max(...rects.map((r) => r.y + r.height));
    return { x, y, width: right - x, height: bottom - y };
  }

  /** Viewport size in the screen's coordinate space. */
  get viewportSize(): { readonly width: number; readonly height: number } {
    return this.viewport;
  }

  async drainLogs(): Promise<readonly LogEntry[]> {
    const out = this.logs;
    this.logs = [];
    return out;
  }

  escapeHatch(): unknown {
    return this;
  }

  private build(spec: FakeNodeSpec, parent: FakeNode | null): FakeNode {
    const id = spec.id ?? spec.testId ?? `n${this.counter++}`;
    const node: FakeNode = { id, spec, parent, children: [] };
    this.nodes.set(id, node);
    if (spec.editable) this.values.set(id, spec.value ?? '');
    node.children = (spec.children ?? []).map((c) => this.build(c, node));
    return node;
  }

  private *descendants(n: FakeNode): Generator<FakeNode> {
    for (const c of n.children) {
      yield c;
      yield* this.descendants(c);
    }
  }

  /** An editable node's value as reported: masked when secure. */
  private shownValue(n: FakeNode): string {
    const value = this.valueOf(n.id);
    return n.spec.secure ? '\u2022'.repeat([...value].length) : value;
  }

  private textOf(n: FakeNode): string | null {
    if (n.spec.editable) return this.shownValue(n) || null;
    const parts = [n.spec.text, ...n.children.map((c) => this.textOf(c))].filter(
      (p): p is string => !!p,
    );
    return parts.length ? parts.join(' ').replace(/\s+/g, ' ').trim() : null;
  }

  private isVisible(n: FakeNode): boolean {
    for (let cur: FakeNode | null = n; cur; cur = cur.parent) {
      if (cur.spec.visible === false) return false;
    }
    return true;
  }

  private boundsOf(n: FakeNode): Rect {
    return n.spec.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
  }

  private snapshotOf(n: FakeNode): ElementSnapshot {
    const b = this.boundsOf(n);
    const focusWithin =
      this.focusedId !== null &&
      (n.id === this.focusedId || [...this.descendants(n)].some((d) => d.id === this.focusedId));
    const busy = !!n.spec.busy || [...this.descendants(n)].some((d) => !!d.spec.busy);
    const visible = this.isVisible(n) && (b.width > 0 || b.height > 0 || !n.spec.bounds);
    return {
      ref: n.id as ElementRef,
      testId: n.spec.testId ?? null,
      text: this.textOf(n),
      label: null,
      bounds: b,
      visible,
      inViewport:
        visible &&
        b.x < this.viewport.width &&
        b.y < this.viewport.height &&
        b.x + b.width > 0 &&
        b.y + b.height > 0,
      focusable: !!n.spec.focusable,
      focused: n.id === this.focusedId,
      focusWithin,
      enabled: n.spec.enabled !== false,
      selected: !!n.spec.selected,
      busy,
      editable: !!n.spec.editable,
      value: n.spec.editable ? this.shownValue(n) : null,
      secure: !!n.spec.editable && !!n.spec.secure,
    };
  }

  private uiNode(n: FakeNode): UINode {
    return { ...this.snapshotOf(n), children: n.children.map((c) => this.uiNode(c)) };
  }

  private neighbor(direction: Direction): string | null {
    const from = this.focusedId ? this.nodes.get(this.focusedId) : undefined;
    if (!from) return null;
    const explicit = from.spec.neighbors?.[direction];
    if (explicit !== undefined) return explicit;
    const a = this.boundsOf(from);
    const ax = a.x + a.width / 2;
    const ay = a.y + a.height / 2;
    let best: { id: string; score: number } | null = null;
    for (const n of this.nodes.values()) {
      if (n === from || !n.spec.focusable || !this.isVisible(n) || n.spec.enabled === false)
        continue;
      const b = this.boundsOf(n);
      const dx = b.x + b.width / 2 - ax;
      const dy = b.y + b.height / 2 - ay;
      const primary = { up: -dy, down: dy, left: -dx, right: dx }[direction];
      if (primary <= 0) continue;
      const secondary = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
      const score = primary + secondary * 2;
      if (!best || score < best.score) best = { id: n.id, score };
    }
    return best?.id ?? null;
  }
}
