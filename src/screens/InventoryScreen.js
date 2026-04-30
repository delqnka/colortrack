import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet } from '../api/client';
import { glassPurpleFabBar } from '../theme/glassUi';

const ORDER = ['dye', 'oxidant', 'retail', 'consumable'];

const LABEL = {
  dye: 'Color',
  oxidant: 'Oxidants',
  retail: 'Retail',
  consumable: 'Consumables',
};

function sectionTitle(cat) {
  if (LABEL[cat]) return LABEL[cat];
  const s = String(cat).replace(/_/g, ' ');
  return s.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export default function InventoryScreen({ navigation }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiGet('/api/inventory');
      setRows(Array.isArray(r) ? r : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const grouped = useMemo(() => {
    const m = {};
    for (const item of rows) {
      const key = item.category || 'other';
      if (!m[key]) m[key] = [];
      m[key].push(item);
    }
    return m;
  }, [rows]);

  const sectionKeys = useMemo(() => {
    const keys = Object.keys(grouped);
    const preset = ORDER.filter((k) => grouped[k]?.length);
    const rest = keys.filter((k) => !ORDER.includes(k)).sort((a, b) => a.localeCompare(b));
    return [...preset, ...rest];
  }, [grouped]);

  const lowCount = rows.filter((r) => r.is_low_stock).length;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Inventory</Text>
        <View style={styles.headerRight}>
          {lowCount > 0 ? (
            <View style={styles.badge}>
              <Ionicons name="alert-circle" size={18} color="#fff" />
              <Text style={styles.badgeText}>{lowCount} low</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.addBtn}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('InventoryItem')}
          >
            <Ionicons name="add" size={26} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {sectionKeys.map((cat) => {
            const list = grouped[cat];
            if (!list?.length) return null;
            return (
              <View key={cat} style={styles.section}>
                <Text style={styles.sectionTitle}>{sectionTitle(cat)}</Text>
                {list.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.row, item.is_low_stock && styles.rowLow]}
                    activeOpacity={0.85}
                    onPress={() => navigation.navigate('InventoryItem', { itemId: item.id })}
                  >
                    <View style={styles.rowMain}>
                      <Text style={styles.rowName}>{item.name}</Text>
                      <Text style={styles.rowMeta}>
                        {[item.brand, item.shade_code].filter(Boolean).join(' · ') || '—'}
                      </Text>
                    </View>
                    <View style={styles.qtyRow}>
                      <View style={styles.qty}>
                        <Text style={[styles.qtyVal, item.is_low_stock && styles.qtyWarn]}>
                          {item.quantity} {item.unit}
                        </Text>
                        {item.is_low_stock ? (
                          <Text style={styles.lowLbl}>{item.low_stock_threshold}</Text>
                        ) : null}
                      </View>
                      <Ionicons name="chevron-forward" size={20} color="#1C1C1E" />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}

          <View style={{ height: 130 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 28, fontWeight: '800', color: '#1C1C1E' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addBtn: {
    ...glassPurpleFabBar,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E53935',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  badgeText: { color: '#fff', fontWeight: '400', fontSize: 13 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 },
  section: { marginBottom: 22 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '400',
    color: '#1C1C1E',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowLow: { borderColor: '#FFCDD2', backgroundColor: '#FFF8F8' },
  rowMain: { flex: 1, paddingRight: 12 },
  rowName: { fontSize: 16, fontWeight: '400', color: '#1C1C1E' },
  rowMeta: { marginTop: 4, fontSize: 13, color: '#1C1C1E' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qty: { alignItems: 'flex-end' },
  qtyVal: { fontSize: 16, fontWeight: '400', color: '#1C1C1E' },
  qtyWarn: { color: '#C62828' },
  lowLbl: { marginTop: 4, fontSize: 11, fontWeight: '400', color: '#E53935' },
});
