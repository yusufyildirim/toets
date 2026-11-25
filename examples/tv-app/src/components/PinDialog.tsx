import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FocusGroup } from '../focus/FocusGroup';
import { Focusable } from '../focus/Focusable';
import { FocusScope } from '../focus/FocusScope';
import { useBackKey } from '../remote/useBackKey';
import { colors, px } from '../theme';

const ROWS = ['123', '456', '789'];
const LENGTH = 4;

interface PinDialogProps {
  /** Checks a complete PIN; `false` keeps the dialog open with an error. */
  readonly onSubmit: (pin: string) => boolean;
  readonly onClose: () => void;
}

/** A PIN pad dialog: digits, delete and OK, the entered digits shown masked. BACK closes it. */
export function PinDialog({ onSubmit, onClose }: PinDialogProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  useBackKey(onClose, true);

  const add = (digit: string) => {
    setError(false);
    setPin((p) => (p.length < LENGTH ? p + digit : p));
  };
  const submit = () => {
    if (onSubmit(pin)) return;
    setError(true);
    setPin('');
  };

  return (
    <View testID="pin_dialog" style={styles.backdrop}>
      <FocusScope id="pin" active initialFocusKey="pin_key_1">
        <View style={styles.dialog}>
          <Text style={styles.title}>Enter PIN</Text>
          <Text testID="pin_value" style={styles.value}>
            {'•'.repeat(pin.length)}
          </Text>
          {error && (
            <Text testID="pin_error" style={styles.error}>
              Wrong PIN
            </Text>
          )}
          <FocusGroup testID="pin_pad" style={styles.pad} trap={['up', 'down', 'left', 'right']}>
            {ROWS.map((row) => (
              <View key={row} style={styles.row}>
                {[...row].map((d) => (
                  <PadKey key={d} testID={`pin_key_${d}`} label={d} onPress={() => add(d)} />
                ))}
              </View>
            ))}
            <View style={styles.row}>
              <PadKey testID="pin_del" label="del" onPress={() => setPin((p) => p.slice(0, -1))} />
              <PadKey testID="pin_key_0" label="0" onPress={() => add('0')} />
              <PadKey testID="pin_ok" label="OK" onPress={submit} />
            </View>
          </FocusGroup>
        </View>
      </FocusScope>
    </View>
  );
}

function PadKey({
  testID,
  label,
  onPress,
}: {
  testID: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Focusable
      testID={testID}
      accessibilityRole="button"
      style={({ focused }) => [styles.key, focused && styles.keyFocused]}
      onPress={onPress}
    >
      {({ focused }) => (
        <Text style={[styles.keyLabel, focused && styles.keyLabelFocused]}>{label}</Text>
      )}
    </Focusable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  dialog: {
    alignItems: 'center',
    gap: px(20),
    padding: px(40),
    borderRadius: px(20),
    backgroundColor: colors.surface,
  },
  title: { color: colors.text, fontSize: px(40), fontWeight: '800' },
  value: {
    color: colors.text,
    fontSize: px(48),
    letterSpacing: px(12),
    height: px(64),
    // Visible while empty.
    minWidth: px(240),
    textAlign: 'center',
  },
  error: { color: colors.danger, fontSize: px(26) },
  pad: { gap: px(12) },
  row: { flexDirection: 'row', gap: px(12) },
  key: {
    width: px(110),
    height: px(80),
    borderRadius: px(12),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  keyFocused: { backgroundColor: colors.focus },
  keyLabel: { color: colors.text, fontSize: px(32), fontWeight: '700' },
  keyLabelFocused: { color: colors.background },
});
