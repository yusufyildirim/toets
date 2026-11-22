import { View, type ViewProps } from 'react-native';

import type { FocusGroupProps } from './FocusGroup';

/**
 * Web: same contract as native, implemented by `spatialNavigation.web.ts` through
 * `data-focus-group` and `data-focus-trap` (react-native-web renders `dataSet` as `data-*`
 * attributes; RN's types do not know it).
 */
export function FocusGroup({ trap = [], ...props }: FocusGroupProps) {
  const dataSet = { focusGroup: 'auto', focusTrap: trap.join(' ') };
  return <View {...props} {...({ dataSet } as ViewProps)} />;
}
