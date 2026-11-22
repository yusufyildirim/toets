import { StyleSheet, Text, View } from 'react-native';

import { FocusGroup } from '../focus/FocusGroup';
import { Focusable } from '../focus/Focusable';
import { FocusScope } from '../focus/FocusScope';
import { MENU_SCOPE, type Tab } from '../navigation/navigation';
import { useNavigation } from '../navigation/NavigationContext';
import { SIDE_MENU_WIDTH, colors, px } from '../theme';

const ITEMS: readonly { tab: Tab; label: string }[] = [
  { tab: 'home', label: 'Home' },
  { tab: 'settings', label: 'Settings' },
];

/** Persistent side menu; the active tab's item is `selected`. Focus memory: last focused item. */
export function SideMenu({ visible }: { visible: boolean }) {
  const { state, selectTab } = useNavigation();
  return (
    <FocusScope id={MENU_SCOPE} active={visible}>
      <View testID="side_menu" style={styles.menu}>
        <View style={styles.brand}>
          <Text style={styles.logo}>dpad</Text>
          <Text style={styles.tagline}>TV example</Text>
        </View>
        <FocusGroup style={styles.items} trap={['up', 'down']}>
          {ITEMS.map(({ tab, label }) => {
            const selected = state.tab === tab;
            return (
              <Focusable
                key={tab}
                testID={`menu_${tab}`}
                accessibilityRole="tab"
                aria-selected={selected}
                style={({ focused }) => [
                  styles.item,
                  selected && styles.selected,
                  focused && styles.focused,
                ]}
                onPress={() => selectTab(tab)}
              >
                {({ focused }) => (
                  <Text
                    style={[
                      styles.label,
                      selected && styles.labelSelected,
                      focused && styles.labelFocused,
                    ]}
                  >
                    {label}
                  </Text>
                )}
              </Focusable>
            );
          })}
        </FocusGroup>
      </View>
    </FocusScope>
  );
}

const styles = StyleSheet.create({
  menu: {
    width: SIDE_MENU_WIDTH,
    height: '100%',
    backgroundColor: colors.surface,
    paddingVertical: px(64),
    paddingHorizontal: px(28),
  },
  brand: { paddingHorizontal: px(20), marginBottom: px(64) },
  logo: { color: colors.text, fontSize: px(52), fontWeight: '800', letterSpacing: px(1) },
  tagline: { color: colors.textMuted, fontSize: px(22), marginTop: px(4) },
  // Fills the menu's height: the tvOS focus engine only enters a focus guide that overlaps the
  // focused card vertically, so a short group is unreachable with left from the lower rails.
  items: { flex: 1, gap: px(12) },
  item: {
    paddingVertical: px(18),
    paddingHorizontal: px(20),
    borderRadius: px(12),
    borderLeftWidth: px(6),
    borderLeftColor: 'transparent',
  },
  selected: { borderLeftColor: colors.accent, backgroundColor: colors.surfaceRaised },
  focused: { backgroundColor: colors.focus },
  label: { color: colors.textMuted, fontSize: px(30), fontWeight: '600' },
  labelSelected: { color: colors.text },
  labelFocused: { color: colors.background },
});
