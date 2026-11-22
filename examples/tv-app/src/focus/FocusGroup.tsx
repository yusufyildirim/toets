import type { ReactNode } from 'react';
import { TVFocusGuideView, type StyleProp, type ViewStyle } from 'react-native';

export interface FocusGroupProps {
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly children: ReactNode;
}

/**
 * A group that remembers focus: entering it from outside focuses the element that was focused
 * last time (the first focusable child on the first visit). Native: `TVFocusGuideView autoFocus`.
 */
export function FocusGroup(props: FocusGroupProps) {
  return <TVFocusGuideView autoFocus {...props} />;
}
