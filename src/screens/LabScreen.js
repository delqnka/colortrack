import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet, apiPost } from '../api/client';
import { glassPurpleIconBtn } from '../theme/glassUi';
import {
  LAB_ACCENT,
  LAB_GRADIENT_COLORS,
  LAB_GRADIENT_END,
  LAB_GRADIENT_LOCATIONS,
  LAB_GRADIENT_START,
} from '../theme/labGradient';
import { formatDisplayDate } from '../lib/formatDate';

function toYMDLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function boundsForRange(range) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const to = toYMDLocal(today);
  if (range === 'all') return { from: null, to };
  if (range === 'week') {
    const start = new Date(today);
    const dow = start.getDay();
    const offset = dow === 0 ? -6 : 1 - dow;
    start.setDate(start.getDate() + offset);
    return { from: toYMDLocal(start), to };
  }
  if (range === 'month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0, 0);
    return { from: toYMDLocal(start), to };
  }
  return { from: null, to };
}

export default function LabScreen({ navigation }) {
  const [stats, setStats] = useState(null);
  const [visits, setVisits] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('month');
  const [searchQ, setSearchQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const listSearchTimer = useRef(null);
  const clientSearchTimer = useRef(null);

  const [useModal, setUseModal] = useState(null);
  const [pickContext, setPickContext] = useState(null);
  const [visitDate, setVisitDate] = useState(() => toYMDLocal(new Date()));
  const [procedureOverride, setProcedureOverride] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [clientHits, setClientHits] = useState([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [saveTplVisitId, setSaveTplVisitId] = useState(null);
  const [saveTplName, setSaveTplName] = useState('');
  const [saveTplBusy, setSaveTplBusy] = useState(false);

  const { from, to } = useMemo(() => boundsForRange(range), [range]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '60');
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (debouncedQ.trim()) params.set('q', debouncedQ.trim());
      const [st, list, tpls] = await Promise.all([
        apiGet('/api/lab/stats'),
        apiGet(`/api/lab/visits?${params.toString()}`),
        apiGet('/api/lab/templates'),
      ]);
      setStats(st);
      setVisits(Array.isArray(list) ? list : []);
      setTemplates(Array.isArray(tpls) ? tpls : []);
    } catch {
      setStats(null);
      setVisits([]);
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, debouncedQ]);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll]),
  );

  const onSearchChange = useCallback((text) => {
    setSearchQ(text);
    if (listSearchTimer.current) clearTimeout(listSearchTimer.current);
    listSearchTimer.current = setTimeout(() => setDebouncedQ(text), 320);
  }, []);

  const openDuplicate = useCallback((row) => {
    setPickContext({
      source_visit_id: row.id,
      defaultProcedure: row.procedure_name || '',
    });
    setVisitDate(toYMDLocal(new Date()));
    setProcedureOverride(row.procedure_name || '');
    setClientQuery('');
    setClientHits([]);
    setUseModal('duplicate');
  }, []);

  const openApplyTemplate = useCallback((tpl) => {
    setPickContext({
      template_id: tpl.id,
      defaultProcedure: tpl.name || 'Formula',
    });
    setVisitDate(toYMDLocal(new Date()));
    setProcedureOverride(tpl.name || 'Formula');
    setClientQuery('');
    setClientHits([]);
    setUseModal('template');
  }, []);

  const closeUseModal = () => {
    setUseModal(null);
    setPickContext(null);
    setSubmitting(false);
  };

  const runClientSearch = useCallback(async (q) => {
    const t = q.trim();
    if (!t) {
      setClientHits([]);
      return;
    }
    setClientLoading(true);
    try {
      const rows = await apiGet(`/api/clients?q=${encodeURIComponent(t)}`);
      setClientHits(Array.isArray(rows) ? rows : []);
    } catch {
      setClientHits([]);
    } finally {
      setClientLoading(false);
    }
  }, []);

  const onClientQueryChange = useCallback(
    (text) => {
      setClientQuery(text);
      if (clientSearchTimer.current) clearTimeout(clientSearchTimer.current);
      clientSearchTimer.current = setTimeout(() => runClientSearch(text), 280);
    },
    [runClientSearch],
  );

  const submitUseModal = async (clientId) => {
    if (!pickContext || !clientId) return;
    setSubmitting(true);
    try {
      const vd = visitDate.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(vd)) {
        Alert.alert('Date', 'Use YYYY-MM-DD.');
        return;
      }
      const proc = procedureOverride.trim() || pickContext.defaultProcedure || 'Visit';
      let res;
      if (pickContext.template_id != null) {
        res = await apiPost(`/api/lab/templates/${pickContext.template_id}/apply`, {
          client_id: clientId,
          visit_date: vd,
          procedure_name: proc,
        });
      } else {
        res = await apiPost('/api/lab/duplicate-visit', {
          source_visit_id: pickContext.source_visit_id,
          client_id: clientId,
          visit_date: vd,
          procedure_name: proc,
        });
      }
      if (res && res.queued) {
        Alert.alert('Offline', 'This action was queued and will sync when you are online.');
        closeUseModal();
        return;
      }
      if (res && res.id) {
        closeUseModal();
        await loadAll();
        navigation.navigate('VisitDetail', { visitId: res.id });
      }
    } catch (e) {
      Alert.alert('Could not create visit', e && e.message ? String(e.message) : 'Error');
    } finally {
      setSubmitting(false);
    }
  };

  const openSaveTemplate = (visitId) => {
    setSaveTplVisitId(visitId);
    setSaveTplName('');
    setSaveTplOpen(true);
  };

  const submitSaveTemplate = async () => {
    const name = saveTplName.trim();
    if (!saveTplVisitId || !name) return;
    setSaveTplBusy(true);
    try {
      const res = await apiPost('/api/lab/templates/from-visit', {
        visit_id: saveTplVisitId,
        name,
      });
      if (res && res.queued) {
        Alert.alert('Offline', 'Connect to the internet to save a template.');
        return;
      }
      setSaveTplOpen(false);
      setSaveTplVisitId(null);
      await loadAll();
    } catch (e) {
      Alert.alert('Save failed', e && e.message ? String(e.message) : 'Error');
    } finally {
      setSaveTplBusy(false);
    }
  };

  const listHeader = useMemo(
    () => (
      <View>
        <LinearGradient
          colors={LAB_GRADIENT_COLORS}
          locations={LAB_GRADIENT_LOCATIONS}
          start={LAB_GRADIENT_START}
          end={LAB_GRADIENT_END}
          style={styles.statRow}
        >
          <Text style={styles.statLabel}>This month</Text>
          <Text style={styles.statValue}>
            {stats?.visits_with_formula_this_month != null
              ? `${stats.visits_with_formula_this_month} formula visits`
              : '—'}
          </Text>
        </LinearGradient>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={20} color="#1C1C1E" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search client, procedure, brand, shade"
            placeholderTextColor="#8E8E93"
            value={searchQ}
            onChangeText={onSearchChange}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
          {[
            { key: 'week', label: 'This week' },
            { key: 'month', label: 'This month' },
            { key: 'all', label: 'All (to today)' },
          ].map((c) => (
            <TouchableOpacity
              key={c.key}
              style={[styles.chip, range === c.key && styles.chipOn]}
              onPress={() => setRange(c.key)}
              activeOpacity={0.85}
            >
              <Text style={[styles.chipTxt, range === c.key && styles.chipTxtOn]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.sectionLabel}>Recent formula visits</Text>
        <Text style={styles.sectionHint}>
          Tap a row to open the visit. Cube = inventory-linked line on that visit.
        </Text>
      </View>
    ),
    [stats, searchQ, onSearchChange, range],
  );

  const listFooter = useMemo(
    () => (
      <View style={styles.tplBlock}>
        <Text style={styles.sectionLabel}>Templates</Text>
        <Text style={styles.sectionHint}>
          Apply a saved mix to a client and date (does not deduct stock).
        </Text>
        {templates.length === 0 ? (
          <Text style={styles.tplEmpty}>No templates yet. Save one from a visit row.</Text>
        ) : (
          templates.map((t) => (
            <View key={t.id} style={styles.tplRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.tplName}>{t.name}</Text>
                <Text style={styles.tplMeta}>
                  {t.line_count} lines · {formatDisplayDate(t.created_at)}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.tplApply}
                onPress={() => openApplyTemplate(t)}
                activeOpacity={0.88}
              >
                <Text style={styles.tplApplyTxt}>Apply</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
        <View style={{ height: 32 }} />
      </View>
    ),
    [templates, openApplyTemplate],
  );

  const renderVisit = useCallback(
    ({ item }) => (
      <View style={styles.visitCard}>
        <TouchableOpacity
          style={styles.visitMain}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('VisitDetail', { visitId: item.id })}
        >
          <View style={styles.visitTop}>
            <Text style={styles.visitClient} numberOfLines={1}>
              {item.client_name}
            </Text>
            {item.has_inventory_link ? (
              <Ionicons name="cube-outline" size={18} color={LAB_ACCENT} />
            ) : null}
          </View>
          <Text style={styles.visitProc} numberOfLines={2}>
            {item.procedure_name}
          </Text>
          <Text style={styles.visitDate}>{formatDisplayDate(item.visit_date)}</Text>
          {item.preview_text ? (
            <Text style={styles.visitPreview} numberOfLines={2}>
              {item.preview_text}
            </Text>
          ) : null}
          <Text style={styles.visitMeta}>{item.formula_line_count} lines</Text>
        </TouchableOpacity>
        <View style={styles.visitActions}>
          <TouchableOpacity
            style={styles.iconAct}
            onPress={() => openDuplicate(item)}
            hitSlop={8}
            accessibilityLabel="Duplicate visit"
          >
            <Ionicons name="copy-outline" size={22} color="#1C1C1E" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconAct}
            onPress={() => openSaveTemplate(item.id)}
            hitSlop={8}
            accessibilityLabel="Save as template"
          >
            <Ionicons name="bookmark-outline" size={22} color="#1C1C1E" />
          </TouchableOpacity>
        </View>
      </View>
    ),
    [navigation, openDuplicate, openSaveTemplate],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={glassPurpleIconBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
        >
          <Ionicons name="chevron-back" size={22} color="#1C1C1E" />
        </TouchableOpacity>
        <Text style={styles.title}>My lab</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading && visits.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#1C1C1E" />
        </View>
      ) : (
        <FlatList
          data={visits}
          keyExtractor={(it) => String(it.id)}
          renderItem={renderVisit}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          contentContainerStyle={styles.listContent}
          refreshing={loading}
          onRefresh={loadAll}
          ListEmptyComponent={
            <Text style={styles.emptyList}>No formula visits match this filter.</Text>
          }
        />
      )}

      <Modal visible={Boolean(useModal)} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalRoot}
        >
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeUseModal} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>
              {useModal === 'template' ? 'Apply template' : 'Duplicate formula visit'}
            </Text>
            <Text style={styles.modalLabel}>Visit date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.modalInput}
              value={visitDate}
              onChangeText={setVisitDate}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.modalLabel}>Procedure name</Text>
            <TextInput
              style={styles.modalInput}
              value={procedureOverride}
              onChangeText={setProcedureOverride}
            />
            <Text style={styles.modalLabel}>Client</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Search name or phone"
              placeholderTextColor="#8E8E93"
              value={clientQuery}
              onChangeText={onClientQueryChange}
              autoCapitalize="none"
            />
            {clientLoading ? <ActivityIndicator style={{ marginVertical: 8 }} /> : null}
            <FlatList
              style={{ maxHeight: 200 }}
              data={clientHits}
              keyExtractor={(it) => String(it.id)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.clientHit}
                  onPress={() => submitUseModal(item.id)}
                  disabled={submitting}
                >
                  <Text style={styles.clientHitName}>{item.full_name}</Text>
                  {item.phone ? <Text style={styles.clientHitPhone}>{item.phone}</Text> : null}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.modalCancel} onPress={closeUseModal}>
              <Text style={styles.modalCancelTxt}>Cancel</Text>
            </TouchableOpacity>
            {submitting ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={saveTplOpen} animationType="fade" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalRoot}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => !saveTplBusy && setSaveTplOpen(false)}
          />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Save as template</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Template name"
              placeholderTextColor="#8E8E93"
              value={saveTplName}
              onChangeText={setSaveTplName}
            />
            <TouchableOpacity
              style={[styles.modalPrimary, saveTplBusy && { opacity: 0.6 }]}
              onPress={submitSaveTemplate}
              disabled={saveTplBusy}
            >
              <Text style={styles.modalPrimaryTxt}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => !saveTplBusy && setSaveTplOpen(false)}
            >
              <Text style={styles.modalCancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
    paddingVertical: 8,
    marginBottom: 4,
  },
  title: { fontSize: 20, fontWeight: '600', color: '#1C1C1E' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  statRow: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    overflow: 'hidden',
  },
  statLabel: { fontSize: 12, color: 'rgba(15, 31, 23, 0.8)', marginBottom: 4, fontWeight: '600' },
  statValue: { fontSize: 16, color: '#0F1F17', fontWeight: '600' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 16, color: '#1C1C1E', padding: 0 },
  chipsScroll: { marginBottom: 16 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F2F2F7',
    marginRight: 8,
  },
  chipOn: { backgroundColor: LAB_ACCENT },
  chipTxt: { fontSize: 14, color: '#1C1C1E' },
  chipTxtOn: { color: '#FFFFFF' },
  sectionLabel: { fontSize: 17, fontWeight: '600', color: '#1C1C1E', marginBottom: 4 },
  sectionHint: { fontSize: 13, color: '#8E8E93', marginBottom: 12 },
  visitCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#FAFAFA',
    borderRadius: 16,
    marginBottom: 10,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
  },
  visitMain: { flex: 1, padding: 14 },
  visitTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  visitClient: { fontSize: 16, fontWeight: '600', color: '#1C1C1E', flex: 1, marginRight: 8 },
  visitProc: { fontSize: 15, color: '#1C1C1E', marginTop: 4 },
  visitDate: { fontSize: 13, color: '#8E8E93', marginTop: 4 },
  visitPreview: { fontSize: 13, color: '#636366', marginTop: 8 },
  visitMeta: { fontSize: 12, color: '#8E8E93', marginTop: 6 },
  visitActions: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#E5E5EA',
    paddingVertical: 8,
    gap: 12,
  },
  iconAct: { padding: 4 },
  emptyList: { textAlign: 'center', color: '#8E8E93', marginTop: 24 },
  tplBlock: { marginTop: 28 },
  tplEmpty: { color: '#8E8E93', fontSize: 14, marginTop: 8 },
  tplRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  tplName: { fontSize: 16, color: '#1C1C1E', fontWeight: '500' },
  tplMeta: { fontSize: 13, color: '#8E8E93', marginTop: 2 },
  tplApply: {
    backgroundColor: LAB_ACCENT,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  tplApplyTxt: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  modalTitle: { fontSize: 18, fontWeight: '600', color: '#1C1C1E', marginBottom: 16 },
  modalLabel: { fontSize: 13, color: '#8E8E93', marginBottom: 6 },
  modalInput: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 12,
    color: '#1C1C1E',
  },
  clientHit: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F2F2F7' },
  clientHitName: { fontSize: 16, color: '#1C1C1E' },
  clientHitPhone: { fontSize: 13, color: '#8E8E93' },
  modalCancel: { marginTop: 12, alignItems: 'center' },
  modalCancelTxt: { fontSize: 16, color: LAB_ACCENT, fontWeight: '600' },
  modalPrimary: {
    backgroundColor: LAB_ACCENT,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  modalPrimaryTxt: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
});
