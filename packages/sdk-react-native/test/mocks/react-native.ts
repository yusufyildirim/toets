/**
 * Minimal `react-native` stand-in for unit tests (aliased in vitest.config.ts). Views are
 * host components rendered by the fake Fabric renderer in `test/renderer.ts`.
 */
import { createElement, type ComponentType, type ReactNode } from 'react';

export const Platform = {
  OS: 'android' as string,
  isTV: true,
  select<T>(options: Record<string, T>): T | undefined {
    return options[Platform.OS] ?? options.default;
  },
};

/** iOS `Settings`: NSUserDefaults, including launch arguments. */
export const Settings = {
  values: {} as Record<string, unknown>,
  get(key: string): unknown {
    return Settings.values[key];
  },
};

export const AppRegistry = {
  provider: null as null | (() => ComponentType<never>),
  setWrapperComponentProvider(provider: () => ComponentType<never>): void {
    AppRegistry.provider = provider;
  },
};

export const Dimensions = {
  window: { width: 1920, height: 1080, scale: 2, fontScale: 1 },
  get(_dim: 'window' | 'screen') {
    return Dimensions.window;
  },
};

type Style = Record<string, unknown> | null | undefined | false | readonly Style[];

export const StyleSheet = {
  flatten(style: Style): Record<string, unknown> {
    if (!style) return {};
    if (Array.isArray(style)) {
      const out: Record<string, unknown> = {};
      for (const s of style as readonly Style[]) Object.assign(out, StyleSheet.flatten(s));
      return out;
    }
    return { ...(style as Record<string, unknown>) };
  },
};

export const View = 'RCTView';

/** react-native-tvos `TVFocusGuideView`: a View marked `isTVSelectable` when it auto-focuses. */
export function TVFocusGuideView({
  autoFocus,
  ...props
}: {
  autoFocus?: boolean;
  children?: ReactNode;
  [prop: string]: unknown;
}): ReactNode {
  return createElement(FocusGuideInner, { ...props, autoFocus, isTVSelectable: !!autoFocus });
}

/** The function component between the guide and its host view, as `View` is in React Native. */
function FocusGuideInner(props: Record<string, unknown>): ReactNode {
  return createElement('RCTView', props);
}
export const Text = 'RCTText';
export const TextInput = 'AndroidTextInput';

type EndCallback = (result: { finished: boolean }) => void;

interface Composite {
  start(callback?: EndCallback, isLooping?: boolean): void;
  stop(): void;
}

function timed(durationMs: number): Composite {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let end: EndCallback | undefined;
  return {
    start(callback) {
      end = callback;
      timer = setTimeout(() => end?.({ finished: true }), durationMs);
    },
    stop() {
      clearTimeout(timer);
      end?.({ finished: false });
    },
  };
}

export const Animated = {
  timing: (_value: unknown, config: { duration?: number }): Composite =>
    timed(config.duration ?? 500),
  spring: (_value: unknown, _config: unknown): Composite => timed(300),
  decay: (_value: unknown, _config: unknown): Composite => timed(300),
  /** Like React Native's: restarts the inner animation with `isLooping` for infinite loops. */
  loop(animation: Composite): Composite {
    let stopped = false;
    return {
      start(callback) {
        const restart = (result: { finished: boolean } = { finished: true }): void => {
          if (stopped || !result.finished) callback?.(result);
          else animation.start(restart, true);
        };
        restart();
      },
      stop() {
        stopped = true;
        animation.stop();
      },
    };
  },
};
