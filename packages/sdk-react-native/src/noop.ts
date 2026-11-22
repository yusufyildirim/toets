/**
 * Inert stand-in for `@dpad-tv/sdk-react-native` with the same app-facing API and no
 * dependency on React Native internals. Alias the SDK to this module in production builds:
 * see `docs/production.md`.
 */
import type { ComponentType, ReactNode } from 'react';
import type { NavigationIdleListeners } from './idle.js';
import type { VideoMediaProps } from './media.js';

export type * from './index.js';
export {
  createDpad,
  getDpad,
  markBusy,
  onState,
  registerMedia,
  createMediaReporter,
  focusChanged,
} from '@dpad-tv/sdk/noop';

function noop(): void {}

export function startDpad(_options?: unknown): void {}

export function reportFocus(_target: unknown): void {}

export function DpadRoot(props: { readonly children?: ReactNode }): ReactNode {
  return props.children ?? null;
}

export function withDpad<P extends object>(App: ComponentType<P>, _options?: unknown) {
  return App;
}

const videoProps: VideoMediaProps = {
  onLoadStart: noop,
  onLoad: noop,
  onProgress: noop,
  onBuffer: noop,
  onPlaybackStateChanged: noop,
  onPlaybackRateChange: noop,
  onSeek: noop,
  onEnd: noop,
  onError: noop,
};

export function useDpadMedia(_id: string): VideoMediaProps {
  return videoProps;
}

export function videoMediaProps(_reporter: unknown): VideoMediaProps {
  return videoProps;
}

export function navigationIdleListeners(): NavigationIdleListeners {
  return { transitionStart: noop, transitionEnd: noop };
}

export function discoverNativePayload(): unknown {
  return undefined;
}

export function payloadFromInitialProps(_initialProps: unknown): unknown {
  return undefined;
}
