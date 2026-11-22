import { evaluateChain, findNode, focusedIn, type ElementRef } from '@dpad-tv/core';
import { describe, expect, it } from 'vitest';
import { parseSource, type WdaSourceNode } from '../src/source.js';

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

/** Shaped like WebDriverAgent's JSON source of the fixture home screen. */
const HOME: WdaSourceNode = {
  type: 'Application',
  name: 'DpadFixture',
  label: 'DpadFixture',
  rawIdentifier: null,
  rect: rect(0, 0, 1920, 1080),
  isEnabled: '1',
  isVisible: '1',
  isAccessible: '0',
  isFocused: '0',
  children: [
    {
      type: 'Window',
      rect: rect(0, 0, 1920, 1080),
      isVisible: '1',
      children: [
        {
          type: 'StaticText',
          rawIdentifier: 'title',
          name: 'title',
          label: 'dpad   fixture',
          value: 'dpad fixture',
          rect: rect(80, 60, 400, 50),
          isVisible: '1',
          isAccessible: '1',
          traits: 'Header, StaticText',
        },
        {
          type: 'Other',
          rawIdentifier: 'rail',
          name: 'rail',
          label: null,
          rect: rect(0, 300, 1920, 300),
          isVisible: '1',
          isAccessible: '0',
          isFocused: '0',
          children: [
            {
              type: 'Button',
              rawIdentifier: 'rail_item_1',
              name: 'rail_item_1',
              label: 'Item 1',
              rect: rect(80, 320, 300, 200),
              isEnabled: '1',
              isVisible: '1',
              isAccessible: '1',
              isFocused: '1',
              traits: 'Button',
              children: [
                {
                  type: 'StaticText',
                  label: 'Item 1',
                  rect: rect(90, 330, 100, 40),
                  isVisible: '1',
                  isAccessible: '1',
                },
              ],
            },
            {
              type: 'Button',
              rawIdentifier: 'rail_item_2',
              name: 'rail_item_2',
              label: 'Item 2',
              rect: rect(420, 320, 300, 200),
              isVisible: '1',
              isAccessible: '1',
              isFocused: '0',
              traits: 'Button, Selected',
            },
            {
              type: 'Button',
              rawIdentifier: 'rail_item_9',
              label: 'Item 9',
              rect: rect(2400, 320, 300, 200),
              isVisible: '0',
              isAccessible: '1',
              traits: 'Button',
            },
          ],
        },
        {
          type: 'Button',
          rawIdentifier: null,
          // WDA's `name` falls back to the label when there is no identifier.
          name: 'Disabled',
          label: 'Disabled',
          rect: rect(80, 700, 300, 80),
          isEnabled: '0',
          isVisible: '1',
          isAccessible: '1',
          traits: 'Button, NotEnabled',
        },
        {
          type: 'ActivityIndicator',
          rawIdentifier: 'spinner',
          rect: rect(900, 900, 40, 40),
          isVisible: '1',
          label: 'In progress',
        },
        {
          type: 'Switch',
          rawIdentifier: 'toggle',
          label: 'Autoplay',
          value: '1',
          rect: rect(80, 800, 300, 80),
          isVisible: '1',
          isAccessible: '1',
        },
        { type: 'Other', rawIdentifier: 'zero', rect: rect(0, 0, 0, 0), isVisible: '1' },
      ],
    },
  ],
};

