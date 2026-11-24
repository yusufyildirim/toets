import { decodeLaunchPayload, type LaunchPayload } from '@toets/protocol';
import type { MediaReporter, MediaSnapshot, MediaSource } from './media.js';
import { Toets, type ToetsOptions } from './runtime.js';
import type { StateHandler } from './state.js';

/*
 * App-facing functions that work before (and without) an adapter starting the SDK. They
 * attach to the active runtime as soon as one exists and are inert otherwise, so app code
 * can call them unconditionally.
 */

let current: Toets | null = null;
let launchPayload: LaunchPayload | null = null;

interface Binding<T> {
  readonly value: T;
  detach: (() => void) | null;
}

const stateHandlers: Array<Binding<StateHandler>> = [];
const mediaSources: Array<
  Binding<{ id: string; source: MediaSource; onAttach?: (d: Toets) => void }>
> = [];

/**
 * Creates the runtime. With a valid payload it becomes the active runtime that
 * {@link markBusy}, {@link onState}, {@link registerMedia} and {@link focusChanged} use.
 * Adapters call this; apps normally call an adapter's `startToets()` instead.
 */
export function createToets(options: ToetsOptions): Toets {
  const toets = new Toets(options);
  launchPayload = decodeLaunchPayload(options.payload) ?? launchPayload;
  if (!toets.active) return toets;
  if (current && current !== toets) current.stop();
  current = toets;
  for (const b of stateHandlers) {
    b.detach?.();
    b.detach = toets.onState(b.value);
  }
  for (const b of mediaSources) {
    b.detach?.();
    b.detach = toets.media.register(b.value.id, b.value.source);
    b.value.onAttach?.(toets);
  }
  return toets;
}

/** The active runtime, or `null` when the SDK is not running (no payload, production). */
export function getToets(): Toets | null {
  return current;
}

/**
 * The launch payload the app was started with (`mockUrl`, `state`, `flags`), or `null` for a
 * normal launch. Unlike {@link getToets} it is also set when toets runs without the SDK session
 * (black-box runs with network mocking: the payload has a `mockUrl` but no `sdkUrl`), so read
 * the mock server URL here. Available once an adapter looked for the payload (`startToets()`;
 * on React Native Android when the root first renders).
 *
 * @example
 * const apiBase = getLaunchPayload()?.mockUrl ?? 'https://api.example.com';
 */
export function getLaunchPayload(): LaunchPayload | null {
  return launchPayload;
}

/**
 * Marks the app busy until the returned function is called, e.g. while a native player or
 * WebGL scene loads. No-op when the SDK is not running.
 *
 * @example
 * const done = markBusy('hero image decode');
 * await decodeHero();
 * done();
 */
export function markBusy(description: string, kind = 'custom'): () => void {
  return current ? current.markBusy(description, kind) : noop;
}

/**
 * Registers the app's state handler: launch into a named state (payload `state`) and apply
 * `state.apply` requests. Inert when the SDK is not running.
 *
 * @example
 * onState(async (state, flags) => {
 *   if (state === 'logged-in') await session.loginAsTestUser();
 *   featureFlags.set(flags);
 * });
 */
export function onState(handler: StateHandler): () => void {
  const binding: Binding<StateHandler> = {
    value: handler,
    detach: current ? current.onState(handler) : null,
  };
  stateHandlers.push(binding);
  return () => {
    binding.detach?.();
    binding.detach = null;
    const i = stateHandlers.indexOf(binding);
    if (i >= 0) stateHandlers.splice(i, 1);
  };
}

/** Registers a media player read on demand (pull). Returns an unregister function. */
export function registerMedia(id: string, source: MediaSource): () => void {
  return bindMedia(id, source);
}

/**
 * Registers a media player that reports through events (push), e.g. from player callbacks.
 *
 * @example
 * const media = createMediaReporter('main');
 * player.on('playing', () => media.update({ state: 'playing' }));
 * player.on('timeupdate', (t) => media.update({ position: t }));
 */
export function createMediaReporter(
  id: string,
  initial: Partial<MediaSnapshot> = {},
): MediaReporter {
  let snapshot: MediaSnapshot = { state: 'idle', position: 0, duration: null, rate: 1, ...initial };
  let toets: Toets | null = null;
  const dispose = bindMedia(id, { getSnapshot: () => snapshot }, (d) => (toets = d));
  return {
    update(patch) {
      snapshot = { ...snapshot, ...patch };
      toets?.media.changed(id);
    },
    get snapshot() {
      return snapshot;
    },
    dispose,
  };
}

/** Tells the SDK that focus may have moved (custom focus engines without DOM/native focus). */
export function focusChanged(): void {
  current?.focusChanged();
}

function bindMedia(id: string, source: MediaSource, onAttach?: (d: Toets) => void): () => void {
  const value = onAttach ? { id, source, onAttach } : { id, source };
  const binding: Binding<typeof value> = { value, detach: null };
  if (current) {
    binding.detach = current.media.register(id, source);
    onAttach?.(current);
  }
  mediaSources.push(binding);
  return () => {
    binding.detach?.();
    binding.detach = null;
    const i = mediaSources.indexOf(binding);
    if (i >= 0) mediaSources.splice(i, 1);
  };
}

function noop(): void {}
