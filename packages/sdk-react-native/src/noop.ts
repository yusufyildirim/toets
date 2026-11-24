/**
 * Inert stand-in for `@toets/sdk-react-native` with the same app-facing API and no
 * dependency on React Native internals. Alias the SDK to this module in production builds:
 * see `docs/production.md`.
 */
import type { ComponentType, ReactNode } from 'react';
import type { NavigationIdleListeners } from './idle.js';
import type { VideoMediaProps } from './media.js';

export type * from './index.js';
export {
  createToets,
  getToets,
  getLaunchPayload,
  markBusy,
  onState,
  registerMedia,
  createMediaReporter,
  reportFocus,
} from '@toets/sdk/noop';

function noop(): void {}

export function startToets(_options?: unknown): void {}

export function ToetsRoot(props: { readonly children?: ReactNode }): ReactNode {
  return props.children ?? null;
}

export function withToets<P extends object>(App: ComponentType<P>, _options?: unknown) {
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

export function useToetsMedia(_id: string): VideoMediaProps {
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
