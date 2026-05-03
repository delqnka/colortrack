import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  ActivityIndicator,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import SFIcon from '../../components/SFIcon';
import { apiLoginWithApple, flushOutbox, getApiBaseUrl, saveSessionToken } from '../../api/client';
import { registerExpoPushIfPossible } from '../../push/registerPush';
import { O, OnboardingFonts, ONBOARDING_LEGAL } from '../theme';
import { setOnboardingComplete } from '../storage';

function GoogleMark() {
  return (
    <View style={gMark.wrap}>
      <View style={[gMark.cell, { backgroundColor: '#4285F4' }]} />
      <View style={[gMark.cell, { backgroundColor: '#EA4335' }]} />
      <View style={[gMark.cell, { backgroundColor: '#FBBC05' }]} />
      <View style={[gMark.cell, { backgroundColor: '#34A853' }]} />
    </View>
  );
}

const gMark = StyleSheet.create({
  wrap: { width: 20, height: 20, flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: 10, height: 10 },
});

export default function OnboardingAuthScreen({ navigation, onLoggedIn }) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [appleOk, setAppleOk] = useState(Platform.OS === 'ios');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (Platform.OS !== 'ios') {
        if (!cancelled) setAppleOk(false);
        return;
      }
      try {
        const ok = await AppleAuthentication.isAvailableAsync();
        if (!cancelled) setAppleOk(Boolean(ok));
      } catch {
        if (!cancelled) setAppleOk(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function mapErr(message) {
    const m = String(message || '').toLowerCase();
    if (m.includes('network request failed') || m.includes('failed to fetch')) {
      return `No connection (${getApiBaseUrl()}).`;
    }
    return message || 'Something went wrong';
  }

  async function signInApple() {
    setBusy(true);
    try {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!cred.identityToken) return;
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
      const code = e && e.code;
      if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') return;
      Alert.alert(mapErr(e.message || code));
    } finally {
      setBusy(false);
    }
  }

  function openLegal(kind) {
    const url = kind === 'terms' ? ONBOARDING_LEGAL.terms : ONBOARDING_LEGAL.privacy;
    Linking.openURL(url).catch(() => Alert.alert(mapErr('Could not open link.')));
  }

  function emailInstead() {
    navigation.navigate('OnboardingEmail', { mode: 'register' });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      {busy ? (
        <View style={styles.busyVeil}>
          <ActivityIndicator size="large" color={O.accent} />
        </View>
      ) : null}
      <View style={[styles.shell, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Pressable
          hitSlop={14}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={28} color={O.text} />
        </Pressable>

        <View style={styles.head}>
          <Text style={[OnboardingFonts.titlePage, styles.title]}>One last step</Text>
          <Text style={[OnboardingFonts.subtitle, styles.sub]}>Keep your data safe across all devices.</Text>
        </View>

        <View style={styles.actions}>
          {appleOk ? (
            <Pressable
              disabled={busy}
              onPress={() => void signInApple()}
              style={({ pressed }) => [styles.appleRow, pressed && !busy && { opacity: 0.94 }]}
            >
              <SFIcon iosName="apple.logo" name="logo-apple" size={20} color="#FFFFFF" />
              <Text style={styles.appleTxt} numberOfLines={1}>
                Continue with Apple
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.googleRow}>
            <View style={styles.googleLead}>
              <GoogleMark />
              <Text style={styles.googleTxt} numberOfLines={1}>
                Continue with Google
              </Text>
            </View>
            <Text style={styles.comingSoon}>Coming soon</Text>
          </View>

          <Pressable
            onPress={() => void emailInstead()}
            style={styles.emailTap}
            hitSlop={{ top: 10, bottom: 10 }}
            accessibilityRole="button"
          >
            <Text style={styles.emailLink}>Use email instead</Text>
          </Pressable>
        </View>

        <View style={styles.flexGrow} />

        <Text style={styles.disclaimer}>
          By continuing you agree to our{' '}
          <Text onPress={() => openLegal('terms')} style={styles.linkLeg}>
            Terms of Service
          </Text>{' '}
          and{' '}
          <Text onPress={() => openLegal('privacy')} style={styles.linkLeg}>
            Privacy Policy
          </Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: O.bg },
  busyVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.65)',
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shell: { flex: 1, paddingHorizontal: 28 },
  backBtn: {
    alignSelf: 'flex-start',
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    marginLeft: -4,
  },
  head: { paddingTop: 16, paddingHorizontal: 4 },
  title: { color: O.text },
  sub: { marginTop: 8, color: O.secondary, fontFamily: 'Manrope_400Regular' },
  actions: { marginTop: 48, gap: 12 },
  appleRow: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    height: 54,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
  },
  appleTxt: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  googleRow: {
    backgroundColor: O.bg,
    borderRadius: 14,
    height: 54,
    minHeight: 54,
    borderWidth: 1,
    borderColor: O.borderLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    opacity: 0.45,
  },
  googleLead: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  googleTxt: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 15,
    color: O.text,
    flexShrink: 1,
  },
  comingSoon: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: O.secondary,
    marginLeft: 8,
  },
  emailTap: {
    marginTop: 8,
    minHeight: 44,
    alignSelf: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  emailLink: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: O.accent,
    textAlign: 'center',
  },
  flexGrow: { flex: 1 },
  disclaimer: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: O.tertiary,
    textAlign: 'center',
    paddingBottom: 8,
  },
  linkLeg: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 11,
    color: O.accent,
  },
});
