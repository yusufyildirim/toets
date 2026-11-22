import type { ReactNode } from 'react';
import { TVFocusGuideView, type StyleProp, type ViewStyle } from 'react-native';

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface FocusGroupProps {
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
  /** Directions in which focus never leaves the group. */
  readonly trap?: readonly Direction[];
  readonly children: ReactNode;
}

/**
 * A group that remembers focus: entering it from outside focuses the element that was focused
 * last time (the first focusable child on the first visit). Native: `TVFocusGuideView autoFocus`.
 */
export function FocusGroup({ trap = [], ...props }: FocusGroupProps) {
  return (
    <TVFocusGuideView
      autoFocus
      trapFocusUp={trap.includes('up')}
      trapFocusDown={trap.includes('down')}
      trapFocusLeft={trap.includes('left')}
      trapFocusRight={trap.includes('right')}
      {...props}
    />
  );
}
