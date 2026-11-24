import { RpcError, RpcErrorCode, type Viewport } from '@toets/protocol';
import { createToets, sdkWarn, type Toets, type ToetsOptions } from '@toets/sdk';
import { startToets as startWebToets, type WebToetsOptions } from '@toets/sdk/web';
import { Component, createElement, type ComponentType, type ReactNode } from 'react';
import * as ReactNative from 'react-native';
import { Animated, AppRegistry, Dimensions, Platform, StyleSheet, View } from 'react-native';
import pkg from '../package.json' with { type: 'json' };
import { FiberMapper, hostRootOf, type Fiber, type HostProps } from './fiber.js';
import { FocusTracker } from './focus.js';
import { instrumentAnimated, instrumentInteractionManager } from './idle.js';
import { discoverNativePayload, payloadFromInitialProps } from './payload.js';
import { trackUncaughtErrors } from './uncaught.js';

/** `name@version` of this package, announced in the handshake. */
export const SDK_ID = `${pkg.name}@${pkg.version}`;

export interface ReactNativeToetsOptions extends Partial<Omit<ToetsOptions, 'payload'>> {
  /**
   * Payload override. Default: `global.__TOETS__`, then the `-__toets` launch argument (iOS,
   * tvOS), then the root component's `__toets` initial prop (Android glue).
   */
  readonly payload?: unknown;
  /**
   * Install {@link ToetsRoot} with `AppRegistry.setWrapperComponentProvider`. Default true.
   * Set false when the app registers its own wrapper provider, and render `withToets(App)`.
   */
  readonly wrapRoot?: boolean;
  /** Prop holding test ids. Default `testID`. */
  readonly testIdProp?: string;
  /** Overrides focusability of host views; return `undefined` to keep the default. */
  readonly isFocusable?: (props: HostProps, type: string) => boolean | undefined;
  /**
   * Track focus from native focus/blur events. Default true. Set false for JS focus engines
   * that never move native focus, and call {@link reportFocus} instead.
   */
  readonly nativeFocus?: boolean;
  /** Track `Animated` animations for idle. Default true. */
  readonly animated?: boolean;
  /** react-native-web only: options for the web adapter (`@toets/sdk/web`). */
  readonly web?: Omit<WebToetsOptions, keyof ToetsOptions>;
}

let config: ReactNativeToetsOptions = {};
let started = false;
let lastPayload: unknown;
let runtime: Toets | null = null;
let tracker = new FocusTracker();
const roots: ToetsRoot[] = [];

/**
 * Starts the SDK in a React Native app. Call it first thing in the app entry file, before
 * `AppRegistry.registerComponent`. Inert (installs nothing) unless the app was launched by
 * toets. On react-native-web it starts the web adapter.
 *
 * On Android the payload arrives with the root component's initial props, so the runtime
 * starts when {@link ToetsRoot} first renders; read it with `getToets()`.
 *
 * @example
 * import { startToets } from '@toets/sdk-react-native';
 * startToets();
 * AppRegistry.registerComponent('app', () => App);
 */
export function startToets(options: ReactNativeToetsOptions = {}): void {
  if (Platform.OS === 'web') {
    startOnWeb(options);
    return;
  }
  config = options;
  started = true;
  const payload = options.payload !== undefined ? options.payload : discoverNativePayload();
  if (payload !== undefined) activate(payload);
  const mayActivateLater = Platform.OS === 'android' && runtime === null;
  if (options.wrapRoot !== false && (isActive() || mayActivateLater)) {
    try {
      AppRegistry.setWrapperComponentProvider(() => ToetsRoot);
    } catch (error) {
      sdkWarn(`could not install the root wrapper: ${String(error)}; render withToets(App)`);
    }
  }
}

/**
 * Tells toets which view holds focus, for focus engines that do not move native focus (or
 * to correct it). Accepts a ref, a host instance, a native tag, or `null`.
 */
export function reportFocus(target: unknown): void {
  tracker.set(target);
}

export interface ToetsRootProps {
  readonly children?: ReactNode;
  /** The app root's initial props; carries the Android launch payload (`__toets`). */
  readonly initialProps?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Root wrapper that gives toets the app's view tree and native focus events. Installed by
 * {@link startToets} (default) or by {@link withToets}. Renders only its children when the
 * SDK is not running.
 */
export class ToetsRoot extends Component<ToetsRootProps> {
  private readonly wrap: boolean;

  constructor(props: ToetsRootProps) {
    super(props);
    activateFromRoot(props.initialProps);
    this.wrap = isActive() && config.nativeFocus !== false;
  }

  override componentDidMount(): void {
    if (roots.indexOf(this) < 0) roots.push(this);
  }

  override componentWillUnmount(): void {
    const i = roots.indexOf(this);
    if (i >= 0) roots.splice(i, 1);
  }

