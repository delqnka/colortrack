import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  saveSessionToken,
  apiLogin,
  apiRegister,
  apiLoginWithApple,
  flushOutbox,
  getApiBaseUrl,
} from '../api/client';
import { registerExpoPushIfPossible } from '../push/registerPush';
import { FontFamily } from '../theme/fonts';
import { typeLh } from '../theme/typography';
import * as AppleAuthentication from 'expo-apple-authentication';
import { setOnboardingComplete } from '../onboarding/storage';

const VIOLET = '#5E35B1';
const VIOLET_LIGHT = '#7C4DFF';

export default function LoginScreen({ onLoggedIn }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const isSignUp = mode === 'signup';

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (Platform.OS !== 'ios') return;
      try {
        const ok = await AppleAuthentication.isAvailableAsync();
        if (!cancelled) setAppleAvailable(Boolean(ok));
      } catch {
        if (!cancelled) setAppleAvailable(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function mapErr(message) {
    const m = String(message || '').toLowerCase();
    if (m === 'conflict') return 'This email is already registered.';
    if (m === 'unauthorized') return 'Invalid email or password.';
    if (m === 'forbidden') return 'Registration is disabled.';
    if (m === 'bad_request') return isSignUp
      ? 'Enter a valid email and password (min. 8 characters).'
      : 'Enter your email and password.';
    if (m.includes('network request failed') || m.includes('failed to fetch'))
      return `Cannot connect to server (${getApiBaseUrl()}).`;
    return message || 'Something went wrong';
  }

  async function submit() {
    setErr('');
    const em = String(email).trim();
    const pw = String(password);
    if (isSignUp && pw !== String(confirm)) {
      setErr('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const data = isSignUp ? await apiRegister(em, pw) : await apiLogin(em, pw);
      await saveSessionToken(data.token);
      await flushOutbox();
      await registerExpoPushIfPossible();
      await setOnboardingComplete();
      onLoggedIn?.();
    } catch (e) {
      setErr(mapErr(e.message));
    } finally {
      setBusy(false);
    }
  }

  async function signInApple() {
    setErr('');
    setBusy(true);
    try {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!cred.identityToken) { setErr('Apple Sign-In failed.'); return; }
      const data = await apiLoginWithApple({
        identity_token: cred.identityToken,
        email: cred.email || undefined,
      });
      await saveSessionToken(data.token);
      await flushOutbox();
      await registerExpoPushIfPossible();
      await setOnboardingComplete();
      onLoggedIn?.();
    } catch (e) {
      const code = e?.code;
      if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') return;
      setErr(mapErr(e.message || code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[styles.inner, { opacity: fadeAnim }]}>

            {/* Brand mark */}
            <View style={styles.brandArea}>
              <View style={styles.logoMark}>
                <Ionicons name="cut" size={28} color="#FFFFFF" />
              </View>
              <Text style={styles.brandName}>ColorBar Suite</Text>
              <Text style={styles.brandTagline}>Professional salon management</Text>
            </View>

            {/* Heading */}
            <Text style={styles.heading}>
              {isSignUp ? 'Create account' : 'Welcome back'}
            </Text>
            <Text style={styles.subheading}>
              {isSignUp
                ? 'Start your 7-day free trial'
                : 'Sign in to continue'}
            </Text>

            {/* Fields */}
            <View style={styles.fields}>
              <Field
                icon="mail-outline"
                placeholder="Email address"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoComplete="email"
                autoCapitalize="none"
                editable={!busy}
              />
              <Field
                icon="lock-closed-outline"
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPass}
                autoComplete={isSignUp ? 'password-new' : 'password'}
                editable={!busy}
                rightIcon={showPass ? 'eye-off-outline' : 'eye-outline'}
                onRightIcon={() => setShowPass(v => !v)}
              />
              {isSignUp && (
                <Field
                  icon="shield-checkmark-outline"
                  placeholder="Confirm password"
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry
                  autoComplete="password-new"
                  editable={!busy}
                />
              )}
            </View>

            {err ? <Text style={styles.err}>{err}</Text> : null}

            {/* Primary button */}
            <Pressable
              style={({ pressed }) => [styles.btn, pressed && { opacity: 0.88 }, busy && { opacity: 0.6 }]}
              onPress={submit}
              disabled={busy}
            >
              {busy
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={styles.btnTxt}>{isSignUp ? 'Create account' : 'Sign in'}</Text>
              }
            </Pressable>

            {/* Apple */}
            {appleAvailable && (
              <>
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerTxt}>or</Text>
                  <View style={styles.dividerLine} />
                </View>
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={isSignUp
                    ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
                    : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={14}
                  style={styles.appleBtn}
                  onPress={signInApple}
                  disabled={busy}
                />
              </>
            )}

            {/* Switch mode */}
            <Pressable
              style={styles.switcher}
              onPress={() => { setErr(''); setMode(isSignUp ? 'signin' : 'signup'); if (!isSignUp) setConfirm(''); }}
              hitSlop={12}
            >
              <Text style={styles.switcherTxt}>
                {isSignUp ? 'Already have an account?  ' : "Don't have an account?  "}
                <Text style={styles.switcherLink}>{isSignUp ? 'Sign in' : 'Sign up'}</Text>
              </Text>
            </Pressable>

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ icon, rightIcon, onRightIcon, ...props }) {
  return (
    <View style={fieldStyles.wrap}>
      <Ionicons name={icon} size={18} color="#AEAEB2" style={fieldStyles.icon} />
      <TextInput
        style={fieldStyles.input}
        placeholderTextColor="#6B6B6B"
        {...props}
      />
      {rightIcon && (
        <Pressable onPress={onRightIcon} hitSlop={10} style={fieldStyles.rightBtn}>
          <Ionicons name={rightIcon} size={18} color="#AEAEB2" />
        </Pressable>
      )}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    paddingHorizontal: 16,
    minHeight: 54,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  icon: { marginRight: 12 },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.regular,
    color: '#FFFFFF',
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
  },
  rightBtn: { paddingLeft: 8 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D0D0D' },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  inner: { width: '100%', maxWidth: 400, alignSelf: 'center' },

  brandArea: { alignItems: 'center', marginBottom: 40 },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: VIOLET,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: VIOLET_LIGHT,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 10,
  },
  brandName: {
    fontFamily: FontFamily.bold,
    fontSize: 24,
    lineHeight: typeLh(24),
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  brandTagline: {
    marginTop: 4,
    fontFamily: FontFamily.regular,
    fontSize: 13,
    lineHeight: typeLh(13),
    color: '#6B6B6B',
    letterSpacing: 0.2,
  },

  heading: {
    fontFamily: FontFamily.bold,
    fontSize: 28,
    lineHeight: typeLh(28),
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  subheading: {
    fontFamily: FontFamily.regular,
    fontSize: 15,
    lineHeight: typeLh(15),
    color: '#6B6B6B',
    marginBottom: 28,
  },

  fields: { marginBottom: 4 },

  err: {
    color: '#FF6B6B',
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.regular,
    marginBottom: 12,
    textAlign: 'center',
  },

  btn: {
    backgroundColor: VIOLET,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
    marginTop: 8,
    shadowColor: VIOLET_LIGHT,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
  },
  btnTxt: {
    color: '#FFFFFF',
    fontFamily: FontFamily.semibold,
    fontSize: 16,
    lineHeight: typeLh(16),
    letterSpacing: 0.1,
  },

  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 22,
    marginBottom: 16,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#2C2C2E' },
  dividerTxt: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    color: '#6B6B6B',
  },
  appleBtn: { width: '100%', height: 54 },

  switcher: { marginTop: 28, alignSelf: 'center', paddingVertical: 8 },
  switcherTxt: {
    fontFamily: FontFamily.regular,
    fontSize: 14,
    lineHeight: typeLh(14),
    color: '#6B6B6B',
    textAlign: 'center',
  },
  switcherLink: {
    fontFamily: FontFamily.semibold,
    color: VIOLET_LIGHT,
  },
});
