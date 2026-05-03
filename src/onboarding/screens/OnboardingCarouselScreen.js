import React, { useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import DotGrid from '../components/DotGrid';
import { O, OnboardingFonts } from '../theme';
import { setOnboardingComplete } from '../storage';

const SLIDES = [
  {
    key: 'lab',
    headline: 'Your Formula Lab',
    body:
      'Save every color formula. Find it instantly the next time your client sits in your chair.',
    Mockup: LabMockup,
  },
  {
    key: 'invoice',
    headline: 'Scan. Stock. Done.',
    body: 'Photograph any invoice and watch your inventory fill itself. No typing, ever.',
    Mockup: InvoiceMockup,
  },
  {
    key: 'finance',
    headline: 'Know your numbers.',
    body: 'Track income and expenses. See exactly how your business is performing, every day.',
    Mockup: FinanceMockup,
  },
];

export default function OnboardingCarouselScreen({ navigation }) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef(null);

  const upperH = H * 0.6;
  const phoneW = Math.min(W - 96, 300);
  const phoneH = Math.min(Math.round(phoneW * 2.05), 424);

  const goAuth = useCallback(async () => {
    await setOnboardingComplete();
    navigation.navigate('OnboardingAuth');
  }, [navigation]);

  const onNext = useCallback(() => {
    scrollX.stopAnimation((v) => {
      const pageW = Math.max(W, 1);
      const idx = Math.round(v / pageW);
      const last = SLIDES.length - 1;
      if (idx >= last) {
        void goAuth();
        return;
      }
      scrollRef.current?.scrollTo({ x: (idx + 1) * pageW, animated: true });
    });
  }, [W, goAuth, scrollX]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <View style={styles.skipRow}>
        <Pressable
          onPress={() => void goAuth()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Skip"
          style={{ minHeight: 44, minWidth: 52, justifyContent: 'center', alignItems: 'flex-end' }}
        >
          <Text style={[OnboardingFonts.labelSm, styles.skip]}>SKIP</Text>
        </Pressable>
      </View>

      <View style={[styles.upper, { height: upperH }]}>
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          decelerationRate="fast"
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
            useNativeDriver: false,
          })}
          contentContainerStyle={styles.carouselContent}
        >
          {SLIDES.map((s) => (
            <View key={s.key} style={[styles.slidePane, { width: W, minHeight: upperH }]}>
              <View style={[styles.heroCell, { width: phoneW, height: phoneH }]}>
                <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                  <DotGrid width={phoneW} height={phoneH} spacing={20} dot={3} color="#E5E5E5" opacity={0.6} />
                </View>
                <PhoneShell>
                  <s.Mockup />
                </PhoneShell>
              </View>
            </View>
          ))}
        </Animated.ScrollView>
      </View>

      <View style={[styles.lower, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <View style={styles.lowerInner}>
          <View style={styles.dots}>
            {SLIDES.map((s, i) => (
              <Dot key={s.key} scrollX={scrollX} index={i} W={W} />
            ))}
          </View>

          <View style={styles.copyWrap}>
            {SLIDES.map((s, i) => {
              const opacity = scrollX.interpolate({
                inputRange: [(i - 1) * W, i * W, (i + 1) * W],
                outputRange: [0, 1, 0],
                extrapolate: 'clamp',
              });
              return (
                <Animated.View key={s.key} style={[styles.copyBlock, { opacity }]} pointerEvents="none">
                  <Text style={[OnboardingFonts.carouselHeadline, styles.headline]}>{s.headline}</Text>
                  <Text style={[OnboardingFonts.bodyMd, styles.body]}>{s.body}</Text>
                </Animated.View>
              );
            })}
          </View>
        </View>

        <Pressable style={styles.nextBtn} onPress={onNext}>
          <Text style={[OnboardingFonts.button, styles.nextTxt]}>NEXT →</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Dot({ scrollX, index, W }) {
  const capW = scrollX.interpolate({
    inputRange: [(index - 1) * W, index * W, (index + 1) * W],
    outputRange: [6, 20, 6],
    extrapolate: 'clamp',
  });

  const grayFade = scrollX.interpolate({
    inputRange: [(index - 1) * W, index * W, (index + 1) * W],
    outputRange: [1, 0, 1],
    extrapolate: 'clamp',
  });

  const capReveal = scrollX.interpolate({
    inputRange: [(index - 1) * W, index * W, (index + 1) * W],
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.dotSlot}>
      <Animated.View style={[styles.dotGray, { opacity: grayFade }]} />
      <Animated.View style={[styles.dotCapsule, { width: capW, opacity: capReveal }]} />
    </View>
  );
}

function PhoneShell({ children }) {
  return (
    <View style={styles.phoneOuter}>
      <View style={styles.phoneInner}>{children}</View>
    </View>
  );
}

function LabMockup() {
  return (
    <View style={styles.mockLab}>
      <Text style={[OnboardingFonts.label, styles.labClient]}>Jordan M.</Text>
      <View style={styles.labRow}>
        <Text style={styles.labRowLabel}>Roots</Text>
        <View style={styles.labDots}>
          {[0, 1, 2].map((x) => (
            <View key={x} style={styles.ingChip} />
          ))}
        </View>
      </View>
      <View style={styles.labRow}>
        <Text style={styles.labRowLabel}>Lengths</Text>
        <View style={styles.labDots}>
          {[0, 1].map((x) => (
            <View key={x} style={[styles.ingChip, { width: 56 }]} />
          ))}
        </View>
      </View>
      <View style={styles.ingList}>
        <View style={styles.ingLine}>
          <View style={[styles.ingSwatch, { backgroundColor: '#2C2540' }]} />
          <Text style={[OnboardingFonts.bodySm, styles.ingName]} numberOfLines={1}>6N + 30g</Text>
          <Text style={[OnboardingFonts.labelSm, styles.ingAmt]}>1:2</Text>
        </View>
        <View style={styles.ingLine}>
          <View style={[styles.ingSwatch, { backgroundColor: '#5E4FB3' }]} />
          <Text style={[OnboardingFonts.bodySm, styles.ingName]} numberOfLines={1}>Gloss toner</Text>
          <Text style={[OnboardingFonts.labelSm, styles.ingAmt]}>15 ml</Text>
        </View>
      </View>
    </View>
  );
}

function InvoiceMockup() {
  return (
    <View style={styles.invRoot}>
      <View style={styles.viewfinder}>
        <View style={styles.invPaper}>
          <View style={styles.invLineWide} />
          <View style={styles.invLineNarrow} />
          <View style={[styles.invLineWide, { marginTop: 10 }]} />
        </View>
      </View>
      <View style={styles.scanList}>
        <View style={styles.scanPill}>
          <View style={[styles.ingSwatch, { backgroundColor: '#4A4463' }]} />
          <Text style={[OnboardingFonts.labelSm, styles.scanPillTxt]} numberOfLines={1}>Permanent color 60 ml</Text>
        </View>
        <View style={styles.scanPill}>
          <View style={[styles.ingSwatch, { backgroundColor: '#7368A8' }]} />
          <Text style={[OnboardingFonts.labelSm, styles.scanPillTxt]} numberOfLines={1}>Developer 1000 ml</Text>
        </View>
      </View>
    </View>
  );
}

function FinanceMockup() {
  return (
    <View style={styles.finRoot}>
      <View style={styles.finCard}>
        <View style={styles.finRow}>
          <Ionicons name="trending-up-outline" size={18} color={O.secondary} />
          <Text style={[OnboardingFonts.labelSm, styles.finLbl]}>Income</Text>
        </View>
        <Text style={[OnboardingFonts.titlePage, styles.finNum]}>$3,842</Text>
      </View>
      <View style={[styles.finCard]}>
        <View style={styles.finRow}>
          <Ionicons name="trending-down-outline" size={18} color={O.secondary} />
          <Text style={[OnboardingFonts.labelSm, styles.finLbl]}>Expense</Text>
        </View>
        <Text style={[OnboardingFonts.titlePage, styles.finNumLo]}>$1,076</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: O.bg },
  skipRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 20,
    minHeight: 44,
  },
  skip: { color: O.tertiary, textAlign: 'right', fontFamily: 'Manrope_500Medium', fontSize: 13 },
  upper: {
    overflow: 'hidden',
  },
  carouselContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slidePane: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCell: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    position: 'relative',
    flexShrink: 0,
    flexGrow: 0,
  },
  phoneOuter: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: O.phoneFill,
    borderRadius: 28,
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
  },
  phoneInner: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  lower: {
    flex: 0.4,
    paddingHorizontal: 24,
    paddingTop: 4,
    justifyContent: 'space-between',
  },
  lowerInner: {
    flex: 1,
    minHeight: 140,
    position: 'relative',
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    marginTop: 4,
  },
  dotSlot: {
    width: 22,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  dotGray: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: O.borderLight,
    position: 'absolute',
    zIndex: 0,
  },
  dotCapsule: {
    position: 'absolute',
    height: 6,
    borderRadius: 3,
    backgroundColor: O.accent,
    zIndex: 1,
  },
  copyWrap: {
    marginTop: 12,
    minHeight: 120,
    position: 'relative',
    alignItems: 'center',
    width: '100%',
    flexGrow: 1,
  },
  copyBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 8,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  headline: {
    color: O.text,
    textAlign: 'center',
    fontSize: 24,
    fontFamily: 'Manrope_700Bold',
    lineHeight: 31,
  },
  body: {
    marginTop: 12,
    color: O.secondary,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 16,
    maxWidth: 360,
    fontFamily: 'Manrope_400Regular',
    fontSize: 15,
  },
  nextBtn: {
    backgroundColor: O.btnPrimaryBg,
    borderRadius: 14,
    height: 54,
    minHeight: 54,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextTxt: {
    color: '#FFFFFF',
    fontFamily: 'Manrope_600SemiBold',
  },
  mockLab: { flex: 1, paddingHorizontal: 4, paddingTop: 12 },
  labClient: {
    fontSize: 15,
    color: O.text,
    letterSpacing: -0.2,
    marginBottom: 14,
    fontFamily: 'Manrope_500Medium',
  },
  labRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    justifyContent: 'space-between',
    gap: 8,
  },
  labRowLabel: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    color: O.secondary,
    width: 56,
  },
  labDots: {
    flexDirection: 'row',
    flex: 1,
    gap: 6,
    justifyContent: 'flex-start',
  },
  ingChip: {
    height: 8,
    flex: 1,
    maxWidth: 62,
    borderRadius: 4,
    backgroundColor: 'rgba(27,26,43,0.12)',
  },
  ingList: { marginTop: 16, gap: 10 },
  ingLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ingSwatch: { width: 14, height: 14, borderRadius: 4 },
  ingName: {
    flex: 1,
    color: O.text,
    fontSize: 13,
    fontFamily: 'Manrope_400Regular',
  },
  ingAmt: {
    color: O.tertiary,
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
  },
  invRoot: {
    flex: 1,
    paddingHorizontal: 2,
    paddingVertical: 10,
    justifyContent: 'space-between',
    gap: 8,
  },
  viewfinder: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#12121C',
    padding: 10,
    minHeight: 120,
    justifyContent: 'center',
    marginBottom: 6,
  },
  invPaper: {
    backgroundColor: '#F2F2F4',
    borderRadius: 6,
    padding: 10,
    minHeight: 72,
    justifyContent: 'flex-start',
  },
  invLineWide: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#DCDCE0',
    width: '100%',
  },
  invLineNarrow: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EEEEF1',
    width: '70%',
    marginTop: 8,
  },
  scanList: { gap: 8 },
  scanPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: O.borderLight,
  },
  scanPillTxt: {
    flex: 1,
    color: O.text,
    fontSize: 13,
    fontFamily: 'Manrope_500Medium',
  },
  finRoot: {
    flex: 1,
    gap: 12,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  finCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: O.borderLight,
    padding: 14,
  },
  finRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  finLbl: { color: O.secondary },
  finNum: { fontSize: 22, letterSpacing: -0.8, color: O.text, fontFamily: 'Manrope_700Bold' },
  finNumLo: { fontSize: 22, letterSpacing: -0.8, color: '#4A4860', fontFamily: 'Manrope_700Bold' },
});
