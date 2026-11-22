import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { FocusScope } from '../focus/FocusScope';

interface ScreenProps {
  /** Focus scope id (see `FocusScope`). */
  readonly id: string;
  readonly testID: string;
  /** Hidden screens stay mounted (state, scroll, focus memory) but leave the UI tree. */
  readonly visible: boolean;
  readonly initialFocusKey?: string | undefined;
  readonly style?: StyleProp<ViewStyle>;
  readonly children: ReactNode;
}

export function Screen({ id, testID, visible, initialFocusKey, style, children }: ScreenProps) {
  return (
    <View testID={testID} style={[styles.screen, style, !visible && styles.hidden]}>
      <FocusScope id={id} active={visible} initialFocusKey={initialFocusKey}>
        {children}
      </FocusScope>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill },
  hidden: { display: 'none' },
});
