import { Platform, StyleSheet, Text, View } from 'react-native';

import { api } from '../api';
import { Screen } from '../components/Screen';
import { FocusGroup } from '../focus/FocusGroup';
import { Focusable } from '../focus/Focusable';
import { useSettings } from '../settings/SettingsContext';
import { CONTENT_INSET, colors, px } from '../theme';

const PLATFORM = Platform.OS === 'web' ? 'web' : Platform.OS === 'ios' ? 'tvos' : 'android-tv';

/** Settings: the autoplay toggle plus read-only diagnostics (API endpoint, mock routing, platform). */
export function SettingsScreen({ visible }: { visible: boolean }) {
  const { autoplay, setAutoplay } = useSettings();
  return (
    <Screen id="settings" testID="screen_settings" visible={visible}>
      <View style={styles.container}>
        <Text style={styles.heading}>Settings</Text>
        <FocusGroup style={styles.rows}>
          <Focusable
            testID="settings_autoplay"
            accessibilityRole="switch"
            aria-checked={autoplay}
            style={({ focused }) => [styles.row, focused && styles.rowFocused]}
            onPress={() => setAutoplay(!autoplay)}
          >
            {({ focused }) => (
              <>
                <View>
                  <Text style={[styles.label, focused && styles.textFocused]}>Autoplay</Text>
                  <Text style={[styles.hint, focused && styles.textFocused]}>
                    Start playback when the player opens
                  </Text>
                </View>
                <View style={[styles.pill, autoplay && styles.pillOn]}>
                  <Text testID="settings_autoplay_value" style={styles.pillText}>
                    {autoplay ? 'On' : 'Off'}
                  </Text>
                </View>
              </>
            )}
          </Focusable>
        </FocusGroup>
        <View style={styles.info}>
          <Text style={styles.infoHeading}>About</Text>
          <InfoRow testID="settings_api_url" label="API" value={api.route.baseUrl} />
          <InfoRow
            testID="settings_mock"
            label="Mock server"
            value={api.route.mocked ? 'On' : 'Off'}
          />
          <InfoRow testID="settings_platform" label="Platform" value={PLATFORM} />
        </View>
      </View>
    </Screen>
  );
}

function InfoRow({ testID, label, value }: { testID: string; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text testID={testID} style={styles.infoValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: CONTENT_INSET, paddingTop: px(96) },
  heading: { color: colors.text, fontSize: px(64), fontWeight: '800', marginBottom: px(48) },
  rows: { maxWidth: px(1100) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: px(28),
    paddingHorizontal: px(36),
    borderRadius: px(16),
    backgroundColor: colors.surface,
    borderWidth: px(4),
    borderColor: 'transparent',
  },
  rowFocused: { backgroundColor: colors.focus, borderColor: colors.focus },
  label: { color: colors.text, fontSize: px(34), fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: px(24), marginTop: px(6) },
  textFocused: { color: colors.background },
  pill: {
    minWidth: px(110),
    alignItems: 'center',
    paddingVertical: px(10),
    borderRadius: px(999),
    backgroundColor: colors.surfaceRaised,
  },
  pillOn: { backgroundColor: colors.accent },
  pillText: { color: colors.text, fontSize: px(26), fontWeight: '700' },
  info: { marginTop: px(72), maxWidth: px(1100), gap: px(16) },
  infoHeading: {
    color: colors.textMuted,
    fontSize: px(26),
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  infoRow: { flexDirection: 'row', gap: px(24) },
  infoLabel: { color: colors.textMuted, fontSize: px(26), width: px(220) },
  infoValue: { color: colors.text, fontSize: px(26) },
});
