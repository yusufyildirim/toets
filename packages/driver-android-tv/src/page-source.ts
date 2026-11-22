import type { ElementRef, Rect, UINode, UITree } from '@dpad-tv/core';
import { XMLParser } from 'fast-xml-parser';

/** Which page-source attribute holds the dpad test ID. */
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
 * Maps a UiAutomator2 page source (or a `uiautomator dump`) to a dpad {@link UITree}.
 *
 * - `testId`: `resource-id` without the package prefix (or `content-desc`, see options).
 * - `text`: the element's own `text` plus that of its displayed descendants, normalized.
 * - `label`: `content-desc`.
 * - `visible`: `displayed` and a non-empty `bounds`. Android reports bounds clipped to what is
 *   on screen, so partially scrolled-out elements report their visible part only.
 * - `busy`: always `false`; Android has no busy flag (the SDK `sync` domain provides it).
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
    const text = normalize(
      [ownText, ...children.filter((c) => c.visible).map((c) => c.text ?? '')].join(' '),
    );
    const focused = attrs.focused === 'true';
    const resourceId = attrs['resource-id'] ?? '';
    return {
      ref: `${path}|${attrs.class ?? tagOf(node) ?? ''}|${resourceId}` as ElementRef,
      testId: isRoot ? null : testIdOf(attrs, testIdAttribute),
      text: text || null,
      label: nonEmpty(attrs['content-desc']),
      bounds,
      visible: isRoot || visible,
      inViewport: (isRoot || visible) && intersects(bounds, viewport),
      focusable: attrs.focusable === 'true',
      focused,
      focusWithin: focused || children.some((c) => c.focusWithin),
      enabled: isRoot || attrs.enabled !== 'false',
      selected: attrs.selected === 'true',
      busy: false,
      children,
    };
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
