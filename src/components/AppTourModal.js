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

const { width: W } = Dimensions.get('window');
const VIOLET = '#452277';

const STEPS = [
  {
    icon: 'calendar',
    color: '#452277',
    title: 'Your iPhone Calendar in the app',
    body: 'ColorBar Suite shows your appointments from your iPhone calendar in real time, alongside your client bookings. Your full day, always in one place.',
  },
  {
    icon: 'today-outline',
    color: '#0D0D0D',
    title: 'Your Daily Schedule',
    body: 'The home screen shows today\'s appointments at a glance. Tap any date to navigate your week and see what\'s coming.',
  },
  {
    icon: 'calendar-number-outline',
    color: '#0D0D0D',
    title: 'Book Appointments',
    body: 'Tap the calendar tab to add a new appointment. Choose the client, service, date and time — done in seconds.',
  },
  {
    icon: 'people-outline',
    color: '#0D0D0D',
    title: 'Client Dossiers',
    body: 'Every client has a complete dossier — contact info, appointment history, colour formulas and personal notes. All in one place.',
  },
  {
    icon: 'flask-outline',
    color: '#452277',
    title: 'Formula Builder',
    body: 'Build and save colour formulas. Access them instantly during appointments directly from the client\'s dossier.',
  },
  {
    icon: 'cube-outline',
    color: '#0D0D0D',
    title: 'Inventory',
    body: 'Track your product stock. ColorBar Suite alerts you when items run low so you\'re never caught short mid-appointment.',
  },
  {
    icon: 'list-outline',
    color: '#0D0D0D',
    title: 'Services & Price List',
    body: 'Add your services and prices once. They appear automatically when filling in client appointments — no retyping.',
  },
  {
    icon: 'stats-chart-outline',
    color: '#452277',
    title: 'Finance & Revenue',
    body: 'Log sales and track income against expenses. See your monthly revenue and identify your most profitable services.',
  },
];

export const TOUR_STORAGE_KEY = 'colortrack_tour_seen';

export default function AppTourModal({ visible, onClose }) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  useEffect(() => {
    if (visible) {
      setStep(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 200 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    } else {
      slideAnim.setValue(60);
      opacityAnim.setValue(0);
    }
  }, [visible]);

  const goNext = () => {
    if (isLast) { onClose(); return; }
    Animated.sequence([
      Animated.timing(contentOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(contentOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    setTimeout(() => setStep(s => s + 1), 120);
  };

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: opacityAnim }]}>
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom + 24, 40) },
            { transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* Skip */}
          <TouchableOpacity style={styles.skipBtn} onPress={onClose} hitSlop={12}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>

          {/* Step counter */}
          <Text style={styles.stepCount}>{step + 1} of {STEPS.length}</Text>

          {/* Icon */}
          <Animated.View style={[styles.iconArea, { opacity: contentOpacity }]}>
            <View style={[styles.iconCircle, { backgroundColor: current.color }]}>
              <Ionicons name={current.icon} size={40} color="#FFFFFF" />
            </View>
          </Animated.View>

          {/* Text */}
          <Animated.View style={[styles.textArea, { opacity: contentOpacity }]}>
            <Text style={styles.title}>{current.title}</Text>
            <Text style={styles.body}>{current.body}</Text>
          </Animated.View>

          {/* Dots */}
          <View style={styles.dots}>
            {STEPS.map((_, i) => (
              <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
            ))}
          </View>

          {/* CTA */}
          <TouchableOpacity style={styles.btn} onPress={goNext} activeOpacity={0.88}>
            <Text style={styles.btnText}>{isLast ? 'Get started' : 'Next'}</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 20,
    paddingHorizontal: 28,
    alignItems: 'center',
    minHeight: 520,
  },
  skipBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  skipText: {
    fontFamily: FontFamily.medium,
    fontSize: 15,
    color: '#AEAEB2',
  },
  stepCount: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    color: '#AEAEB2',
    letterSpacing: 0.5,
    marginBottom: 28,
  },
  iconArea: {
    marginBottom: 28,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
  },
  textArea: {
    alignItems: 'center',
    paddingHorizontal: 8,
    marginBottom: 32,
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: 24,
    lineHeight: typeLh(24),
    color: '#0D0D0D',
    textAlign: 'center',
    letterSpacing: -0.4,
    marginBottom: 12,
  },
  body: {
    fontFamily: FontFamily.regular,
    fontSize: 15,
    lineHeight: 22,
    color: '#6B6B6B',
    textAlign: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 24,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E5E5EA',
  },
  dotActive: {
    width: 20,
    backgroundColor: '#0D0D0D',
    borderRadius: 3,
  },
  btn: {
    alignSelf: 'stretch',
    backgroundColor: '#0D0D0D',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  btnText: {
    fontFamily: FontFamily.semibold,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
});