  override render(): ReactNode {
    const children = this.props.children ?? null;
    if (!this.wrap) return children;
    return createElement(View as ComponentType<Record<string, unknown>>, ROOT_PROPS, children);
  }
}

/**
 * Wraps the app root component in {@link ToetsRoot}. Use it when `startToets({ wrapRoot:
 * false })` is needed (the app has its own wrapper provider) or without `startToets()`.
 *
 * @example
 * AppRegistry.registerComponent('app', () => withToets(App));
 */
export function withToets<P extends object>(
  App: ComponentType<P>,
  options?: ReactNativeToetsOptions,
): ComponentType<P> {
  if (!started && options) config = options;
  const Wrapped = (props: P): ReactNode =>
    createElement(
      ToetsRoot,
      { initialProps: props as Readonly<Record<string, unknown>> },
      createElement(App, props),
    );
  Wrapped.displayName = `withToets(${App.displayName || App.name || 'App'})`;
  return Wrapped;
}

const ROOT_PROPS = {
  style: { flex: 1, pointerEvents: 'box-none' },
  // Focus and blur bubble in React Native's event system: one capture listener at the root
  // sees every native focus change on Android and tvOS.
  onFocusCapture: (event: unknown) => tracker.focus(eventTarget(event)),
  onBlurCapture: (event: unknown) => tracker.blur(eventTarget(event)),
};

function eventTarget(event: unknown): unknown {
  if (typeof event !== 'object' || event === null) return null;
  const e = event as { target?: unknown; nativeEvent?: { target?: unknown } };
  return e.target ?? (e.nativeEvent ? e.nativeEvent.target : null);
}

function isActive(): boolean {
  return runtime !== null && runtime.active;
}

function activateFromRoot(initialProps: unknown): void {
  // react-native-web: the web adapter owns the session (started by startToets()).
  if (runtime || Platform.OS === 'web') return;
  const fromProps = payloadFromInitialProps(initialProps);
  if (fromProps !== undefined) {
    if (fromProps !== lastPayload) activate(fromProps);
    return;
  }
  if (!started) {
    started = true;
    const payload = discoverNativePayload();
    if (payload !== undefined) activate(payload);
  }
}

function activate(payload: unknown): void {
  lastPayload = payload;
  const opts = config;
  const toets = createToets({
    ...coreOptions(opts),
    payload,
    framework: opts.framework ?? 'react-native',
    sdk: opts.sdk ?? SDK_ID,
    // React Native's fetch is built on XMLHttpRequest: tracking both would count twice.
    idle: { fetch: false, ...opts.idle },
  });
  if (!toets.active) return;
  runtime = toets;
  const focus = new FocusTracker();
  tracker = focus;
  const mapper = new FiberMapper({
    roots: mountedRoots,
    focused: () => focus.current,
    viewport,
    flattenStyle: (style) => StyleSheet.flatten(style as never),
    testIdProp: opts.testIdProp,
    isFocusable: opts.isFocusable,
    // react-native-tvos only; plain React Native has no focus guides.
    focusGuides: [(ReactNative as unknown as Record<string, unknown>).TVFocusGuideView].filter(
      Boolean,
    ),
  });
  toets.handle('tree.get', (p) => {
    requireRoot();
    return mapper.tree(p.rootId);
  });
  toets.handle('focus.get', async () => ({ node: roots.length ? await mapper.focused() : null }));
  toets.handle('focus.graph', async (p) => {
    requireRoot();
    return { nodes: await mapper.graph(p.rootId) };
  });
  toets.setFocusSource({ current: () => mapper.focusedId() });
  focus.onChange = () => toets.focusChanged();
  if (opts.animated !== false) toets.onStop(instrumentAnimated(toets.idle, Animated));
  toets.onStop(instrumentInteractionManager(toets.idle, interactionManager));
  if (opts.logs !== false) toets.onStop(trackUncaughtErrors(toets));
  toets.onStop(() => {
    focus.onChange = null;
  });
  toets.start();
}

function startOnWeb(options: ReactNativeToetsOptions): void {
  const toets = startWebToets({
    testIdAttribute: 'data-testid',
    ...options.web,
    ...coreOptions(options),
    ...(options.payload !== undefined ? { payload: options.payload } : {}),
    framework: options.framework ?? 'react-native-web',
    sdk: options.sdk ?? SDK_ID,
  });
  if (toets.active && options.animated !== false) {
    toets.onStop(instrumentAnimated(toets.idle, Animated));
  }
}

function coreOptions(o: ReactNativeToetsOptions): Partial<Omit<ToetsOptions, 'payload'>> {
  const out: { -readonly [K in keyof ToetsOptions]?: ToetsOptions[K] } = {};
  if (o.idle !== undefined) out.idle = o.idle;
  if (o.logs !== undefined) out.logs = o.logs;
  if (o.allowRemoteHost !== undefined) out.allowRemoteHost = o.allowRemoteHost;
  if (o.WebSocket !== undefined) out.WebSocket = o.WebSocket;
  if (o.connectRetries !== undefined) out.connectRetries = o.connectRetries;
  return out;
}

function mountedRoots(): Fiber[] {
  const out: Fiber[] = [];
  for (const root of roots) {
    const fiber = hostRootOf(root);
    if (fiber && out.indexOf(fiber) < 0) out.push(fiber);
  }
  return out;
}

function requireRoot(): void {
  if (roots.length === 0) {
    throw new RpcError(
      RpcErrorCode.HandlerFailed,
      'No ToetsRoot is mounted: keep startToets() wrapRoot enabled or render withToets(App)',
    );
  }
}

function viewport(): Viewport {
  const w = Dimensions.get('window');
  const width = w && w.width > 0 ? w.width : 1;
  const height = w && w.height > 0 ? w.height : 1;
  return w && w.scale > 0 ? { width, height, pixelRatio: w.scale } : { width, height };
}

// Removed in recent React Native versions, where the export throws in development builds.
function interactionManager(): unknown {
  return (ReactNative as unknown as Record<string, unknown>).InteractionManager;
}
