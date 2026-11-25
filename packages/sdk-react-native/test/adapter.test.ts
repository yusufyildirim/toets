import type { ProtocolNode } from '@toets/protocol';
import { Activity, createElement as h, createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, eventually, launch, load, onCleanup, sleep, type Adapter } from './helpers.js';
import { fire, rectOf, render, setInstanceMode, type FakeInstance } from './renderer.js';

afterEach(async () => {
  setInstanceMode('fabric');
  delete (globalThis as Record<string, unknown>).nativeFabricUIManager;
  delete (globalThis as Record<string, unknown>).ErrorUtils;
  await cleanup();
});

function flatten(root: ProtocolNode): ProtocolNode[] {
  const out: ProtocolNode[] = [];
  const visit = (n: ProtocolNode): void => {
    out.push(n);
    n.children.forEach(visit);
  };
  visit(root);
  return out;
}

function byTestId(root: ProtocolNode, testId: string): ProtocolNode {
  const node = flatten(root).find((n) => n.testId === testId);
  if (!node) throw new Error(`no node ${testId}`);
  return node;
}

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
});

function Screen(props: { extra?: ReactNode; hideB?: boolean }): ReactNode {
  return h(
    'RCTView',
    { style: box(0, 0, 1920, 1080) },
    h(
      'RCTView',
      {
        testID: 'card-a',
        focusable: true,
        accessibilityRole: 'button',
        accessibilityLabel: 'Card A',
        style: box(100, 50, 300, 200),
      },
      h('RCTText', { style: box(10, 10, 280, 40) }, 'Hello ', h('RCTVirtualText', null, 'world')),
    ),
    h('RCTView', {
      testID: 'card-b',
      isTVSelectable: true,
      accessibilityState: { selected: true, disabled: true },
      style: [box(420, 50, 300, 200), props.hideB ? { opacity: 0 } : null],
    }),
    h(
      'RCTView',
      { style: { display: 'none' } },
      h('RCTView', { testID: 'hidden-child', style: box(0, 0, 10, 10) }),
    ),
    h('RCTView', { style: box(0, 300, 100, 100) }, h('RCTView', { style: box(0, 0, 50, 50) })),
    h('AndroidTextInput', {
      testID: 'search',
      text: 'tv shows',
      placeholder: 'Search',
      mostRecentEventCount: 0,
      style: box(0, 600, 400, 60),
    }),
    h('AndroidTextInput', {
      testID: 'password',
      text: 'secret',
      secureTextEntry: true,
      editable: false,
      mostRecentEventCount: 0,
      style: box(0, 700, 400, 60),
    }),
    h(Activity, { mode: 'hidden', children: h('RCTView', { testID: 'offscreen' }) }),
    props.extra,
  );
}

/** Mounts `app` under ToetsRoot the way the Android glue does (payload in initial props). */
async function mountAndroid(sdk: Adapter, app: ReactNode, extra = {}) {
  const l = await launch(extra);
  sdk.startToets();
  const rendered = render(h(sdk.ToetsRoot, { initialProps: { __toets: l.payload } }, app));
  onCleanup(() => {
    sdk.getToets()?.stop();
    rendered.unmount();
  });
  return { ...l, rendered, session: await l.session() };
}

