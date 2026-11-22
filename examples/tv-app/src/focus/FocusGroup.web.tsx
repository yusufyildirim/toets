import { View, type ViewProps } from 'react-native';

import type { FocusGroupProps } from './FocusGroup';

/** react-native-web renders `dataSet` as `data-*` attributes; RN's types do not know it. */
const groupProps = { dataSet: { focusGroup: 'auto' } } as ViewProps;

/** Web: same contract as native, implemented by `spatialNavigation.web.ts` (`data-focus-group`). */
export function FocusGroup(props: FocusGroupProps) {
  return <View {...props} {...groupProps} />;
}
