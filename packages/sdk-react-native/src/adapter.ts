import { RpcError, RpcErrorCode, type Viewport } from '@dpad-tv/protocol';
import { createDpad, sdkWarn, type Dpad, type DpadOptions } from '@dpad-tv/sdk';
import { startDpad as startWebDpad, type WebDpadOptions } from '@dpad-tv/sdk/web';
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

export interface ReactNativeDpadOptions extends Partial<Omit<DpadOptions, 'payload'>> {
  /**
   * Payload override. Default: `global.__DPAD__`, then the `-__dpad` launch argument (iOS,
   * tvOS), then the root component's `__dpad` initial prop (Android glue).
   */
  readonly payload?: unknown;
  /**
   * Install {@link DpadRoot} with `AppRegistry.setWrapperComponentProvider`. Default true.
   * Set false when the app registers its own wrapper provider, and render `withDpad(App)`.
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
  /** react-native-web only: options for the web adapter (`@dpad-tv/sdk/web`). */
  readonly web?: Omit<WebDpadOptions, keyof DpadOptions>;
}

let config: ReactNativeDpadOptions = {};
let started = false;
let lastPayload: unknown;
let runtime: Dpad | null = null;
let tracker = new FocusTracker();
const roots: DpadRoot[] = [];

/**
 * Starts the SDK in a React Native app. Call it first thing in the app entry file, before
 * `AppRegistry.registerComponent`. Inert (installs nothing) unless the app was launched by
 * dpad. On react-native-web it starts the web adapter.
 *
 * On Android the payload arrives with the root component's initial props, so the runtime
 * starts when {@link DpadRoot} first renders; read it with `getDpad()`.
 *
 * @example
 * import { startDpad } from '@dpad-tv/sdk-react-native';
 * startDpad();
 * AppRegistry.registerComponent('app', () => App);
 */
export function startDpad(options: ReactNativeDpadOptions = {}): void {
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
      AppRegistry.setWrapperComponentProvider(() => DpadRoot);
    } catch (error) {
      sdkWarn(`could not install the root wrapper: ${String(error)}; render withDpad(App)`);
    }
  }
}

/**
 * Tells dpad which view holds focus, for focus engines that do not move native focus (or
 * to correct it). Accepts a ref, a host instance, a native tag, or `null`.
 */
export function reportFocus(target: unknown): void {
  tracker.set(target);
}

export interface DpadRootProps {
  readonly children?: ReactNode;
  /** The app root's initial props; carries the Android launch payload (`__dpad`). */
  readonly initialProps?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Root wrapper that gives dpad the app's view tree and native focus events. Installed by
 * {@link startDpad} (default) or by {@link withDpad}. Renders only its children when the
 * SDK is not running.
 */
export class DpadRoot extends Component<DpadRootProps> {
  private readonly wrap: boolean;

  constructor(props: DpadRootProps) {
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
 * Wraps the app root component in {@link DpadRoot}. Use it when `startDpad({ wrapRoot:
 * false })` is needed (the app has its own wrapper provider) or without `startDpad()`.
 *
 * @example
 * AppRegistry.registerComponent('app', () => withDpad(App));
 */
export function withDpad<P extends object>(
  App: ComponentType<P>,
  options?: ReactNativeDpadOptions,
): ComponentType<P> {
  if (!started && options) config = options;
  const Wrapped = (props: P): ReactNode =>
    createElement(
      DpadRoot,
      { initialProps: props as Readonly<Record<string, unknown>> },
      createElement(App, props),
    );
  Wrapped.displayName = `withDpad(${App.displayName || App.name || 'App'})`;
  return Wrapped;
}

const ROOT_PROPS = {
  style: { flex: 1 },
  pointerEvents: 'box-none',
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
  if (runtime) return;
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
  const dpad = createDpad({
    ...coreOptions(opts),
    payload,
    framework: opts.framework ?? 'react-native',
    sdk: opts.sdk ?? SDK_ID,
    // React Native's fetch is built on XMLHttpRequest: tracking both would count twice.
    idle: { fetch: false, ...opts.idle },
  });
  if (!dpad.active) return;
  runtime = dpad;
  const focus = new FocusTracker();
  tracker = focus;
  const mapper = new FiberMapper({
    roots: mountedRoots,
    focused: () => focus.current,
    viewport,
    flattenStyle: (style) => StyleSheet.flatten(style as never),
    testIdProp: opts.testIdProp,
    isFocusable: opts.isFocusable,
  });
  dpad.handle('tree.get', (p) => {
    requireRoot();
    return mapper.tree(p.rootId);
  });
  dpad.handle('focus.get', async () => ({ node: roots.length ? await mapper.focused() : null }));
  dpad.handle('focus.graph', async (p) => {
    requireRoot();
    return { nodes: await mapper.graph(p.rootId) };
  });
  dpad.setFocusSource({ current: () => mapper.focusedId() });
  focus.onChange = () => dpad.focusChanged();
  if (opts.animated !== false) dpad.onStop(instrumentAnimated(dpad.idle, Animated));
  dpad.onStop(instrumentInteractionManager(dpad.idle, interactionManager));
  if (opts.logs !== false) dpad.onStop(trackUncaughtErrors(dpad));
  dpad.onStop(() => {
    focus.onChange = null;
  });
  dpad.start();
}

function startOnWeb(options: ReactNativeDpadOptions): void {
  const dpad = startWebDpad({
    testIdAttribute: 'data-testid',
    ...options.web,
    ...coreOptions(options),
    ...(options.payload !== undefined ? { payload: options.payload } : {}),
    framework: options.framework ?? 'react-native-web',
    sdk: options.sdk ?? SDK_ID,
  });
  if (dpad.active && options.animated !== false) {
    dpad.onStop(instrumentAnimated(dpad.idle, Animated));
  }
}

function coreOptions(o: ReactNativeDpadOptions): Partial<Omit<DpadOptions, 'payload'>> {
  const out: { -readonly [K in keyof DpadOptions]?: DpadOptions[K] } = {};
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
      'No DpadRoot is mounted: keep startDpad() wrapRoot enabled or render withDpad(App)',
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
