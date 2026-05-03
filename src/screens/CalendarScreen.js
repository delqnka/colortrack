import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  AppState,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { apiGet } from '../api/client';
import { BRAND_PURPLE, glassPurpleFabBar } from '../theme/glassUi';
import {
  fetchDeviceEventDatesInRange,
  fetchDeviceEventsForDay,
  getDeviceCalendarPermissionStatus,
} from '../lib/deviceCalendar';
import { FontFamily } from '../theme/fonts';
import { Type, typeLh } from '../theme/typography';
import { hapticImpactLight } from '../theme/haptics';

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
  const [deviceEvents, setDeviceEvents] = useState([]);
  const [marked, setMarked] = useState(new Set());
  const [deviceMark, setDeviceMark] = useState(new Set());
  const [calPerm, setCalPerm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const ymd = useMemo(() => toYMD(selected), [selected]);

  const fromTo = useMemo(() => {
    const first = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-01`;
    const lastD = daysInMonth(cursor.y, cursor.m);
    const last = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;
    return [first, last];
  }, [cursor]);

  const ymdRef = useRef(ymd);
  const fromToRef = useRef(fromTo);
  const scheduleFocusedRef = useRef(false);
  const monthFetchGen = useRef(0);
  const dayFetchGen = useRef(0);

  useEffect(() => {
    ymdRef.current = ymd;
  }, [ymd]);
  useEffect(() => {
    fromToRef.current = fromTo;
  }, [fromTo]);

  const loadMonthMarks = useCallback(async () => {
    const myGen = ++monthFetchGen.current;
    const [from, to] = fromToRef.current;
    let days = [];
    try {
      days = await apiGet(
        `/api/appointments/days?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
    } catch {
      days = [];
    }
    let dMarks = new Set();
    try {
      dMarks = await fetchDeviceEventDatesInRange(from, to);
    } catch {
      dMarks = new Set();
    }
    if (myGen !== monthFetchGen.current) return;
    setMarked(new Set(Array.isArray(days) ? days : []));
    setDeviceMark(dMarks && typeof dMarks.has === 'function' ? dMarks : new Set());
    try {
      const st = await getDeviceCalendarPermissionStatus();
      if (myGen === monthFetchGen.current) setCalPerm(st);
    } catch {
      if (myGen === monthFetchGen.current) setCalPerm(null);
    }
  }, []);

  const loadDayAgendaOverlay = useCallback(async () => {
    const myGen = ++dayFetchGen.current;
    const day = ymdRef.current;
    setLoading(true);
    try {
      let rows = [];
      let dev = [];
      try {
        ;[rows, dev] = await Promise.all([
          apiGet(`/api/appointments?date=${encodeURIComponent(day)}`),
          fetchDeviceEventsForDay(day),
        ]);
      } catch {
        try {
          rows = await apiGet(`/api/appointments?date=${encodeURIComponent(day)}`);
        } catch {
          rows = [];
        }
        try {
          dev = await fetchDeviceEventsForDay(day);
        } catch {
          dev = [];
        }
      }
      if (myGen !== dayFetchGen.current) return;
      setItems(Array.isArray(rows) ? rows : []);
      setDeviceEvents(Array.isArray(dev) ? dev : []);
    } finally {
      if (myGen === dayFetchGen.current) {
        setLoading(false);
      }
    }
  }, []);

  /** Foreground / pull — does not touch `dayFetchGen` (avoids fighting the overlay loader). */
  const refreshDayAgendaSilent = useCallback(async () => {
    const dayAtStart = ymdRef.current;
    let rows = [];
    let dev = [];
    try {
      ;[rows, dev] = await Promise.all([
        apiGet(`/api/appointments?date=${encodeURIComponent(dayAtStart)}`),
        fetchDeviceEventsForDay(dayAtStart),
      ]);
    } catch {
      try {
        rows = await apiGet(`/api/appointments?date=${encodeURIComponent(dayAtStart)}`);
      } catch {
        rows = [];
      }
      try {
        dev = await fetchDeviceEventsForDay(dayAtStart);
      } catch {
        dev = [];
      }
    }
    if (ymdRef.current !== dayAtStart) return;
    setItems(Array.isArray(rows) ? rows : []);
    setDeviceEvents(Array.isArray(dev) ? dev : []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      scheduleFocusedRef.current = true;
      return () => {
        scheduleFocusedRef.current = false;
      };
    }, []),
  );

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
        await loadMonthMarks();
        if (cancelled) return;
      })();
      return () => {
        cancelled = true;
        monthFetchGen.current += 1;
      };
    }, [fromTo, loadMonthMarks]),
  );

  useFocusEffect(
    useCallback(() => {
      loadDayAgendaOverlay();
      return () => {
        dayFetchGen.current += 1;
        setLoading(false);
      };
    }, [ymd, loadDayAgendaOverlay]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !scheduleFocusedRef.current) return;
      loadMonthMarks();
      refreshDayAgendaSilent();
    });
    return () => sub.remove();
  }, [loadMonthMarks, refreshDayAgendaSilent]);

  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([loadMonthMarks(), refreshDayAgendaSilent()]);
    } finally {
      setPullRefreshing(false);
    }
  }, [loadMonthMarks, refreshDayAgendaSilent]);

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
    hapticImpactLight();
    setSelected(new Date(cursor.y, cursor.m, dayNum));
  };

  function fmtTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDeviceTime(ev) {
    if (ev.allDay) return 'All day';
    const s = new Date(ev.startDate);
    const e = new Date(ev.endDate);
    if (Number.isNaN(s.getTime())) return '';
    const o = { hour: '2-digit', minute: '2-digit' };
    const a = s.toLocaleTimeString(undefined, o);
    const b = Number.isNaN(e.getTime()) ? '' : e.toLocaleTimeString(undefined, o);
    return b ? `${a} – ${b}` : a;
  }

  const mergedRows = useMemo(() => {
    const salon = items.map((a) => {
      const t = new Date(a.start_at).getTime();
      return {
        kind: 'salon',
        key: `s-${a.id}`,
        sort: Number.isFinite(t) ? t : 0,
        salon: a,
      };
    });
    const external = deviceEvents.map((ev) => {
      const t = new Date(ev.startDate).getTime();
      return {
        kind: 'device',
        key: `d-${ev.id}`,
        sort: Number.isFinite(t) ? t : 0,
        ev,
      };
    });
    return [...salon, ...external].sort((x, y) => x.sort - y.sort);
  }, [items, deviceEvents]);

  const openDeviceEventActions = useCallback(
    (ev) => {
      hapticImpactLight();
      const detail =
        [
          fmtDeviceTime(ev),
          ev.location ? String(ev.location) : '',
          ev.notes ? String(ev.notes).slice(0, 400) : '',
        ]
          .filter(Boolean)
          .join('\n') || '—';
      const rawTitle = (ev.title || '').trim();
      const title = rawTitle || 'Calendar';
      const notesSnippet = ev.notes ? String(ev.notes).slice(0, 2000) : '';
      Alert.alert(title, detail, [
        { text: 'Close', style: 'cancel' },
        {
          text: 'New client',
          onPress: () =>
            navigation.navigate('ClientForm', {
              fromDeviceCalendarEventId: String(ev.id),
              initialFullName: rawTitle,
              initialNotesFromCalendar: notesSnippet,
            }),
        },
        {
          text: 'Log visit…',
          onPress: () =>
            navigation.navigate('Clients', {
              pickForCalendarVisit: {
                deviceCalendarEventId: String(ev.id),
                initialProcedure: rawTitle || 'Visit',
                initialDate: ymd,
                initialNotes: notesSnippet || null,
                initialChair: ev.location ? String(ev.location).slice(0, 256) : null,
                suggestedClientName: rawTitle,
              },
            }),
        },
      ]);
    },
    [navigation, ymd],
  );

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
          <Ionicons name="add" size={28} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {calPerm === 'denied' ? (
        <View style={styles.calHint}>
          <Text style={styles.calHintTxt}>
            Calendar access is off — bookings from Booksy, Fresha, and similar won’t appear here.
          </Text>
          <TouchableOpacity onPress={() => Linking.openSettings()} hitSlop={8}>
            <Text style={styles.calHintLink}>Settings</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {calPerm === 'unavailable' ? (
        <View style={styles.calHint}>
          <Text style={styles.calHintTxt}>Device calendar isn’t available on web.</Text>
        </View>
      ) : null}

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
        <View style={styles.calMonthSpacer} />
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
            const hasAppointmentMark = dayNum && (marked.has(key) || deviceMark.has(key));
            return (
              <TouchableOpacity
                key={key}
                style={[styles.cell, isSel && styles.cellSel]}
                onPress={() => pickDay(dayNum)}
                disabled={!dayNum}
                activeOpacity={0.85}
              >
                {dayNum ? (
                  hasAppointmentMark ? (
                    <View style={[styles.dayOutline, isSel && styles.dayOutlineSel]}>
                      <Text style={[styles.cellTxt, isSel && styles.cellTxtSel]}>{dayNum}</Text>
                    </View>
                  ) : (
                    <Text style={[styles.cellTxt, isSel && styles.cellTxtSel]}>{dayNum}</Text>
                  )
                ) : null}
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
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={pullRefreshing}
              onRefresh={onPullRefresh}
              tintColor={BRAND_PURPLE}
            />
          }
        >
          {mergedRows.map((row) =>
            row.kind === 'salon' ? (
              <View key={row.key} style={styles.card}>
                <TouchableOpacity
                  activeOpacity={0.92}
                  onPress={() => {
                    hapticImpactLight();
                    navigation.navigate('AppointmentForm', { appointment: row.salon });
                  }}
                >
                  <Text style={styles.cardTitle}>{row.salon.title}</Text>
                  {row.salon.client_name ? (
                    <Text style={styles.client}>{row.salon.client_name}</Text>
                  ) : null}
                  <Text style={styles.time}>
                    {fmtTime(row.salon.start_at)} – {fmtTime(row.salon.end_at)}
                  </Text>
                  {row.salon.chair_label ? (
                    <Text style={styles.chair}>{row.salon.chair_label}</Text>
                  ) : null}
                </TouchableOpacity>
                {row.salon.client_id ? (
                  <View style={styles.cardActions}>
                    {row.salon.visit_id ? (
                      <TouchableOpacity
                        style={styles.cardActionBtn}
                        onPress={() => {
                          hapticImpactLight();
                          navigation.navigate('VisitDetail', { visitId: row.salon.visit_id });
                        }}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.cardActionTxt}>Visit record</Text>
                        <Ionicons name="open-outline" size={18} color="#5E35B1" />
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={styles.cardActionBtn}
                        onPress={() => {
                          hapticImpactLight();
                          navigation.navigate('FormulaBuilder', {
                            clientId: row.salon.client_id,
                            appointmentId: row.salon.id,
                            initialProcedure: row.salon.procedure_name || row.salon.title,
                            initialDate: row.salon.day_local,
                            initialChair: row.salon.chair_label,
                            initialNotes: row.salon.notes,
                          });
                        }}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.cardActionTxt}>Add color formula</Text>
                        <Ionicons name="flask-outline" size={18} color="#5E35B1" />
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}
              </View>
            ) : (
              <TouchableOpacity
                key={row.key}
                style={styles.deviceCard}
                activeOpacity={0.88}
                onPress={() => openDeviceEventActions(row.ev)}
              >
                <View style={styles.deviceCardTop}>
                  <Ionicons name="phone-portrait-outline" size={20} color="#5E35B1" />
                  <Text style={styles.devicePill}>On this device</Text>
                </View>
                <Text style={styles.deviceTitle}>{row.ev.title || '(No title)'}</Text>
                <Text style={styles.deviceTime}>{fmtDeviceTime(row.ev)}</Text>
                {row.ev.location ? (
                  <Text style={styles.deviceLoc}>{row.ev.location}</Text>
                ) : null}
              </TouchableOpacity>
            ),
          )}
          <View style={{ height: 130 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addBtn: {
    ...glassPurpleFabBar,
  },
  title: { ...Type.screenTitle, color: '#0D0D0D' },
  calHint: {
    marginHorizontal: 24,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5EA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  calHintTxt: { flex: 1, ...Type.secondary, color: '#8A8A8E' },
  calHintLink: {
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.semibold,
    color: '#5E35B1',
  },
  calCard: {
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 15,
    elevation: 10,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
  },
  calMonthSpacer: {
    height: 40,
  },
  monthBtn: { padding: 4 },
  monthTitle: {
    fontSize: 17,
    lineHeight: typeLh(17),
    fontFamily: FontFamily.regular,
    color: '#0D0D0D',
  },
  wdRow: { flexDirection: 'row', marginBottom: 18 },
  wd: {
    flex: 1,
    textAlign: 'center',
    ...Type.calendarWeekdayAbbrev,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 0 },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    maxHeight: 58,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    marginBottom: 2,
  },
  cellSel: { backgroundColor: BRAND_PURPLE },
  /** Days with bookings: hollow circle framing the digit (no filled dot). */
  dayOutline: {
    minWidth: 36,
    minHeight: 36,
    paddingHorizontal: 2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BRAND_PURPLE,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayOutlineSel: {
    borderColor: 'rgba(255,255,255,0.92)',
  },
  cellTxt: {
    ...Type.calendarMonthCell,
  },
  cellTxtSel: { color: '#fff' },
  loader: { paddingTop: 24, alignItems: 'center' },
  list: { paddingHorizontal: 24, paddingBottom: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 18,
    marginBottom: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 15,
    elevation: 10,
  },
  cardTitle: {
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.regular,
    color: '#0D0D0D',
  },
  client: {
    marginTop: 6,
    ...Type.listPrimary,
    color: '#5E35B1',
  },
  time: {
    marginTop: 8,
    ...Type.listPrimary,
    color: '#0D0D0D',
    fontFamily: FontFamily.regular,
  },
  chair: { marginTop: 4, ...Type.secondary, color: '#0D0D0D' },
  cardActions: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5EA',
  },
  cardActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  cardActionTxt: { ...Type.buttonLabel, color: '#5E35B1' },
  deviceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 15,
    elevation: 10,
  },
  deviceCardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  devicePill: {
    ...Type.sectionLabel,
    color: '#5E35B1',
    letterSpacing: 0.4,
    marginBottom: 0,
  },
  deviceTitle: { ...Type.greetingHello, color: '#0D0D0D' },
  deviceTime: { marginTop: 6, ...Type.listPrimary, color: '#0D0D0D', fontFamily: FontFamily.regular },
  deviceLoc: { marginTop: 4, ...Type.secondary, color: '#8A8A8E' },
});
