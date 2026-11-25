import {
  RpcError,
  RpcErrorCode,
  type ProtocolNode,
  type Rect,
  type Viewport,
} from '@toets/protocol';
import type { ReportedFocus } from '../runtime.js';

export interface DomMapperOptions {
  /** Attribute holding test ids. Default `data-testid` (react-native-web renders `testID` there). */
  readonly testIdAttribute?: string;
  /** Root element of the tree. Default `document.body`. */
  readonly root?: () => Element | null;
  /** Overrides focusability; return `undefined` to keep the default. */
  readonly isFocusable?: (el: Element) => boolean | undefined;
}

/** The element a `reportFocus()` value stands for: an element or a ref object holding one. */
function reportedElement(target: unknown): Element | null {
  const value =
    typeof target === 'object' && target !== null && 'current' in target
      ? (target as { current: unknown }).current
      : target;
  if (typeof value !== 'object' || value === null) return null;
  const el = value as Element & { isConnected?: boolean };
  // A detached element holds no focus (`isConnected` is missing on old engines: assume attached).
  return el.nodeType === 1 && el.isConnected !== false ? el : null;
}

const SKIP = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE'];
const LEAF = [
  'SVG',
  'svg',
  'CANVAS',
  'IFRAME',
  'VIDEO',
  'AUDIO',
  'IMG',
  'INPUT',
  'TEXTAREA',
  'SELECT',
];
const NATIVE_FOCUSABLE = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'IFRAME', 'SUMMARY'];
const MAX_TEXT = 1000;

const IMPLICIT_ROLES: Record<string, string> = {
  BUTTON: 'button',
  TEXTAREA: 'textbox',
  SELECT: 'combobox',
  IMG: 'img',
  VIDEO: 'video',
  AUDIO: 'audio',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  UL: 'list',
  OL: 'list',
  LI: 'listitem',
  NAV: 'navigation',
  MAIN: 'main',
  DIALOG: 'dialog',
};

interface Inherited {
  /** An ancestor is `display: none` or `opacity: 0`. */
  readonly hidden: boolean;
}

/**
 * Maps the DOM to protocol nodes. Elements become nodes when they carry meaning for tests
 * (test id, focusable, own text, label or role, media, form controls); purely structural
 * wrappers are collapsed so trees stay small. Ids are stable per element.
 */
export class DomMapper {
  private readonly ids = new WeakMap<Element, string>();
  private nextId = 1;
  private readonly opts: DomMapperOptions;
  private readonly attr: string;
  private readonly reported: () => ReportedFocus | null;

  /**
   * @param reported Focus reported by the app (`reportFocus()`); while it returns `null`, focus
   * is `document.activeElement`.
   */
  constructor(opts: DomMapperOptions = {}, reported: () => ReportedFocus | null = () => null) {
    this.opts = opts;
    this.attr = opts.testIdAttribute ?? 'data-testid';
    this.reported = reported;
  }

  idOf(el: Element): string {
    let id = this.ids.get(el);
    if (id === undefined) {
      id = `e${this.nextId++}`;
      this.ids.set(el, id);
    }
    return id;
  }

  tree(rootId?: string): { root: ProtocolNode; viewport: Viewport } {
    const viewport = currentViewport();
    const focused = this.focusedElement();
    if (rootId !== undefined) {
      const el = this.elementById(rootId);
      if (!el) throw new RpcError(RpcErrorCode.NotFound, `No node with id "${rootId}"`);
      const node = this.build(
        el,
        { hidden: ancestorsHidden(el) },
        focused,
        true,
      )[0] as ProtocolNode;
      return { root: node, viewport };
    }
    const rootEl = this.rootElement();
    const children = rootEl ? this.children(rootEl, { hidden: false }, focused) : [];
    const root: ProtocolNode = {
      ...(rootEl ? this.describe(rootEl, false, focused) : blankNode()),
      id: rootEl ? this.idOf(rootEl) : 'root',
      bounds: { x: 0, y: 0, width: viewport.width, height: viewport.height },
      visible: true,
      children,
    };
    return { root, viewport };
  }

  focused(): ProtocolNode | null {
    const el = this.focusedElement();
    if (!el) return null;
    return this.build(el, { hidden: ancestorsHidden(el) }, el, true)[0] ?? null;
  }

  focusedId(): string | null {
    const el = this.focusedElement();
    return el ? this.idOf(el) : null;
  }

