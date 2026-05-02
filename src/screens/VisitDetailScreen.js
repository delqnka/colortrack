import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet } from '../api/client';
import { BRAND_PURPLE } from '../theme/glassUi';
import { SCHEDULE_BANNER_LEAD_PINK } from '../theme/scheduleBannerGradient';
import { FontFamily } from '../theme/fonts';
import { formatDisplayDate } from '../lib/formatDate';
import { useCurrency } from '../context/CurrencyContext';
import { formatMinorFromStoredCents } from '../format/moneyDisplay';

const SECTION_META = {
  roots:     { label: 'Roots',     color: SCHEDULE_BANNER_LEAD_PINK },
  lengths:   { label: 'Lengths',   color: BRAND_PURPLE },
  toner:     { label: 'Toner',     color: '#00897B' },
  other:     { label: 'Other',     color: '#5D4037' },
  developer: { label: 'Developer', color: '#0D74FF' },
};

const UNIT_SET = new Set(['g', 'oz', 'ml']);

function sectionMeta(key) {
  return SECTION_META[key] ?? { label: key, color: '#8E8E93' };
}

function formatLine(fl) {
  const shade = fl.shade_code && fl.shade_code !== '-' && !UNIT_SET.has(fl.shade_code)
    ? fl.shade_code
    : '';
  const unit = UNIT_SET.has(fl.shade_code) ? fl.shade_code : '';
  const name = [fl.brand, shade].filter(Boolean).join(' ');
  const qty = `${Number(fl.amount) % 1 === 0 ? Number(fl.amount) : fl.amount}${unit ? ' ' + unit : ''}`;
  return { name, qty };
}

function buildMixGroups(lines) {
  const groups = [];
  let current = null;
  for (const line of lines) {
    if (line.section === 'developer') {
      if (current) {
        current.developer = line;
        groups.push(current);
        current = null;
      } else {
        groups.push({ section: 'developer', colours: [], developer: line });
      }
    } else {
      if (current && current.section !== line.section) {
        groups.push(current);
        current = null;
      }
      if (!current) current = { section: line.section, colours: [], developer: null };
      current.colours.push(line);
    }
  }
  if (current) groups.push(current);
  return groups;
}

const VISIT_SOURCE_LABEL = {
  device_calendar: 'Device calendar',
  appointment: 'Salon booking',
  manual: 'Manual',
};

