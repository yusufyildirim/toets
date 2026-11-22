import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, px } from '../theme';
import { Button } from './Button';

/** Loading spinner (`<prefix>_loading`, aria-busy) or error with retry (`<prefix>_error`, `<prefix>_retry`). */
export function StatusView({
  prefix,
  error,
  onRetry,
}: {
  prefix: string;
  error?: Error;
  onRetry?: () => void;
}) {
  if (!error) {
    return (
      <View testID={`${prefix}_loading`} aria-busy style={styles.container}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  return (
    <View testID={`${prefix}_error`} style={styles.container}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text testID={`${prefix}_error_message`} style={styles.message}>
        {error.message}
      </Text>
      {onRetry ? (
        <Button testID={`${prefix}_retry`} label="Try again" variant="primary" onPress={onRetry} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: px(24),
    padding: px(64),
  },
  title: { color: colors.text, fontSize: px(44), fontWeight: '700' },
  message: { color: colors.textMuted, fontSize: px(28), textAlign: 'center', maxWidth: px(1000) },
});