describe('activation', () => {
  it('stays inert without a payload and renders children only', async () => {
    const { sdk, RN } = await load('android');
    sdk.startToets();
    expect(RN.AppRegistry.provider).not.toBeNull(); // Android: the payload may come with initial props
    const rendered = render(h(sdk.ToetsRoot, { initialProps: {} }, h(Screen)));
    onCleanup(() => rendered.unmount());
    expect(sdk.getToets()).toBeNull();
    expect(rendered.container.children[0]!.props.onFocusCapture).toBeUndefined();
  });

  it('exposes a black-box payload (mockUrl, no sdkUrl) from the root initial props', async () => {
    const { sdk } = await load('android');
    sdk.startToets();
    const payload = { v: 1 as const, mockUrl: 'http://localhost:9400' };
    const rendered = render(
      h(sdk.ToetsRoot, { initialProps: { __toets: JSON.stringify(payload) } }, h(Screen)),
    );
    onCleanup(() => rendered.unmount());
    expect(sdk.getToets()).toBeNull();
    expect(sdk.getLaunchPayload()).toEqual(payload);
  });

  it('installs nothing on iOS without launch arguments', async () => {
    const { sdk, RN } = await load('ios');
    sdk.startToets();
    expect(RN.AppRegistry.provider).toBeNull();
    expect(sdk.getToets()).toBeNull();
  });

  it('reads the tvOS launch argument through Settings', async () => {
    const { sdk, RN } = await load('ios');
    const l = await launch();
    RN.Settings.values.__toets = l.payload;
    sdk.startToets();
    onCleanup(() => sdk.getToets()?.stop());
    expect(RN.AppRegistry.provider?.()).toBe(sdk.ToetsRoot);
    const session = await l.session();
    expect(session.hello.framework).toBe('react-native');
    expect(session.hello.sdk).toMatch(/^@toets\/sdk-react-native@\d+\.\d+\.\d+/);
    expect([...session.domains].sort()).toEqual([
      'focus',
      'logs',
      'media',
      'state',
      'sync',
      'tree',
    ]);
  });

  it('reads the Android payload from the root initial props', async () => {
    const { sdk } = await load('android');
    const { session, rendered } = await mountAndroid(sdk, h(Screen));
    await eventually(() => sdk.getToets()?.status === 'connected');
    expect(session.has('tree.get')).toBe(true);
    // The root wrapper listens for focus events.
    expect(typeof rendered.container.children[0]!.props.onFocusCapture).toBe('function');
  });

  it('reads global.__TOETS__ first', async () => {
    const { sdk } = await load('android');
    const l = await launch();
    (globalThis as Record<string, unknown>).__TOETS__ = l.payload;
    onCleanup(() => delete (globalThis as Record<string, unknown>).__TOETS__);
    sdk.startToets();
    onCleanup(() => sdk.getToets()?.stop());
    await l.session();
  });

  it('withToets wraps the root and passes initial props through', async () => {
    const { sdk } = await load('android');
    const l = await launch();
    const App = (props: { greeting: string }) => h('RCTText', { testID: 'g' }, props.greeting);
    const Wrapped = sdk.withToets(App);
    const rendered = render(h(Wrapped, { greeting: 'hi', __toets: l.payload } as never));
    onCleanup(() => {
      sdk.getToets()?.stop();
      rendered.unmount();
    });
    const session = await l.session();
    const { root } = await session.request('tree.get', {});
    expect(byTestId(root, 'g').text).toBe('hi');
  });

  it('refuses tree requests when no root is mounted', async () => {
    const { sdk } = await load('ios');
    const l = await launch();
    sdk.startToets({ payload: l.payload, wrapRoot: false });
    onCleanup(() => sdk.getToets()?.stop());
    const session = await l.session();
    await expect(session.request('tree.get', {})).rejects.toMatchObject({
      code: 'sdk.remote-error',
    });
    expect(await session.request('focus.get', {})).toEqual({ node: null });
  });

  it('starts the web adapter on react-native-web', async () => {
    const { sdk } = await load('web');
    const l = await launch();
    sdk.startToets({ payload: l.payload });
    onCleanup(() => sdk.getToets()?.stop());
    const session = await l.session();
    expect(session.hello.framework).toBe('react-native-web');
  });
  it('leaves react-native-web roots to the web adapter', async () => {
    const { sdk } = await load('web');
    const l = await launch();
    (globalThis as Record<string, unknown>).__TOETS__ = l.payload;
    onCleanup(() => delete (globalThis as Record<string, unknown>).__TOETS__);
    const Wrapped = sdk.withToets(() => h('RCTView', { testID: 'x' }));
    const rendered = render(h(Wrapped));
    onCleanup(() => rendered.unmount());
    expect(sdk.getToets()).toBeNull();
    expect(rendered.container.children[0]!.props.testID).toBe('x');
  });
});

