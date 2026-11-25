import type { ElementRef, Rect, UINode, UITree } from '@toets/core';
import { XMLParser } from 'fast-xml-parser';

/** Which page-source attribute holds the toets test ID. */
export type TestIdAttribute = 'resource-id' | 'content-desc';

export interface PageSourceOptions {
  /**
   * Attribute mapped to `testId`. Default `resource-id`, with the `<package>:id/` prefix
   * stripped, so `com.example:id/play_button` and React Native's `testID="play_button"` both
   * read as `play_button`.
   */
  readonly testIdAttribute?: TestIdAttribute;
}

type Attributes = Readonly<Record<string, string>>;

interface OrderedXmlNode {
  readonly [tag: string]: OrderedXmlNode[] | Attributes | string | undefined;
  readonly ':@'?: Attributes;
}

/** The frame the activity's content view is added to; everything above it is window decor. */
const WINDOW_CONTENT_ID = 'android:id/content';

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: true,
});

/**
 * Maps a UiAutomator2 page source (or a `uiautomator dump`) to a toets {@link UITree}.
 *
 * - `testId`: `resource-id` without the package prefix (or `content-desc`, see options). Window
 *   decor (`android:id/content` and the frames above it) has none: its IDs are the platform's.
 * - `text`: the element's own `text` plus that of its displayed descendants, normalized.
 * - `label`: `content-desc`.
 * - `visible`: `displayed` and a non-empty `bounds`. Android reports bounds clipped to what is
 *   on screen, so partially scrolled-out elements report their visible part only.
 * - `focusable`: Android's flag, except on containers holding a focusable descendant (scroll
 *   views, lists): Android focuses those only when no descendant can take focus.
 * - `busy`: always `false`; Android has no busy flag (the SDK `sync` domain provides it).
 * - `editable`: an enabled `EditText`. `value` is its text, `''` while Android shows the hint
 *   (`showing-hint`, the hint is reported as the text); `secure` is `password`, whose text
 *   Android already reports as one `•` per character.
 */
export function parsePageSource(xml: string, opts: PageSourceOptions = {}): UITree {
  const testIdAttribute = opts.testIdAttribute ?? 'resource-id';
  const doc = parser.parse(xml) as OrderedXmlNode[];
  const hierarchy = doc.find((n) => tagOf(n) !== null && tagOf(n) !== '?xml');
  if (!hierarchy) throw new Error('Page source has no root element.');

  const rootAttrs = hierarchy[':@'] ?? {};
  const rawChildren = childrenOf(hierarchy);
  const width = Number(rootAttrs.width);
  const height = Number(rootAttrs.height);
  const childRects = rawChildren.map((c) => parseBounds(c[':@']?.bounds));
  const viewport =
    width > 0 && height > 0
      ? { width, height }
      : {
          width: Math.max(0, ...childRects.map((r) => r.x + r.width)),
          height: Math.max(0, ...childRects.map((r) => r.y + r.height)),
        };

  // Nodes on the path from the root to `android:id/content`.
  const decor = new Set<OrderedXmlNode>();
  const markDecor = (node: OrderedXmlNode): boolean => {
    const onPath =
      node[':@']?.['resource-id'] === WINDOW_CONTENT_ID ||
      childrenOf(node).some((c) => markDecor(c));
    if (onPath) decor.add(node);
    return onPath;
  };
  markDecor(hierarchy);
  // Nodes that are, or contain, an element Android reports focusable.
  const withFocusable = new Set<UINode>();

  const build = (node: OrderedXmlNode, path: string): UINode => {
    const attrs = node[':@'] ?? {};
    const isRoot = path === 'r';
    const children = childrenOf(node).map((c, i) => build(c, `${path}.${i}`));
    const bounds = isRoot
      ? { x: 0, y: 0, width: viewport.width, height: viewport.height }
      : parseBounds(attrs.bounds);
    const displayed = attrs.displayed !== 'false';
    const visible = displayed && bounds.width > 0 && bounds.height > 0;
    const ownText = attrs['showing-hint'] === 'true' ? '' : (attrs.text ?? '');
    const editable = /EditText$/.test(attrs.class ?? '') && attrs.enabled !== 'false';
    const secure = editable && attrs.password === 'true';
    const text = normalize(
      [ownText, ...children.filter((c) => c.visible).map((c) => c.text ?? '')].join(' '),
    );
    const focused = attrs.focused === 'true';
    const resourceId = attrs['resource-id'] ?? '';
    const rawFocusable = attrs.focusable === 'true';
    const holdsFocusable = children.some((c) => withFocusable.has(c));
    const result: UINode = {
      ref: `${path}|${attrs.class ?? tagOf(node) ?? ''}|${resourceId}` as ElementRef,
      testId: isRoot || decor.has(node) ? null : testIdOf(attrs, testIdAttribute),
      text: text || null,
      label: nonEmpty(attrs['content-desc']),
      bounds,
      visible: isRoot || visible,
      inViewport: (isRoot || visible) && intersects(bounds, viewport),
      focusable: rawFocusable && (focused || !holdsFocusable),
      focused,
      focusWithin: focused || children.some((c) => c.focusWithin),
      enabled: isRoot || attrs.enabled !== 'false',
      selected: attrs.selected === 'true',
      busy: false,
      editable,
      value: editable ? (secure ? '\u2022'.repeat([...ownText].length) : ownText) : null,
      secure,
      children,
    };
    if (rawFocusable || holdsFocusable) withFocusable.add(result);
    return result;
  };

  return { root: build(hierarchy, 'r'), viewport };
}

/** Finds the node a ref was issued for, or `null` when it is gone or now a different element. */
export function findByRef(root: UINode, ref: ElementRef): UINode | null {
  const path = ref.slice(0, ref.indexOf('|'));
  const steps = path.split('.').slice(1).map(Number);
  let node: UINode | undefined = root;
  for (const i of steps) node = node?.children[i];
  return node && node.ref === ref ? node : null;
}

/** Parses UiAutomator `[x1,y1][x2,y2]` bounds. */
export function parseBounds(raw: string | undefined): Rect {
  const m = raw ? /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(raw) : null;
  if (!m) return { x: 0, y: 0, width: 0, height: 0 };
  const [x1, y1, x2, y2] = m.slice(1).map(Number) as [number, number, number, number];
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

function testIdOf(attrs: Attributes, attribute: TestIdAttribute): string | null {
  const raw = attrs[attribute];
  if (!raw) return null;
  return attribute === 'resource-id' ? raw.replace(/^[^:/]+:id\//, '') : raw;
}

function tagOf(node: OrderedXmlNode): string | null {
  return Object.keys(node).find((k) => k !== ':@') ?? null;
}

function childrenOf(node: OrderedXmlNode): OrderedXmlNode[] {
  const tag = tagOf(node);
  const value = tag ? node[tag] : undefined;
  return Array.isArray(value) ? value.filter((c) => tagOf(c) !== '#text') : [];
}

function intersects(r: Rect, viewport: { width: number; height: number }): boolean {
  return r.x < viewport.width && r.y < viewport.height && r.x + r.width > 0 && r.y + r.height > 0;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function nonEmpty(value: string | undefined): string | null {
  return value ? value : null;
}
