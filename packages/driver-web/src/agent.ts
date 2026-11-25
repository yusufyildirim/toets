/**
 * The in-page agent. `pageAgent` is serialized and evaluated in the page by Playwright, once per
 * driver call, so it must stay self-contained: no imports, no references to outer scope (type
 * imports are fine, they are erased).
 *
 * One evaluation walks the DOM once (flat tree: open shadow roots and slots are followed) and
 * computes snapshots only for the elements the call returns.
 */
import type { Rect } from '@toets/core';

export interface AgentConfig {
  readonly testIdAttribute: string;
}

/** Selector steps, pre-normalized on the Node side (text values whitespace-collapsed). */
export type AgentSelector =
  | { readonly kind: 'testId'; readonly value: string }
  /** `value` is lowercased when `exact` is false. */
  | { readonly kind: 'text'; readonly value: string; readonly exact: boolean }
  | { readonly kind: 'regex'; readonly source: string; readonly flags: string }
  | { readonly kind: 'focused' }
  | { readonly kind: 'nth'; readonly index: number };

export type AgentRequest =
  | { readonly op: 'query'; readonly config: AgentConfig; readonly chain: readonly AgentSelector[] }
  | { readonly op: 'focused'; readonly config: AgentConfig }
  | { readonly op: 'tree'; readonly config: AgentConfig }
  | { readonly op: 'bounds'; readonly ref: string };

export interface AgentSnapshot {
  readonly ref: string;
  readonly testId: string | null;
  readonly text: string | null;
  readonly label: string | null;
  readonly bounds: Rect;
  readonly visible: boolean;
  readonly inViewport: boolean;
  readonly focusable: boolean;
  readonly focused: boolean;
  readonly focusWithin: boolean;
  readonly enabled: boolean;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly editable: boolean;
  readonly value: string | null;
  readonly secure: boolean;
}

export interface AgentNode extends AgentSnapshot {
  readonly children: readonly AgentNode[];
}

export interface AgentTree {
  readonly root: AgentNode | null;
  readonly viewport: { readonly width: number; readonly height: number };
}

/** Response type per request op. */
export interface AgentResponses {
  readonly query: readonly AgentSnapshot[];
  readonly focused: AgentSnapshot | null;
  readonly tree: AgentTree;
  readonly bounds: {
    readonly bounds: Rect;
    readonly viewport: { readonly width: number; readonly height: number };
  } | null;
}

/**
 * Answers one request. Returns the response (`AgentResponses[op]`) as a JSON string: Playwright's
 * structured serialization of a large tree is ~10x slower than `JSON.stringify` + `JSON.parse`.
 */
