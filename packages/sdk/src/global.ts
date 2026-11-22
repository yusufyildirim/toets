import type { MediaReporter, MediaSnapshot, MediaSource } from './media.js';
import { Dpad, type DpadOptions } from './runtime.js';
import type { StateHandler } from './state.js';

/*
 * App-facing functions that work before (and without) an adapter starting the SDK. They
 * attach to the active runtime as soon as one exists and are inert otherwise, so app code
 * can call them unconditionally.
 */

let current: Dpad | null = null;

interface Binding<T> {
  readonly value: T;
  detach: (() => void) | null;
}

const stateHandlers: Array<Binding<StateHandler>> = [];
const mediaSources: Array<
  Binding<{ id: string; source: MediaSource; onAttach?: (d: Dpad) => void }>
> = [];

/**
 * Creates the runtime. With a valid payload it becomes the active runtime that
 * {@link markBusy}, {@link onState}, {@link registerMedia} and {@link focusChanged} use.
 * Adapters call this; apps normally call an adapter's `startDpad()` instead.
 */
export function createDpad(options: DpadOptions): Dpad {
  const dpad = new Dpad(options);
  if (!dpad.active) return dpad;
  if (current && current !== dpad) current.stop();
  current = dpad;
  for (const b of stateHandlers) {
    b.detach?.();
    b.detach = dpad.onState(b.value);
  }
  for (const b of mediaSources) {
    b.detach?.();
    b.detach = dpad.media.register(b.value.id, b.value.source);
    b.value.onAttach?.(dpad);
  }
  return dpad;
}

/** The active runtime, or `null` when the SDK is not running (no payload, production). */
export function getDpad(): Dpad | null {
  return current;
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
  let dpad: Dpad | null = null;
  const dispose = bindMedia(id, { getSnapshot: () => snapshot }, (d) => (dpad = d));
  return {
    update(patch) {
      snapshot = { ...snapshot, ...patch };
      dpad?.media.changed(id);
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

function bindMedia(id: string, source: MediaSource, onAttach?: (d: Dpad) => void): () => void {
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
