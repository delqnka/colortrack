import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { apiGet, apiPost } from '../api/client';
import { FontFamily } from '../theme/fonts';
import { Type, typeLh } from '../theme/typography';

const VIOLET = '#5E35B1';
const DEEP = '#0D0D0D';

function formatEarnings(cents) {
  if (!cents) return '€0.00';
  return `€${(Number(cents) / 100).toFixed(2)}`;
}

function StatCard({ label, value }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function AffiliateScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [affiliate, setAffiliate] = useState(null);
  const [role, setRole] = useState('staff');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const me = await apiGet('/api/me', { allowStaleCache: false });
      setRole(me?.role || 'staff');
      const data = await apiGet('/api/affiliates/me', { allowStaleCache: false });
      setAffiliate(data);
    } catch (e) {
      const msg = String(e?.message || '');
      if (!msg.includes('not_found') && !msg.includes('404')) {
        Alert.alert('', msg || 'Could not load affiliate data.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const createAffiliate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const data = await apiPost('/api/affiliates', {});
      setAffiliate(data);
    } catch (e) {
      Alert.alert('', String(e?.message || 'Could not create affiliate link.'));
    } finally {
      setCreating(false);
    }
  };

  const shareLink = async () => {
    if (!affiliate?.affiliate_code) return;
    const code = affiliate.affiliate_code;
    const deepLink = `colorbar-suite://join?ref=${code}`;
    try {
      await Share.share({
        message: `Try ColorBar Suite — the salon management app! Use my referral link:\n${deepLink}\nOr enter code: ${code}`,
        url: deepLink,
      });
    } catch {
      // user dismissed share sheet
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.topBar}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Ionicons name="chevron-back" size={26} color={DEEP} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Partner Program</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={DEEP} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 32) }]}
          showsVerticalScrollIndicator={false}
        >
          {affiliate ? (
            <>
              <Text style={styles.sectionHint}>Your referral code</Text>

              <View style={styles.codeCard}>
                <Text style={styles.codeText}>{affiliate.affiliate_code}</Text>
                <Text style={styles.commissionBadge}>20% commission</Text>
              </View>

              <TouchableOpacity style={styles.shareBtn} onPress={shareLink} activeOpacity={0.88}>
                <Ionicons name="share-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.shareBtnText}>Share my link</Text>
              </TouchableOpacity>

              <View style={styles.statsRow}>
                <StatCard label="Referrals" value={String(affiliate.total_referrals ?? 0)} />
                <StatCard label="Active" value={String(affiliate.active_referrals ?? 0)} />
                <StatCard label="Earned" value={formatEarnings(affiliate.total_earnings_cents)} />
              </View>

              <View style={styles.infoBox}>
                <Ionicons name="information-circle-outline" size={18} color={VIOLET} style={{ marginRight: 8, marginTop: 1 }} />
                <Text style={styles.infoText}>
                  You earn 20% of every subscription purchased via your link. Earnings are tracked automatically.
                </Text>
              </View>
            </>
          ) : role === 'admin' ? (
            <View style={styles.emptyState}>
              <Ionicons name="link-outline" size={52} color="#AEAEB2" />
              <Text style={styles.emptyTitle}>No affiliate link yet</Text>
              <Text style={styles.emptyBody}>
                Generate your unique referral code and start earning 20% from every subscription via your link.
              </Text>
              <TouchableOpacity
                style={[styles.shareBtn, creating && { opacity: 0.55 }]}
                onPress={createAffiliate}
                disabled={creating}
                activeOpacity={0.88}
              >
                {creating
                  ? <ActivityIndicator color="#FFFFFF" />
                  : <Text style={styles.shareBtnText}>Generate my code</Text>
                }
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="lock-closed-outline" size={52} color="#AEAEB2" />
              <Text style={styles.emptyTitle}>Partner Program</Text>
              <Text style={styles.emptyBody}>Contact your salon admin to get access to the affiliate program.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  topTitle: { ...Type.screenTitle, color: DEEP },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingHorizontal: 24, paddingTop: 8, alignItems: 'center' },

  sectionHint: {
    alignSelf: 'stretch',
    ...Type.sectionLabel,
    marginBottom: 12,
  },
  codeCard: {
    alignSelf: 'stretch',
    borderRadius: 20,
    backgroundColor: VIOLET,
    paddingVertical: 28,
    alignItems: 'center',
    shadowColor: VIOLET,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 8,
    marginBottom: 16,
  },
  codeText: {
    fontFamily: FontFamily.bold,
    fontSize: 36,
    lineHeight: typeLh(36),
    color: '#FFFFFF',
    letterSpacing: 6,
  },
  commissionBadge: {
    marginTop: 8,
    fontFamily: FontFamily.medium,
    fontSize: 13,
    lineHeight: typeLh(13),
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 0.5,
  },

  shareBtn: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    backgroundColor: DEEP,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  shareBtnText: {
    ...Type.buttonLabel,
    color: '#FFFFFF',
  },

  statsRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  statValue: {
    fontFamily: FontFamily.semibold,
    fontSize: 24,
    lineHeight: typeLh(24),
    color: DEEP,
  },
  statLabel: {
    marginTop: 4,
    ...Type.secondary,
  },

  infoBox: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F3F0FF',
    borderRadius: 14,
    padding: 14,
  },
  infoText: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: 13,
    lineHeight: typeLh(13),
    color: VIOLET,
  },

  emptyState: {
    marginTop: 48,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  emptyTitle: {
    marginTop: 16,
    marginBottom: 8,
    ...Type.screenTitle,
    textAlign: 'center',
  },
  emptyBody: {
    ...Type.secondary,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: typeLh(14),
  },
});
