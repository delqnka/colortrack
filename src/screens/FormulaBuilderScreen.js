import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { apiGet, apiPost } from '../api/client';
import { BRAND_PURPLE, glassPurpleIconBtn } from '../theme/glassUi';
import { formatDisplayDate, parseISODateToLocal } from '../lib/formatDate';

const SECTIONS = [
  { key: 'roots', label: 'Roots' },
  { key: 'lengths', label: 'Lengths' },
  { key: 'toner', label: 'Toner' },
  { key: 'other', label: 'Other' },
];

function newLine() {
  return {
    key: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    section: 'roots',
    brand: '',
    shade_code: '',
    amount: '',
    inventory_item_id: null,
    stockLabel: null,
  };
}

function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function FormulaBuilderScreen({ route, navigation }) {
  const clientId = route.params?.clientId;

  const [procedureName, setProcedureName] = useState('');
  const [chairLabel, setChairLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [amountUsd, setAmountUsd] = useState('');
  const [visitDate, setVisitDate] = useState(() => toYMD(new Date()));
  const [lines, setLines] = useState(() => [newLine()]);

  const [linkedAppointmentId, setLinkedAppointmentId] = useState(null);
  const prefilledApptRef = useRef(null);
  const prefilledDeviceCalRef = useRef(null);

  const [inventory, setInventory] = useState([]);
  const [loadingStock, setLoadingStock] = useState(true);
  const [pickerForKey, setPickerForKey] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [datePickMode, setDatePickMode] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiGet('/api/inventory');
        if (!cancelled) setInventory(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setInventory([]);
      } finally {
        if (!cancelled) setLoadingStock(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const aid = route.params?.appointmentId;
      if (aid != null && Number(aid) > 0) {
        const n = Number(aid);
        setLinkedAppointmentId(n);
        prefilledDeviceCalRef.current = null;
        if (prefilledApptRef.current !== n) {
          prefilledApptRef.current = n;
          const ip = route.params?.initialProcedure;
          if (ip != null && String(ip).trim()) setProcedureName(String(ip).trim());
          const id = route.params?.initialDate;
          if (id && /^\d{4}-\d{2}-\d{2}$/.test(String(id))) setVisitDate(String(id));
          const ic = route.params?.initialChair;
          if (ic != null && String(ic).trim()) setChairLabel(String(ic).trim());
          const ino = route.params?.initialNotes;
          if (ino != null && String(ino).trim()) setNotes(String(ino).trim());
        }
      } else {
        setLinkedAppointmentId(null);
        prefilledApptRef.current = null;
        const dcid = route.params?.deviceCalendarEventId;
        if (dcid != null && String(dcid).trim()) {
          const key = String(dcid).trim();
          if (prefilledDeviceCalRef.current !== key) {
            prefilledDeviceCalRef.current = key;
            const ip = route.params?.initialProcedure;
            if (ip != null && String(ip).trim()) setProcedureName(String(ip).trim());
            const id = route.params?.initialDate;
            if (id && /^\d{4}-\d{2}-\d{2}$/.test(String(id))) setVisitDate(String(id));
            const ic = route.params?.initialChair;
            if (ic != null && String(ic).trim()) setChairLabel(String(ic).trim());
            const ino = route.params?.initialNotes;
            if (ino != null && String(ino).trim()) setNotes(String(ino).trim());
          }
        } else {
          prefilledDeviceCalRef.current = null;
        }
      }
    }, [
      route.params?.appointmentId,
      route.params?.deviceCalendarEventId,
      route.params?.initialProcedure,
      route.params?.initialDate,
      route.params?.initialChair,
      route.params?.initialNotes,
    ]),
  );

  const updateLine = (key, patch) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const addRow = () => setLines((prev) => [...prev, newLine()]);
  const removeRow = (key) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));
  };

  const pickStock = (item) => {
    if (!pickerForKey) return;
    updateLine(pickerForKey, {
      inventory_item_id: item.id,
      stockLabel: `${item.brand ? item.brand + ' ' : ''}${item.name}${item.shade_code ? ' · ' + item.shade_code : ''}`,
      brand: item.brand || item.name || '',
      shade_code: item.shade_code || '-',
    });
    setPickerForKey(null);
  };

  const clearStock = (key) => {
    updateLine(key, { inventory_item_id: null, stockLabel: null });
  };

  const submit = async () => {
    const proc = procedureName.trim();
    if (!proc) {
      Alert.alert('', 'Procedure');
      return;
    }
    const validLines = lines
      .map((l) => ({
        section: l.section,
        brand: l.brand.trim(),
        shade_code: (l.shade_code || '').trim() || '-',
        amount: Number(String(l.amount).replace(',', '.')),
        inventory_item_id: l.inventory_item_id,
      }))
      .filter((l) => l.brand && Number.isFinite(l.amount) && l.amount > 0);

    if (validLines.length === 0) {
      Alert.alert('', 'Formula');
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        client_id: clientId,
        visit_date: /^\d{4}-\d{2}-\d{2}$/.test(visitDate) ? visitDate : undefined,
        procedure_name: proc,
        chair_label: chairLabel.trim() || null,
        notes: notes.trim() || null,
        lines: validLines,
      };
      if (linkedAppointmentId) {
        body.appointment_id = linkedAppointmentId;
      }
      const usdRaw = amountUsd.trim().replace(',', '.');
      if (usdRaw) {
        const u = Number(usdRaw);
        if (Number.isFinite(u) && u >= 0) body.amount_usd = u;
      }
      const evId = route.params?.deviceCalendarEventId;
      if (evId != null && String(evId).trim()) {
        body.device_calendar_event_id = String(evId).trim().slice(0, 256);
      }
      await apiPost('/api/visits', body);
      navigation.goBack();
    } catch (e) {
      Alert.alert('', e.message || '');
    } finally {
      setSubmitting(false);
    }
  };

  if (!clientId) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.err}>Missing client.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={styles.header}>
          <View style={styles.headerSide} />
          <Text style={styles.title}>Formula</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={12}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.label}>Procedure</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={procedureName}
            onChangeText={setProcedureName}
          />

          <Text style={styles.label}>Date</Text>
          <TouchableOpacity
            style={[styles.input, styles.datePickRow]}
            onPress={() => setDatePickMode('date')}
            activeOpacity={0.85}
          >
            <Text style={styles.datePickText}>{formatDisplayDate(visitDate)}</Text>
            <Ionicons name="calendar-outline" size={22} color="#1C1C1E" />
          </TouchableOpacity>

          <Text style={styles.label}>Chair</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={chairLabel}
            onChangeText={setChairLabel}
          />

          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          <Text style={styles.label}>Paid (USD, optional)</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={amountUsd}
            onChangeText={setAmountUsd}
            keyboardType="decimal-pad"
          />

          <View style={styles.linesHeader}>
            <Text style={styles.sectionTitle}>Formula lines</Text>
            <TouchableOpacity onPress={addRow} style={styles.addChip} activeOpacity={0.85}>
              <Ionicons name="add" size={20} color={BRAND_PURPLE} />
              <Text style={styles.addChipText}>Line</Text>
            </TouchableOpacity>
          </View>

          {lines.map((line, idx) => (
            <View key={line.key} style={styles.lineCard}>
              <View style={styles.lineTop}>
                <Text style={styles.lineTitle}>Line {idx + 1}</Text>
                {lines.length > 1 ? (
                  <TouchableOpacity onPress={() => removeRow(line.key)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={20} color="#E53935" />
                  </TouchableOpacity>
                ) : null}
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segScroll}>
                {SECTIONS.map((s) => (
                  <TouchableOpacity
                    key={s.key}
                    onPress={() => updateLine(line.key, { section: s.key })}
                    style={[styles.seg, line.section === s.key && styles.segOn]}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.segTxt, line.section === s.key && styles.segTxtOn]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.labSm}>Brand</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#1C1C1E"
                value={line.brand}
                onChangeText={(t) => updateLine(line.key, { brand: t })}
              />

              <Text style={styles.labSm}>Shade</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#1C1C1E"
                value={line.shade_code}
                onChangeText={(t) => updateLine(line.key, { shade_code: t })}
                autoCapitalize="characters"
              />

              <Text style={styles.labSm}>Amount</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#1C1C1E"
                value={String(line.amount)}
                onChangeText={(t) => updateLine(line.key, { amount: t })}
                keyboardType="decimal-pad"
              />

              {line.stockLabel ? (
                <View style={styles.stockLinked}>
                  <Ionicons name="cube" size={18} color="#2E7D32" />
                  <Text style={styles.stockLinkedTxt} numberOfLines={2}>
                    {line.stockLabel}
                  </Text>
                  <TouchableOpacity onPress={() => clearStock(line.key)}>
                    <Text style={styles.unlink}>Clear</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.linkStockBtn}
                  onPress={() => setPickerForKey(line.key)}
                  activeOpacity={0.88}
                >
                  <Ionicons name="link" size={18} color="#5E35B1" />
                  <Text style={styles.linkStockTxt}>Stock</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}

          <TouchableOpacity
            style={[styles.saveBtn, submitting && styles.saveDisabled]}
            onPress={submit}
            disabled={submitting || loadingStock}
            activeOpacity={0.9}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveTxt}>Save</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {Platform.OS === 'ios' && datePickMode != null ? (
        <Modal visible animationType="slide" transparent>
          <View style={styles.iosPickerRoot}>
            <TouchableOpacity
              style={styles.iosPickerBackdrop}
              activeOpacity={1}
              onPress={() => setDatePickMode(null)}
            />
            <View style={styles.iosPickerSheet}>
              <View style={styles.iosPickerToolbar}>
                <View style={{ width: 72 }} />
                <Text style={[styles.iosPickerTitleText, { flex: 1, textAlign: 'center' }]}>Date</Text>
                <TouchableOpacity
                  style={{ width: 72, alignItems: 'flex-end' }}
                  onPress={() => setDatePickMode(null)}
                  hitSlop={8}
                >
                  <Text style={styles.modalClose}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={parseISODateToLocal(visitDate)}
                mode="date"
                display="spinner"
                themeVariant="light"
                onChange={(_, selected) => {
                  if (selected) setVisitDate(toYMD(selected));
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}

      {Platform.OS === 'android' && datePickMode != null ? (
        <DateTimePicker
          value={parseISODateToLocal(visitDate)}
          mode="date"
          display="default"
          onChange={(event, selected) => {
            setDatePickMode(null);
            if (event.type === 'dismissed') return;
            if (selected) setVisitDate(toYMD(selected));
          }}
        />
      ) : null}

      <Modal visible={!!pickerForKey} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Warehouse</Text>
              <TouchableOpacity onPress={() => setPickerForKey(null)}>
                <Text style={styles.modalClose}>Done</Text>
              </TouchableOpacity>
            </View>
            {loadingStock ? (
              <ActivityIndicator style={{ marginTop: 24 }} />
            ) : (
              <FlatList
                data={inventory}
                keyExtractor={(it) => String(it.id)}
                contentContainerStyle={{ paddingBottom: 24 }}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.stockRow} onPress={() => pickStock(item)} activeOpacity={0.85}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stockName}>{item.name}</Text>
                      <Text style={styles.stockMeta}>
                        {[item.brand, item.shade_code].filter(Boolean).join(' · ') || item.category} · {item.quantity}{' '}
                        {item.unit}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#1C1C1E" />
                  </TouchableOpacity>
                )}
                ListEmptyComponent={null}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  err: { textAlign: 'center', marginTop: 40, color: '#1C1C1E' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerSide: { width: 40, height: 40 },
  iconBtn: {
    ...glassPurpleIconBtn,
  },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '400', color: '#1C1C1E' },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 },
  label: { fontSize: 14, fontWeight: '400', color: '#1C1C1E', marginBottom: 8, marginTop: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '400', color: '#1C1C1E' },
  linesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 12,
  },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#EDE7F6',
  },
  addChipText: { fontWeight: '400', color: BRAND_PURPLE, fontSize: 14 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  inputMulti: { minHeight: 88, textAlignVertical: 'top' },
  datePickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  datePickText: { fontSize: 16, color: '#1C1C1E', flex: 1 },
  lineCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#EDE7F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  lineTitle: { fontWeight: '400', color: '#1C1C1E', fontSize: 15 },
  segScroll: { gap: 8, marginBottom: 14 },
  seg: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#F2F2F7',
  },
  segOn: { backgroundColor: '#1C1C1E' },
  segTxt: { fontWeight: '400', color: '#1C1C1E', fontSize: 13 },
  segTxtOn: { color: '#fff' },
  labSm: { fontSize: 12, fontWeight: '400', color: '#1C1C1E', marginBottom: 6, marginTop: 8 },
  linkStockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 12,
    justifyContent: 'center',
    backgroundColor: '#F3E5F5',
    borderRadius: 14,
  },
  linkStockTxt: { fontWeight: '400', color: '#5E35B1', fontSize: 14 },
  stockLinked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: 12,
    backgroundColor: '#E8F5E9',
    borderRadius: 14,
  },
  stockLinkedTxt: { flex: 1, fontSize: 13, fontWeight: '400', color: '#1B5E20' },
  unlink: { fontWeight: '400', color: '#C62828', fontSize: 13 },
  saveBtn: {
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveDisabled: { opacity: 0.6 },
  saveTxt: { color: '#fff', fontSize: 17, fontWeight: '400' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    paddingHorizontal: 16,
  },
  modalHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '400', color: '#1C1C1E' },
  modalClose: { fontSize: 16, fontWeight: '400', color: '#5E35B1' },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 14,
    marginBottom: 8,
  },
  stockName: { fontSize: 16, fontWeight: '400', color: '#1C1C1E' },
  stockMeta: { marginTop: 4, fontSize: 13, color: '#1C1C1E' },
  iosPickerRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  iosPickerBackdrop: { flex: 1 },
  iosPickerSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 8,
  },
  iosPickerToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  iosPickerTitleText: { fontSize: 17, fontWeight: '400', color: '#1C1C1E' },
});
