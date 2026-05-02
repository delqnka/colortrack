import React, { useCallback, useMemo, useState } from 'react';
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
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client';
import { glassPurpleIconBtn } from '../theme/glassUi';
import { formatDisplayDate } from '../lib/formatDate';
import { useCurrency } from '../context/CurrencyContext';
import { formatMinorFromStoredCents } from '../format/moneyDisplay';

function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYMD(s) {
  const t = (s || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }
  const [y, mo, day] = t.split('-').map(Number);
  const d = new Date(y, mo - 1, day, 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function formatYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Fixed calendar date for time-only picker values */
const T0 = { y: 2000, m: 0, d: 1 };

function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim());
  if (!m) return new Date(T0.y, T0.m, T0.d, 9, 0, 0, 0);
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return new Date(T0.y, T0.m, T0.d, h, min, 0, 0);
}

function formatHM(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function AppointmentFormScreen({ route, navigation }) {
  const { currency } = useCurrency();
  const appt = route.params?.appointment;
  const appointmentId = appt?.id;
  const isEdit = Number.isFinite(appointmentId) && appointmentId > 0;

  const [title, setTitle] = useState('');
  const [procedureName, setProcedureName] = useState('');
  const [dateStr, setDateStr] = useState(route.params?.initialDate || todayYMD());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [chairLabel, setChairLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [clientId, setClientId] = useState(null);
  const [clientLabel, setClientLabel] = useState('');

  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dateTimePickerMode, setDateTimePickerMode] = useState(null);
  const [saving, setSaving] = useState(false);
  const [linkedVisitId, setLinkedVisitId] = useState(() => (appt?.visit_id != null ? appt.visit_id : null));

  const loadClients = useCallback(async () => {
    try {
      const rows = await apiGet('/api/clients');
      setClients(Array.isArray(rows) ? rows : []);
    } catch {
      setClients([]);
    }
  }, []);

  const loadServices = useCallback(async () => {
    try {
      const rows = await apiGet('/api/services', { allowStaleCache: false });
      setServices(Array.isArray(rows) ? rows : []);
    } catch {
      setServices([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadClients();
      loadServices();
    }, [loadClients, loadServices]),
  );

  useFocusEffect(
    useCallback(() => {
      if (isEdit && appt) {
        setTitle(appt.title || '');
        setProcedureName(appt.procedure_name || '');
        setDateStr(appt.day_local || route.params?.initialDate || todayYMD());
        setStartTime(appt.start_local || '09:00');
        setEndTime(appt.end_local || '10:00');
        setChairLabel(appt.chair_label || '');
        setNotes(appt.notes || '');
        setClientId(appt.client_id ?? null);
        setClientLabel(appt.client_name || '');
      } else {
        setTitle('');
        setProcedureName('');
        setDateStr(route.params?.initialDate || todayYMD());
        setStartTime('09:00');
        setEndTime('10:00');
        setChairLabel('');
        setNotes('');
        setClientId(null);
        setClientLabel('');
      }
    }, [isEdit, appt, route.params?.initialDate]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!isEdit || !appointmentId) {
        setLinkedVisitId(null);
        return undefined;
      }
      const day = dateStr;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
      let cancelled = false;
      (async () => {
        try {
          const rows = await apiGet(`/api/appointments?date=${encodeURIComponent(day)}`);
          if (cancelled || !Array.isArray(rows)) return;
          const row = rows.find((r) => Number(r.id) === Number(appointmentId));
          setLinkedVisitId(row?.visit_id ?? null);
        } catch {
          if (!cancelled) setLinkedVisitId(null);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [isEdit, appointmentId, dateStr]),
  );

  const pickClient = (c) => {
    setClientId(c.id);
    setClientLabel(c.full_name);
    setPickerOpen(false);
  };

  const clearClient = () => {
    setClientId(null);
    setClientLabel('');
  };

  const pickService = (service) => {
    const name = String(service?.name || '').trim();
    if (!name) return;
    setProcedureName(name);
    if (!title.trim()) setTitle(name);
  };

  const applyPickerSelection = useCallback((mode, selectedDate) => {
    if (!selectedDate || !mode) return;
    if (mode === 'date') setDateStr(formatYMD(selectedDate));
    else if (mode === 'start') setStartTime(formatHM(selectedDate));
    else if (mode === 'end') setEndTime(formatHM(selectedDate));
  }, []);

  const pickerValue = useMemo(() => {
    if (dateTimePickerMode === 'date') return parseYMD(dateStr);
    if (dateTimePickerMode === 'start') return parseHM(startTime);
    if (dateTimePickerMode === 'end') return parseHM(endTime);
    return new Date();
  }, [dateTimePickerMode, dateStr, startTime, endTime]);

  const onDateTimePickerChange = useCallback(
    (event, selectedDate) => {
      const mode = dateTimePickerMode;
      if (Platform.OS === 'android') {
        setDateTimePickerMode(null);
        if (event.type === 'dismissed') return;
        applyPickerSelection(mode, selectedDate);
        return;
      }
      if (selectedDate) applyPickerSelection(mode, selectedDate);
    },
    [dateTimePickerMode, applyPickerSelection],
  );

  const iosPickerTitle =
    dateTimePickerMode === 'date' ? 'Date' : dateTimePickerMode === 'start' ? 'Start' : 'End';
  const save = async () => {
    const t = title.trim();
    if (!t) {
      Alert.alert('', 'Title');
      return;
    }
    const ds = dateStr.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
      Alert.alert('', 'Date');
      return;
    }

    const body = {
      title: t,
      procedure_name: procedureName.trim() || null,
      date: ds,
      start_time: startTime.trim(),
      end_time: endTime.trim(),
      chair_label: chairLabel.trim() || null,
      notes: notes.trim() || null,
      client_id: clientId,
    };

    setSaving(true);
    try {
      if (isEdit) {
        await apiPatch(`/api/appointments/${appointmentId}`, body);
      } else {
        await apiPost('/api/appointments', body);
      }
      navigation.goBack();
    } catch (e) {
      Alert.alert('', e.message || '');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!isEdit) return;
    Alert.alert('', 'Delete', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiDelete(`/api/appointments/${appointmentId}`);
            navigation.goBack();
          } catch (e) {
            Alert.alert('', e.message || '');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={styles.header}>
          <View style={styles.headerSide} />
          <Text style={styles.htitle}>{isEdit ? 'Edit' : 'New'}</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={12}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={title}
            onChangeText={setTitle}
          />

          <Text style={styles.label}>Procedure</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={procedureName}
            onChangeText={setProcedureName}
          />
          {services.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.serviceChips}
              keyboardShouldPersistTaps="handled"
            >
              {services.map((service) => (
                <TouchableOpacity
                  key={service.id}
                  style={styles.serviceChip}
                  onPress={() => pickService(service)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.serviceChipName}>{service.name}</Text>
                  {service.price_cents != null ? (
                    <Text style={styles.serviceChipPrice}>
                      {formatMinorFromStoredCents(service.price_cents, currency)}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}

          <Text style={styles.label}>Date</Text>
          <TouchableOpacity
            style={styles.pickerField}
            onPress={() => setDateTimePickerMode('date')}
            activeOpacity={0.88}
          >
            <Text style={styles.pickerFieldText}>{formatDisplayDate(dateStr)}</Text>
            <Ionicons name="calendar-outline" size={22} color="#1C1C1E" />
          </TouchableOpacity>

          <View style={styles.row2}>
            <View style={[styles.row2col, styles.row2colPad]}>
              <Text style={styles.label}>Start</Text>
              <TouchableOpacity
                style={styles.pickerField}
                onPress={() => setDateTimePickerMode('start')}
                activeOpacity={0.88}
              >
                <Text style={styles.pickerFieldText}>{startTime}</Text>
                <Ionicons name="time-outline" size={22} color="#1C1C1E" />
              </TouchableOpacity>
            </View>
            <View style={styles.row2col}>
              <Text style={styles.label}>End</Text>
              <TouchableOpacity
                style={styles.pickerField}
                onPress={() => setDateTimePickerMode('end')}
                activeOpacity={0.88}
              >
                <Text style={styles.pickerFieldText}>{endTime}</Text>
                <Ionicons name="time-outline" size={22} color="#1C1C1E" />
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.label}>Client</Text>
          <TouchableOpacity style={styles.clientRow} onPress={() => setPickerOpen(true)} activeOpacity={0.88}>
            <Text style={clientLabel ? styles.clientTxt : styles.clientPh}>
              {clientLabel || '—'}
            </Text>
            {clientId ? (
              <TouchableOpacity onPress={clearClient} hitSlop={8}>
                <Ionicons name="close-circle" size={22} color="#1C1C1E" />
              </TouchableOpacity>
            ) : (
              <Ionicons name="chevron-forward" size={20} color="#1C1C1E" />
            )}
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
            style={[styles.input, styles.textArea]}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveDisabled]}
            onPress={save}
            disabled={saving}
            activeOpacity={0.9}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Save</Text>}
          </TouchableOpacity>

          {isEdit && clientId ? (
            linkedVisitId ? (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => navigation.navigate('VisitDetail', { visitId: linkedVisitId })}
                activeOpacity={0.88}
              >
                <Text style={styles.secondaryBtnTxt}>Open visit record</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() =>
                  navigation.navigate('FormulaBuilder', {
                    clientId,
                    appointmentId,
                    initialProcedure: procedureName.trim() || title.trim(),
                    initialDate: dateStr,
                    initialChair: chairLabel,
                    initialNotes: notes,
                  })
                }
                activeOpacity={0.88}
              >
                <Text style={styles.secondaryBtnTxt}>Log visit (formula)</Text>
              </TouchableOpacity>
            )
          ) : null}

          {isEdit ? (
            <TouchableOpacity style={styles.delBtn} onPress={remove} activeOpacity={0.88}>
              <Text style={styles.delTxt}>Delete</Text>
            </TouchableOpacity>
          ) : null}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={pickerOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Clients</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)}>
                <Text style={styles.modalClose}>Done</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={clients}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={{ paddingBottom: 24 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.stockRow} onPress={() => pickClient(item)} activeOpacity={0.85}>
                  <Text style={styles.stockName}>{item.full_name}</Text>
                  <Ionicons name="chevron-forward" size={20} color="#1C1C1E" />
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {Platform.OS === 'ios' && dateTimePickerMode != null ? (
        <Modal visible animationType="slide" transparent>
          <View style={styles.iosPickerRoot}>
            <TouchableOpacity
              style={styles.iosPickerBackdrop}
              activeOpacity={1}
              onPress={() => setDateTimePickerMode(null)}
            />
            <View style={styles.iosPickerSheet}>
              <View style={styles.iosPickerToolbar}>
                <View style={{ width: 72 }} />
                <Text style={[styles.iosPickerTitleText, { flex: 1, textAlign: 'center' }]}>{iosPickerTitle}</Text>
                <TouchableOpacity
                  style={{ width: 72, alignItems: 'flex-end' }}
                  onPress={() => setDateTimePickerMode(null)}
                  hitSlop={8}
                >
                  <Text style={styles.modalClose}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={pickerValue}
                mode={dateTimePickerMode === 'date' ? 'date' : 'time'}
                display="spinner"
                onChange={onDateTimePickerChange}
                themeVariant="light"
              />
            </View>
          </View>
        </Modal>
      ) : null}

      {Platform.OS === 'android' && dateTimePickerMode != null ? (
        <DateTimePicker
          value={pickerValue}
          mode={dateTimePickerMode === 'date' ? 'date' : 'time'}
          display="default"
          onChange={onDateTimePickerChange}
        />
      ) : null}
    </SafeAreaView>
  );
}

const reliefShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.14,
  shadowRadius: 5,
  elevation: 4,
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
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
  htitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '400', color: '#1C1C1E' },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 },
  label: { fontSize: 14, fontWeight: '400', color: '#1C1C1E', marginBottom: 8, marginTop: 4 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1C1C1E',
    marginBottom: 4,
    ...reliefShadow,
  },
  pickerField: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...reliefShadow,
  },
  pickerFieldText: { fontSize: 16, color: '#1C1C1E' },
  serviceChips: {
    gap: 8,
    paddingVertical: 8,
    paddingRight: 8,
  },
  serviceChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5EA',
    ...reliefShadow,
  },
  serviceChipName: { fontSize: 14, fontWeight: '400', color: '#1C1C1E' },
  serviceChipPrice: { marginTop: 3, fontSize: 12, fontWeight: '400', color: '#5E35B1' },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  row2: { flexDirection: 'row' },
  row2col: { flex: 1 },
  row2colPad: { marginRight: 12 },
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 4,
    ...reliefShadow,
  },
  clientTxt: { fontSize: 16, color: '#1C1C1E', flex: 1 },
  clientPh: { fontSize: 16, color: '#1C1C1E', flex: 1 },
  saveBtn: {
    marginTop: 28,
    backgroundColor: '#5E35B1',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 6,
  },
  saveDisabled: { opacity: 0.6 },
  saveTxt: { color: '#fff', fontSize: 16, fontWeight: '400' },
  secondaryBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#5E35B1',
    alignItems: 'center',
  },
  secondaryBtnTxt: { fontSize: 16, fontWeight: '400', color: '#5E35B1' },
  delBtn: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  delTxt: { color: '#C62828', fontSize: 16, fontWeight: '400' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '72%',
    paddingBottom: 16,
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  modalTitle: { fontSize: 17, fontWeight: '400', color: '#1C1C1E' },
  modalClose: { fontSize: 17, fontWeight: '400', color: '#5E35B1' },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  stockName: { fontSize: 16, fontWeight: '400', color: '#1C1C1E', flex: 1 },
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
