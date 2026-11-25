import { evaluateChain, focusedIn, walkTree, type ElementRef, type UINode } from '@toets/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findByRef, parseBounds, parsePageSource } from '../src/page-source.js';

/** Real UiAutomator2 page source of the fixture's home screen (API 33 `tv_1080p`). */
const homeXml = readFileSync(join(import.meta.dirname, 'fixtures', 'home.xml'), 'utf8');

const byTestId = (root: UINode, testId: string) =>
  [...walkTree(root)].find((n) => n.testId === testId);

describe('parsePageSource', () => {
  const tree = parsePageSource(homeXml);

  it('reads the viewport from the hierarchy root', () => {
    expect(tree.viewport).toEqual({ width: 1920, height: 1080 });
    expect(tree.root).toMatchObject({ testId: null, visible: true, inViewport: true });
    expect(tree.root.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('maps resource-id without the package prefix to testId', () => {
    const card = byTestId(tree.root, 'card_0');
    expect(card).toMatchObject({
      testId: 'card_0',
      text: 'Item 0',
      label: null,
      focusable: true,
      focused: true,
      focusWithin: true,
      enabled: true,
      selected: false,
      busy: false,
      visible: true,
      inViewport: true,
    });
    expect(card?.bounds).toEqual({ x: 424, y: 172, width: 400, height: 224 });
    expect(byTestId(tree.root, 'root')?.testId).toBe('root'); // tv.toets.fixture:id/root
  });

  it('gives window decor no test ID', () => {
    // android:id/content and the frames above it belong to the platform, not the app.
    expect(byTestId(tree.root, 'content')).toBeUndefined();
    const content = tree.root.children[0]?.children[0]?.children[0];
    expect(content?.ref).toContain('|android:id/content');
    expect(content?.testId).toBeNull();
    expect(content?.children[0]?.testId).toBe('root');
  });

  it('reports scroll containers with focusable children as not focusable', () => {
    // Android focuses a HorizontalScrollView only when nothing inside it can take focus.
    expect(byTestId(tree.root, 'rail')?.focusable).toBe(false);
    expect(byTestId(tree.root, 'card_1')?.focusable).toBe(true);
    const empty = parsePageSource(`<hierarchy width="100" height="100">
  <android.widget.ScrollView resource-id="list" focusable="true" bounds="[0,0][100,100]">
    <android.widget.TextView text="Nothing yet" focusable="false" bounds="[0,0][100,20]" />
  </android.widget.ScrollView>
</hierarchy>`);
    expect(byTestId(empty.root, 'list')?.focusable).toBe(true);
  });

  it('maps content-desc to label, enabled and selected', () => {
    expect(byTestId(tree.root, 'disabled_button')).toMatchObject({
      text: 'Unavailable',
      label: 'Not available yet',
      enabled: false,
    });
    expect(byTestId(tree.root, 'menu_home')?.selected).toBe(true);
  });

  it('aggregates the text of displayed descendants', () => {
    const menu = byTestId(tree.root, 'menu');
    expect(menu?.text).toBe('Home Settings');
    // Off-screen cards are not displayed, so their text does not count.
    expect(byTestId(tree.root, 'rail')?.text).toBe('Item 0 Item 1 Item 2 Item 3');
  });

  it('marks clipped-out elements invisible and partially visible ones by their visible part', () => {
    expect(byTestId(tree.root, 'card_9')).toMatchObject({ visible: false, inViewport: false });
    expect(byTestId(tree.root, 'card_3')?.bounds).toEqual({
      x: 1720,
      y: 172,
      width: 152,
      height: 224,
    });
  });

  it('computes focusWithin for ancestors of the focused element', () => {
    expect(byTestId(tree.root, 'rail')).toMatchObject({ focused: false, focusWithin: true });
    expect(byTestId(tree.root, 'menu')?.focusWithin).toBe(false);
    expect(tree.root.focusWithin).toBe(true);
  });

  it('supports content-desc as the test ID attribute', () => {
    const t = parsePageSource(homeXml, { testIdAttribute: 'content-desc' });
    expect(evaluateChain(t, [{ kind: 'testId', value: 'Not available yet' }])).toHaveLength(1);
    expect(evaluateChain(t, [{ kind: 'testId', value: 'card_0' }])).toHaveLength(0);
  });

  it('works on a uiautomator dump and edge-case attributes', () => {
    const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" bounds="[0,0][1280,720]">
    <node index="0" text="Tom &amp; Jerry&#10;S1" resource-id="com.x:id/title" class="android.widget.TextView" bounds="[10,10][200,50]" />
    <node index="1" text="Search" showing-hint="true" resource-id="com.x:id/search" class="android.widget.EditText" focusable="true" focused="true" bounds="[10,60][200,100]" />
    <node index="2" text="hidden" resource-id="com.x:id/gone" class="android.widget.TextView" displayed="false" bounds="[10,60][200,100]" />
  </node>
</hierarchy>`;
    const t = parsePageSource(xml);
    expect(t.viewport).toEqual({ width: 1280, height: 720 });
    expect(byTestId(t.root, 'title')?.text).toBe('Tom & Jerry S1');
    expect(byTestId(t.root, 'search')).toMatchObject({ text: null, focused: true });
    expect(byTestId(t.root, 'gone')).toMatchObject({ visible: false, text: 'hidden' });
    expect(t.root.children[0]?.text).toBe('Tom & Jerry S1');
  });

  it('reports text fields as editable with their value, passwords as secure', () => {
    const xml = `<hierarchy rotation="0">
  <node index="0" text="" class="android.widget.FrameLayout" bounds="[0,0][1280,720]">
    <node index="0" text="Email" showing-hint="true" resource-id="com.x:id/email" class="android.widget.EditText" bounds="[10,10][200,50]" />
    <node index="1" text="a@b.co" resource-id="com.x:id/email2" class="android.widget.EditText" bounds="[10,60][200,100]" />
    <node index="2" text="••••" password="true" resource-id="com.x:id/pass" class="android.widget.EditText" bounds="[10,110][200,150]" />
    <node index="3" text="off" enabled="false" resource-id="com.x:id/off" class="android.widget.EditText" bounds="[10,160][200,200]" />
    <node index="4" text="Hi" resource-id="com.x:id/label" class="android.widget.TextView" bounds="[10,210][200,250]" />
  </node>
</hierarchy>`;
    const t = parsePageSource(xml);
    expect(byTestId(t.root, 'email')).toMatchObject({ editable: true, value: '', secure: false });
    expect(byTestId(t.root, 'email2')).toMatchObject({ editable: true, value: 'a@b.co' });
    expect(byTestId(t.root, 'pass')).toMatchObject({
      editable: true,
      value: '••••',
      secure: true,
    });
    expect(byTestId(t.root, 'off')).toMatchObject({ editable: false, value: null, secure: false });
    expect(byTestId(t.root, 'label')).toMatchObject({ editable: false, value: null });
  });
});

describe('refs', () => {
  it('resolve to the same element while it exists, and to null once it changed', () => {
    const tree = parsePageSource(homeXml);
    const card = byTestId(tree.root, 'card_2')!;
    expect(findByRef(parsePageSource(homeXml).root, card.ref)?.testId).toBe('card_2');
    const changed = homeXml.replace('tv.toets.fixture:id/card_2', 'tv.toets.fixture:id/other');
    expect(findByRef(parsePageSource(changed).root, card.ref)).toBeNull();
    expect(findByRef(tree.root, 'r.9.9.9|x|y' as ElementRef)).toBeNull();
  });
});

describe('parseBounds', () => {
  it('parses UiAutomator bounds and tolerates garbage', () => {
    expect(parseBounds('[1,2][11,22]')).toEqual({ x: 1, y: 2, width: 10, height: 20 });
    expect(parseBounds('[2152,172][1872,396]')).toEqual({ x: 2152, y: 172, width: 0, height: 224 });
    expect(parseBounds(undefined)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(parseBounds('nope')).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('focusedIn', () => {
  it('returns the focused element without children', () => {
    const focused = focusedIn(parsePageSource(homeXml));
    expect(focused?.testId).toBe('card_0');
    expect(focused).not.toHaveProperty('children');
  });
});
