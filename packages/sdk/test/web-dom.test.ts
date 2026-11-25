// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { decodeLaunchPayload, encodeLaunchPayloadParam, type ProtocolNode } from '@toets/protocol';
import {
  DomMapper,
  describeElement,
  discoverWebPayload,
  mediaElementSnapshot,
  startToets,
} from '../src/web/index.js';

function strip(node: ProtocolNode): unknown {
  const { bounds: _b, id: _i, ...rest } = node;
  return { ...rest, children: node.children.map(strip) };
}

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).__TOETS__;
  history.replaceState(null, '', '/');
});

describe('DomMapper', () => {
  it('keeps meaningful elements and collapses structural wrappers', () => {
    document.body.innerHTML = `
      <div class="layout"><div class="row">
        <button data-testid="play">Play <b>now</b></button>
        <div data-testid="card" tabindex="-1" aria-selected="true"><span>Title</span></div>
        <a>no href</a>
        <input data-testid="search" placeholder="Search" value="cats">
        <div aria-busy="true"></div>
        <button disabled>Off</button>
      </div></div>`;
    const { root, viewport } = new DomMapper().tree();
    expect(viewport.width).toBeGreaterThan(0);
    expect(root.children.map(strip)).toMatchObject([
      {
        testId: 'play',
        text: 'Play',
        role: 'button',
        focusable: true,
        children: [{ text: 'now' }],
      },
      {
        testId: 'card',
        focusable: true,
        selected: true,
        children: [{ text: 'Title', focusable: false }],
      },
      { text: 'no href', focusable: false },
      { testId: 'search', text: 'cats', label: 'Search', role: 'textbox', focusable: true },
      { busy: true },
      { text: 'Off', enabled: false, focusable: false },
    ]);
  });

  it('keeps ids stable and serves subtrees', () => {
    document.body.innerHTML = `<div data-testid="rail"><button data-testid="a">A</button></div>`;
    const mapper = new DomMapper();
    const first = mapper.tree().root;
    const second = mapper.tree().root;
    expect(second.children[0]?.id).toBe(first.children[0]?.id);
    const rail = first.children[0] as ProtocolNode;
    const sub = mapper.tree(rail.id).root;
    expect(sub.id).toBe(rail.id);
    expect(sub.children[0]?.testId).toBe('a');
    expect(() => mapper.tree('nope')).toThrow(/No node/);
  });

  it('reports DOM focus and custom focus engines', () => {
    document.body.innerHTML = `<button data-testid="a">A</button><div data-testid="b" class="focused">B</div>`;
    const mapper = new DomMapper();
    expect(mapper.focused()).toBeNull();
    (document.querySelector('button') as HTMLButtonElement).focus();
    expect(mapper.focused()).toMatchObject({ testId: 'a', focused: true });
    expect(
      mapper
        .tree()
        .root.children.filter((n) => n.focused)
        .map((n) => n.testId),
    ).toEqual(['a']);

    // A JS focus engine reports focus (`reportFocus()`): DOM focus no longer counts.
    let reported: { target: unknown } | null = null;
    const custom = new DomMapper(
      { isFocusable: (el) => (el.getAttribute('data-testid') === 'b' ? true : undefined) },
      () => reported,
    );
    expect(custom.focused()).toMatchObject({ testId: 'a' });
    const b = document.querySelector('.focused');
    reported = { target: b };
    expect(custom.focused()).toMatchObject({ testId: 'b', focusable: true, focused: true });
    reported = { target: { current: b } };
    expect(custom.focusedId()).toBe(custom.idOf(b as Element));
    reported = { target: null };
    expect(custom.focused()).toBeNull();
    b?.remove();
    reported = { target: b };
    expect(custom.focused()).toBeNull();
  });

  it('marks hidden subtrees invisible', () => {
    document.body.innerHTML = `
      <div style="display:none"><button data-testid="x">X</button></div>
      <div style="opacity:0"><button data-testid="y">Y</button></div>
      <button data-testid="z" style="visibility:hidden">Z</button>`;
    const nodes = new DomMapper().tree().root.children;
    expect(nodes.map((n) => [n.testId, n.visible])).toEqual([
      ['x', false],
      ['y', false],
      ['z', false],
    ]);
  });

  it('honors a custom test id attribute', () => {
    document.body.innerHTML = `<button data-qa="a">A</button><button data-qa="b">B</button>`;
    const [a] = Array.from(document.querySelectorAll('button'));
    const mapper = new DomMapper({ testIdAttribute: 'data-qa' });
    expect(mapper.tree().root.children.map((n) => n.testId)).toEqual(['a', 'b']);
    expect(describeElement(a, 'data-qa')).toBe('button[data-qa="a"]');
  });
});

describe('web payload discovery', () => {
  it('reads the query parameter, hash routes and window.__TOETS__', () => {
    const payload = { v: 1 as const, sdkUrl: 'ws://localhost:1', token: 't' };
    expect(discoverWebPayload()).toBeUndefined();
    history.replaceState(null, '', `/?x=1&__toets=${encodeLaunchPayloadParam(payload)}`);
    expect(decodeLaunchPayload(discoverWebPayload())).toEqual(payload);
    history.replaceState(null, '', `/#/home?__toets=${encodeLaunchPayloadParam(payload)}`);
    expect(decodeLaunchPayload(discoverWebPayload())).toEqual(payload);
    (window as unknown as Record<string, unknown>).__TOETS__ = payload;
    expect(discoverWebPayload()).toBe(payload);
  });

  it('stays inert without a payload', () => {
    const before = window.fetch;
    const toets = startToets();
    expect(toets.status).toBe('inert');
    expect(window.fetch).toBe(before);
  });
});

describe('media element mapping', () => {
  const el = (props: Partial<HTMLMediaElement>) =>
    ({
      error: null,
      ended: false,
      paused: true,
      readyState: 4,
      networkState: 1,
      currentSrc: 'x.mp4',
      seeking: false,
      currentTime: 1,
      duration: 10,
      playbackRate: 1,
      getAttribute: () => null,
      ...props,
    }) as unknown as HTMLMediaElement;

  it.each([
    [{}, 'paused'],
    [{ paused: false }, 'playing'],
    [{ paused: false, readyState: 2 }, 'buffering'],
    [{ paused: false, readyState: 0 }, 'loading'],
    [{ readyState: 0, networkState: 2 }, 'loading'],
    [{ currentSrc: '', networkState: 0, readyState: 0 }, 'idle'],
    [{ ended: true }, 'ended'],
    [{ error: { code: 4, message: 'bad' } as MediaError }, 'error'],
  ] as const)('%o -> %s', (props, state) => {
    expect(mediaElementSnapshot(el(props)).state).toBe(state);
  });

  it('reports live streams with a null duration and the error message', () => {
    expect(mediaElementSnapshot(el({ duration: Infinity })).duration).toBeNull();
    expect(
      mediaElementSnapshot(el({ error: { code: 4, message: 'bad' } as MediaError })).error,
    ).toBe('MediaError 4: bad');
  });
});