export function pageAgent(req: AgentRequest): string {
  // --- Element refs: stable per element, unique across documents (nonce), weakly held. ---
  interface RefState {
    readonly nonce: string;
    next: number;
    readonly byEl: WeakMap<Element, string>;
    readonly byRef: Map<string, WeakRef<Element>>;
    pruneAt: number;
  }
  const STATE_KEY = Symbol.for('toets.driver-web.refs');
  const holder = window as unknown as Record<symbol, RefState | undefined>;
  let state = holder[STATE_KEY];
  if (state === undefined) {
    state = {
      nonce: Math.random().toString(36).slice(2, 10),
      next: 1,
      byEl: new WeakMap(),
      byRef: new Map(),
      pruneAt: 1000,
    };
    Object.defineProperty(window, STATE_KEY, { value: state, configurable: true });
  }
  const refs = state;

  const plainRect = (r: DOMRect): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });

  if (req.op === 'bounds') {
    const el = refs.byRef.get(req.ref)?.deref();
    const found: AgentResponses['bounds'] =
      el === undefined || !el.isConnected
        ? null
        : {
            bounds: plainRect(el.getBoundingClientRect()),
            viewport: { width: window.innerWidth, height: window.innerHeight },
          };
    return JSON.stringify(found);
  }

  const cfg = req.config;

  // --- Flat-tree preorder walk. Descendants of i are the indices in (i, end[i]). ---
  const SKIP = new Set([
    'script',
    'style',
    'template',
    'noscript',
    'link',
    'meta',
    'title',
    'head',
    'base',
  ]);
  const els: Element[] = [];
  const parent: number[] = [];
  const end: number[] = [];
  const indexOf = new Map<Element, number>();
  const childrenOf = (el: Element): Element[] => {
    if (el.shadowRoot) return Array.from(el.shadowRoot.children);
    if (el instanceof HTMLSlotElement) {
      const assigned = el.assignedElements();
      if (assigned.length > 0) return assigned;
    }
    return Array.from(el.children);
  };
  const visit = (el: Element, p: number): void => {
    const i = els.length;
    els.push(el);
    parent.push(p);
    end.push(i + 1);
    indexOf.set(el, i);
    // SVG internals (paths, groups) are drawing primitives, not UI elements.
    if (el.localName !== 'svg') {
      for (const child of childrenOf(el)) if (!SKIP.has(child.localName)) visit(child, i);
    }
    end[i] = els.length;
  };
  const root = document.body ?? document.documentElement;
  if (root) visit(root, -1);
  const at = (i: number): Element => els[i] as Element;
  const parentOf = (i: number): number => parent[i] as number;
  const endOf = (i: number): number => end[i] as number;
  /** Direct children indices of i. */
  const childIndices = (i: number): number[] => {
    const out: number[] = [];
    for (let j = i + 1; j < endOf(i); j = endOf(j)) out.push(j);
    return out;
  };

  // --- Inherited flags, computed top-down in one pass (parents precede children). ---
  const ariaDisabled = new Uint8Array(els.length);
  const inert = new Uint8Array(els.length);
  const busy = new Uint8Array(els.length);
  for (let i = 0; i < els.length; i++) {
    const el = at(i);
    const p = parentOf(i);
    ariaDisabled[i] =
      (p >= 0 && ariaDisabled[p]) || el.getAttribute('aria-disabled') === 'true' ? 1 : 0;
    inert[i] = (p >= 0 && inert[p]) || el.hasAttribute('inert') ? 1 : 0;
    if (el.getAttribute('aria-busy') === 'true') {
      for (let j = i; j >= 0 && !busy[j]; j = parentOf(j)) busy[j] = 1;
    }
  }

  // --- Focus: DOM focus, through open shadow roots. JS focus engines report it via the SDK. ---
  let activeIdx = -1;
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (active && active !== document.body && active !== document.documentElement) {
    activeIdx = indexOf.get(active) ?? -1;
  }
  const focusWithin = new Set<number>();
  for (let i = activeIdx; i >= 0; i = parentOf(i)) focusWithin.add(i);

  // --- Lazily computed, memoized per call. ---
  const memo = <T>(compute: (i: number) => T): ((i: number) => T) => {
    const cache = new Map<number, T>();
    return (i) => {
      if (cache.has(i)) return cache.get(i) as T;
      const v = compute(i);
      cache.set(i, v);
      return v;
    };
  };
  const normalize = (s: string | null | undefined): string | null => {
    const t = (s ?? '').replace(/\s+/g, ' ').trim();
    return t === '' ? null : t;
  };
  const styleAt = memo((i) => getComputedStyle(at(i)));
  /** Has a box and is not `visibility: hidden` (ancestors included). */
  const renderedAt = memo((i) => at(i).checkVisibility({ visibilityProperty: true }));

  const flatChildNodes = (el: Element): readonly Node[] => {
    if (el.shadowRoot) return Array.from(el.shadowRoot.childNodes);
    if (el instanceof HTMLSlotElement) {
      const assigned = el.assignedNodes();
      if (assigned.length > 0) return assigned;
    }
    return Array.from(el.childNodes);
  };
  const INLINE_DISPLAY = /^(inline|contents|ruby)/;
  /**
   * Raw text over the flat tree (open shadow roots included), block children space-separated.
   * `all` keeps hidden descendants; otherwise only rendered descendants contribute.
   */
  const rawText = (i: number, all: boolean): string => {
    const el = at(i);
    if (el.localName === 'svg') return el.textContent ?? '';
    let out = '';
    for (const node of flatChildNodes(el)) {
      if (node.nodeType === Node.TEXT_NODE) {
        out += (node as Text).data;
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const child = node as Element;
      if (child.localName === 'br') {
        out += ' ';
        continue;
      }
      const j = indexOf.get(child);
      // Not walked (script, style, ...) or not rendered: contributes no text.
      if (j === undefined || (!all && !rendersText(j))) continue;
      const text = all ? rawAll(j) : rawVisible(j);
      out += INLINE_DISPLAY.test(styleAt(j).display) ? text : ` ${text} `;
    }
    return out;
  };
  /** Contributes rendered text: has a box, or is `display: contents` inside rendered content. */
  const rendersText = memo((i): boolean => {
    if (renderedAt(i)) return true;
    const p = parentOf(i);
    return styleAt(i).display === 'contents' && (p < 0 || rendersText(p));
  });
  const mask = (value: string): string => '\u2022'.repeat(Array.from(value).length);
  /**
   * A system text field and its value (masked for passwords, never the placeholder): text-like
   * inputs, textareas and contenteditable hosts that are not read-only.
   */
  const fieldAt = memo((i): { value: string; secure: boolean } | null => {
    const el = at(i);
    if (el instanceof HTMLInputElement) {
      const types = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'];
      if (el.readOnly || types.indexOf(el.type) < 0) return null;
      const secure = el.type === 'password';
      return { value: secure ? mask(el.value) : el.value, secure };
    }
    if (el instanceof HTMLTextAreaElement) {
      return el.readOnly ? null : { value: el.value, secure: false };
    }
    if (el instanceof HTMLElement && el.isContentEditable) {
      const parent = el.parentElement;
      if (parent && parent.isContentEditable) return null;
      return { value: el.innerText, secure: false };
    }
    return null;
  });
  const rawVisible = memo((i) => rawText(i, false));
  const rawAll = memo((i) => rawText(i, true));

  /**
   * Text of the rendered descendants (like `innerText` without CSS text-transform). A hidden
   * element reports all its text, so it can still be found by text and asserted hidden.
   * Form fields report their value.
   */
  const textAt = memo((i): string | null => {
    const el = at(i);
    const field = fieldAt(i);
    if (field) return normalize(field.value);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
      return el.type === 'password' ? null : normalize(el.value);
    if (el instanceof HTMLSelectElement) {
      return normalize(Array.from(el.selectedOptions, (o) => o.text).join(' '));
    }
    return normalize(rendersText(i) ? rawVisible(i) : rawAll(i));
  });
  const rectAt = memo((i) => plainRect(at(i).getBoundingClientRect()));
  const isContents = (i: number): boolean => {
    const r = rectAt(i);
    return r.width === 0 && r.height === 0 && styleAt(i).display === 'contents';
  };
  /** `display: contents` elements have no box; they span their children. */
  const boundsAt = memo((i): Rect => {
    if (!isContents(i)) return rectAt(i);
    const boxes = childIndices(i)
      .map(boundsAt)
      .filter((b) => b.width > 0 || b.height > 0);
    if (boxes.length === 0) return rectAt(i);
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const right = Math.max(...boxes.map((b) => b.x + b.width));
    const bottom = Math.max(...boxes.map((b) => b.y + b.height));
    return { x, y, width: right - x, height: bottom - y };
  });
  const visibleAt = memo((i): boolean => {
    const el = at(i);
    if (!el.isConnected) return false;
    if (renderedAt(i)) {
      const r = rectAt(i);
      return r.width > 0 && r.height > 0;
    }
    return isContents(i) && childIndices(i).some(visibleAt);
  });

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const viewportRect: Rect = { x: 0, y: 0, ...viewport };
  const intersect = (a: Rect, b: Rect, clipX = true, clipY = true): Rect => {
    const x = clipX ? Math.max(a.x, b.x) : a.x;
    const y = clipY ? Math.max(a.y, b.y) : a.y;
    const right = clipX ? Math.min(a.x + a.width, b.x + b.width) : a.x + a.width;
    const bottom = clipY ? Math.min(a.y + a.height, b.y + b.height) : a.y + a.height;
    return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
  };
  /**
   * The area an element can paint into: the viewport cut by every ancestor that clips its
   * overflow (e.g. a rail with `overflow: hidden`). `position: fixed` escapes to the viewport.
   * Approximation: absolutely positioned elements escaping a clipping ancestor are not modeled.
   */
  const clipAt = memo((i): Rect => {
    const p = parentOf(i);
    if (p < 0 || styleAt(i).position === 'fixed') return viewportRect;
    const inherited = clipAt(p);
    const pe = at(p);
    // Overflow on <html>/<body> applies to the viewport, which is already the base clip.
    if (pe === document.body || pe === document.documentElement) return inherited;
    const ps = styleAt(p);
    const clipX = ps.overflowX !== 'visible';
    const clipY = ps.overflowY !== 'visible';
    return clipX || clipY ? intersect(inherited, rectAt(p), clipX, clipY) : inherited;
  });

  const focusableAt = (i: number): boolean => {
    const el = at(i);
    if (inert[i] || el.matches(':disabled')) return false;
    const tabIndex = (el as Partial<HTMLElement>).tabIndex;
    // An explicit tabindex (even -1, common in TV focus engines) makes an element focusable.
    return el.hasAttribute('tabindex') || (typeof tabIndex === 'number' && tabIndex >= 0);
  };

  const labelOf = (el: Element): string | null => {
    const aria = normalize(el.getAttribute('aria-label'));
    if (aria !== null) return aria;
    const ids = el.getAttribute('aria-labelledby');
    if (ids) {
      const scope = el.getRootNode() as Document | DocumentFragment;
      const parts = ids
        .split(/\s+/)
        .map((id) =>
          id && typeof scope.getElementById === 'function' ? scope.getElementById(id) : null,
        )
        .map((n) => {
          if (!n) return null;
          const j = indexOf.get(n);
          return j === undefined ? normalize(n.textContent) : textAt(j);
        })
        .filter((t): t is string => t !== null);
      if (parts.length > 0) return parts.join(' ');
    }
    const hasAlt =
      el instanceof HTMLImageElement ||
      el instanceof HTMLAreaElement ||
      (el instanceof HTMLInputElement && el.type === 'image');
    return hasAlt ? normalize(el.getAttribute('alt')) : null;
  };

  const refOf = (el: Element): string => {
    let ref = refs.byEl.get(el);
    if (ref === undefined) {
      ref = `${refs.nonce}.${refs.next++}`;
      refs.byEl.set(el, ref);
    }
    if (!refs.byRef.has(ref)) refs.byRef.set(ref, new WeakRef(el));
    return ref;
  };

  const snapshotAt = (i: number): AgentSnapshot => {
    const el = at(i);
    const bounds = boundsAt(i);
    const visible = visibleAt(i);
    const clipped = intersect(bounds, clipAt(i));
    return {
      ref: refOf(el),
      testId: el.getAttribute(cfg.testIdAttribute),
      text: textAt(i),
      label: labelOf(el),
      bounds,
      visible,
      inViewport: visible && clipped.width > 0 && clipped.height > 0,
      focusable: focusableAt(i),
      focused: i === activeIdx,
      focusWithin: focusWithin.has(i),
      enabled: !(ariaDisabled[i] || el.matches(':disabled')),
      selected:
        el.getAttribute('aria-selected') === 'true' ||
        (el instanceof HTMLOptionElement && el.selected),
      busy: busy[i] === 1,
      editable: fieldAt(i) !== null,
      value: fieldAt(i)?.value ?? null,
      secure: fieldAt(i)?.secure ?? false,
    };
  };

  const pruneRefs = (): void => {
    if (refs.byRef.size <= refs.pruneAt) return;
    for (const [ref, weak] of refs.byRef) {
      const el = weak.deref();
      if (el === undefined || !el.isConnected) refs.byRef.delete(ref);
    }
    refs.pruneAt = Math.max(1000, refs.byRef.size * 2);
  };

  const matcherFor = (step: Exclude<AgentSelector, { kind: 'nth' }>): ((i: number) => boolean) => {
    switch (step.kind) {
      case 'testId':
        return (i) => at(i).getAttribute(cfg.testIdAttribute) === step.value;
      case 'focused':
        return (i) => i === activeIdx;
      case 'text':
      case 'regex': {
        let test: (text: string) => boolean;
        if (step.kind === 'regex') {
          // Stateless like the core's testRegExp: the g/y flags never carry state between elements.
          const re = new RegExp(step.source, step.flags.replace(/[gy]/g, ''));
          test = (t) => re.test(t);
        } else if (step.exact) {
          test = (t) => t === step.value;
        } else {
          test = (t) => t.toLowerCase().includes(step.value);
        }
        const matches = (i: number): boolean => {
          const t = textAt(i);
          return t !== null && test(t);
        };
        // Like Playwright: the deepest elements whose text matches, not their ancestors.
        return (i) => matches(i) && !childIndices(i).some(matches);
      }
    }
  };

  let result: AgentResponses[AgentRequest['op']];
  if (req.op === 'query') {
    // Same semantics as the core's `evaluateChain`. `null` = the document scope: the first
    // search step covers the whole tree (root included), while `nth` and an empty chain treat it
    // as the root alone. Later steps search strict descendants of the previous matches.
    const documentScope = els.length > 0 ? [0] : [];
    let current: number[] | null = null;
    for (const step of req.chain) {
      if (step.kind === 'nth') {
        const picked: number | undefined = (current ?? documentScope)[step.index];
        current = picked === undefined ? [] : [picked];
        continue;
      }
      const matches = matcherFor(step);
      const next: number[] = [];
      if (current === null) {
        for (let i = 0; i < els.length; i++) if (matches(i)) next.push(i);
      } else {
        // Scopes are sorted; a scope nested in a previous one adds nothing new.
        let covered = -1;
        for (const scope of current) {
          if (scope < covered) continue;
          for (let i = scope + 1; i < endOf(scope); i++) if (matches(i)) next.push(i);
          covered = endOf(scope);
        }
      }
      current = next;
    }
    result = (current ?? documentScope).map(snapshotAt);
  } else if (req.op === 'focused') {
    result = activeIdx >= 0 ? snapshotAt(activeIdx) : null;
  } else {
    const node = (i: number): AgentNode => ({
      ...snapshotAt(i),
      children: childIndices(i).map(node),
    });
    result = { root: els.length > 0 ? node(0) : null, viewport };
  }
  pruneRefs();
  return JSON.stringify(result);
}
