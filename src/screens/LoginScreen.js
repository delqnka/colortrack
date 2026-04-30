import React, { useEffect, useState } from 'react';
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
  useWindowDimensions,
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
import { BRAND_PURPLE } from '../theme/glassUi';
import * as AppleAuthentication from 'expo-apple-authentication';

const LAVENDER_BG = '#F5F2FF';
const CARD_FILL = '#EDE8FF';
const CARD_STROKE = 'rgba(94, 53, 177, 0.28)';
const INPUT_BORDER = '#E0DCEA';
const SUBTITLE = '#6B6A72';

export default function LoginScreen({ onLoggedIn }) {
  const { width: winW } = useWindowDimensions();
  const cardMax = Math.min(400, winW - 48);
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  const isSignUp = mode === 'signup';

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
    return () => {
      cancelled = true;
    };
  }, []);

  function mapErr(message) {
    const m = String(message || '').toLowerCase();
    if (m === 'conflict') return 'This email is already registered.';
    if (m === 'unauthorized') return 'Invalid email or password.';
    if (m === 'forbidden') return 'Registration is disabled.';
    if (m === 'bad_request') {
      return isSignUp
        ? 'Enter a valid email and password (min. 8 characters).'
        : 'Enter your email and password.';
    }
    if (m.includes('network request failed') || m.includes('failed to fetch')) {
      return `No connection to the server (${getApiBaseUrl()}). Same Wi‑Fi as the Mac, correct LAN IP in root .env, fire up backend, then npx expo start --clear. On iPhone, test Safari: open that URL + /health`;
    }
    return message || 'Something went wrong';
  }

  async function submit() {
    setErr('');
    const em = String(email).trim();
    const pw = String(password);
    if (isSignUp) {
      if (pw !== String(confirm)) {
        setErr('Passwords do not match.');
        return;
      }
    }
    setBusy(true);
    try {
      const data = isSignUp ? await apiRegister(em, pw) : await apiLogin(em, pw);
      await saveSessionToken(data.token);
      await flushOutbox();
      await registerExpoPushIfPossible();
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
      if (!cred.identityToken) {
        setErr('Apple Sign-In did not return a token.');
        return;
      }
      const data = await apiLoginWithApple({
        identity_token: cred.identityToken,
        email: cred.email || undefined,
      });
      await saveSessionToken(data.token);
      await flushOutbox();
      await registerExpoPushIfPossible();
      onLoggedIn?.();
    } catch (e) {
      const code = e && e.code;
      if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') return;
      setErr(mapErr(e.message || code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.bgDecor}>
        <View style={[styles.blob, styles.blob1]} />
        <View style={[styles.blob, styles.blob2]} />
        <View style={[styles.blob, styles.blob3]} />
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, { width: cardMax, maxWidth: cardMax, alignSelf: 'center' }]}>
            <Text style={styles.brand}>ColorTrack</Text>
            <Text style={styles.headline}>
              {isSignUp ? 'Create your account' : 'Welcome back'}
            </Text>
            <Text style={styles.sub}>
              {isSignUp
                ? 'Sign up with email to access your schedule and clients.'
                : 'Sign in with your email and password to continue.'}
            </Text>

            <View style={styles.fieldWrap}>
              <Ionicons name="mail-outline" size={20} color={SUBTITLE} style={styles.fieldIcon} />
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#9E9CAA"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View style={styles.fieldWrap}>
              <Ionicons name="lock-closed-outline" size={20} color={SUBTITLE} style={styles.fieldIcon} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#9E9CAA"
                secureTextEntry
                autoComplete={isSignUp ? 'password-new' : 'password'}
                value={password}
                onChangeText={setPassword}
              />
            </View>

            {isSignUp ? (
              <View style={styles.fieldWrap}>
                <Ionicons name="shield-checkmark-outline" size={20} color={SUBTITLE} style={styles.fieldIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm password"
                  placeholderTextColor="#9E9CAA"
                  secureTextEntry
                  autoComplete="password-new"
                  value={confirm}
                  onChangeText={setConfirm}
                />
              </View>
            ) : null}

            {err ? <Text style={styles.err}>{err}</Text> : null}

            <Pressable
              style={({ pressed }) => [styles.btn, pressed && styles.btnPressed, busy && styles.btnDisabled]}
              onPress={submit}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.btnTxt}>{isSignUp ? 'Sign up' : 'Sign in'}</Text>
              )}
            </Pressable>

            {appleAvailable ? (
              <>
                <View style={styles.orRow}>
                  <View style={styles.orLine} />
                  <Text style={styles.orTxt}>or</Text>
                  <View style={styles.orLine} />
                </View>
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={
                    isSignUp
                      ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
                      : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
                  }
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={26}
                  style={styles.appleBtn}
                  onPress={signInApple}
                  disabled={busy}
                />
              </>
            ) : null}

            <Pressable
              style={styles.switcher}
              onPress={() => {
                setErr('');
                setMode(isSignUp ? 'signin' : 'signup');
                if (!isSignUp) setConfirm('');
              }}
              hitSlop={12}
            >
              <Text style={styles.switcherTxt}>
                {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
                <Text style={styles.switcherBold}>{isSignUp ? 'Sign in' : 'Sign up'}</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  bgDecor: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: LAVENDER_BG,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.38,
  },
  blob1: {
    width: 220,
    height: 220,
    backgroundColor: '#D4C4FC',
    top: -60,
    right: -50,
  },
  blob2: {
    width: 160,
    height: 160,
    backgroundColor: '#C8B8F8',
    bottom: 120,
    left: -40,
  },
  blob3: {
    width: 100,
    height: 100,
    backgroundColor: '#B8A9F9',
    bottom: 40,
    right: 30,
    opacity: 0.28,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  card: {
    borderRadius: 28,
    paddingHorizontal: 26,
    paddingTop: 32,
    paddingBottom: 28,
    backgroundColor: CARD_FILL,
    borderWidth: 1.5,
    borderColor: CARD_STROKE,
    shadowColor: BRAND_PURPLE,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 8,
  },
  brand: {
    fontSize: 26,
    fontWeight: '800',
    color: BRAND_PURPLE,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  headline: {
    marginTop: 14,
    fontSize: 22,
    fontWeight: '700',
    color: '#1C1C1E',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  sub: {
    marginTop: 8,
    marginBottom: 22,
    fontSize: 15,
    lineHeight: 21,
    color: SUBTITLE,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  fieldWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    marginBottom: 12,
    paddingHorizontal: 16,
    minHeight: 54,
  },
  fieldIcon: { marginRight: 10 },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#1C1C1E',
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
  },
  err: {
    color: '#B00020',
    fontSize: 14,
    marginBottom: 10,
    textAlign: 'center',
  },
  btn: {
    marginTop: 6,
    backgroundColor: BRAND_PURPLE,
    borderRadius: 26,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  btnPressed: { opacity: 0.92 },
  btnDisabled: { opacity: 0.75 },
  btnTxt: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
    marginBottom: 14,
  },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(28,28,30,0.2)' },
  orTxt: { fontSize: 13, color: SUBTITLE, fontWeight: '600' },
  appleBtn: { width: '100%', height: 54 },
  switcher: { marginTop: 22, alignSelf: 'center', paddingVertical: 8 },
  switcherTxt: { fontSize: 15, color: SUBTITLE, textAlign: 'center' },
  switcherBold: { fontWeight: '700', color: BRAND_PURPLE },
});
