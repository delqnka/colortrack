import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FontFamily } from '../theme/fonts';
import { typeLh } from '../theme/typography';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SW, height: SH } = Dimensions.get('window');
export const TOUR_STORAGE_KEY = 'colortrack_tour_seen';

const PAD = 8;

// Tabs: Dashboard(0-25%), Clients(25-50%), Inventory(50-75%), Calendar(75-100%)
// Home cards: Lab(57-80% top, 0-55% left), Finance(57-70%, 55-100%), LowStock(70-80%), Services(80-88%)
const STEPS = [
  {
    icon: 'calendar',
    title: 'Your iPhone Calendar in the app',
    body: 'ColorBar Suite shows your appointments from your iPhone calendar in real time, alongside your client bookings. Your full day, always in one place.',
    spot: { top: 0.18, left: 0, w: 1, h: 0.08 },
    tipPos: 'bottom',
  },
  {
    icon: 'today-outline',
    title: 'Your Daily Schedule',
    body: 'The home screen shows today\'s bookings at a glance. Tap any date in the strip to jump to that day.',
    spot: { top: 0.26, left: 0, w: 1, h: 0.22 },
    tipPos: 'bottom',
  },
  {
    icon: 'calendar-number-outline',
    title: 'Book Appointments',
    body: 'Tap the calendar icon in the tab bar to add a new appointment. Choose the client, service, date and time in seconds.',
    spot: { top: 0.87, left: 0.75, w: 0.25, h: 0.13 },
    tipPos: 'top',
  },
  {
    icon: 'people-outline',
    title: 'Client Dossiers',
    body: 'Every client has a complete dossier with contact info, appointment history, colour formulas and personal notes. Tap the clients tab to get started.',
    spot: { top: 0.87, left: 0.25, w: 0.25, h: 0.13 },
    tipPos: 'top',
  },
  {
    icon: 'flask-outline',
    title: 'My Lab',
    body: 'Build all your formulas in My Lab. Save them to each client\'s dossier and access them instantly during any appointment.',
    spot: { top: 0.57, left: 0, w: 0.55, h: 0.25 },
    tipPos: 'top',
  },
  {
    icon: 'file-tray-stacked-outline',
    title: 'Inventory',
    body: 'Track your product stock. ColorBar Suite alerts you when items run low so you\'re never caught short mid-appointment.',
    spot: { top: 0.87, left: 0.50, w: 0.25, h: 0.13 },
    tipPos: 'top',
  },
  {
    icon: 'list-outline',
    title: 'Services & Price List',
    body: 'Add your services and prices once. They appear automatically when filling in client appointments.',
    spot: { top: 0.80, left: 0.55, w: 0.44, h: 0.08 },
    tipPos: 'top',
    cardOffset: -180,
  },
  {
    icon: 'stats-chart-outline',
    title: 'Finance, Sales & Revenue',
    body: 'Log sales and track income against expenses. See your monthly revenue and identify your most profitable services.',
    spot: { top: 0.57, left: 0.55, w: 0.44, h: 0.13 },
    tipPos: 'top',
    cardOffset: -20,
  },
];

export default function AppTourModal({ visible, onClose }) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Spotlight rect in px
  const spotTop = current.spot.top * SH;
  const spotLeft = current.spot.left * SW;
  const spotW = current.spot.w * SW;
  const spotH = current.spot.h * SH;

  useEffect(() => {
    if (visible) {
      setStep(0);
      Animated.timing(overlayOpacity, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    } else {
      overlayOpacity.setValue(0);
    }
  }, [visible]);

  // Pulse animation on spotlight
  useEffect(() => {
    pulseAnim.setValue(1);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [step]);

  const goNext = () => {
    Animated.timing(contentOpacity, { toValue: 0, duration: 100, useNativeDriver: true }).start(() => {
      setStep(s => s + 1);
      Animated.timing(contentOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  };

  const tipIsBottom = current.tipPos === 'bottom';
  const cardH = 220;
  const rawCardTop = tipIsBottom
    ? spotTop + spotH + PAD + 28
    : spotTop - cardH - PAD - 28;
  const cardTop = current.cardOffset != null
    ? spotTop + current.cardOffset
    : Math.min(Math.max(rawCardTop, insets.top + 8), SH - cardH - insets.bottom - 8);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: overlayOpacity }]}>

        {/* Dark overlay - 4 rectangles around spotlight */}
        {/* Top */}
        <View style={[styles.dark, { top: 0, left: 0, right: 0, height: spotTop - PAD }]} />
        {/* Bottom */}
        <View style={[styles.dark, { top: spotTop + spotH + PAD, left: 0, right: 0, bottom: 0 }]} />
        {/* Left */}
        <View style={[styles.dark, { top: spotTop - PAD, left: 0, width: spotLeft - PAD, height: spotH + PAD * 2 }]} />
        {/* Right */}
        <View style={[styles.dark, { top: spotTop - PAD, left: spotLeft + spotW + PAD, right: 0, height: spotH + PAD * 2 }]} />

        {/* Spotlight border pulse */}
        <Animated.View
          style={[
            styles.spotBorder,
            {
              top: spotTop - PAD,
              left: spotLeft - PAD,
              width: spotW + PAD * 2,
              height: spotH + PAD * 2,
              transform: [{ scale: pulseAnim }],
            },
          ]}
        />

        {/* Tap hint arrow */}
        <View style={[styles.tapArrow, { top: tipIsBottom ? spotTop + spotH + PAD + 4 : spotTop - PAD - 28, left: spotLeft + spotW / 2 - 12 }]}>
          <Ionicons
            name={tipIsBottom ? 'arrow-up-outline' : 'arrow-down-outline'}
            size={24}
            color="#FFFFFF"
          />
        </View>

        {/* Tooltip card */}
        <Animated.View
          style={[
            styles.card,
            {
              top: cardTop,
              opacity: contentOpacity,
            },
          ]}
        >
          {/* Header */}
          <View style={styles.cardHeader}>
            <View style={styles.iconWrap}>
              <Ionicons name={current.icon} size={20} color="#FFFFFF" />
            </View>
            <Text style={styles.stepCount}>{step + 1} of {STEPS.length}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={styles.skip}>Skip</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.body}>{current.body}</Text>

          {/* Dots + button */}
          <View style={styles.footer}>
            <View style={styles.dots}>
              {STEPS.map((_, i) => (
                <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
              ))}
            </View>
            <TouchableOpacity style={styles.btn} onPress={isLast ? onClose : goNext} activeOpacity={0.88}>
              <Text style={styles.btnText}>{isLast ? 'Get started' : 'Next'}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dark: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  spotBorder: {
    position: 'absolute',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  tapArrow: {
    position: 'absolute',
    alignItems: 'center',
  },
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#452277',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  stepCount: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: 12,
    color: '#AEAEB2',
    letterSpacing: 0.3,
  },
  skip: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
    color: '#AEAEB2',
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: 18,
    lineHeight: typeLh(18),
    color: '#0D0D0D',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  body: {
    fontFamily: FontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    color: '#6B6B6B',
    marginBottom: 16,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dots: {
    flexDirection: 'row',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E5E5EA',
  },
  dotActive: {
    width: 18,
    backgroundColor: '#0D0D0D',
    borderRadius: 3,
  },
  btn: {
    backgroundColor: '#0D0D0D',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  btnText: {
    fontFamily: FontFamily.semibold,
    fontSize: 14,
    color: '#FFFFFF',
  },
});