describe('tree', () => {
  it('maps host views to protocol nodes', async () => {
    const { sdk } = await load();
    const { session } = await mountAndroid(sdk, h(Screen));
    const { root, viewport } = await session.request('tree.get', {});
    expect(viewport).toEqual({ width: 1920, height: 1080, pixelRatio: 2 });
    expect(root).toMatchObject({ id: 'root', bounds: { x: 0, y: 0, width: 1920, height: 1080 } });

    const a = byTestId(root, 'card-a');
    expect(a).toMatchObject({
      role: 'button',
      label: 'Card A',
      focusable: true,
      enabled: true,
      visible: true,
      bounds: { x: 100, y: 50, width: 300, height: 200 },
    });
    expect(a.children).toHaveLength(1);
    expect(a.children[0]).toMatchObject({ text: 'Hello world', children: [] });
    expect(a.children[0]!.bounds).toEqual({ x: 110, y: 60, width: 280, height: 40 });

    expect(byTestId(root, 'card-b')).toMatchObject({
      focusable: true,
      selected: true,
      enabled: false,
    });
    expect(byTestId(root, 'hidden-child').visible).toBe(false);
    expect(byTestId(root, 'search')).toMatchObject({
      text: 'tv shows',
      label: 'Search',
      focusable: true,
    });
    const password = byTestId(root, 'password');
    expect(password.text).toBeUndefined();
    expect(password).toMatchObject({ focusable: false, enabled: false });
    expect(flatten(root).some((n) => n.testId === 'offscreen')).toBe(false);
    // Structural wrappers are collapsed.
    const ids = flatten(root).map((n) => n.testId ?? n.text ?? n.id);
    expect(ids).toEqual([
      'root',
      'card-a',
      'Hello world',
      'card-b',
      'hidden-child',
      'search',
      'password',
    ]);
  });

  it('never reports a focus guide as focusable, only its children', async () => {
    const { sdk } = await load();
    const { TVFocusGuideView } = await import('react-native');
    const { session } = await mountAndroid(
      sdk,
      h(
        TVFocusGuideView,
        { autoFocus: true, testID: 'rail', style: box(0, 0, 400, 100) },
        h('RCTView', { testID: 'card', focusable: true, style: box(0, 0, 100, 100) }),
      ),
    );
    const { root } = await session.request('tree.get', {});
    expect(byTestId(root, 'rail').focusable).toBe(false);
    expect(byTestId(root, 'card').focusable).toBe(true);
  });

  it('treats opacity 0 as invisible and keeps ids stable across renders', async () => {
    const { sdk } = await load();
    const { session, rendered } = await mountAndroid(sdk, h(Screen));
    const before = (await session.request('tree.get', {})).root;
    rendered.update(h(sdk.ToetsRoot, null, h(Screen, { hideB: true })));
    const after = (await session.request('tree.get', {})).root;
    expect(byTestId(after, 'card-b').visible).toBe(false);
    expect(byTestId(after, 'card-a').id).toBe(byTestId(before, 'card-a').id);
    expect(byTestId(after, 'card-b').id).toBe(byTestId(before, 'card-b').id);
  });

  it('answers subtrees and NotFound', async () => {
    const { sdk } = await load();
    const { session } = await mountAndroid(sdk, h(Screen));
    const { root } = await session.request('tree.get', {});
    const a = byTestId(root, 'card-a');
    const sub = await session.request('tree.get', { rootId: a.id });
    expect(sub.root).toEqual(a);
    const hidden = byTestId(root, 'hidden-child');
    expect((await session.request('tree.get', { rootId: hidden.id })).root.visible).toBe(false);
    await expect(session.request('tree.get', { rootId: 'nope' })).rejects.toMatchObject({
      code: 'sdk.remote-error',
      rpcCode: -32005,
    });
  });

  it('measures through nativeFabricUIManager when no public instance exists yet', async () => {
    setInstanceMode('fabric-lazy');
    (globalThis as Record<string, unknown>).nativeFabricUIManager = {
      getBoundingClientRect(node: { instance: FakeInstance }, includeTransform: boolean) {
        expect(includeTransform).toBe(true);
        const r = rectOf(node.instance);
        return [r.x, r.y, r.width, r.height];
      },
    };
    const { sdk } = await load();
    const { session } = await mountAndroid(sdk, h(Screen));
    const { root } = await session.request('tree.get', {});
    expect(byTestId(root, 'card-a').bounds).toEqual({ x: 100, y: 50, width: 300, height: 200 });
  });

  it('measures old-architecture views asynchronously', async () => {
    setInstanceMode('paper');
    const { sdk } = await load();
    const { session } = await mountAndroid(sdk, h(Screen));
    const { root } = await session.request('tree.get', {});
    expect(byTestId(root, 'card-a').bounds).toEqual({ x: 100, y: 50, width: 300, height: 200 });
  });
});

