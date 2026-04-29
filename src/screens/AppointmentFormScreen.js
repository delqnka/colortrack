import React, { useCallback, useState } from 'react';
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
import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client';

function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function AppointmentFormScreen({ route, navigation }) {
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadClients = useCallback(async () => {
    try {
      const rows = await apiGet('/api/clients');
      setClients(Array.isArray(rows) ? rows : []);
    } catch {
      setClients([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadClients();
    }, [loadClients]),
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

  const pickClient = (c) => {
    setClientId(c.id);
    setClientLabel(c.full_name);
    setPickerOpen(false);
  };

  const clearClient = () => {
    setClientId(null);
    setClientLabel('');
  };

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
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={12}>
            <Ionicons name="close" size={26} color="#1C1C1E" />
          </TouchableOpacity>
          <Text style={styles.htitle}>{isEdit ? 'Edit' : 'New'}</Text>
          <View style={{ width: 40 }} />
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
            placeholderTextColor="#C7C7CC"
            value={title}
            onChangeText={setTitle}
          />

          <Text style={styles.label}>Procedure</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#C7C7CC"
            value={procedureName}
            onChangeText={setProcedureName}
          />

          <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#C7C7CC"
            value={dateStr}
            onChangeText={setDateStr}
            autoCapitalize="none"
          />

          <View style={styles.row2}>
            <View style={[styles.row2col, styles.row2colPad]}>
              <Text style={styles.label}>Start</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#C7C7CC"
                value={startTime}
                onChangeText={setStartTime}
              />
            </View>
            <View style={styles.row2col}>
              <Text style={styles.label}>End</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#C7C7CC"
                value={endTime}
                onChangeText={setEndTime}
              />
            </View>
          </View>

          <Text style={styles.label}>Client</Text>
          <TouchableOpacity style={styles.clientRow} onPress={() => setPickerOpen(true)} activeOpacity={0.88}>
            <Text style={clientLabel ? styles.clientTxt : styles.clientPh}>
              {clientLabel || '—'}
            </Text>
            {clientId ? (
              <TouchableOpacity onPress={clearClient} hitSlop={8}>
                <Ionicons name="close-circle" size={22} color="#8E8E93" />
              </TouchableOpacity>
            ) : (
              <Ionicons name="chevron-forward" size={20} color="#C7C7CC" />
            )}
          </TouchableOpacity>

          <Text style={styles.label}>Chair</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#C7C7CC"
            value={chairLabel}
            onChangeText={setChairLabel}
          />

          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder=""
            placeholderTextColor="#C7C7CC"
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
                  <Ionicons name="chevron-forward" size={20} color="#C7C7CC" />
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#F5F5FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  htitle: { fontSize: 18, fontWeight: '800', color: '#1C1C1E' },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 },
  label: { fontSize: 14, fontWeight: '700', color: '#8E8E93', marginBottom: 8, marginTop: 4 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1C1C1E',
    marginBottom: 4,
  },
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
  },
  clientTxt: { fontSize: 16, color: '#1C1C1E', flex: 1 },
  clientPh: { fontSize: 16, color: '#C7C7CC', flex: 1 },
  saveBtn: {
    marginTop: 28,
    backgroundColor: '#5E35B1',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  saveDisabled: { opacity: 0.6 },
  saveTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  delBtn: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  delTxt: { color: '#C62828', fontSize: 16, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#F5F5FA',
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
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#1C1C1E' },
  modalClose: { fontSize: 17, fontWeight: '600', color: '#5E35B1' },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  stockName: { fontSize: 16, fontWeight: '600', color: '#1C1C1E', flex: 1 },
});
