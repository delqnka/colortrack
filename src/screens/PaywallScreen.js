import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Switch,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Purchases from 'react-native-purchases';
import * as Notifications from 'expo-notifications';
import { ENTITLEMENT_ID } from '../hooks/useEntitlement';
import { FontFamily } from '../theme/fonts';
import { Type, typeLh } from '../theme/typography';

const VIOLET = '#5E35B1';
const DEEP = '#0D0D0D';

const FEATURES = [
  { icon: 'people-outline',       text: 'Unlimited clients & dossiers' },
  { icon: 'calendar-outline',     text: 'Appointments & calendar sync' },
  { icon: 'flask-outline',        text: 'Formula builder & Lab' },
  { icon: 'cube-outline',         text: 'Inventory management' },
  { icon: 'stats-chart-outline',  text: 'Finance & revenue reports' },
];

async function scheduleTrialReminder() {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    // Cancel any existing trial reminders first
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.content.data?.type === 'trial_reminder') {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
    // Schedule 5 days from now (2 days before 7-day trial ends)
    const reminderDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '⏰ Your free trial ends in 2 days',
        body: 'Subscribe now to keep access to ColorBar Suite Pro.',
        data: { type: 'trial_reminder' },
      },
      trigger: { type: 'date', date: reminderDate },
    });
  } catch {
    // noop — notification scheduling is best-effort
  }
}