describe('focus', () => {
  it('follows native focus events captured at the root', async () => {
    const { sdk } = await load();
    const { session, rendered } = await mountAndroid(sdk, h(Screen));
    const events: unknown[] = [];
    session.on('focus.changed', (e) => events.push(e));
    const { root } = await session.request('tree.get', {});
    const a = byTestId(root, 'card-a');
    const b = byTestId(root, 'card-b');

    fire('focus', rendered.byTestId('card-a'));
    await eventually(() => events.length === 1);
    expect(events[0]).toEqual({ from: null, to: a.id });
    const focused = (await session.request('focus.get', {})).node;
    expect(focused).toMatchObject({ id: a.id, testId: 'card-a', focused: true });
    expect(byTestId((await session.request('tree.get', {})).root, 'card-a').focused).toBe(true);

    // tvOS may deliver the new focus before the old blur.
    fire('focus', rendered.byTestId('card-b'));
    fire('blur', rendered.byTestId('card-a'));
    await eventually(() => events.length === 2);
    expect(events[1]).toEqual({ from: a.id, to: b.id });
    expect((await session.request('focus.get', {})).node?.id).toBe(b.id);

    fire('blur', rendered.byTestId('card-b'));
    await eventually(() => events.length === 3);
    expect(events[2]).toEqual({ from: b.id, to: null });
    expect((await session.request('focus.get', {})).node).toBeNull();
  });

  it('takes focus from reportFocus() only, once a JS focus engine reports it', async () => {
    const { sdk } = await load();
    const ref = createRef<object>();
    const app = h(Screen, {
      extra: h('RCTView', { ref, testID: 'virtual', style: box(0, 0, 5, 5) }),
    });
    // Reported before the Android runtime exists (it starts with the root): replayed.
    sdk.reportFocus(ref);
    const { session, rendered } = await mountAndroid(sdk, app);
    expect((await session.request('focus.get', {})).node?.testId).toBe('virtual');
    // Native focus events no longer count: one source of truth.
    fire('focus', rendered.byTestId('card-a'));
    expect((await session.request('focus.get', {})).node?.testId).toBe('virtual');
    sdk.reportFocus(null);
    expect((await session.request('focus.get', {})).node).toBeNull();
    sdk.reportFocus(rendered.byTestId('card-b').tag);
    expect((await session.request('focus.get', {})).node?.testId).toBe('card-b');
  });
});

