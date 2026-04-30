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
import { glassPurpleIconBtn } from '../theme/glassUi';
import { formatDisplayDate } from '../lib/formatDate';

const SECTION_LABEL = {
  roots: 'Roots',
  lengths: 'Lengths',
  toner: 'Toner',
  other: 'Other',
};

function formatUsdFromCents(cents) {
  if (cents == null || cents === '') return null;
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n / 100);
  } catch {
    return `$${(n / 100).toFixed(2)}`;
  }
}

const VISIT_SOURCE_LABEL = {
  device_calendar: 'Device calendar',
  appointment: 'Salon booking',
  manual: 'Manual',
};

export default function VisitDetailScreen({ route, navigation }) {
  const visitId = route.params?.visitId;
  const [visit, setVisit] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!visitId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const v = await apiGet(`/api/visits/${visitId}`);
      setVisit(v);
    } catch {
      setVisit(null);
    } finally {
      setLoading(false);
    }
  }, [visitId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading && !visit) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (!visit) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.top}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Visit</Text>
          <View style={{ width: 40 }} />
        </View>
        <Text style={styles.miss}>Not found.</Text>
      </SafeAreaView>
    );
  }

  const lines = visit.formula_lines || [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.top}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Visit</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          style={styles.clientRow}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('ClientDetail', { clientId: visit.client_id })}
        >
          <Text style={styles.clientName} numberOfLines={1}>
            {visit.client?.full_name || 'Client'}
          </Text>
          <Ionicons name="chevron-forward" size={20} color="#1C1C1E" />
        </TouchableOpacity>

        <Text style={styles.proc}>{visit.procedure_name}</Text>
        <Text style={styles.date}>{formatDisplayDate(visit.visit_date)}</Text>
        {formatUsdFromCents(visit.amount_paid_cents) ? (
          <Text style={styles.paid}>{formatUsdFromCents(visit.amount_paid_cents)} paid</Text>
        ) : null}
        {visit.source ? (
          <Text style={styles.sourceHint}>{VISIT_SOURCE_LABEL[visit.source] || visit.source}</Text>
        ) : null}
        {visit.chair_label ? <Text style={styles.sub}>{visit.chair_label}</Text> : null}

        {visit.notes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesBody}>{visit.notes}</Text>
          </View>
        ) : null}

        {lines.length ? (
          <>
            <Text style={styles.section}>Formula</Text>
            <View style={styles.formulaCard}>
              {lines.map((fl) => (
                <Text key={fl.id} style={styles.formulaLine}>
                  <Text style={styles.formulaSec}>{SECTION_LABEL[fl.section] || fl.section}</Text>
                  {' · '}
                  {fl.brand} {fl.shade_code !== '-' ? fl.shade_code : ''}
                  {' — '}
                  {fl.amount}
                  {fl.inventory_item_id ? ' · \u25CF' : ''}
                </Text>
              ))}
            </View>
          </>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  miss: { textAlign: 'center', marginTop: 24, color: '#1C1C1E' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  iconBtn: {
    ...glassPurpleIconBtn,
  },
  topTitle: { fontSize: 17, fontWeight: '400', color: '#1C1C1E' },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 },
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    marginTop: 8,
  },
  clientName: { flex: 1, fontSize: 16, fontWeight: '400', color: '#5E35B1' },
  proc: { marginTop: 20, fontSize: 22, fontWeight: '400', color: '#1C1C1E' },
  date: { marginTop: 6, fontSize: 15, color: '#1C1C1E' },
  paid: { marginTop: 8, fontSize: 16, fontWeight: '500', color: '#2E7D32' },
  sourceHint: { marginTop: 4, fontSize: 13, color: '#007AFF' },
  sub: { marginTop: 4, fontSize: 14, color: '#1C1C1E' },
  notesBox: {
    marginTop: 20,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
  },
  notesLabel: { fontSize: 12, fontWeight: '400', color: '#1C1C1E', marginBottom: 8 },
  notesBody: { fontSize: 15, color: '#1C1C1E', lineHeight: 22 },
  section: { marginTop: 28, fontSize: 18, fontWeight: '400', color: '#1C1C1E', marginBottom: 12 },
  formulaCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
  },
  formulaLine: { fontSize: 14, color: '#1C1C1E', marginBottom: 8, lineHeight: 20 },
  formulaSec: { fontWeight: '400', color: '#5E35B1' },
});
