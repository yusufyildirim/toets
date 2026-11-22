import { useEffect, useRef, type ComponentRef, type ReactNode } from 'react';
import {
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';

import { hideFocusRing } from './focusRing';
import { useFocusScope } from './FocusScope';
import { usePreferredFocus } from './usePreferredFocus';

export interface FocusableProps extends Omit<
  PressableProps,
  'style' | 'children' | 'testID' | 'focusable'
> {
  readonly testID: string;
  /** Identity inside the focus scope, used for initial focus and restoration. Defaults to `testID`. */
  readonly focusKey?: string;
  readonly style?:
    StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
  readonly children?: ReactNode | ((state: PressableStateCallbackType) => ReactNode);
}

/** A remote-focusable, pressable element that takes part in its screen's focus scope. */
export function Focusable({ testID, focusKey = testID, onFocus, style, ...props }: FocusableProps) {
  const scope = useFocusScope();
  const ref = useRef<ComponentRef<typeof View>>(null);
  const preferred = scope.active && scope.requestedKey === focusKey;
  const { register } = scope;
  useEffect(() => register(focusKey), [register, focusKey]);
  usePreferredFocus(ref, preferred);

  return (
    <Pressable
      {...props}
      ref={ref}
      testID={testID}
      focusable
      hasTVPreferredFocus={preferred}
      style={(state) => [hideFocusRing, typeof style === 'function' ? style(state) : style]}
      onFocus={(event) => {
        scope.onFocused(focusKey);
        onFocus?.(event);
      }}
    />
  );
}