export default function PaywallScreen({ onDismiss }) {
  const insets = useSafeAreaInsets();
  const [offering, setOffering] = useState(null);
  const [loadingOffering, setLoadingOffering] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [remindMe, setRemindMe] = useState(true);

  useEffect(() => {
    Purchases.getOfferings()
      .then((offerings) => {
        const pkg = offerings.current?.availablePackages?.[0] ?? null;
        setOffering(pkg);
      })
      .catch(() => setOffering(null))
      .finally(() => setLoadingOffering(false));
  }, []);

  const priceText = offering
    ? offering.product.priceString
    : '—';

  const startTrial = async () => {
    if (!offering || purchasing) return;
    setPurchasing(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(offering);
      const isActive = Boolean(customerInfo.entitlements.active[ENTITLEMENT_ID]);
      if (isActive) {
        if (remindMe) await scheduleTrialReminder();
        onDismiss?.({ subscribed: true });
      }
    } catch (e) {
      if (!e.userCancelled) {
        Alert.alert('Purchase failed', String(e?.message || 'Try again later.'));
      }
    } finally {
      setPurchasing(false);
    }
  };

  const restorePurchases = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const info = await Purchases.restorePurchases();
      const isActive = Boolean(info.entitlements.active[ENTITLEMENT_ID]);
      if (isActive) {
        onDismiss?.({ subscribed: true });
      } else {
        Alert.alert('', 'No active subscription found.');
      }
    } catch (e) {
      Alert.alert('', String(e?.message || 'Could not restore.'));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {onDismiss && (
        <TouchableOpacity
          style={[styles.closeBtn, { top: insets.top + 8 }]}
          onPress={() => onDismiss({ subscribed: false })}
          hitSlop={12}
        >
          <Ionicons name="close" size={22} color="#AEAEB2" />
        </TouchableOpacity>
      )}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom + 16, 40) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.heroArea}>
          <View style={styles.iconCircle}>
            <Ionicons name="cut-outline" size={36} color="#FFFFFF" />
          </View>
          <Text style={styles.heroTitle}>ColorBar Suite Pro</Text>
          <Text style={styles.heroSub}>
            Everything you need to run your salon — clients, formulas, inventory and finance in one place.
          </Text>
        </View>

        {/* Features */}
        <View style={styles.featuresCard}>
          {FEATURES.map((f) => (
            <View key={f.text} style={styles.featureRow}>
              <View style={styles.featureIconWrap}>
                <Ionicons name={f.icon} size={18} color={VIOLET} />
              </View>
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        {/* Plan */}
        <View style={styles.planCard}>
          <View style={styles.trialBadge}>
            <Text style={styles.trialBadgeText}>7-DAY FREE TRIAL</Text>
          </View>
          <Text style={styles.planName}>Monthly Pro</Text>
          <Text style={styles.planPrice}>
            {loadingOffering ? '…' : priceText}
            <Text style={styles.planPer}> / month</Text>
          </Text>
          <Text style={styles.planNote}>Free for 7 days, then billed monthly. Cancel anytime.</Text>
        </View>

        {/* Remind me toggle */}
        <View style={styles.remindRow}>
          <View style={styles.remindLeft}>
            <Ionicons name="notifications-outline" size={18} color={DEEP} style={{ marginRight: 10 }} />
            <Text style={styles.remindText}>Remind me 2 days before trial ends</Text>
          </View>
          <Switch
            value={remindMe}
            onValueChange={setRemindMe}
            trackColor={{ false: '#E5E5EA', true: VIOLET }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={[styles.ctaBtn, (purchasing || loadingOffering) && { opacity: 0.6 }]}
          onPress={startTrial}
          disabled={purchasing || loadingOffering || !offering}
          activeOpacity={0.88}
        >
          {purchasing
            ? <ActivityIndicator color="#FFFFFF" />
            : <Text style={styles.ctaBtnText}>Start Free Trial</Text>
          }
        </TouchableOpacity>

        {/* Restore */}
        <TouchableOpacity style={styles.restoreBtn} onPress={restorePurchases} disabled={restoring}>
          {restoring
            ? <ActivityIndicator color="#AEAEB2" size="small" />
            : <Text style={styles.restoreText}>Restore purchase</Text>
          }
        </TouchableOpacity>

        <Text style={styles.legal}>
          Payment will be charged to your {Platform.OS === 'ios' ? 'Apple ID' : 'Google Play'} account at confirmation of purchase. Subscription automatically renews unless cancelled at least 24 hours before the end of the current period.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  closeBtn: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 24,
    alignItems: 'center',
  },

  heroArea: { alignItems: 'center', marginBottom: 24, marginTop: 16 },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: VIOLET,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: VIOLET,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  heroTitle: {
    fontFamily: FontFamily.bold,
    fontSize: 26,
    lineHeight: typeLh(26),
    color: DEEP,
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSub: {
    ...Type.secondary,
    textAlign: 'center',
    lineHeight: typeLh(14),
    paddingHorizontal: 8,
  },

  featuresCard: {
    alignSelf: 'stretch',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  featureRow: { flexDirection: 'row', alignItems: 'center' },
  featureIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F3F0FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  featureText: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
    lineHeight: typeLh(14),
    color: DEEP,
  },

  planCard: {
    alignSelf: 'stretch',
    borderRadius: 18,
    backgroundColor: VIOLET,
    padding: 20,
    marginBottom: 14,
    alignItems: 'center',
    shadowColor: VIOLET,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
  },
  trialBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 10,
  },
  trialBadgeText: {
    fontFamily: FontFamily.bold,
    fontSize: 11,
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  planName: {
    fontFamily: FontFamily.semibold,
    fontSize: 18,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  planPrice: {
    fontFamily: FontFamily.bold,
    fontSize: 32,
    lineHeight: typeLh(32),
    color: '#FFFFFF',
  },
  planPer: {
    fontFamily: FontFamily.regular,
    fontSize: 16,
    color: 'rgba(255,255,255,0.75)',
  },
  planNote: {
    marginTop: 8,
    fontFamily: FontFamily.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },

  remindRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F9F9FB',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  remindLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  remindText: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
    lineHeight: typeLh(14),
    color: DEEP,
    flex: 1,
  },

  ctaBtn: {
    alignSelf: 'stretch',
    backgroundColor: DEEP,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  ctaBtnText: {
    fontFamily: FontFamily.semibold,
    fontSize: 17,
    color: '#FFFFFF',
  },

  restoreBtn: { paddingVertical: 10, marginBottom: 16 },
  restoreText: { ...Type.secondary, color: '#AEAEB2' },

  legal: {
    fontFamily: FontFamily.regular,
    fontSize: 11,
    lineHeight: typeLh(11),
    color: '#AEAEB2',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
