import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet } from '../api/client';

const SECTION_LABEL = {
  roots: 'Roots',
  lengths: 'Lengths',
  toner: 'Toner',
  other: 'Other',
};

export default function ClientDetailScreen({route, navigation}) {
  const clientId = route.params?.clientId;
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const c = await apiGet(`/api/clients/${clientId}`);
      setClient(c);
    } catch {
      setClient(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading && !client) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (!client) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.miss}>Client not found.</Text>
      </SafeAreaView>
    );
  }

  const visits = client.visits || [];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.top}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color="#1C1C1E" />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Dossier</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('ClientForm', { clientId })}
          style={styles.back}
          hitSlop={12}
        >
          <Ionicons name="pencil" size={20} color="#1C1C1E" />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Image
          source={{
            uri:
              client.avatar_url ||
              'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=400&auto=format&fit=crop',
          }}
          style={styles.hero}
        />
        <Text style={styles.name}>{client.full_name}</Text>
        {client.phone ? <Text style={styles.meta}>{client.phone}</Text> : null}

        <TouchableOpacity
          style={styles.cta}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('FormulaBuilder', { clientId })}
        >
          <Ionicons name="brush-outline" size={22} color="#fff" />
          <Text style={styles.ctaText}>Visit</Text>
        </TouchableOpacity>

        {client.patch_overdue ? (
          <View style={styles.alert}>
            <Ionicons name="warning" size={20} color="#B71C1C" />
            <Text style={styles.alertText}>Patch</Text>
          </View>
        ) : (
          <View style={styles.okBadge}>
            <Ionicons name="checkmark-circle" size={18} color="#2E7D32" />
            <Text style={styles.okText}>Patch OK</Text>
          </View>
        )}

        <Text style={styles.section}>Visits</Text>
        {visits.length === 0 ? null : (
          visits.map((v) => (
            <View key={v.id} style={styles.visitCard}>
              <Text style={styles.visitTitle}>{v.procedure_name}</Text>
              <Text style={styles.visitDate}>{v.visit_date}</Text>
              {v.chair_label ? <Text style={styles.visitSub}>{v.chair_label}</Text> : null}
              {v.formula_lines?.length ? (
                <View style={styles.formulaBox}>
                  {v.formula_lines.map((fl) => (
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
              ) : null}
            </View>
          ))
        )}

        <Text style={styles.section}>Photos</Text>
        <View style={styles.placeholder}>
          <Ionicons name="images-outline" size={28} color="#8E8E93" />
        </View>
        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F5FA' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  miss: { textAlign: 'center', marginTop: 48, color: '#8E8E93' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: { fontSize: 17, fontWeight: '700', color: '#1C1C1E' },
  scroll: { paddingHorizontal: 24, paddingBottom: 32 },
  hero: {
    width: '100%',
    height: 200,
    borderRadius: 24,
    backgroundColor: '#ddd',
    marginTop: 8,
  },
  name: { marginTop: 20, fontSize: 24, fontWeight: '800', color: '#1C1C1E' },
  meta: { marginTop: 6, fontSize: 15, color: '#8E8E93' },
  cta: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#5E35B1',
    paddingVertical: 14,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  alert: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    padding: 14,
    borderRadius: 16,
  },
  alertText: { flex: 1, color: '#B71C1C', fontWeight: '600', fontSize: 14 },
  okBadge: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#E8F5E9',
    padding: 12,
    borderRadius: 16,
    alignSelf: 'flex-start',
  },
  okText: { color: '#2E7D32', fontWeight: '600' },
  section: { marginTop: 28, fontSize: 18, fontWeight: '800', color: '#1C1C1E', marginBottom: 12 },
  visitCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  visitTitle: { fontSize: 16, fontWeight: '700', color: '#1C1C1E' },
  visitDate: { marginTop: 6, fontSize: 14, color: '#8E8E93' },
  visitSub: { marginTop: 4, fontSize: 13, color: '#555' },
  formulaBox: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5EA' },
  formulaLine: { fontSize: 13, color: '#333', marginBottom: 6, lineHeight: 18 },
  formulaSec: { fontWeight: '800', color: '#5E35B1' },
  placeholder: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderStyle: 'dashed',
  },
});
