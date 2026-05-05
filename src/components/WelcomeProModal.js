import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FontFamily } from '../theme/fonts';
import { typeLh } from '../theme/typography';

const VIOLET = '#452277';

const UNLOCKED = [
  { icon: 'people',           text: 'Unlimited clients & dossiers' },
  { icon: 'flask',            text: 'Formula builder & Lab' },
  { icon: 'calendar',         text: 'Appointments & calendar' },
  { icon: 'cube',             text: 'Inventory management' },
  { icon: 'stats-chart',      text: 'Finance & revenue reports' },
];

export default function WelcomeProModal({ visible, onClose }) {
  const insets = useSafeAreaInsets();
  const scaleAnim = useRef(new Animated.Value(0.88)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 180 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    } else {
      scaleAnim.setValue(0.88);
      opacityAnim.setValue(0);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: opacityAnim }]}>
        <Animated.View
          style={[
            styles.card,
            { paddingBottom: Math.max(insets.bottom + 24, 40) },
            { transform: [{ scale: scaleAnim }] },
          ]}
        >
          {/* Icon */}
          <View style={styles.iconWrap}>
            <Ionicons name="checkmark" size={36} color="#FFFFFF" />
          </View>

          {/* Heading */}
          <Text style={styles.title}>You're now Pro</Text>
          <Text style={styles.sub}>All features are unlocked.</Text>

          {/* Features */}
          <View style={styles.list}>
            {UNLOCKED.map((f) => (
              <View key={f.text} style={styles.row}>
                <Ionicons name={f.icon} size={16} color={VIOLET} style={styles.rowIcon} />
                <Text style={styles.rowText}>{f.text}</Text>
              </View>
            ))}
          </View>

          {/* CTA */}
          <TouchableOpacity
            style={styles.btn}
            onPress={onClose}
            activeOpacity={0.88}
          >
            <Text style={styles.btnText}>Start exploring</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 32,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: VIOLET,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: VIOLET,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: 28,
    lineHeight: typeLh(28),
    color: '#0D0D0D',
    letterSpacing: -0.5,
    marginBottom: 6,
    textAlign: 'center',
  },
  sub: {
    fontFamily: FontFamily.regular,
    fontSize: 15,
    color: '#8A8A8E',
    marginBottom: 28,
    textAlign: 'center',
  },
  list: {
    alignSelf: 'stretch',
    marginBottom: 32,
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowIcon: {
    width: 24,
    marginRight: 12,
  },
  rowText: {
    fontFamily: FontFamily.medium,
    fontSize: 15,
    lineHeight: typeLh(15),
    color: '#0D0D0D',
  },
  btn: {
    alignSelf: 'stretch',
    backgroundColor: '#0D0D0D',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
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
