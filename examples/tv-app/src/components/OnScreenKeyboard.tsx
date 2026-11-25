import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FocusGroup } from '../focus/FocusGroup';
import { Focusable } from '../focus/Focusable';
import { FocusScope } from '../focus/FocusScope';
import { useBackKey } from '../remote/useBackKey';
import { colors, px } from '../theme';

type Layer = 'lower' | 'upper' | 'symbols';

const LETTERS = ['abcdefg', 'hijklmn', 'opqrstu', "vwxyz-'"];
const SYMBOLS = ['1234567', '890.@_!', '?&#:/()'];

const LAYERS: Readonly<Record<Layer, readonly string[]>> = {
  lower: LETTERS,
  upper: LETTERS.map((row) => row.toUpperCase()),
  symbols: SYMBOLS,
};

interface OnScreenKeyboardProps {
  /** Focus scope id. */
  readonly id: string;
  readonly onKey: (char: string) => void;
  readonly onDelete: () => void;
  readonly onClear: () => void;
  readonly onSubmit: () => void;
  /** BACK closes the keyboard. */
  readonly onClose: () => void;
}

/**
 * An app-drawn keyboard, as most TV apps have: a grid of keys moved through with the D-pad and
 * typed with SELECT. Layers: lower case, upper case (Shift, reverts after one letter) and
 * symbols (`?123`, back with `ABC`). Keys keep their position across layers, so focus stays put
 * when the layer changes. Takes focus when it opens.
 */
export function OnScreenKeyboard({
  id,
  onKey,
  onDelete,
  onClear,
  onSubmit,
  onClose,
}: OnScreenKeyboardProps) {
  const [layer, setLayer] = useState<Layer>('lower');
  useBackKey(onClose, true);
  const rows = LAYERS[layer];

  const type = (char: string) => {
    onKey(char);
    if (layer === 'upper') setLayer('lower');
  };

  return (
    <FocusScope id={id} active initialFocusKey="osk_key_0_0">
      <FocusGroup testID="osk" style={styles.keyboard} trap={['up', 'down', 'left', 'right']}>
        {rows.map((row, r) => (
          <View key={r} style={styles.row}>
            {[...row].map((char, c) => (
              <Key key={c} testID={`osk_key_${r}_${c}`} label={char} onPress={() => type(char)} />
            ))}
          </View>
        ))}
        <View style={styles.row}>
          {layer !== 'symbols' && (
            <Key
              testID="osk_shift"
              label="Shift"
              wide
              selected={layer === 'upper'}
              onPress={() => setLayer(layer === 'upper' ? 'lower' : 'upper')}
            />
          )}
          <Key
            testID="osk_symbols"
            label={layer === 'symbols' ? 'ABC' : '?123'}
            wide
            onPress={() => setLayer(layer === 'symbols' ? 'lower' : 'symbols')}
          />
          <Key testID="osk_space" label="space" wide onPress={() => onKey(' ')} />
          <Key testID="osk_del" label="del" wide onPress={onDelete} />
          <Key testID="osk_clear" label="clear" wide onPress={onClear} />
          <Key testID="osk_go" label="Go" wide onPress={onSubmit} />
        </View>
      </FocusGroup>
    </FocusScope>
  );
}

function Key({
  testID,
  label,
  wide,
  selected,
  onPress,
}: {
  testID: string;
  label: string;
  wide?: boolean;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Focusable
      testID={testID}
      accessibilityRole="button"
      aria-selected={selected}
      style={({ focused }) => [
        styles.key,
        wide && styles.wide,
        selected && styles.selected,
        focused && styles.focused,
      ]}
      onPress={onPress}
    >
      {({ focused }) => <Text style={[styles.label, focused && styles.labelFocused]}>{label}</Text>}
    </Focusable>
  );
}

const styles = StyleSheet.create({
  keyboard: {
    gap: px(10),
    padding: px(20),
    borderRadius: px(16),
    backgroundColor: colors.surface,
    alignSelf: 'flex-start',
  },
  row: { flexDirection: 'row', gap: px(10) },
  key: {
    width: px(72),
    height: px(64),
    borderRadius: px(10),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  wide: { width: px(86) },
  selected: { backgroundColor: colors.accent },
  focused: { backgroundColor: colors.focus },
  label: { color: colors.text, fontSize: px(28), fontWeight: '600' },
  labelFocused: { color: colors.background },
});