describe('parseSource', () => {
  const tree = parseSource(HOME);
  const byId = (id: string) => evaluateChain(tree, [{ kind: 'testId', value: id }])[0]!;

  it('uses the root frame as viewport', () => {
    expect(tree.viewport).toEqual({ width: 1920, height: 1080 });
  });

  it('takes testId from rawIdentifier only, never the label fallback in name', () => {
    expect(byId('rail_item_1').testId).toBe('rail_item_1');
    expect(evaluateChain(tree, [{ kind: 'testId', value: 'Disabled' }])).toEqual([]);
    const disabled = evaluateChain(tree, [{ kind: 'text', value: 'Disabled', exact: true }])[0]!;
    expect(disabled.testId).toBeNull();
    expect(disabled.label).toBe('Disabled');
  });

  it('lets an accessible element speak for its subtree and joins text of containers', () => {
    expect(byId('title').text).toBe('dpad fixture');
    expect(byId('rail_item_1').text).toBe('Item 1');
    expect(byId('rail').text).toBe('Item 1 Item 2 Item 9');
    expect(byId('toggle').text).toBe('Autoplay');
    expect(tree.root.text).not.toContain('DpadFixture');
  });

  it('marks focus on the deepest focused element and focusWithin on its ancestors', () => {
    expect(byId('rail_item_1')).toMatchObject({
      focused: true,
      focusWithin: true,
      focusable: true,
    });
    expect(byId('rail')).toMatchObject({ focused: false, focusWithin: true });
    expect(tree.root.focusWithin).toBe(true);
    expect(byId('rail_item_2')).toMatchObject({ focused: false, focusWithin: false });
    expect(focusedIn(tree)?.testId).toBe('rail_item_1');
  });

  it('maps enabled, selected, busy, visibility and viewport', () => {
    expect(byId('rail_item_2').selected).toBe(true);
    expect(byId('rail_item_1').selected).toBe(false);
    expect(evaluateChain(tree, [{ kind: 'text', value: 'Disabled' }])[0]!.enabled).toBe(false);
    expect(byId('spinner').busy).toBe(true);
    expect(tree.root.busy).toBe(true);
    expect(byId('rail_item_1').busy).toBe(false);
    expect(byId('rail_item_9')).toMatchObject({ visible: false, inViewport: false });
    expect(byId('zero').visible).toBe(false);
    expect(byId('title')).toMatchObject({ visible: true, inViewport: true, focusable: false });
    expect(byId('rail_item_1').bounds).toEqual(rect(80, 320, 300, 200));
  });

  it('issues refs stable across fetches of the same screen', () => {
    const again = parseSource(structuredClone(HOME));
    const ref = byId('rail_item_2').ref;
    expect(ref).toBe('0.0.1.1:Button#rail_item_2');
    expect(findNode(again, ref)?.testId).toBe('rail_item_2');
    expect(findNode(again, 'nope' as ElementRef)).toBeNull();
  });

  it('returns a null focus when nothing is focused', () => {
    expect(
      focusedIn(parseSource({ type: 'Application', rect: rect(0, 0, 1920, 1080) })),
    ).toBeNull();
  });
});

describe('evaluateChain', () => {
  const tree = parseSource(HOME);
  const ids = (chain: Parameters<typeof evaluateChain>[1]) =>
    evaluateChain(tree, chain).map((s) => s.testId ?? s.label);

  it('matches text case-insensitively by substring, exactly, or by RegExp, deepest first', () => {
    // The button's own StaticText child is deeper than the button, so it wins (like the DOM).
    expect(ids([{ kind: 'text', value: 'item' }])).toEqual([
      'Item 1',
      'rail_item_2',
      'rail_item_9',
    ]);
    expect(ids([{ kind: 'text', value: 'Item 2', exact: true }])).toEqual(['rail_item_2']);
    expect(ids([{ kind: 'text', value: /^item \d$/i }])).toHaveLength(3);
    expect(ids([{ kind: 'text', value: 'item 1', exact: true }])).toEqual([]);
  });

  it('scopes later steps to descendants and picks nth', () => {
    expect(
      ids([
        { kind: 'testId', value: 'rail' },
        { kind: 'text', value: 'Item' },
        { kind: 'nth', index: 1 },
      ]),
    ).toEqual(['rail_item_2']);
    expect(
      ids([
        { kind: 'testId', value: 'rail' },
        { kind: 'nth', index: 3 },
      ]),
    ).toEqual([]);
    expect(ids([{ kind: 'testId', value: 'rail' }, { kind: 'focused' }])).toEqual(['rail_item_1']);
    expect(ids([{ kind: 'testId', value: 'title' }, { kind: 'focused' }])).toEqual([]);
  });

  it('returns snapshots without children', () => {
    expect(evaluateChain(tree, [{ kind: 'testId', value: 'rail' }])[0]).not.toHaveProperty(
      'children',
    );
  });
});
