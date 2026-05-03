import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { CommonActions } from '@react-navigation/native';
import { O, OnboardingFonts } from '../theme';
import { setOnboardingComplete } from '../storage';

export default function WelcomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <LinearGradient
        colors={['#000000', '#160B28', '#2D1155']}
        locations={[0, 0.45, 1]}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <StatusBar style="light" />
      <View style={styles.mid}>
        <Text style={[OnboardingFonts.titleHuge, styles.brand]}>ColorTrack</Text>
        <View style={styles.accentRule} />
        <Text style={styles.tag}>Your color formulas. Always with you.</Text>
        <Text style={styles.tag2}>Your revenue and your expenses daily.</Text>
        <Text style={styles.tag2}>Your stock, always under control.</Text>
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 28) }]}>
        <Pressable style={styles.primaryBtn} onPress={() => navigation.navigate('OnboardingCarousel')}>
          <Text style={[OnboardingFonts.button, styles.primaryBtnTxt]}>Get started</Text>
        </Pressable>
        <Pressable
          style={styles.linkTap}
          onPress={() => {
            void setOnboardingComplete();
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'Login' }],
              }),
            );
          }}
          hitSlop={{ top: 12, bottom: 12 }}
        >
          <Text style={[OnboardingFonts.bodySm, styles.linkMuted]} accessibilityRole="button">
            I already have an account
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
  },
  mid: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    marginTop: 12,
  },
  brand: { color: '#FFFFFF', textAlign: 'center' },
  accentRule: {
    marginTop: 16,
    width: 40,
    height: 2,
    backgroundColor: O.accent,
    borderRadius: 1,
  },
  tag: {
    ...OnboardingFonts.subtitle,
    fontSize: 16,
    lineHeight: 22,
    marginTop: 16,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    maxWidth: 320,
    fontFamily: 'Manrope_400Regular',
  },
  tag2: {
    ...OnboardingFonts.subtitle,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    maxWidth: 320,
    fontFamily: 'Manrope_400Regular',
  },
  footer: {
    paddingHorizontal: 40,
    paddingTop: 8,
  },
  primaryBtn: {
    backgroundColor: O.btnPrimaryBg,
    borderRadius: 14,
    height: 54,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    minHeight: 54,
  },
  primaryBtnTxt: { color: '#FFFFFF', textTransform: 'uppercase', fontVariant: undefined },
  linkTap: {
    marginTop: 16,
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.5)',
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  linkMuted: {
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    fontFamily: 'Manrope_400Regular',
  },
});
