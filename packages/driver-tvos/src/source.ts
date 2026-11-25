import type { ElementRef, Rect, UINode, UITree } from '@toets/core';

/**
 * One element of WebDriverAgent's JSON page source (`mobile: source`, `format: json`).
 * Booleans arrive as `"1"`/`"0"` strings. Attributes listed in `SOURCE_EXCLUDED_ATTRIBUTES`
 * are not requested.
 */
export interface WdaSourceNode {
  /** Short element type, e.g. `Button`, `StaticText`, `Other`. */
  readonly type: string;
  /** `accessibilityIdentifier`, `null` when unset. Unlike `name`, never falls back to the label. */
  readonly rawIdentifier?: string | null;
  readonly name?: string | null;
  readonly label?: string | null;
  readonly value?: string | number | null;
  /** Placeholder of a text field; XCUITest reports it as the `value` of an empty field. */
  readonly placeholderValue?: string | null;
  readonly rect?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly isEnabled?: string | boolean | number;
  readonly isVisible?: string | boolean | number;
  readonly isAccessible?: string | boolean | number;
  readonly isFocused?: string | boolean | number;
  /** Comma-separated accessibility traits, e.g. `Button, Selected`. */
  readonly traits?: string | null;
  readonly children?: readonly WdaSourceNode[];
}

/**
 * Attributes dropped from the page source request: toets does not use them and some are
 * expensive to compute on large trees.
 */
export const SOURCE_EXCLUDED_ATTRIBUTES = [
  'frame',
  'nativeFrame',
  'minValue',
  'maxValue',
  'customActions',
  'nativeAccessibilityElement',
].join(',');

/**
 * Element types the tvOS focus engine can focus. XCUITest exposes no "focusable" flag, so
 * this list (plus "is focused now", the Button/Link traits and accessible `Other` elements)
 * approximates it. Custom SwiftUI views made `.focusable()` usually surface as `Button` or
 * `Other` with the Button trait once focused; see the traps page.
 */
const FOCUSABLE_TYPES: ReadonlySet<string> = new Set([
  'Button',
  'Cell',
  'Link',
  'TextField',
  'SecureTextField',
  'SearchField',
  'Switch',
  'Toggle',
  'Slider',
  'SegmentedControl',
  'Tab',
  'MenuItem',
  'PickerWheel',
  'Stepper',
]);

/** Types whose `value` is user-visible text (other types use it for state, e.g. `1` on a switch). */
const TEXT_VALUE_TYPES: ReadonlySet<string> = new Set([
  'StaticText',
  'TextField',
  'SecureTextField',
  'SearchField',
  'TextView',
]);

const BUSY_TYPES: ReadonlySet<string> = new Set(['ActivityIndicator']);

/** System text fields: tvOS enters their text with its fullscreen keyboard. */
const EDITABLE_TYPES: ReadonlySet<string> = new Set([
  'TextField',
  'SecureTextField',
  'SearchField',
  'TextView',
]);

/**
 * Maps one page source fetch to a toets {@link UITree}.
 *
 * - `testId` = `accessibilityIdentifier`; `label` = accessibility label.
 * - `text`: an accessible or text element with a label speaks for its subtree (its label);
 *   otherwise its own label/text value joined with its children's text.
 * - `visible`: XCUITest's `isVisible` and a non-zero size; flattened containers (see below)
 *   by their frame.
 * - `focused` marks only the deepest element reporting `hasFocus`; ancestors get `focusWithin`.
 * - `selected` comes from the `Selected` trait; `busy` from a visible activity indicator.
 * - `editable`: enabled text fields. `value` is their text, `''` when XCUITest reports the
 *   placeholder as the value (it does for empty fields); secure fields are masked. Their `text`
 *   is the value.
 * - Refs are tree paths plus type and identifier: stable while the screen structure is.
 */
export function parseSource(source: WdaSourceNode): UITree {
  const rootRect = rectOf(source);
  const viewport = { width: rootRect.width, height: rootRect.height };
  const deepestFocused = findDeepestFocused(source, '0');
  const root = toNode(source, '0', viewport, deepestFocused);
  return { root, viewport };
}