export default function VisitDetailScreen({ route, navigation }) {
  const { currency } = useCurrency();
  const visitId = route.params?.visitId;
  const [visit, setVisit] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!visitId) { setLoading(false); return; }
    setLoading(true);
    try {
      setVisit(await apiGet(`/api/visits/${visitId}`));
    } catch {
      setVisit(null);
    } finally {
      setLoading(false);
    }
  }, [visitId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading && !visit) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}><ActivityIndicator color={BRAND_PURPLE} /></View>
      </SafeAreaView>
    );
  }

  if (!visit) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Text style={styles.miss}>Visit not found.</Text>
      </SafeAreaView>
    );
  }

  const lines = visit.formula_lines || [];
  const mixGroups = buildMixGroups(lines);
  const paid = formatMinorFromStoredCents(visit.amount_paid_cents, currency);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── client chip ── */}
        <TouchableOpacity
          style={styles.clientChip}
          onPress={() => navigation.navigate('ClientDetail', { clientId: visit.client_id })}
          activeOpacity={0.75}
        >
          <Ionicons name="person-circle-outline" size={16} color={BRAND_PURPLE} style={{ marginRight: 5 }} />
          <Text style={styles.clientChipTxt} numberOfLines={1}>
            {visit.client?.full_name || 'Client'}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={BRAND_PURPLE} style={{ marginLeft: 2 }} />
        </TouchableOpacity>

        {/* ── hero: procedure + date ── */}
        <Text style={styles.procedure}>{visit.procedure_name}</Text>
        <Text style={styles.date}>{formatDisplayDate(visit.visit_date)}</Text>

        {/* ── meta row ── */}
        <View style={styles.metaRow}>
          {visit.source ? (
            <View style={styles.metaPill}>
              <Text style={styles.metaPillTxt}>
                {VISIT_SOURCE_LABEL[visit.source] || visit.source}
              </Text>
            </View>
          ) : null}
          {paid ? (
            <View style={[styles.metaPill, styles.metaPillGreen]}>
              <Text style={[styles.metaPillTxt, styles.metaPillTxtGreen]}>{paid} paid</Text>
            </View>
          ) : null}
          {visit.chair_label ? (
            <View style={styles.metaPill}>
              <Text style={styles.metaPillTxt}>{visit.chair_label}</Text>
            </View>
          ) : null}
        </View>

        {/* ── notes ── */}
        {visit.notes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>NOTES</Text>
            <Text style={styles.notesBody}>{visit.notes}</Text>
          </View>
        ) : null}

        {/* ── formula ── */}
        {mixGroups.length ? (
          <>
            <Text style={styles.formulaHeading}>Formula</Text>
            {mixGroups.map((group, gi) => {
              const meta = sectionMeta(group.section);
              return (
                <View key={gi} style={styles.mixCard}>
                  {/* section badge */}
                  <View style={styles.mixCardHeader}>
                    <View style={[styles.sectionBadge, { backgroundColor: meta.color + '18' }]}>
                      <Text style={[styles.sectionBadgeTxt, { color: meta.color }]}>
                        {meta.label.toUpperCase()}
                      </Text>
                    </View>
                    {mixGroups.filter(g => g.section === group.section).length > 1 ? (
                      <Text style={styles.mixIndex}>
                        Mix {mixGroups.slice(0, gi + 1).filter(g => g.section === group.section).length}
                      </Text>
                    ) : null}
                  </View>

                  {/* colour rows */}
                  {group.colours.map((fl, ci) => {
                    const { name, qty } = formatLine(fl);
                    return (
                      <View key={fl.id} style={[styles.lineRow, ci < group.colours.length - 1 && styles.lineRowBorder]}>
                        <View style={styles.lineNumBadge}>
                          <Text style={styles.lineNumTxt}>{ci + 1}</Text>
                        </View>
                        <View style={styles.lineBody}>
                          <Text style={styles.lineName} numberOfLines={2}>{name}</Text>
                        </View>
                        <Text style={styles.lineQty}>{qty}</Text>
                        {fl.inventory_item_id ? (
                          <View style={styles.linkedDot} />
                        ) : null}
                      </View>
                    );
                  })}

                  {/* developer row */}
                  {group.developer ? (
                    <View style={styles.devRow}>
                      <View style={[styles.lineNumBadge, styles.lineNumBadgeDev]}>
                        <Ionicons name="flask-outline" size={13} color="#0D74FF" />
                      </View>
                      <View style={styles.lineBody}>
                        <Text style={styles.devName} numberOfLines={2}>
                          {formatLine(group.developer).name}
                        </Text>
                      </View>
                      <Text style={styles.devQty}>{formatLine(group.developer).qty}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </>
        ) : null}

        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F2F2F7' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  miss: { textAlign: 'center', marginTop: 48, color: '#8E8E93', fontFamily: FontFamily.regular, fontSize: 16 },

  scroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24 },

  // client chip
  clientChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: BRAND_PURPLE + '14',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 16,
  },
  clientChipTxt: {
    fontFamily: FontFamily.semibold,
    fontSize: 13,
    color: BRAND_PURPLE,
    maxWidth: 200,
  },

  // hero
  procedure: {
    fontFamily: FontFamily.bold,
    fontSize: 34,
    color: '#000000',
    letterSpacing: -0.8,
    lineHeight: 40,
    marginBottom: 6,
  },
  date: {
    fontFamily: FontFamily.regular,
    fontSize: 15,
    color: '#8E8E93',
    marginBottom: 14,
  },

  // meta pills
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  metaPill: {
    backgroundColor: '#E5E5EA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  metaPillTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    color: '#3C3C43',
  },
  metaPillGreen: { backgroundColor: '#E8F5E9' },
  metaPillTxtGreen: { color: '#2E7D32' },

  // notes
  notesBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
    marginBottom: 4,
  },
  notesLabel: {
    fontFamily: FontFamily.semibold,
    fontSize: 11,
    color: '#8E8E93',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  notesBody: {
    fontFamily: FontFamily.regular,
    fontSize: 15,
    color: '#1C1C1E',
    lineHeight: 22,
  },

  // formula heading
  formulaHeading: {
    fontFamily: FontFamily.bold,
    fontSize: 22,
    color: '#000000',
    letterSpacing: -0.5,
    marginTop: 28,
    marginBottom: 12,
  },

  // mix card
  mixCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingTop: 14,
    paddingBottom: 6,
    paddingHorizontal: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  mixCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sectionBadgeTxt: {
    fontFamily: FontFamily.bold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  mixIndex: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    color: '#8E8E93',
  },

  // colour line
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    gap: 10,
  },
  lineRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  lineNumBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  lineNumTxt: {
    fontFamily: FontFamily.semibold,
    fontSize: 12,
    color: '#3C3C43',
  },
  lineBody: { flex: 1 },
  lineName: {
    fontFamily: FontFamily.semibold,
    fontSize: 15,
    color: '#000000',
    letterSpacing: -0.2,
  },
  lineQty: {
    fontFamily: FontFamily.bold,
    fontSize: 15,
    color: '#1C1C1E',
    letterSpacing: -0.3,
    flexShrink: 0,
  },
  linkedDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: SCHEDULE_BANNER_LEAD_PINK,
    flexShrink: 0,
  },

  // developer row
  devRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5EA',
  },
  lineNumBadgeDev: {
    backgroundColor: '#EEF4FF',
  },
  devName: {
    fontFamily: FontFamily.regular,
    fontSize: 14,
    color: '#0D74FF',
    letterSpacing: -0.1,
  },
  devQty: {
    fontFamily: FontFamily.bold,
    fontSize: 14,
    color: '#0D74FF',
    letterSpacing: -0.2,
    flexShrink: 0,
  },
});
