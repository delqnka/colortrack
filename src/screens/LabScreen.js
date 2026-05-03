import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import SFIcon from '../components/SFIcon';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet, apiPost } from '../api/client';
import { BRAND_PURPLE, glassPurpleFabBar } from '../theme/glassUi';
import {
  SCHEDULE_BANNER_GRADIENT,
  SCHEDULE_BANNER_GRADIENT_END,
  SCHEDULE_BANNER_GRADIENT_START,
  SCHEDULE_BANNER_LOCATIONS,
} from '../theme/scheduleBannerGradient';
import { FontFamily } from '../theme/fonts';
import { Type, typeLh } from '../theme/typography';
import { hapticImpactLight } from '../theme/haptics';
import { formatDisplayDate } from '../lib/formatDate';
import IsoDatePickField from '../components/IsoDatePickField';

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
  const [bootstrapped, setBootstrapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [range, setRange] = useState('month');
  const [searchQ, setSearchQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const listSearchTimer = useRef(null);
  const clientSearchTimer = useRef(null);
  const bootstrappedRef = useRef(false);
  const visitFetchSeq = useRef(0);

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

  const loadAll = useCallback(
    async (opts = {}) => {
      const { pullToRefresh = false } = opts;
      const firstEver = !bootstrappedRef.current;
      visitFetchSeq.current += 1;
      const seq = visitFetchSeq.current;

      if (pullToRefresh) setPullRefreshing(true);
      else if (firstEver) setLoading(true);

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
        if (seq !== visitFetchSeq.current) return;
        setStats(st);
        setVisits(Array.isArray(list) ? list : []);
        setTemplates(Array.isArray(tpls) ? tpls : []);
      } catch {
        if (seq !== visitFetchSeq.current) return;
        setStats(null);
        setVisits([]);
        setTemplates([]);
      } finally {
        if (seq === visitFetchSeq.current) {
          setLoading(false);
          setPullRefreshing(false);
          bootstrappedRef.current = true;
          setBootstrapped(true);
        }
      }
    },
    [from, to, debouncedQ],
  );

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll]),
  );

  useEffect(() => {
    if (!useModal) return;
    setClientQuery('');
    runClientSearch('');
  }, [useModal, runClientSearch]);

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
    setClientLoading(true);
    try {
      let rows;
      if (!t) {
        rows = await apiGet('/api/clients');
      } else {
        rows = await apiGet(`/api/clients?q=${encodeURIComponent(t)}`);
      }
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
        Alert.alert('Invalid Date', 'Use the format YYYY-MM-DD.');
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
        Alert.alert(`You're Offline`, 'This visit will finish syncing when you reconnect.');
        closeUseModal();
        return;
      }
      if (res && res.id) {
        closeUseModal();
        await loadAll();
        navigation.navigate('VisitDetail', { visitId: res.id });
      }
    } catch (e) {
      Alert.alert("Couldn't Save Visit", (e && e.message ? String(e.message) : '').trim() || 'Try again.');
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
        Alert.alert(`You're Offline`, 'Connect to the internet to save a mix.');
        return;
      }
      setSaveTplOpen(false);
      setSaveTplVisitId(null);
      await loadAll();
    } catch (e) {
      Alert.alert('Save Failed', (e && e.message ? String(e.message) : '').trim() || 'Try again.');
    } finally {
      setSaveTplBusy(false);
    }
  };

  const listHeader = useMemo(
    () => (
      <View>
        <View style={styles.statOuter}>
          <LinearGradient
            colors={SCHEDULE_BANNER_GRADIENT}
            locations={SCHEDULE_BANNER_LOCATIONS}
            start={SCHEDULE_BANNER_GRADIENT_START}
            end={SCHEDULE_BANNER_GRADIENT_END}
            style={styles.statGradient}
          >
            <Text style={styles.statLabel}>Formula visits · this month</Text>
            <Text style={styles.statValue}>
              {stats?.visits_with_formula_this_month != null
                ? String(stats.visits_with_formula_this_month)
                : '—'}
            </Text>
          </LinearGradient>
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={20} color="#1C1C1E" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search"
            placeholderTextColor="#8A8A8E"
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
            { key: 'all', label: 'All' },
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

        <Text style={styles.sectionLabel}>Recent activity</Text>
      </View>
    ),
    [stats, searchQ, onSearchChange, range],
  );

  const listFooter = useMemo(
    () => (
      <View style={styles.tplBlock}>
        <Text style={styles.sectionLabel}>Mix library</Text>
        {templates.length === 0 ? (
          <Text style={styles.libraryEmpty}>
            Save a mix from a visit row above, then tap Apply to use it on someone else.
          </Text>
        ) : (
          templates.map((t) => (
            <View key={t.id} style={styles.tplRowOuter}>
              <View style={styles.tplRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tplName}>{t.name}</Text>
                  <Text style={styles.tplMeta}>
                    {t.line_count} lines · {formatDisplayDate(t.created_at)}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.tplApply}
                  onPress={() => {
                    hapticImpactLight();
                    openApplyTemplate(t);
                  }}
                  activeOpacity={0.88}
                >
                  <Text style={styles.tplApplyTxt}>Apply</Text>
                </TouchableOpacity>
              </View>
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
      <View style={styles.visitCardOuter}>
        <View style={styles.visitCard}>
          <TouchableOpacity
            style={styles.visitMain}
            activeOpacity={0.9}
            onPress={() => {
                  hapticImpactLight();
                  navigation.navigate('VisitDetail', { visitId: item.id });
                }}
          >
            <View style={styles.visitTop}>
              <Text style={styles.visitClient} numberOfLines={1}>
                {item.client_name}
              </Text>
              {item.has_inventory_link ? (
                <SFIcon name="filing-outline" iosName="cabinet.fill" size={18} color={BRAND_PURPLE} />
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
              style={styles.visitAct}
              onPress={() => openDuplicate(item)}
              activeOpacity={0.85}
              accessibilityLabel={`Open a new visit with the same formula lines${item.client_name ? ` as for ${item.client_name}` : ''}`}
            >
              <Ionicons name="person-add-outline" size={20} color="#1C1C1E" />
              <Text style={styles.visitActLabel}>New visit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.visitAct}
              onPress={() => openSaveTemplate(item.id)}
              activeOpacity={0.85}
              accessibilityLabel="Save this formula to Mix library"
            >
              <Ionicons name="bookmark-outline" size={20} color={BRAND_PURPLE} />
              <Text style={[styles.visitActLabel, styles.visitActLabelAccent]}>Save mix</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    ),
    [navigation, openDuplicate, openSaveTemplate],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.largeTitle}>Lab</Text>
          <Text style={styles.pageSubhead}>Formula visits above. Reusable mixes below.</Text>
        </View>
        <TouchableOpacity
          style={styles.addBtn}
          activeOpacity={0.85}
          accessibilityHint="Opens a screen to choose a client, then enter the visit formula."
          accessibilityLabel="Add formula visit"
          onPress={() => navigation.push('FormulaBuilder')}
        >
          <Ionicons name="add" size={26} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {!bootstrapped && loading ? (
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
          refreshing={pullRefreshing}
          onRefresh={() => loadAll({ pullToRefresh: true })}
          ListEmptyComponent={
            bootstrapped && visits.length === 0 && !loading && !pullRefreshing ? (
              <Text style={styles.emptyList}>No visits in this time range.</Text>
            ) : null
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
            <View style={styles.sheetGrabber} />
            <Text style={styles.modalTitle}>
              {useModal === 'template' ? 'Use saved mix' : 'Same formula, new visit'}
            </Text>
            <Text style={styles.modalSubtitle}>
              When you pick a client below, a new visit is saved and opened for you.
            </Text>
            <Text style={styles.modalLabel}>Date</Text>
            <IsoDatePickField
              value={visitDate}
              onChange={(ymd) => setVisitDate(ymd)}
              style={styles.modalDatePick}
              textStyle={{ fontFamily: FontFamily.regular, fontSize: 15, lineHeight: typeLh(15), color: '#000000' }}
            />
            <Text style={styles.modalLabel}>Procedure</Text>
            <TextInput
              style={styles.modalInput}
              value={procedureOverride}
              onChangeText={setProcedureOverride}
            />
            <Text style={styles.modalLabel}>Client · tap a row</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Search"
              placeholderTextColor="#8A8A8E"
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
            <View style={styles.sheetGrabber} />
            <Text style={styles.modalTitle}>Save mix to library</Text>
            <Text style={styles.modalSubtitle}>
              You will find it under Mix library. Use Apply when you start the next visit.
            </Text>
            <Text style={styles.modalLabel}>Name</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Required"
              placeholderTextColor="#8A8A8E"
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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headerTitleBlock: { flex: 1, paddingRight: 12 },
  largeTitle: {
    ...Type.screenTitle,
    color: '#000000',
    letterSpacing: 0.35,
  },
  pageSubhead: {
    ...Type.secondary,
    marginTop: 6,
    letterSpacing: -0.24,
  },
  emptyList: {
    fontFamily: FontFamily.regular,
    fontSize: 15,
    lineHeight: typeLh(15),
    color: '#8A8A8E',
    textAlign: 'center',
    paddingHorizontal: 32,
    paddingVertical: 40,
  },
  addBtn: { ...glassPurpleFabBar },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 },
  statOuter: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: BRAND_PURPLE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  statGradient: {
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  statLabel: {
    fontFamily: FontFamily.semibold,
    fontSize: 13,
    lineHeight: typeLh(13),
    color: 'rgba(255,255,255,0.92)',
    marginBottom: 4,
    letterSpacing: -0.08,
  },
  statValue: {
    fontFamily: FontFamily.semibold,
    fontSize: 28,
    lineHeight: typeLh(28),
    color: '#FFFFFF',
    letterSpacing: 0.25,
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.regular,
    color: '#000000',
    padding: 0,
  },
  chipsScroll: { marginBottom: 16 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5EA',
    marginRight: 8,
  },
  chipOn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#0D0D0D',
  },
  chipTxt: { fontSize: 14, lineHeight: typeLh(14), fontFamily: FontFamily.regular, color: '#0D0D0D' },
  chipTxtOn: { fontFamily: FontFamily.semibold, color: '#0D0D0D' },
  sectionLabel: {
    ...Type.sectionLabel,
    marginBottom: 10,
  },
  visitCardOuter: {
    marginBottom: 12,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 15,
    elevation: 10,
  },
  visitCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
  },
  visitMain: { flex: 1, padding: 14 },
  visitTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  visitClient: {
    ...Type.listPrimary,
    color: '#000000',
    flex: 1,
    marginRight: 8,
    letterSpacing: -0.41,
  },
  visitProc: { ...Type.listPrimary, color: '#0D0D0D', marginTop: 4 },
  visitDate: { ...Type.secondary, marginTop: 4, color: '#8A8A8E' },
  visitPreview: { ...Type.secondary, marginTop: 8, color: '#8A8A8E' },
  visitMeta: {
    ...Type.tabBarLabel,
    marginTop: 6,
    color: '#8A8A8E',
  },
  visitActions: {
    width: 92,
    alignItems: 'stretch',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#E5E5EA',
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 4,
  },
  visitAct: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
  },
  visitActLabel: {
    ...Type.tabBarLabel,
    lineHeight: typeLh(11),
    color: '#8A8A8E',
    marginTop: 3,
    textAlign: 'center',
  },
  visitActLabelAccent: { color: BRAND_PURPLE },
  tplBlock: { marginTop: 28 },
  libraryEmpty: {
    ...Type.secondary,
    marginBottom: 8,
    letterSpacing: -0.24,
  },
  tplRowOuter: {
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 15,
    elevation: 10,
  },
  tplRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
  },
  tplName: { ...Type.listPrimary, color: '#000000' },
  tplMeta: { ...Type.secondary, marginTop: 2, color: '#8A8A8E' },
  tplApply: {
    backgroundColor: BRAND_PURPLE,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  tplApplyTxt: { color: '#FFFFFF', ...Type.buttonLabel },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 34,
  },
  sheetGrabber: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#C7C7CC',
    alignSelf: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    ...Type.screenTitle,
    color: '#000000',
    marginBottom: 8,
    letterSpacing: -0.45,
  },
  modalSubtitle: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    lineHeight: typeLh(13),
    color: '#8A8A8E',
    marginBottom: 16,
    letterSpacing: -0.24,
  },
  modalLabel: {
    ...Type.secondary,
    fontFamily: FontFamily.medium,
    marginBottom: 6,
    letterSpacing: -0.08,
  },
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.regular,
    marginBottom: 14,
    color: '#000000',
  },
  modalDatePick: {
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 48,
  },
  clientHit: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  clientHitName: { ...Type.listPrimary, color: '#000000' },
  clientHitPhone: { ...Type.secondary, color: '#8A8A8E', marginTop: 2 },
  modalCancel: { marginTop: 12, alignItems: 'center' },
  modalCancelTxt: { fontSize: 15, lineHeight: typeLh(15), fontFamily: FontFamily.regular, color: BRAND_PURPLE },
  modalPrimary: {
    backgroundColor: BRAND_PURPLE,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  modalPrimaryTxt: { color: '#FFFFFF', ...Type.buttonLabel },
});