  elementById(id: string): Element | null {
    const root = this.rootElement();
    if (!root) return null;
    if (this.ids.get(root) === id) return root;
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i] as Element;
      if (this.ids.get(el) === id) return el;
    }
    return findInShadow(root, (el) => this.ids.get(el) === id);
  }

  /** The reported focus when the app reports it (`reportFocus()`), else `document.activeElement`. */
  focusedElement(): Element | null {
    const reported = this.reported();
    if (reported) return reportedElement(reported.target);
    if (typeof document === 'undefined') return null;
    let el: Element | null = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    return el;
  }

  private rootElement(): Element | null {
    if (this.opts.root) return safe(() => this.opts.root!(), null);
    return typeof document === 'undefined' ? null : document.body;
  }

  private build(
    el: Element,
    inherited: Inherited,
    focused: Element | null,
    force = false,
  ): ProtocolNode[] {
    if (SKIP.indexOf(el.tagName) >= 0) return [];
    const style = computedStyle(el);
    const hiddenHere = !!style && (style.display === 'none' || Number(style.opacity) === 0);
    const childInherited = { hidden: inherited.hidden || hiddenHere };
    const children =
      LEAF.indexOf(el.tagName) >= 0 ? [] : this.children(el, childInherited, focused);
    const node = this.describe(
      el,
      inherited.hidden || hiddenHere || isVisibilityHidden(style),
      focused,
    );
    if (force || this.isMeaningful(el, node, focused)) {
      return [{ ...node, id: this.idOf(el), children }];
    }
    return children;
  }

  private children(el: Element, inherited: Inherited, focused: Element | null): ProtocolNode[] {
    const out: ProtocolNode[] = [];
    const kids = childElements(el);
    for (let i = 0; i < kids.length; i++) {
      const nodes = this.build(kids[i] as Element, inherited, focused);
      for (let j = 0; j < nodes.length; j++) out.push(nodes[j] as ProtocolNode);
    }
    return out;
  }

  private isMeaningful(
    el: Element,
    node: Omit<ProtocolNode, 'id' | 'children'>,
    focused: Element | null,
  ): boolean {
    return (
      el === focused ||
      node.testId !== undefined ||
      node.focusable ||
      node.text !== undefined ||
      node.label !== undefined ||
      node.role !== undefined ||
      node.busy ||
      node.selected
    );
  }

  private describe(
    el: Element,
    hidden: boolean,
    focused: Element | null,
  ): Omit<ProtocolNode, 'id' | 'children'> {
    const bounds = rectOf(el);
    const enabled = !isDisabled(el);
    const custom = this.opts.isFocusable
      ? safe(() => this.opts.isFocusable!(el), undefined)
      : undefined;
    const focusable = custom !== undefined ? custom : enabled && defaultFocusable(el);
    const node: { -readonly [K in keyof ProtocolNode]?: ProtocolNode[K] } = {
      bounds,
      visible: !hidden && bounds.width > 0 && bounds.height > 0,
      focusable,
      focused: el === focused,
      enabled,
      selected: isSelected(el),
      busy: el.getAttribute('aria-busy') === 'true',
    };
    const testId = el.getAttribute(this.attr);
    if (testId) node.testId = testId;
    const text = ownText(el);
    if (text) node.text = text;
    const label = labelOf(el);
    if (label) node.label = label;
    const role = roleOf(el);
    if (role) node.role = role;
    return node as Omit<ProtocolNode, 'id' | 'children'>;
  }
}

function blankNode(): Omit<ProtocolNode, 'id' | 'children'> {
  return {
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    visible: true,
    focusable: false,
    focused: false,
    enabled: true,
    selected: false,
    busy: false,
  };
}

export function currentViewport(): Viewport {
  const w = typeof window === 'undefined' ? undefined : window;
  const width =
    (w && w.innerWidth) ||
    (typeof document !== 'undefined' && document.documentElement.clientWidth) ||
    1;
  const height =
    (w && w.innerHeight) ||
    (typeof document !== 'undefined' && document.documentElement.clientHeight) ||
    1;
  const pixelRatio = w && w.devicePixelRatio;
  return pixelRatio ? { width, height, pixelRatio } : { width, height };
}

function childElements(el: Element): ArrayLike<Element> {
  const shadow = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
  if (shadow) {
    const out: Element[] = [];
    const kids = shadow.children;
    for (let i = 0; i < kids.length; i++) out.push(kids[i] as Element);
    return out;
  }
  if (el.tagName === 'SLOT') {
    const assigned = (el as HTMLSlotElement).assignedElements
      ? (el as HTMLSlotElement).assignedElements()
      : [];
    if (assigned.length > 0) return assigned;
  }
  return el.children;
}

