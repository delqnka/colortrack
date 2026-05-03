import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { apiLogin, apiRegister, saveSessionToken, flushOutbox } from '../../api/client';
import { registerExpoPushIfPossible } from '../../push/registerPush';
import { setOnboardingComplete } from '../storage';
import { O, OnboardingFonts } from '../theme';

export default function OnboardingEmailScreen({ navigation, onLoggedIn, route }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState(route?.params?.mode ?? 'login');
  const isRegister = mode === 'register';

  const [firstName, setFirstName]   = useState('');
  const [lastName, setLastName]     = useState('');
  const [salonName, setSalonName]   = useState('');
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [confirm, setConfirm]       = useState('');
  const [showPw, setShowPw]         = useState(false);
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState('');

  const lastNameRef  = useRef(null);
  const salonRef     = useRef(null);
  const emailRef     = useRef(null);
  const pwRef        = useRef(null);
  const confirmRef   = useRef(null);

  function clearError() { setError(''); }

  function mapErr(message) {
    const m = String(message || '').toLowerCase();
    if (m.includes('network') || m.includes('failed to fetch')) return 'No internet connection.';
    if (m === 'conflict' || m.includes('already')) return 'This email is already registered.';
    if (m === 'bad_credentials' || m.includes('invalid') || m.includes('bad_request')) return 'Incorrect email or password.';
    return message || 'Something went wrong.';
  }

  async function submit() {
    const em = email.trim();
    const pw = password;

    if (isRegister) {
      if (!firstName.trim()) { setError('Enter your first name.'); return; }
      if (!lastName.trim())  { setError('Enter your last name.'); return; }
      if (!salonName.trim()) { setError('Enter your salon name.'); return; }
      if (!em)               { setError('Enter your email address.'); return; }
      if (!/\S+@\S+\.\S+/.test(em)) { setError('Enter a valid email address.'); return; }
      if (pw.length < 6)     { setError('Password must be at least 6 characters.'); return; }
      if (pw !== confirm)    { setError('Passwords do not match.'); return; }
    } else {
      if (!em || !pw) { setError('Please fill in all fields.'); return; }
    }

    setError('');
    setBusy(true);
    try {
      const data = isRegister
        ? await apiRegister(em, pw, { firstName: firstName.trim(), lastName: lastName.trim(), salonName: salonName.trim() })
        : await apiLogin(em, pw);
      await saveSessionToken(data.token);
      await flushOutbox();
      await registerExpoPushIfPossible();
      await setOnboardingComplete();
      onLoggedIn?.();
    } catch (e) {
      setError(mapErr(e?.message || ''));
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(isRegister ? 'login' : 'register');
    setError('');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.shell, { paddingBottom: Math.max(insets.bottom, 32) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {navigation.canGoBack() ? (
            <Pressable
              hitSlop={14}
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={styles.backBtn}
            >
              <Ionicons name="chevron-back" size={28} color={O.text} />
            </Pressable>
          ) : <View style={styles.backBtn} />}

          <View style={styles.head}>
            <Text style={[OnboardingFonts.titlePage, styles.title]}>
              {isRegister ? 'Create your account' : 'Welcome back'}
            </Text>
            <Text style={[OnboardingFonts.subtitle, styles.sub]}>
              {isRegister
                ? 'Set up your ColorBar Suite account in seconds.'
                : 'Sign in to continue to ColorBar Suite.'}
            </Text>
          </View>

          <View style={styles.fields}>
            {isRegister ? (
              <>
                {/* Name row */}
                <View style={styles.nameRow}>
                  <View style={[styles.fieldWrap, { flex: 1 }]}>
                    <Text style={styles.fieldLabel}>First name</Text>
                    <TextInput
                      style={styles.input}
                      value={firstName}
                      onChangeText={(t) => { setFirstName(t); clearError(); }}
                      placeholder="Sofia"
                      placeholderTextColor={O.tertiary}
                      autoCapitalize="words"
                      returnKeyType="next"
                      onSubmitEditing={() => lastNameRef.current?.focus()}
                    />
                  </View>
                  <View style={[styles.fieldWrap, { flex: 1 }]}>
                    <Text style={styles.fieldLabel}>Last name</Text>
                    <TextInput
                      ref={lastNameRef}
                      style={styles.input}
                      value={lastName}
                      onChangeText={(t) => { setLastName(t); clearError(); }}
                      placeholder="Ivanova"
                      placeholderTextColor={O.tertiary}
                      autoCapitalize="words"
                      returnKeyType="next"
                      onSubmitEditing={() => salonRef.current?.focus()}
                    />
                  </View>
                </View>

                {/* Salon name */}
                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>Salon name</Text>
                  <TextInput
                    ref={salonRef}
                    style={styles.input}
                    value={salonName}
                    onChangeText={(t) => { setSalonName(t); clearError(); }}
                    placeholder="Sofia's Beauty Studio"
                    placeholderTextColor={O.tertiary}
                    autoCapitalize="words"
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                  />
                </View>
              </>
            ) : null}

            {/* Email */}
            <View style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                ref={emailRef}
                style={styles.input}
                value={email}
                onChangeText={(t) => { setEmail(t); clearError(); }}
                placeholder="you@example.com"
                placeholderTextColor={O.tertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => pwRef.current?.focus()}
              />
            </View>

            {/* Password */}
            <View style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>Password</Text>
              <View style={styles.pwWrap}>
                <TextInput
                  ref={pwRef}
                  style={[styles.input, styles.pwInput]}
                  value={password}
                  onChangeText={(t) => { setPassword(t); clearError(); }}
                  placeholder={isRegister ? 'At least 6 characters' : 'Your password'}
                  placeholderTextColor={O.tertiary}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType={isRegister ? 'next' : 'done'}
                  onSubmitEditing={() => isRegister ? confirmRef.current?.focus() : submit()}
                />
                <Pressable onPress={() => setShowPw(v => !v)} style={styles.eyeBtn} hitSlop={10}>
                  <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={O.secondary} />
                </Pressable>
              </View>
            </View>

            {/* Confirm password — register only */}
            {isRegister ? (
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Confirm password</Text>
                <TextInput
                  ref={confirmRef}
                  style={styles.input}
                  value={confirm}
                  onChangeText={(t) => { setConfirm(t); clearError(); }}
                  placeholder="Repeat password"
                  placeholderTextColor={O.tertiary}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={submit}
                />
              </View>
            ) : null}

            {error ? <Text style={styles.errorTxt}>{error}</Text> : null}
          </View>

          <Pressable
            style={[styles.submitBtn, busy && styles.submitBtnBusy]}
            onPress={submit}
            disabled={busy}
          >
            {busy
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={styles.submitTxt}>{isRegister ? 'Create account' : 'Sign in'}</Text>
            }
          </Pressable>

          <Pressable style={styles.toggleRow} onPress={switchMode} hitSlop={{ top: 10, bottom: 10 }}>
            <Text style={styles.toggleTxt}>
              {isRegister ? 'Already have an account?  ' : 'No account yet?  '}
              <Text style={styles.toggleLink}>{isRegister ? 'Sign in' : 'Create one'}</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: O.bg },
  flex: { flex: 1 },
  shell: { paddingHorizontal: 28, paddingTop: 0 },
  backBtn: { alignSelf: 'flex-start', minWidth: 44, minHeight: 44, justifyContent: 'center', marginLeft: -4 },
  head: { paddingTop: 12, paddingHorizontal: 4, marginBottom: 32 },
  title: { color: O.text },
  sub: { marginTop: 8, color: O.secondary, fontFamily: 'Manrope_400Regular' },
  fields: { gap: 16, marginBottom: 28 },
  nameRow: { flexDirection: 'row', gap: 12 },
  fieldWrap: { gap: 6 },
  fieldLabel: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: O.text },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: O.borderLight,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 15,
    fontFamily: 'Manrope_400Regular',
    color: O.text,
    backgroundColor: O.bg,
  },
  pwWrap: { position: 'relative' },
  pwInput: { paddingRight: 48 },
  eyeBtn: { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
  errorTxt: { fontFamily: 'Manrope_400Regular', fontSize: 13, color: '#B00020', textAlign: 'center', marginTop: -4 },
  submitBtn: {
    backgroundColor: O.btnPrimaryBg,
    borderRadius: 14,
    height: 54,
    minHeight: 54,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  submitBtnBusy: { opacity: 0.7 },
  submitTxt: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, color: '#FFFFFF', letterSpacing: 0.3 },
  toggleRow: { alignSelf: 'center', paddingVertical: 6 },
  toggleTxt: { fontFamily: 'Manrope_400Regular', fontSize: 13, color: O.secondary, textAlign: 'center' },
  toggleLink: { fontFamily: 'Manrope_600SemiBold', color: O.accent },
});