function toNode(
  n: WdaSourceNode,
  path: string,
  viewport: { width: number; height: number },
  focusedPath: string | null,
): UINode {
  const children = (n.children ?? []).map((c, i) =>
    toNode(c, `${path}.${i}`, viewport, focusedPath),
  );
  const bounds = rectOf(n);
  const hasSize = bounds.width > 0 && bounds.height > 0;
  const testId = str(n.rawIdentifier);
  const accessible = bool(n.isAccessible);
  // A plain view with an identifier but no accessibility of its own (a React Native `View`)
  // is not an accessibility container: XCUITest lists its descendants as its siblings and its
  // `isVisible` is unreliable. Judge such a flattened container by its frame.
  const flattened = n.type === 'Other' && testId !== null && !accessible && children.length === 0;
  const visible =
    hasSize &&
    (flattened ? intersects(bounds, viewport) : n.isVisible === undefined || bool(n.isVisible));
  const focused = path === focusedPath;
  const traits = parseTraits(n.traits);
  const label = str(n.label);
  const enabled = n.isEnabled === undefined || bool(n.isEnabled);
  const editable = EDITABLE_TYPES.has(n.type) && enabled;
  const secure = editable && n.type === 'SecureTextField';
  const value = editable ? fieldValue(n, secure) : null;
  // The application's label is its display name, not on-screen text.
  const ownText =
    n.type === 'Application'
      ? null
      : (label ?? (TEXT_VALUE_TYPES.has(n.type) ? str(n.value) : null));
  // An accessible element speaks for its subtree, and so does a text element: tvOS nests an
  // accessible copy of the same text inside it. Containers join their own and children's text.
  const text = editable
    ? normalize(value ?? '')
    : ownText !== null && (accessible || n.type === 'StaticText')
      ? normalize(ownText)
      : normalize(
          [ownText, ...children.map((c) => c.text).filter((t) => t !== normalize(ownText ?? ''))]
            .filter(Boolean)
            .join(' '),
        );
  return {
    ref: refOf(path, n.type, testId),
    testId,
    text,
    label,
    bounds,
    visible,
    inViewport: visible && intersects(bounds, viewport),
    focusable:
      focused ||
      FOCUSABLE_TYPES.has(n.type) ||
      traits.has('Button') ||
      traits.has('Link') ||
      // React Native touchables (cards, menu items) are accessible `Other` views without traits.
      (n.type === 'Other' && accessible),
    focused,
    focusWithin: focused || children.some((c) => c.focusWithin),
    enabled,
    selected: traits.has('Selected'),
    busy: (visible && BUSY_TYPES.has(n.type)) || children.some((c) => c.busy),
    editable,
    value,
    secure,
    children,
  };
}

/** A text field's text: never the placeholder, one `•` per character when secure. */
function fieldValue(n: WdaSourceNode, secure: boolean): string {
  const raw = n.value === null || n.value === undefined ? '' : String(n.value);
  const placeholder = n.placeholderValue ?? null;
  const value = placeholder !== null && placeholder !== '' && raw === placeholder ? '' : raw;
  return secure ? '\u2022'.repeat([...value].length) : value;
}

/** Path of the deepest node with `hasFocus`, or `null`. Later siblings win on ties. */
function findDeepestFocused(n: WdaSourceNode, path: string): string | null {
  let found: string | null = null;
  (n.children ?? []).forEach((c, i) => {
    const inChild = findDeepestFocused(c, `${path}.${i}`);
    if (inChild !== null) found = inChild;
  });
  if (found !== null) return found;
  return n.isFocused !== undefined && bool(n.isFocused) ? path : null;
}

function refOf(path: string, type: string, testId: string | null): ElementRef {
  return `${path}:${type}${testId === null ? '' : `#${testId}`}` as ElementRef;
}

function rectOf(n: WdaSourceNode): Rect {
  const r = n.rect;
  if (!r) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: finite(r.x), y: finite(r.y), width: finite(r.width), height: finite(r.height) };
}

function intersects(b: Rect, viewport: { width: number; height: number }): boolean {
  return b.x < viewport.width && b.y < viewport.height && b.x + b.width > 0 && b.y + b.height > 0;
}

function parseTraits(traits: string | null | undefined): Set<string> {
  return new Set(
    (traits ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

function bool(v: string | boolean | number | undefined): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function str(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.trim() === '' ? null : s;
}

function finite(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

function normalize(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}