function findInShadow(root: Element, match: (el: Element) => boolean): Element | null {
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const shadow = (all[i] as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (!shadow) continue;
    const inner = shadow.querySelectorAll('*');
    for (let j = 0; j < inner.length; j++) {
      if (match(inner[j] as Element)) return inner[j] as Element;
    }
  }
  return null;
}

function computedStyle(el: Element): CSSStyleDeclaration | null {
  try {
    return typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  } catch {
    return null;
  }
}

function isVisibilityHidden(style: CSSStyleDeclaration | null): boolean {
  return !!style && (style.visibility === 'hidden' || style.visibility === 'collapse');
}

function ancestorsHidden(el: Element): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = computedStyle(p);
    if (s && (s.display === 'none' || Number(s.opacity) === 0)) return true;
  }
  return false;
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: finite(r.left), y: finite(r.top), width: finite(r.width), height: finite(r.height) };
}

function finite(n: number): number {
  return typeof n === 'number' && isFinite(n) ? n : 0;
}

function isDisabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled === true) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  try {
    return typeof el.matches === 'function' && el.matches(':disabled');
  } catch {
    return false;
  }
}

function defaultFocusable(el: Element): boolean {
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && tabindex !== '') return !isNaN(parseInt(tabindex, 10));
  const tag = el.tagName;
  if (tag === 'A' || tag === 'AREA') return el.hasAttribute('href');
  if (tag === 'INPUT') return (el as HTMLInputElement).type !== 'hidden';
  if (NATIVE_FOCUSABLE.indexOf(tag) >= 0) return true;
  if ((tag === 'VIDEO' || tag === 'AUDIO') && el.hasAttribute('controls')) return true;
  return (el as HTMLElement).isContentEditable === true;
}

function isSelected(el: Element): boolean {
  for (const a of ['aria-selected', 'aria-checked', 'aria-pressed']) {
    if (el.getAttribute(a) === 'true') return true;
  }
  if (el.tagName === 'INPUT') return (el as HTMLInputElement).checked === true;
  if (el.tagName === 'OPTION') return (el as HTMLOptionElement).selected === true;
  return false;
}

function ownText(el: Element): string | undefined {
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const input = el as HTMLInputElement;
    if (input.type === 'password' || input.type === 'hidden') return undefined;
    if (input.type === 'checkbox' || input.type === 'radio') return undefined;
    return normalize(input.value);
  }
  if (tag === 'SELECT') {
    const select = el as HTMLSelectElement;
    const option =
      select.options && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
    return option ? normalize(option.text) : undefined;
  }
  let text = '';
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as Node;
    if (n.nodeType === 3) text += n.nodeValue || '';
  }
  return normalize(text);
}

function labelOf(el: Element): string | undefined {
  const aria = el.getAttribute('aria-label');
  if (aria) return normalize(aria);
  const by = el.getAttribute('aria-labelledby');
  if (by && typeof document !== 'undefined') {
    const parts = by.split(/\s+/).map((id) => {
      const ref = document.getElementById(id);
      return ref ? ref.textContent || '' : '';
    });
    const joined = normalize(parts.join(' '));
    if (joined) return joined;
  }
  const alt = el.getAttribute('alt');
  if (alt) return normalize(alt);
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return normalize(placeholder);
  const title = el.getAttribute('title');
  return title ? normalize(title) : undefined;
}

function roleOf(el: Element): string | undefined {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.split(/\s+/)[0];
  const tag = el.tagName;
  if (tag === 'A') return el.hasAttribute('href') ? 'link' : undefined;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    if (type === 'hidden') return undefined;
    if (type === 'checkbox' || type === 'radio') return type;
    if (type === 'range') return 'slider';
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
    return 'textbox';
  }
  return IMPLICIT_ROLES[tag];
}

function normalize(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}...` : t;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Short CSS-like description of an element for busy reports, e.g. `div[data-testid="hero"]`. */
export function describeElement(
  el: Element | null | undefined,
  testIdAttribute = 'data-testid',
): string {
  if (!el || !el.tagName) return 'unknown element';
  const tag = el.tagName.toLowerCase();
  const testId = el.getAttribute(testIdAttribute);
  if (testId) return `${tag}[${testIdAttribute}="${testId}"]`;
  if (el.id) return `${tag}#${el.id}`;
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
  return cls ? `${tag}.${cls}` : tag;
}