describe('idle, logs and media', () => {
  it('tracks Animated animations but not infinite loops', async () => {
    const { sdk, RN } = await load();
    const { session } = await mountAndroid(sdk, h(Screen), {});
    RN.Animated.timing(0, { duration: 200 }).start();
    let result = await session.request('sync.waitForIdle', { timeoutMs: 50 });
    expect(result.idle).toBe(false);
    expect(result.busy).toContainEqual(
      expect.objectContaining({ kind: 'animation', description: 'Animated.timing 200ms' }),
    );
    expect((await session.request('sync.waitForIdle', { timeoutMs: 2000 })).idle).toBe(true);

    const loop = RN.Animated.loop(RN.Animated.timing(0, { duration: 100 }));
    loop.start();
    onCleanup(() => loop.stop());
    await sleep(250);
    result = await session.request('sync.waitForIdle', { timeoutMs: 50 });
    expect(result.busy.filter((b) => b.kind === 'animation')).toEqual([]);
  });

  it('restores Animated on stop', async () => {
    const { sdk, RN } = await load();
    const original = RN.Animated.timing;
    await mountAndroid(sdk, h(Screen));
    expect(RN.Animated.timing).not.toBe(original);
    sdk.getToets()?.stop();
    expect(RN.Animated.timing).toBe(original);
  });

  it('marks navigation transitions busy', async () => {
    const { sdk } = await load();
    const { session } = await mountAndroid(sdk, h(Screen));
    const listeners = sdk.navigationIdleListeners();
    listeners.transitionStart({ target: 'Details-1' });
    const busy = await session.request('sync.waitForIdle', { timeoutMs: 30 });
    expect(busy.busy).toContainEqual(
      expect.objectContaining({ kind: 'navigation', description: 'transition Details-1' }),
    );
    listeners.transitionEnd({ target: 'Details-1' });
    expect((await session.request('sync.waitForIdle', { timeoutMs: 1000 })).idle).toBe(true);
  });

  it('forwards uncaught errors and chains the previous handler', async () => {
    const seen: unknown[] = [];
    const previous = (error: unknown) => seen.push(error);
    const errorUtils = {
      handler: previous as (e: unknown, fatal?: boolean) => void,
      getGlobalHandler() {
        return errorUtils.handler;
      },
      setGlobalHandler(h: (e: unknown, fatal?: boolean) => void) {
        errorUtils.handler = h;
      },
    };
    (globalThis as Record<string, unknown>).ErrorUtils = errorUtils;
    const { sdk } = await load();
    const { session } = await mountAndroid(sdk, h(Screen));
    const logs: Array<{ message: string; kind?: string }> = [];
    session.on('logs.entry', (e) => logs.push(e));
    errorUtils.handler(new TypeError('boom'), true);
    await eventually(() => logs.some((l) => l.kind === 'uncaught'));
    expect(logs.find((l) => l.kind === 'uncaught')?.message).toBe('Fatal TypeError: boom');
    expect(seen).toHaveLength(1);
    sdk.getToets()?.stop();
    expect(errorUtils.handler).toBe(previous);
  });

  it('registers players through useToetsMedia', async () => {
    const { sdk } = await load();
    let media: ReturnType<Adapter['useToetsMedia']> | undefined;
    const Player = () => {
      media = sdk.useToetsMedia('main');
      return h('RCTView', { testID: 'player', style: box(0, 0, 1920, 1080) });
    };
    const { session, rendered } = await mountAndroid(sdk, h(Player));
    const changes: unknown[] = [];
    session.on('media.changed', (e) => changes.push(e));
    media!.onLoadStart();
    media!.onLoad({ duration: 60, currentTime: 0 });
    media!.onPlaybackStateChanged({ isPlaying: true });
    media!.onProgress({ currentTime: 12.5 });
    expect(await session.request('media.get', {})).toEqual({
      media: { id: 'main', state: 'playing', position: 12.5, duration: 60, rate: 1 },
    });
    await eventually(() => changes.length >= 3);
    rendered.update(h(sdk.ToetsRoot, null, null));
    expect(await session.request('media.list', {})).toEqual({ media: [] });
  });
});
