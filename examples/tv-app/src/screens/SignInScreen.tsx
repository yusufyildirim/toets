import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { FocusGroup } from '../focus/FocusGroup';
import { CONTENT_INSET, colors, px } from '../theme';

/** The password the demo account accepts. */
const PASSWORD = 'tv-pass-1';

/**
 * Sign-in with the platform's native text inputs (system keyboard): email, then password, then
 * the sign-in button. The keyboard's action key on the email field moves to the password; on the
 * password it signs in.
 */
export function SignInScreen({ visible }: { visible: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  const signIn = () =>
    setStatus(password === PASSWORD ? `Signed in as ${email}` : 'Wrong email or password');

  return (
    <Screen id="signin" testID="screen_signin" visible={visible}>
      <View style={styles.container}>
        <Text style={styles.heading}>Sign in</Text>
        <FocusGroup style={styles.form}>
          <TextInput
            testID="signin_email"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <TextInput
            ref={passwordRef}
            testID="signin_password"
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={signIn}
          />
          <Button testID="signin_submit" label="Sign in" variant="primary" onPress={signIn} />
        </FocusGroup>
        <Text testID="signin_status" style={styles.status}>
          {status}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: CONTENT_INSET, paddingTop: px(96) },
  heading: { color: colors.text, fontSize: px(64), fontWeight: '800', marginBottom: px(48) },
  form: { width: px(720), gap: px(24), alignItems: 'flex-start' },
  input: {
    alignSelf: 'stretch',
    height: px(84),
    paddingHorizontal: px(28),
    borderRadius: px(12),
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: px(32),
  },
  status: { color: colors.text, fontSize: px(30), marginTop: px(40) },
});
