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
import { LinearGradient } from 'expo-linear-gradient';
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
    headline: 'Always stocked. Never surprised.',
    body: 'Scan any invoice and your inventory updates instantly. Low stock alerts remind you before you run out mid-appointment.',
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
      {/* Formula card */}
      <View style={styles.labFormulaCard}>
        <View style={styles.labClientRow}>
          <View style={styles.labAvatar}>
            <Text style={styles.labAvatarInitial}>S</Text>
          </View>
          <Text style={styles.labClient}>Sofia K.</Text>
        </View>

        <View style={styles.ingSection}>
          <Text style={styles.ingSectionLabel}>Roots</Text>
          <View style={styles.ingLine}>
            <View style={[styles.ingSwatch, { backgroundColor: '#3B2F6B' }]} />
            <Text style={[OnboardingFonts.bodySm, styles.ingName]} numberOfLines={1}>Koleston 6N</Text>
            <Text style={[OnboardingFonts.labelSm, styles.ingAmt]}>45 g</Text>
          </View>
          <View style={styles.ingLine}>
            <View style={[styles.ingSwatch, { backgroundColor: '#7B6EA0' }]} />
            <Text style={[OnboardingFonts.bodySm, styles.ingName]} numberOfLines={1}>Developer 20V</Text>
            <Text style={[OnboardingFonts.labelSm, styles.ingAmt]}>90 ml</Text>
          </View>
        </View>

        <View style={styles.ingSection}>
          <Text style={styles.ingSectionLabel}>Toner</Text>
          <View style={styles.ingLine}>
            <View style={[styles.ingSwatch, { backgroundColor: '#B8A9D8' }]} />
            <Text style={[OnboardingFonts.bodySm, styles.ingName]} numberOfLines={1}>Gloss 10V</Text>
            <Text style={[OnboardingFonts.labelSm, styles.ingAmt]}>90 ml</Text>
          </View>
          <View style={styles.ingLine}>
            <View style={[styles.ingSwatch, { backgroundColor: '#7B6EA0' }]} />
            <Text style={[OnboardingFonts.bodySm, styles.ingName]} numberOfLines={1}>Developer 3V</Text>
            <Text style={[OnboardingFonts.labelSm, styles.ingAmt]}>180 ml</Text>
          </View>
        </View>
      </View>

      {/* My Lab card — mirrors the HomeScreen dark gradient card */}
      <View style={styles.labMyLabCard}>
        <LinearGradient
          colors={['#000000', '#160B28', '#452277']}
          locations={[0, 0.42, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
          borderRadius={14}
        />
        <Text style={styles.labMyLabKicker}>MY LAB</Text>
        <Text style={styles.labMyLabNum}>7</Text>
        <Text style={styles.labMyLabWord}>formulas</Text>
        <Text style={styles.labMyLabSub}>this month</Text>
        <View style={styles.labMyLabInitials}>
          {['S', 'A', 'M'].map((l, i) => (
            <View key={l} style={[styles.labInitialCircle, i > 0 && { marginLeft: -6 }]}>
              <Text style={styles.labInitialTxt}>{l}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const INV_ROWS = [
  { name: 'Koleston 7/0 60ml', qty: '×12', unit: '€7.20',  total: '€86.40', color: '#4A4463', had: 5,  add: 7,  lowStock: true },
  { name: 'Welloxon 6% 1L',    qty: '×3',  unit: '€11.40', total: '€34.20', color: '#7368A8', had: 2,  add: 3,  lowStock: true },
  { name: 'Color Touch 8/0',   qty: '×6',  unit: '€7.00',  total: '€42.00', color: '#9B8EC4', had: 0,  add: 6,  lowStock: false },
];

function InvoiceMockup() {
  return (
    <View style={styles.invRoot}>
      {/* Camera viewfinder with invoice */}
      <View style={styles.viewfinder}>
        <View style={[styles.invCorner, styles.invCornerTL]} />
        <View style={[styles.invCorner, styles.invCornerTR]} />
        <View style={[styles.invCorner, styles.invCornerBL]} />
        <View style={[styles.invCorner, styles.invCornerBR]} />
        <View style={styles.invPaper}>
          <View style={styles.invHeader}>
            <View>
              <Text style={styles.invCompany}>WELLA PROFESSIONALS</Text>
              <Text style={styles.invMeta}>Invoice #2847 · 02.05.2025</Text>
            </View>
            <View style={styles.invLogoBox}><Text style={styles.invLogoTxt}>W</Text></View>
          </View>
          <View style={styles.invDivider} />
          <View style={styles.invTableHead}>
            <Text style={[styles.invCol, { flex: 2 }]}>PRODUCT</Text>
            <Text style={[styles.invCol, { width: 20, textAlign: 'center' }]}>QTY</Text>
            <Text style={[styles.invCol, { width: 30, textAlign: 'right' }]}>UNIT</Text>
            <Text style={[styles.invCol, { width: 34, textAlign: 'right' }]}>TOTAL</Text>
          </View>
          {INV_ROWS.map((r, i) => (
            <View key={i} style={styles.invTableRow}>
              <Text style={[styles.invRowTxt, { flex: 2 }]} numberOfLines={1}>{r.name}</Text>
              <Text style={[styles.invRowTxt, { width: 20, textAlign: 'center' }]}>{r.qty}</Text>
              <Text style={[styles.invRowTxt, { width: 30, textAlign: 'right' }]}>{r.unit}</Text>
              <Text style={[styles.invRowTxt, { width: 34, textAlign: 'right' }]}>{r.total}</Text>
            </View>
          ))}
          <View style={styles.invDivider} />
          <View style={styles.invTableRow}>
            <Text style={[styles.invRowTxt, { flex: 2, fontFamily: 'Manrope_700Bold' }]}>TOTAL</Text>
            <Text style={[styles.invRowTxt, { width: 84, textAlign: 'right', fontFamily: 'Manrope_700Bold' }]}>€162.60</Text>
          </View>
        </View>
      </View>

      {/* Extracted items with stock delta + Add button */}
      <View style={styles.scanList}>
        {INV_ROWS.map((item, i) => (
          <View key={i} style={styles.scanPill}>
            <View style={[styles.ingSwatch, { backgroundColor: item.color }]} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={styles.scanPillTxt} numberOfLines={1}>{item.name}</Text>
                {item.lowStock ? (
                  <View style={styles.lowBadge}>
                    <Text style={styles.lowBadgeTxt}>Low</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.scanPillStock}>
                {item.had > 0 ? `${item.had} in stock · ` : ''}
                <Text style={styles.scanPillAdd}>+{item.add}</Text>
              </Text>
            </View>
            <Text style={styles.scanPillPrice}>{item.unit}</Text>
          </View>
        ))}
        <View style={styles.invAddBtn}>
          <Text style={styles.invAddBtnTxt}>Add to inventory</Text>
        </View>
      </View>
    </View>
  );
}

function FinanceMockup() {
  return (
    <View style={styles.finRoot}>
      {/* Revenue card */}
      <View style={styles.finCard}>
        <Text style={styles.finCardLabel}>REVENUE · MAY</Text>
        <Text style={styles.finBigNum}>€4,222</Text>
        <View style={styles.finSubRow}>
          <Text style={styles.finSubItem}>25 bookings  <Text style={styles.finSubAmt}>€3,842</Text></Text>
          <Text style={styles.finSubItem}>Retail sales  <Text style={styles.finSubAmt}>€380</Text></Text>
        </View>
      </View>

      {/* Expenses card */}
      <View style={styles.finCard}>
        <Text style={styles.finCardLabel}>EXPENSES</Text>
        {[
          { label: 'Rent',        amt: '€950' },
          { label: 'Electricity', amt: '€330' },
          { label: 'Accountant',  amt: '€200' },
        ].map((e, i) => (
          <View key={i} style={styles.finExpRow}>
            <Text style={styles.finExpLabel}>{e.label}</Text>
            <Text style={styles.finExpAmt}>{e.amt}</Text>
          </View>
        ))}
        <View style={styles.finExpDivider} />
        <View style={styles.finExpRow}>
          <Text style={[styles.finExpLabel, { fontFamily: 'Manrope_600SemiBold' }]}>Total</Text>
          <Text style={[styles.finExpAmt, { fontFamily: 'Manrope_600SemiBold' }]}>€1,480</Text>
        </View>
      </View>

      {/* Net profit */}
      <View style={[styles.finCard, styles.finNetCard]}>
        <Text style={styles.finNetLabel}>NET PROFIT</Text>
        <Text style={styles.finNetAmt}>€2,742</Text>
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
  mockLab: { flex: 1, paddingHorizontal: 4, paddingTop: 8, gap: 8 },

  // My Lab gradient card
  labMyLabCard: {
    borderRadius: 14,
    overflow: 'hidden',
    padding: 12,
    minHeight: 110,
    justifyContent: 'space-between',
    backgroundColor: '#000',
  },
  labMyLabKicker: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 9,
    color: '#FFFFFF',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  labMyLabNum: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 36,
    color: '#FFFFFF',
    lineHeight: 40,
    marginTop: 4,
  },
  labMyLabWord: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11,
    color: '#FFFFFF',
  },
  labMyLabSub: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  labMyLabInitials: {
    flexDirection: 'row',
    marginTop: 8,
  },
  labInitialCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  labInitialTxt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 8,
    color: '#FFFFFF',
  },

  // Formula card
  labFormulaCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 10,
    gap: 7,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  labClientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 2,
  },
  labAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#5E35B1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  labAvatarInitial: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: '#FFFFFF',
  },
  labClient: {
    fontSize: 11,
    color: O.text,
    fontFamily: 'Manrope_500Medium',
  },
  ingSection: { marginTop: 8, gap: 6 },
  ingSectionLabel: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 9,
    color: O.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
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
    backgroundColor: '#0D0D14',
    padding: 14,
    minHeight: 120,
    justifyContent: 'center',
    marginBottom: 6,
    position: 'relative',
  },
  invCorner: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderColor: '#6B4EFF',
    borderWidth: 0,
  },
  invCornerTL: { top: 8, left: 8, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 4 },
  invCornerTR: { top: 8, right: 8, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 4 },
  invCornerBL: { bottom: 8, left: 8, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 4 },
  invCornerBR: { bottom: 8, right: 8, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 4 },
  invPaper: {
    backgroundColor: '#FAFAF8',
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 4,
  },
  invHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 1,
  },
  invCompany: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 7,
    color: '#1A1A1A',
    letterSpacing: 0.3,
  },
  invLogoBox: {
    width: 14,
    height: 14,
    borderRadius: 3,
    backgroundColor: '#1A1A2E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  invLogoTxt: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 8,
    color: '#FFFFFF',
  },
  invMeta: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 6,
    color: '#8A8A8E',
    marginBottom: 2,
  },
  invDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#DCDCE0',
    marginVertical: 2,
  },
  invTableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  invCol: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 6,
    color: '#8A8A8E',
    letterSpacing: 0.3,
  },
  invTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  invRowTxt: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 7,
    color: '#1A1A1A',
    lineHeight: 11,
  },
  scanList: { gap: 5 },
  scanPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: O.borderLight,
  },
  scanPillTxt: {
    color: O.text,
    fontSize: 11,
    fontFamily: 'Manrope_500Medium',
    lineHeight: 15,
  },
  scanPillStock: {
    fontSize: 10,
    fontFamily: 'Manrope_400Regular',
    color: O.secondary,
    lineHeight: 14,
  },
  scanPillAdd: {
    fontFamily: 'Manrope_600SemiBold',
    color: '#00A86B',
  },
  lowBadge: {
    backgroundColor: '#FFF3E0',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  lowBadgeTxt: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 9,
    color: '#FF6B35',
  },
  scanPillPrice: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    color: '#5E35B1',
    flexShrink: 0,
  },
  invAddBtn: {
    backgroundColor: '#5E35B1',
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
    marginTop: 2,
  },
  invAddBtnTxt: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  finRoot: {
    flex: 1,
    gap: 7,
    paddingVertical: 6,
  },
  finCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: O.borderLight,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  finCardLabel: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 9,
    color: O.tertiary,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  finBigNum: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 22,
    color: O.text,
    letterSpacing: -0.8,
    lineHeight: 26,
  },
  finSubRow: { marginTop: 5, gap: 2 },
  finSubItem: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 10,
    color: O.secondary,
  },
  finSubAmt: {
    fontFamily: 'Manrope_600SemiBold',
    color: '#00A86B',
  },
  finExpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  finExpLabel: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 11,
    color: O.text,
  },
  finExpAmt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11,
    color: '#B71C1C',
  },
  finExpDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: O.borderLight,
    marginTop: 6,
    marginBottom: 2,
  },
  finNetCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  finNetLabel: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 10,
    color: O.text,
    letterSpacing: 0.4,
  },
  finNetAmt: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    color: '#00A86B',
    letterSpacing: -0.5,
  },
});
