import { useEffect, type ComponentRef, type RefObject } from 'react';
import type { View } from 'react-native';

type ViewRef = ComponentRef<typeof View>;

/** Web: browsers ignore `hasTVPreferredFocus`, so focus the element imperatively. */
export function usePreferredFocus(ref: RefObject<ViewRef | null>, preferred: boolean): void {
  useEffect(() => {
    if (preferred) (ref.current as unknown as HTMLElement | null)?.focus();
  }, [ref, preferred]);
}
