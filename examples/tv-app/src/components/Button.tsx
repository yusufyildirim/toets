import { StyleSheet, Text } from 'react-native';

import { Focusable, type FocusableProps } from '../focus/Focusable';
import { colors, px } from '../theme';

interface ButtonProps extends Omit<FocusableProps, 'children' | 'style'> {
  readonly label: string;
  readonly variant?: 'primary' | 'secondary';
}

export function Button({ label, variant = 'secondary', testID, ...props }: ButtonProps) {
  return (
    <Focusable
      {...props}
      testID={testID}
      accessibilityRole="button"
      style={({ focused }) => [
        styles.button,
        variant === 'primary' && styles.primary,
        focused && styles.focused,
      ]}
    >
      {({ focused }) => (
        <Text testID={`${testID}_label`} style={[styles.label, focused && styles.labelFocused]}>
          {label}
        </Text>
      )}
    </Focusable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: px(200),
    paddingHorizontal: px(40),
    paddingVertical: px(20),
    borderRadius: px(12),
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    borderWidth: px(4),
    borderColor: 'transparent',
  },
  primary: { backgroundColor: colors.accent },
  focused: {
    backgroundColor: colors.focus,
    borderColor: colors.focus,
    transform: [{ scale: 1.06 }],
  },
  label: { color: colors.text, fontSize: px(30), fontWeight: '600' },
  labelFocused: { color: colors.background },
});
