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
import { typeLh } from '../theme/typography';
import WelcomeProModal from '../components/WelcomeProModal';

const VIOLET = '#5E35B1';
const DEEP = '#0D0D0D';

const FEATURES = [
  'Unlimited clients & color dossiers',
  'Formula builder & Lab',
  'Appointments & calendar',
  'Inventory management',
  'Finance & revenue reports',
  'Affiliate partner program',
];

async function scheduleTrialReminder() {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.content.data?.type === 'trial_reminder') {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
    const reminderDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Your free trial ends in 2 days',
        body: 'Subscribe now to keep access to ColorBar Suite Pro.',
        data: { type: 'trial_reminder' },
      },
      trigger: { type: 'date', date: reminderDate },
    });
  } catch { /* best-effort */ }
}

export default function PaywallScreen({ onDismiss }) {
  const insets = useSafeAreaInsets();
  const [offering, setOffering] = useState(null);
  const [loadingOffering, setLoadingOffering] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [remindMe, setRemindMe] = useState(true);
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    Purchases.getOfferings()
      .then((o) => setOffering(o.current?.availablePackages?.[0] ?? null))
      .catch(() => setOffering(null))
      .finally(() => setLoadingOffering(false));
  }, []);

  const priceString = offering?.product?.priceString ?? '—';

  const startTrial = async () => {
    if (!offering || purchasing) return;
    setPurchasing(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(offering);
      if (customerInfo.entitlements.active[ENTITLEMENT_ID]) {
        if (remindMe) await scheduleTrialReminder();
        setShowWelcome(true);
      }
    } catch (e) {
      if (!e.userCancelled) Alert.alert('', String(e?.message || 'Try again later.'));
    } finally {
      setPurchasing(false);
    }
  };

  const restore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const info = await Purchases.restorePurchases();
      if (info.entitlements.active[ENTITLEMENT_ID]) {
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
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={{ width: 32 }} />
        <Text style={styles.topTitle}>ColorBar Suite Pro</Text>
        {onDismiss ? (
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => onDismiss({ subscribed: false })}
            hitSlop={12}
          >
            <Ionicons name="close" size={18} color="#AEAEB2" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 32 }} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom + 24, 48) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Trial badge */}
        <View style={styles.trialBadgeRow}>
          <View style={styles.trialBadge}>
            <Text style={styles.trialBadgeText}>7-DAY FREE TRIAL</Text>
          </View>
        </View>

        {/* Headline */}
        <Text style={styles.headline}>Everything you need{'\n'}to run your salon.</Text>
        <Text style={styles.sub}>Start free. Cancel anytime.</Text>

        {/* Feature list */}
        <View style={styles.featuresList}>
          {FEATURES.map((f) => (
            <View key={f} style={styles.featureRow}>
              <View style={styles.check}>
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              </View>
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        {/* Plan card */}
        <View style={styles.planCard}>
          <View style={styles.planCardAccent} />
          <View style={styles.planCardInner}>
            <View>
              <Text style={styles.planName}>Monthly Pro</Text>
              <Text style={styles.planNote}>
                Free for 7 days, then {priceString}/month
              </Text>
            </View>
            <View style={styles.planPriceCol}>
              <Text style={styles.planPrice}>
                {loadingOffering ? '…' : priceString}
              </Text>
              <Text style={styles.planPricePer}>/mo</Text>
            </View>
          </View>
        </View>

        {/* Remind me */}
        <View style={styles.remindRow}>
          <Ionicons name="notifications-outline" size={18} color={DEEP} />
          <Text style={styles.remindText}>Remind me 2 days before trial ends</Text>
          <Switch
            value={remindMe}
            onValueChange={setRemindMe}
            trackColor={{ false: '#E5E5EA', true: VIOLET }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={[styles.ctaBtn, (purchasing || loadingOffering) && styles.ctaBtnDisabled]}
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
        <TouchableOpacity style={styles.restoreBtn} onPress={restore} disabled={restoring}>
          {restoring
            ? <ActivityIndicator color="#AEAEB2" size="small" />
            : <Text style={styles.restoreText}>Restore purchase</Text>
          }
        </TouchableOpacity>

        <WelcomeProModal
          visible={showWelcome}
          onClose={() => { setShowWelcome(false); onDismiss?.({ subscribed: true }); }}
        />

        {/* Legal */}
        <Text style={styles.legal}>
          Charged to your {Platform.OS === 'ios' ? 'Apple ID' : 'Google Play'} account at purchase confirmation.
          Renews automatically unless cancelled 24 h before the period ends.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
    paddingTop: 4,
  },
  topTitle: {
    fontFamily: FontFamily.semibold,
    fontSize: 17,
    lineHeight: typeLh(17),
    color: DEEP,
    letterSpacing: -0.2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },

  trialBadgeRow: {
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  trialBadge: {
    paddingVertical: 2,
  },
  trialBadgeText: {
    fontFamily: FontFamily.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: VIOLET,
  },

  headline: {
    fontFamily: FontFamily.bold,
    fontSize: 30,
    lineHeight: typeLh(30),
    color: DEEP,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  sub: {
    fontFamily: FontFamily.regular,
    fontSize: 15,
    lineHeight: typeLh(15),
    color: '#8A8A8E',
    marginBottom: 28,
  },

  featuresList: {
    marginBottom: 24,
    gap: 12,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#452277',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    fontFamily: FontFamily.medium,
    fontSize: 15,
    lineHeight: typeLh(15),
    color: DEEP,
  },

  planCard: {
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    marginBottom: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 16,
    elevation: 5,
    overflow: 'hidden',
  },
  planCardAccent: {
    height: 4,
    backgroundColor: VIOLET,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  planCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
  },
  planName: {
    fontFamily: FontFamily.semibold,
    fontSize: 17,
    color: DEEP,
    marginBottom: 4,
  },
  planNote: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    lineHeight: typeLh(13),
    color: '#8A8A8E',
  },
  planPriceCol: {
    alignItems: 'flex-end',
  },
  planPrice: {
    fontFamily: FontFamily.bold,
    fontSize: 26,
    lineHeight: typeLh(26),
    color: DEEP,
    letterSpacing: -0.5,
  },
  planPricePer: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    color: '#8A8A8E',
  },

  remindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 4,
    marginBottom: 20,
  },
  remindText: {
    flex: 1,
    fontFamily: FontFamily.medium,
    fontSize: 14,
    lineHeight: typeLh(14),
    color: DEEP,
  },

  ctaBtn: {
    backgroundColor: DEEP,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 5,
  },
  ctaBtnDisabled: { opacity: 0.55 },
  ctaBtnText: {
    fontFamily: FontFamily.semibold,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },

  restoreBtn: {
    alignSelf: 'center',
    paddingVertical: 10,
    marginBottom: 16,
  },
  restoreText: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    color: '#AEAEB2',
  },

  legal: {
    fontFamily: FontFamily.regular,
    fontSize: 11,
    lineHeight: 16,
    color: '#C7C7CC',
    textAlign: 'center',
  },
});
