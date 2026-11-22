import type { ComponentRef, RefObject } from 'react';
import type { View } from 'react-native';

type ViewRef = ComponentRef<typeof View>;

/** Native: `hasTVPreferredFocus` (set by `Focusable`) moves focus, nothing to do here. */
export function usePreferredFocus(_ref: RefObject<ViewRef | null>, _preferred: boolean): void {}
