import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { apiGet } from '../api/client';

const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysInMonth(year, month0) {
  return new Date(year, month0 + 1, 0).getDate();
}

function padMonthGrid(year, month0) {
  const count = daysInMonth(year, month0);
  const start = new Date(year, month0, 1).getDay();
  const cells = [];
  for (let i = 0; i < start; i++) cells.push(null);
  for (let d = 1; d <= count; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function CalendarScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState(() => new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const [items, setItems] = useState([]);
  const [marked, setMarked] = useState(new Set());
  const [loading, setLoading] = useState(true);

  const ymd = useMemo(() => toYMD(selected), [selected]);

  const fromTo = useMemo(() => {
    const first = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-01`;
    const lastD = daysInMonth(cursor.y, cursor.m);
    const last = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;
    return [first, last];
  }, [cursor]);

  useFocusEffect(
    useCallback(() => {
      const open = route.params?.openDate;
      if (typeof open === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(open)) {
        const [y, mo, da] = open.split('-').map(Number);
        setCursor({ y, m: mo - 1 });
        setSelected(new Date(y, mo - 1, da));
        navigation.setParams({ openDate: undefined });
      }
    }, [navigation, route.params?.openDate]),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const [from, to] = fromTo;
          const days = await apiGet(
            `/api/appointments/days?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          );
          if (!cancelled) setMarked(new Set(Array.isArray(days) ? days : []));
        } catch {
          if (!cancelled) setMarked(new Set());
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [fromTo]),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        try {
          const rows = await apiGet(`/api/appointments?date=${encodeURIComponent(ymd)}`);
          if (!cancelled) setItems(Array.isArray(rows) ? rows : []);
        } catch {
          if (!cancelled) setItems([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [ymd]),
  );

  const grid = useMemo(() => padMonthGrid(cursor.y, cursor.m), [cursor]);

  const shiftMonth = (delta) => {
    setCursor((c) => {
      const next = new Date(c.y, c.m + delta, 1);
      const ny = next.getFullYear();
      const nm = next.getMonth();
      setSelected((s) => {
        const day = Math.min(s.getDate(), daysInMonth(ny, nm));
        return new Date(ny, nm, day);
      });
      return { y: ny, m: nm };
    });
  };

  const pickDay = (dayNum) => {
    if (!dayNum) return;
    setSelected(new Date(cursor.y, cursor.m, dayNum));
  };

  function fmtTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  const monthTitle = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Schedule</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('AppointmentForm', { initialDate: ymd })}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={28} color="#1C1C1E" />
        </TouchableOpacity>
      </View>

      <View style={styles.calCard}>
        <View style={styles.monthRow}>
          <TouchableOpacity onPress={() => shiftMonth(-1)} style={styles.monthBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color="#1C1C1E" />
          </TouchableOpacity>
          <Text style={styles.monthTitle}>{monthTitle}</Text>
          <TouchableOpacity onPress={() => shiftMonth(1)} style={styles.monthBtn} hitSlop={8}>
            <Ionicons name="chevron-forward" size={22} color="#1C1C1E" />
          </TouchableOpacity>
        </View>
        <View style={styles.wdRow}>
          {WD.map((w, i) => (
            <Text key={`${w}-${i}`} style={styles.wd}>
              {w}
            </Text>
          ))}
        </View>
        <View style={styles.grid}>
          {grid.map((dayNum, idx) => {
            const key = dayNum ? toYMD(new Date(cursor.y, cursor.m, dayNum)) : `e-${idx}`;
            const isSel =
              dayNum &&
              selected.getFullYear() === cursor.y &&
              selected.getMonth() === cursor.m &&
              selected.getDate() === dayNum;
            const hasDot = dayNum && marked.has(key);
            return (
              <TouchableOpacity
                key={key}
                style={[styles.cell, isSel && styles.cellSel]}
                onPress={() => pickDay(dayNum)}
                disabled={!dayNum}
                activeOpacity={0.85}
              >
                {dayNum ? <Text style={[styles.cellTxt, isSel && styles.cellTxtSel]}>{dayNum}</Text> : null}
                {hasDot ? <View style={[styles.dot, isSel && styles.dotSel]} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {items.map((a) => (
            <TouchableOpacity
              key={a.id}
              style={styles.card}
              activeOpacity={0.92}
              onPress={() => navigation.navigate('AppointmentForm', { appointment: a })}
            >
              <Text style={styles.cardTitle}>{a.title}</Text>
              {a.client_name ? <Text style={styles.client}>{a.client_name}</Text> : null}
              <Text style={styles.time}>
                {fmtTime(a.start_at)} – {fmtTime(a.end_at)}
              </Text>
              {a.chair_label ? <Text style={styles.chair}>{a.chair_label}</Text> : null}
            </TouchableOpacity>
          ))}
          <View style={{ height: 130 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F5FA' },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  title: { fontSize: 28, fontWeight: '800', color: '#1C1C1E' },
  calCard: {
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  monthBtn: { padding: 4 },
  monthTitle: { fontSize: 17, fontWeight: '800', color: '#1C1C1E' },
  wdRow: { flexDirection: 'row', marginBottom: 8 },
  wd: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700', color: '#8E8E93' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    maxHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    marginBottom: 4,
  },
  cellSel: { backgroundColor: '#1C1C1E' },
  cellTxt: { fontSize: 15, fontWeight: '600', color: '#1C1C1E' },
  cellTxtSel: { color: '#fff' },
  dot: {
    position: 'absolute',
    bottom: 6,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#5E35B1',
  },
  dotSel: { backgroundColor: '#fff' },
  loader: { paddingTop: 24, alignItems: 'center' },
  list: { paddingHorizontal: 24, paddingBottom: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 18,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  cardTitle: { fontSize: 17, fontWeight: '800', color: '#1C1C1E' },
  client: { marginTop: 6, fontSize: 15, color: '#5E35B1', fontWeight: '600' },
  time: { marginTop: 8, fontSize: 15, color: '#333', fontWeight: '600' },
  chair: { marginTop: 4, fontSize: 14, color: '#8E8E93' },
});
