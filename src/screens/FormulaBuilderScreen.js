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
  Keyboard,
  InputAccessoryView,
  Platform,
  FlatList,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { apiGet, apiPost } from '../api/client';
import { BRAND_PURPLE, glassPurpleIconBtn } from '../theme/glassUi';
import {
  SCHEDULE_BANNER_GRADIENT,
  SCHEDULE_BANNER_GRADIENT_END,
  SCHEDULE_BANNER_GRADIENT_START,
  SCHEDULE_BANNER_LEAD_PINK,
  SCHEDULE_BANNER_LOCATIONS,
} from '../theme/scheduleBannerGradient';
import { FontFamily } from '../theme/fonts';
import IsoDatePickField from '../components/IsoDatePickField';

const COLOUR_SECTIONS = [
  { key: 'roots', label: 'Roots', icon: 'color-fill-outline' },
  { key: 'lengths', label: 'Lengths', icon: 'scissors-outline' },
  { key: 'toner', label: 'Toner', icon: 'sparkles-outline' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
];

const IOS_KB_ACCESSORY_ID = 'formula_input_accessory_done';
const MAX_FORMULA_LINES = 24;

function emptyDraftRow(idx) {
  return {
    key: `dr_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
    brand: '',
    shade_code: '',
    amount: '',
    unit: 'g',
    inventory_item_id: null,
    stockLabel: null,
  };
}

function newMixGroupId() {
  return `mg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseRouteClientId(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function FormulaBuilderScreen({ route, navigation }) {
  // ── client ──
  const [clientId, setClientId] = useState(() => parseRouteClientId(route.params?.clientId));
  const [pickedClientLabel, setPickedClientLabel] = useState('');
  const [clientPickQuery, setClientPickQuery] = useState('');
  const [clientPickHits, setClientPickHits] = useState([]);
  const [clientPickLoading, setClientPickLoading] = useState(false);
  const clientPickTimerRef = useRef(null);

  useEffect(() => {
    const next = parseRouteClientId(route.params?.clientId);
    if (next != null) setClientId(next);
  }, [route.params?.clientId]);

  useEffect(() => () => {
    if (clientPickTimerRef.current) clearTimeout(clientPickTimerRef.current);
  }, []);

  const runClientPickSearch = useCallback(async (q) => {
    setClientPickLoading(true);
    try {
      const rows = await apiGet(
        q.trim() ? `/api/clients?q=${encodeURIComponent(q.trim())}` : '/api/clients',
      );
      setClientPickHits(Array.isArray(rows) ? rows : []);
    } catch {
      setClientPickHits([]);
    } finally {
      setClientPickLoading(false);
    }
  }, []);

  useEffect(() => {
    if (clientId == null) runClientPickSearch('');
  }, [clientId, runClientPickSearch]);

  const onClientPickQueryChange = useCallback(
    (text) => {
      setClientPickQuery(text);
      if (clientPickTimerRef.current) clearTimeout(clientPickTimerRef.current);
      clientPickTimerRef.current = setTimeout(() => runClientPickSearch(text), 280);
    },
    [runClientPickSearch],
  );

  // ── visit metadata ──
  const [procedureName, setProcedureName] = useState('');
  const [notes, setNotes] = useState('');
  const [visitDate, setVisitDate] = useState(() => toYMD(new Date()));
  const [linkedAppointmentId, setLinkedAppointmentId] = useState(null);
  const prefilledApptRef = useRef(null);
  const prefilledDeviceCalRef = useRef(null);

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
      route.params?.initialNotes,
    ]),
  );

  // ── committed formula lines ──
  const [lines, setLines] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  // ── wizard draft ──
  const [wizardStep, setWizardStep] = useState(1);
  const [draftSection, setDraftSection] = useState(null);
  const [draftColourRows, setDraftColourRows] = useState([]);
  const [draftDeveloper, setDraftDeveloper] = useState({ brand: '', amount: '', unit: 'g' });

  // ── inventory picker ──
  const [invPickerOpen, setInvPickerOpen] = useState(false);
  const [invPickerTarget, setInvPickerTarget] = useState(null);
  const [invSearch, setInvSearch] = useState('');
  const [invItems, setInvItems] = useState([]);
  const [invLoading, setInvLoading] = useState(false);
  const invSearchTimerRef = useRef(null);

  const [invAllItems, setInvAllItems] = useState([]);

  const openInvPicker = useCallback((target) => {
    setInvPickerTarget(target);
    setInvSearch('');
    setInvPickerOpen(true);
    setInvLoading(true);
    apiGet('/api/inventory')
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setInvAllItems(list);
        setInvItems(list);
      })
      .catch(() => { setInvAllItems([]); setInvItems([]); })
      .finally(() => setInvLoading(false));
  }, []);

  useEffect(() => () => {
    if (invSearchTimerRef.current) clearTimeout(invSearchTimerRef.current);
  }, []);

  const onInvSearchChange = useCallback((text) => {
    setInvSearch(text);
    const q = text.trim().toLowerCase();
    if (!q) {
      setInvItems(invAllItems);
      return;
    }
    setInvItems(
      invAllItems.filter(
        (it) =>
          String(it.name || '').toLowerCase().includes(q) ||
          String(it.brand || '').toLowerCase().includes(q) ||
          String(it.shade_code || '').toLowerCase().includes(q),
      ),
    );
  }, [invAllItems]);

  const pickInventoryItem = useCallback(
    (item) => {
      const name = String(item.name || '').trim();
      const shadeCode = String(item.shade_code || '').trim();
      const brand = String(item.brand || '').trim();
      if (invPickerTarget === 'developer') {
        setDraftDeveloper((d) => ({
          ...d,
          brand: name,
          shade_code: shadeCode,
          inventory_item_id: item.id,
          stockLabel: name,
        }));
      } else {
        setDraftColourRows((rows) =>
          rows.map((r) =>
            r.key === invPickerTarget
              ? { ...r, brand: name, shade_code: shadeCode, inventory_item_id: item.id, stockLabel: name }
              : r,
          ),
        );
      }
      setInvPickerOpen(false);
    },
    [invPickerTarget],
  );

  // ── wizard actions ──
  const resetDraft = useCallback(() => {
    setDraftSection(null);
    setDraftColourRows([]);
    setDraftDeveloper({ brand: '', amount: '', unit: 'g' });
    setWizardStep(1);
  }, []);

  const wizardBack = () => {
    Keyboard.dismiss();
    if (wizardStep === 2) {
      setDraftSection(null);
      setWizardStep(1);
    } else if (wizardStep === 3) {
      setDraftColourRows([]);
      setDraftDeveloper({ brand: '', amount: '', unit: 'g' });
      setWizardStep(2);
    }
  };

  const onPickZone = (sectionKey) => {
    setDraftSection(sectionKey);
    setWizardStep(2);
  };

  const onPickColourCount = (n) => {
    setDraftColourRows(Array.from({ length: n }, (_, i) => emptyDraftRow(i)));
    setDraftDeveloper({ brand: '', amount: '', unit: 'g' });
    setWizardStep(3);
  };

  const updateDraftRow = (key, patch) => {
    setDraftColourRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addDraftRow = () => {
    setDraftColourRows((rows) => [...rows, emptyDraftRow(rows.length)]);
  };

  const removeDraftRow = (key) => {
    setDraftColourRows((rows) => rows.filter((r) => r.key !== key));
  };

  const commitDraftMix = () => {
    Keyboard.dismiss();
    const hasColour = draftColourRows.some((r) => {
      const brand = String(r.brand || '').trim();
      const amt = Number(String(r.amount || '').replace(',', '.'));
      return brand && Number.isFinite(amt) && amt > 0;
    });
    if (!hasColour) {
      Alert.alert('', 'Add at least one colour with an amount.');
      return;
    }
    const mgk = newMixGroupId();
    const built = [];
    for (const r of draftColourRows) {
      const brand = String(r.brand || '').trim();
      const amount = Number(String(r.amount || '').replace(',', '.'));
      if (!brand || !Number.isFinite(amount) || amount <= 0) continue;
      built.push({
        key: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        mixGroupKey: mgk,
        section: draftSection,
        brand,
        shade_code: r.shade_code || r.unit || 'g',
        amount: String(r.amount),
        unit: r.unit || 'g',
        inventory_item_id: r.inventory_item_id ?? null,
      });
    }
    const devBrand = String(draftDeveloper.brand || '').trim();
    const devAmt = Number(String(draftDeveloper.amount || '').replace(',', '.'));
    if (devBrand || (Number.isFinite(devAmt) && devAmt > 0)) {
      built.push({
        key: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        mixGroupKey: mgk,
        section: 'developer',
        brand: devBrand || 'Developer',
        shade_code: draftDeveloper.shade_code || draftDeveloper.unit || 'g',
        amount: String(draftDeveloper.amount || ''),
        unit: draftDeveloper.unit || 'g',
        inventory_item_id: draftDeveloper.inventory_item_id ?? null,
      });
    }
    if (lines.length + built.length > MAX_FORMULA_LINES) {
      Alert.alert('', `Maximum ${MAX_FORMULA_LINES} formula lines reached.`);
      return;
    }
    setLines((prev) => [...prev, ...built]);
    setWizardStep(4);
  };

  const submit = async () => {
    if (!clientId) return;
    const proc = procedureName.trim();
    if (!proc) {
      Alert.alert('Procedure required', 'Enter a name for this visit (e.g. "Full colour + toner").');
      return;
    }
    const validLines = [];
    for (const l of lines) {
      const brand = String(l.brand || '').trim();
      const amount = Number(String(l.amount || '').replace(',', '.'));
      if (!brand || !Number.isFinite(amount) || amount <= 0) continue;
      validLines.push({
        section: l.section,
        brand,
        shade_code: l.shade_code || '-',
        amount,
        inventory_item_id: l.inventory_item_id ?? null,
      });
    }
    if (validLines.length === 0) {
      Alert.alert('', 'Add at least one formula line with a quantity.');
      return;
    }
    Keyboard.dismiss();
    setSubmitting(true);
    try {
      const body = {
        client_id: clientId,
        visit_date: /^\d{4}-\d{2}-\d{2}$/.test(visitDate) ? visitDate : undefined,
        procedure_name: proc,
        notes: notes.trim() || null,
        lines: validLines,
      };
      if (linkedAppointmentId) body.appointment_id = linkedAppointmentId;
      const evId = route.params?.deviceCalendarEventId;
      if (evId != null && String(evId).trim())
        body.device_calendar_event_id = String(evId).trim().slice(0, 256);
      await apiPost('/api/visits', body);
      navigation.goBack();
    } catch (e) {
      Alert.alert('', e.message || '');
    } finally {
      setSubmitting(false);
    }
  };

  // ── client picker screen ──
  if (!clientId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={8}
        >
          <View style={styles.header}>
            <View style={styles.headerSide} />
            <Text style={styles.navHeadline}>New Formula</Text>
            <TouchableOpacity
              onPress={() => { Keyboard.dismiss(); navigation.goBack(); }}
              style={styles.iconBtn}
              hitSlop={12}
            >
              <Ionicons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <Text style={styles.pickPurpose}>Who is this formula for?</Text>
          <View style={styles.pickSearchRow}>
            <Ionicons name="search-outline" size={20} color="#8E8E93" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.pickSearchField}
              placeholder="Search clients"
              placeholderTextColor="#8E8E93"
              value={clientPickQuery}
              onChangeText={onClientPickQueryChange}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          {clientPickLoading ? (
            <ActivityIndicator style={{ marginVertical: 12 }} color={BRAND_PURPLE} />
          ) : null}
          <FlatList
            style={styles.pickList}
            data={clientPickHits}
            keyExtractor={(it) => String(it.id)}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'on-drag' : 'none'}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.pickRow}
                onPress={() => {
                  Keyboard.dismiss();
                  setClientId(item.id);
                  setPickedClientLabel(String(item.full_name || '').trim());
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.pickRowName}>{item.full_name}</Text>
                {item.phone ? <Text style={styles.pickRowPhone}>{item.phone}</Text> : null}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              !clientPickLoading ? (
                <Text style={styles.pickEmpty}>
                  {clientPickQuery.trim() ? 'No matching clients.' : 'No clients yet.'}
                </Text>
              ) : null
            }
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  const iosAccessoryId = Platform.OS === 'ios' ? IOS_KB_ACCESSORY_ID : undefined;

  // unique mix groups from committed lines
  const committedMixGroups = [
    ...new Set(lines.filter((l) => l.section !== 'developer').map((l) => l.mixGroupKey)),
  ];

  // ── Step 1 — What is this mix for? ──
  const renderStep1 = () => (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.stepContainer}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.stepQuestion}>What is this mix for?</Text>
      {pickedClientLabel ? (
        <Text style={styles.forClient}>For {pickedClientLabel}</Text>
      ) : null}

      <View style={styles.zoneGrid}>
        {COLOUR_SECTIONS.map((s) => (
          <TouchableOpacity
            key={s.key}
            style={styles.zoneCard}
            onPress={() => onPickZone(s.key)}
            activeOpacity={0.82}
          >
            <LinearGradient
              colors={['#FFFFFF', '#F5EEFF']}
              style={styles.zoneCardInner}
            >
              <Ionicons name={s.icon} size={38} color={SCHEDULE_BANNER_LEAD_PINK} style={{ marginBottom: 10 }} />
              <Text style={styles.zoneCardLabel}>{s.label}</Text>
            </LinearGradient>
          </TouchableOpacity>
        ))}
      </View>

      {committedMixGroups.length > 0 ? (
        <View style={styles.mixesSummaryBox}>
          <Text style={styles.mixesSummaryTitle}>Added this visit:</Text>
          {committedMixGroups.map((mgk, i) => {
            const colours = lines.filter(
              (l) => l.mixGroupKey === mgk && l.section !== 'developer',
            );
            const sLabel =
              COLOUR_SECTIONS.find((s) => s.key === colours[0]?.section)?.label || colours[0]?.section;
            return (
              <Text key={mgk} style={styles.mixesSummaryItem}>
                Mix {i + 1}: {sLabel} — {colours.length} colour{colours.length !== 1 ? 's' : ''}
              </Text>
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );

  // ── Step 2 — How many colours? ──
  const renderStep2 = () => (
    <View style={[styles.stepContainer, { flex: 1 }]}>
      <Text style={styles.stepQuestion}>How many colours in this mix?</Text>
      {draftSection ? (
        <Text style={styles.stepSubtitle}>
          {COLOUR_SECTIONS.find((s) => s.key === draftSection)?.label}
        </Text>
      ) : null}
      <View style={styles.countGrid}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <TouchableOpacity
            key={n}
            style={styles.countCircleWrap}
            onPress={() => onPickColourCount(n)}
            activeOpacity={0.82}
          >
            <LinearGradient
              colors={SCHEDULE_BANNER_GRADIENT}
              locations={SCHEDULE_BANNER_LOCATIONS}
              start={SCHEDULE_BANNER_GRADIENT_START}
              end={SCHEDULE_BANNER_GRADIENT_END}
              style={styles.countCircle}
            >
              <Text style={styles.countCircleTxt}>{n}</Text>
            </LinearGradient>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity
        style={styles.moreColoursBtn}
        onPress={() => {
          if (Alert.prompt) {
            Alert.prompt(
              'How many colours?',
              'Enter a number up to 12',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'OK',
                  onPress: (v) => {
                    const n = parseInt(v, 10);
                    if (Number.isFinite(n) && n > 0 && n <= 12) onPickColourCount(n);
                  },
                },
              ],
              'plain-text',
              '',
              'number-pad',
            );
          } else {
            Alert.alert('', 'Tap a number above (1–6).');
          }
        }}
        activeOpacity={0.82}
      >
        <Ionicons name="add-circle-outline" size={20} color={BRAND_PURPLE} />
        <Text style={styles.moreColoursBtnTxt}>More colours</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Step 3 — Add your colours ──
  const renderColourRow = (row, idx) => (
    <View key={row.key} style={styles.colourCard}>
      {/* title + remove */}
      <View style={styles.colourCardHeader}>
        <Text style={styles.colourCardTitle}>Colour {idx + 1}</Text>
        {draftColourRows.length > 1 ? (
          <TouchableOpacity onPress={() => removeDraftRow(row.key)} hitSlop={10} activeOpacity={0.7}>
            <Ionicons name="trash-outline" size={18} color="#C62828" />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Stock picker button — primary way to pick */}
      <TouchableOpacity
        style={styles.stockPickerBtn}
        onPress={() => openInvPicker(row.key)}
        activeOpacity={0.82}
      >
        <Ionicons name="cube-outline" size={18} color={BRAND_PURPLE} style={{ marginRight: 8 }} />
        {row.stockLabel ? (
          <View style={{ flex: 1 }}>
            <Text style={styles.stockPickerShade}>
              {row.shade_code || row.stockLabel}
            </Text>
            {row.shade_code ? (
              <Text style={styles.stockPickerName} numberOfLines={1}>{row.stockLabel}</Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.stockPickerBtnTxt}>Choose from stock</Text>
        )}
        {row.stockLabel ? (
          <TouchableOpacity
            onPress={() => updateDraftRow(row.key, { brand: '', shade_code: '', inventory_item_id: null, stockLabel: null })}
            hitSlop={10}
            style={{ marginLeft: 'auto' }}
          >
            <Ionicons name="close-circle" size={17} color="#8E8E93" />
          </TouchableOpacity>
        ) : (
          <Ionicons name="chevron-forward" size={16} color="#C6C6C8" style={{ marginLeft: 'auto' }} />
        )}
      </TouchableOpacity>

      {/* Manual brand/name — shown when no stock item picked */}
      {!row.stockLabel ? (
        <>
          <Text style={styles.fieldLabelOr}>— or type manually —</Text>
          <TextInput
            style={styles.input}
            placeholder="Brand / name  e.g. Wella Koleston 8/0"
            placeholderTextColor="#8E8E93"
            value={row.brand}
            onChangeText={(t) => updateDraftRow(row.key, { brand: t })}
            inputAccessoryViewID={iosAccessoryId}
            returnKeyType="done"
            blurOnSubmit
          />
        </>
      ) : null}

      {/* Amount + unit */}
      <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Amount</Text>
      <View style={styles.amountRow}>
        <TextInput
          style={[styles.input, styles.amountInput]}
          placeholder="0"
          placeholderTextColor="#8E8E93"
          value={row.amount}
          onChangeText={(t) => updateDraftRow(row.key, { amount: t })}
          keyboardType="decimal-pad"
          inputAccessoryViewID={iosAccessoryId}
        />
        <View style={styles.unitToggle}>
          {['g', 'oz'].map((u) => (
            <TouchableOpacity
              key={u}
              style={[styles.unitBtn, row.unit === u && styles.unitBtnActive]}
              onPress={() => updateDraftRow(row.key, { unit: u })}
              activeOpacity={0.8}
            >
              <Text style={[styles.unitBtnTxt, row.unit === u && styles.unitBtnTxtActive]}>{u}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );

  const renderStep3 = () => (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.stepContainer}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.stepQuestion}>Add your colours</Text>
      {draftSection ? (
        <Text style={styles.stepSubtitle}>
          {COLOUR_SECTIONS.find((s) => s.key === draftSection)?.label}
        </Text>
      ) : null}

      {draftColourRows.map((row, idx) => renderColourRow(row, idx))}

      {/* Add another colour row inline */}
      <TouchableOpacity style={styles.addColourRowBtn} onPress={addDraftRow} activeOpacity={0.82}>
        <Ionicons name="add-circle-outline" size={20} color={BRAND_PURPLE} />
        <Text style={styles.addColourRowBtnTxt}>+ Add another colour</Text>
      </TouchableOpacity>

      {/* Developer */}
      <View style={[styles.colourCard, styles.devCard]}>
        <Text style={[styles.colourCardTitle, styles.devCardTitle]}>Developer</Text>

        {/* Stock picker */}
        <TouchableOpacity
          style={[styles.stockPickerBtn, styles.stockPickerBtnDev]}
          onPress={() => openInvPicker('developer')}
          activeOpacity={0.82}
        >
          <Ionicons name="cube-outline" size={18} color="#0D74FF" style={{ marginRight: 8 }} />
          {draftDeveloper.stockLabel ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.stockPickerShade}>
                {draftDeveloper.shade_code || draftDeveloper.stockLabel}
              </Text>
              {draftDeveloper.shade_code ? (
                <Text style={styles.stockPickerName} numberOfLines={1}>{draftDeveloper.stockLabel}</Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.stockPickerBtnTxt}>Choose from stock</Text>
          )}
          {draftDeveloper.stockLabel ? (
            <TouchableOpacity
              onPress={() => setDraftDeveloper((d) => ({ ...d, brand: '', shade_code: '', inventory_item_id: null, stockLabel: null }))}
              hitSlop={10}
              style={{ marginLeft: 'auto' }}
            >
              <Ionicons name="close-circle" size={17} color="#8E8E93" />
            </TouchableOpacity>
          ) : (
            <Ionicons name="chevron-forward" size={16} color="#C6C6C8" style={{ marginLeft: 'auto' }} />
          )}
        </TouchableOpacity>

        {!draftDeveloper.stockLabel ? (
          <>
            <Text style={styles.fieldLabelOr}>— or type manually —</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Wella Welloxon 6%"
              placeholderTextColor="#8E8E93"
              value={draftDeveloper.brand}
              onChangeText={(t) => setDraftDeveloper((d) => ({ ...d, brand: t }))}
              inputAccessoryViewID={iosAccessoryId}
              returnKeyType="done"
              blurOnSubmit
            />
          </>
        ) : null}

        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Amount</Text>
        <View style={styles.amountRow}>
          <TextInput
            style={[styles.input, styles.amountInput]}
            placeholder="0"
            placeholderTextColor="#8E8E93"
            value={draftDeveloper.amount}
            onChangeText={(t) => setDraftDeveloper((d) => ({ ...d, amount: t }))}
            keyboardType="decimal-pad"
            inputAccessoryViewID={iosAccessoryId}
          />
          <View style={styles.unitToggle}>
            {['g', 'ml', 'oz'].map((u) => (
              <TouchableOpacity
                key={u}
                style={[styles.unitBtn, draftDeveloper.unit === u && styles.unitBtnActive]}
                onPress={() => setDraftDeveloper((d) => ({ ...d, unit: u }))}
                activeOpacity={0.8}
              >
                <Text style={[styles.unitBtnTxt, draftDeveloper.unit === u && styles.unitBtnTxtActive]}>
                  {u}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.nextBtn} onPress={commitDraftMix} activeOpacity={0.9}>
        <Text style={styles.nextBtnTxt}>Next →</Text>
      </TouchableOpacity>
      <View style={{ height: 40 }} />
    </ScrollView>
  );

  // ── Step 4 — Add another mix / Save ──
  const renderStep4 = () => (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.stepContainer}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.stepQuestion}>Add another mix?</Text>
      {pickedClientLabel ? (
        <Text style={styles.forClient}>For {pickedClientLabel}</Text>
      ) : null}

      {/* Summary of all mixes */}
      {committedMixGroups.map((mgk, i) => {
        const colours = lines.filter((l) => l.mixGroupKey === mgk && l.section !== 'developer');
        const devLine = lines.find((l) => l.mixGroupKey === mgk && l.section === 'developer');
        const sLabel =
          COLOUR_SECTIONS.find((s) => s.key === colours[0]?.section)?.label || colours[0]?.section;
        return (
          <View key={mgk} style={styles.mixSummaryCard}>
            <Text style={styles.mixSummaryHeading}>
              Mix {i + 1} — {sLabel}
            </Text>
            {colours.map((cl, ci) => (
              <Text key={cl.key} style={styles.mixSummaryLine}>
                Colour {ci + 1}: {cl.brand}  {cl.amount} {cl.unit}
              </Text>
            ))}
            {devLine ? (
              <Text style={styles.mixSummaryDevLine}>
                Developer: {devLine.brand}  {devLine.amount} {devLine.unit}
              </Text>
            ) : null}
          </View>
        );
      })}

      {/* Visit details */}
      <Text style={styles.sectionDivider}>Visit details</Text>

      <Text style={styles.fieldLabel}>Procedure *</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Full colour + toner"
        placeholderTextColor="#8E8E93"
        value={procedureName}
        onChangeText={setProcedureName}
        inputAccessoryViewID={iosAccessoryId}
        returnKeyType="done"
        blurOnSubmit
      />

      <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Date</Text>
      <IsoDatePickField
        value={visitDate}
        onChange={setVisitDate}
        style={[styles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
        textStyle={{ fontSize: 16, color: '#1C1C1E', flex: 1, fontFamily: FontFamily.regular }}
      />

      <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Notes (optional)</Text>
      <TextInput
        style={[styles.input, styles.inputMulti]}
        placeholder=""
        placeholderTextColor="#8E8E93"
        value={notes}
        onChangeText={setNotes}
        multiline
        inputAccessoryViewID={iosAccessoryId}
      />

      <View style={{ height: 28 }} />

      <TouchableOpacity
        style={styles.addAnotherBtn}
        onPress={() => { Keyboard.dismiss(); resetDraft(); }}
        activeOpacity={0.85}
      >
        <Ionicons name="add-circle-outline" size={22} color={SCHEDULE_BANNER_LEAD_PINK} />
        <Text style={styles.addAnotherBtnTxt}>+ Add another mix</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.saveBtn, submitting && styles.saveBtnDisabled]}
        onPress={submit}
        disabled={submitting}
        activeOpacity={0.9}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveBtnTxt}>Save visit ✓</Text>
        )}
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );

  // ── Inventory picker modal ──
  const renderInvModal = () => (
    <Modal
      visible={invPickerOpen}
      animationType="slide"
      transparent
      onRequestClose={() => setInvPickerOpen(false)}
    >
      <View style={styles.modalBackdrop}>
        <TouchableOpacity style={{ flex: 1 }} onPress={() => setInvPickerOpen(false)} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Choose from inventory</Text>
            <TouchableOpacity onPress={() => setInvPickerOpen(false)}>
              <Text style={styles.modalClose}>Done</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.invSearch}
            placeholder="Search by name, brand…"
            placeholderTextColor="#8E8E93"
            value={invSearch}
            onChangeText={onInvSearchChange}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {invLoading ? (
            <ActivityIndicator color={BRAND_PURPLE} style={{ marginVertical: 16 }} />
          ) : null}
          <FlatList
            data={invItems}
            keyExtractor={(it) => String(it.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 32 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.invRow}
                onPress={() => pickInventoryItem(item)}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.invRowName}>{item.name}</Text>
                  <Text style={styles.invRowMeta}>
                    {[item.brand, item.shade_code].filter(Boolean).join(' · ')}
                    {item.quantity != null ? `  ·  In stock: ${item.quantity} ${item.unit || ''}` : ''}
                  </Text>
                </View>
                <Ionicons name="add-circle-outline" size={22} color={BRAND_PURPLE} />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              !invLoading ? (
                <Text style={styles.invEmpty}>
                  {invAllItems.length === 0
                    ? 'No products in inventory yet.'
                    : 'No products match your search.'}
                </Text>
              ) : null
            }
          />
        </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={IOS_KB_ACCESSORY_ID}>
          <View style={styles.kbAccessory}>
            <TouchableOpacity
              onPress={() => Keyboard.dismiss()}
              hitSlop={12}
              style={styles.kbAccessoryDoneBtn}
            >
              <Text style={styles.kbAccessoryDoneTxt}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      ) : null}

      {renderInvModal()}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerSide}>
            {wizardStep > 1 && wizardStep < 4 ? (
              <TouchableOpacity onPress={wizardBack} style={styles.iconBtn} hitSlop={12}>
                <Ionicons name="chevron-back" size={26} color="#FFFFFF" />
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.navHeadline}>New Formula</Text>
          <TouchableOpacity
            onPress={() => { Keyboard.dismiss(); navigation.goBack(); }}
            style={styles.iconBtn}
            hitSlop={12}
          >
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Progress */}
        <View style={styles.progressRow}>
          {[1, 2, 3, 4].map((s) => (
            <View
              key={s}
              style={[
                styles.progressSegment,
                s < wizardStep && styles.progressSegmentDone,
                s === wizardStep && styles.progressSegmentActive,
              ]}
            />
          ))}
        </View>
        <Text style={styles.progressLabel}>Step {wizardStep} of 4</Text>

        {wizardStep === 1 && renderStep1()}
        {wizardStep === 2 && renderStep2()}
        {wizardStep === 3 && renderStep3()}
        {wizardStep === 4 && renderStep4()}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#FFFFFF' },

  // keyboard accessory
  kbAccessory: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: '#E8E8ED',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#C6C6C8',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  kbAccessoryDoneBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  kbAccessoryDoneTxt: { fontSize: 17, fontFamily: FontFamily.semibold, color: BRAND_PURPLE },

  // header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerSide: { width: 40, height: 40 },
  iconBtn: { ...glassPurpleIconBtn },
  navHeadline: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FontFamily.bold,
    fontSize: 17,
    letterSpacing: -0.41,
    color: '#000000',
  },

  // progress bar
  progressRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 24,
    marginTop: 4,
    marginBottom: 2,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5EA',
  },
  progressSegmentDone: {
    backgroundColor: SCHEDULE_BANNER_LEAD_PINK,
    opacity: 0.45,
  },
  progressSegmentActive: {
    backgroundColor: SCHEDULE_BANNER_LEAD_PINK,
    opacity: 1,
  },
  progressLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    color: '#8E8E93',
    paddingHorizontal: 24,
    marginBottom: 10,
    marginTop: 4,
    letterSpacing: -0.08,
  },

  // step container
  stepContainer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
  },
  stepQuestion: {
    fontFamily: FontFamily.bold,
    fontSize: 26,
    color: '#1C1C1E',
    letterSpacing: -0.5,
    marginBottom: 6,
    lineHeight: 32,
  },
  stepSubtitle: {
    fontFamily: FontFamily.medium,
    fontSize: 16,
    color: SCHEDULE_BANNER_LEAD_PINK,
    marginBottom: 20,
    letterSpacing: -0.2,
  },
  forClient: {
    fontFamily: FontFamily.regular,
    fontSize: 15,
    color: '#8E8E93',
    marginBottom: 20,
    letterSpacing: -0.2,
  },

  // step 1 — zone grid
  zoneGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  zoneCard: {
    width: '48%',
    marginBottom: 14,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: SCHEDULE_BANNER_LEAD_PINK,
    overflow: 'hidden',
    shadowColor: SCHEDULE_BANNER_LEAD_PINK,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  zoneCardInner: {
    minHeight: 130,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  zoneCardLabel: {
    fontFamily: FontFamily.semibold,
    fontSize: 18,
    color: '#1C1C1E',
    letterSpacing: -0.3,
  },
  mixesSummaryBox: {
    marginTop: 8,
    backgroundColor: '#F5EEFF',
    borderRadius: 14,
    padding: 14,
  },
  mixesSummaryTitle: {
    fontFamily: FontFamily.semibold,
    fontSize: 13,
    color: BRAND_PURPLE,
    marginBottom: 6,
    letterSpacing: -0.1,
  },
  mixesSummaryItem: {
    fontFamily: FontFamily.regular,
    fontSize: 14,
    color: '#1C1C1E',
    lineHeight: 21,
  },

  // step 2 — count grid
  countGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 16,
    marginBottom: 10,
  },
  countCircleWrap: { margin: 8 },
  countCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: SCHEDULE_BANNER_LEAD_PINK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  countCircleTxt: {
    fontSize: 26,
    fontFamily: FontFamily.bold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  moreColoursBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: BRAND_PURPLE,
    backgroundColor: '#FAFAFA',
  },
  moreColoursBtnTxt: {
    fontFamily: FontFamily.semibold,
    fontSize: 16,
    color: BRAND_PURPLE,
  },

  // step 3 — colour cards
  colourCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  devCard: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  colourCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  colourCardTitle: {
    fontFamily: FontFamily.semibold,
    fontSize: 15,
    color: '#1C1C1E',
  },
  devCardTitle: {
    color: '#0D74FF',
  },
  fieldLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    color: '#8E8E93',
    marginBottom: 6,
    marginTop: 2,
    letterSpacing: 0.1,
  },
  fieldLabelOr: {
    fontFamily: FontFamily.regular,
    fontSize: 11,
    color: '#C6C6C8',
    textAlign: 'center',
    marginVertical: 8,
    letterSpacing: 0.2,
  },
  stockPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  stockPickerBtnDev: {
    backgroundColor: '#F2F2F7',
  },
  stockPickerBtnTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 15,
    color: '#8E8E93',
    flex: 1,
  },
  stockPickerShade: {
    fontFamily: FontFamily.bold,
    fontSize: 16,
    color: '#1C1C1E',
    letterSpacing: -0.2,
  },
  stockPickerName: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 1,
  },
  addColourRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginBottom: 14,
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
  },
  addColourRowBtnTxt: {
    fontFamily: FontFamily.semibold,
    fontSize: 15,
    color: BRAND_PURPLE,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  amountInput: {
    flex: 1,
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  unitBtn: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 8,
  },
  unitBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  unitBtnTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 13,
    color: '#8E8E93',
  },
  unitBtnTxtActive: {
    color: '#1C1C1E',
    fontFamily: FontFamily.semibold,
  },

  // next button (step 3)
  nextBtn: {
    backgroundColor: SCHEDULE_BANNER_LEAD_PINK,
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: SCHEDULE_BANNER_LEAD_PINK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  nextBtnTxt: {
    color: '#fff',
    fontSize: 17,
    fontFamily: FontFamily.semibold,
    letterSpacing: -0.2,
  },

  // step 4 — mix summary
  mixSummaryCard: {
    backgroundColor: '#F5EEFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  mixSummaryHeading: {
    fontFamily: FontFamily.semibold,
    fontSize: 14,
    color: BRAND_PURPLE,
    marginBottom: 6,
    letterSpacing: -0.15,
  },
  mixSummaryLine: {
    fontFamily: FontFamily.regular,
    fontSize: 14,
    color: '#1C1C1E',
    lineHeight: 21,
  },
  mixSummaryDevLine: {
    fontFamily: FontFamily.regular,
    fontSize: 14,
    color: '#0D74FF',
    lineHeight: 21,
    marginTop: 2,
  },
  sectionDivider: {
    fontFamily: FontFamily.semibold,
    fontSize: 13,
    color: '#8E8E93',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 12,
  },

  // inputs
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    color: '#000000',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },

  // step 4 action buttons
  addAnotherBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: SCHEDULE_BANNER_LEAD_PINK,
    borderRadius: 16,
    paddingVertical: 18,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  addAnotherBtnTxt: {
    fontSize: 17,
    fontFamily: FontFamily.semibold,
    color: '#1C1C1E',
  },
  saveBtn: {
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnTxt: {
    color: '#fff',
    fontSize: 17,
    fontFamily: FontFamily.semibold,
    letterSpacing: -0.2,
  },

  // client picker
  pickPurpose: {
    fontFamily: FontFamily.bold,
    fontSize: 24,
    color: '#1C1C1E',
    paddingHorizontal: 24,
    marginTop: 12,
    marginBottom: 16,
    letterSpacing: -0.45,
    lineHeight: 30,
  },
  pickSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 24,
    marginBottom: 8,
  },
  pickSearchField: {
    flex: 1,
    fontSize: 17,
    fontFamily: FontFamily.regular,
    color: '#000000',
    padding: 0,
  },
  pickList: { flex: 1, paddingHorizontal: 24 },
  pickRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  pickRowName: { fontSize: 17, fontFamily: FontFamily.regular, color: '#000000' },
  pickRowPhone: { fontSize: 15, fontFamily: FontFamily.regular, color: '#8E8E93', marginTop: 2 },
  pickEmpty: {
    fontFamily: FontFamily.regular,
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    lineHeight: 20,
  },

  // inventory picker modal
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
  modalTitle: { fontSize: 18, fontFamily: FontFamily.semibold, color: '#1C1C1E' },
  modalClose: { fontSize: 16, fontFamily: FontFamily.regular, color: BRAND_PURPLE },
  invSearch: {
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    color: '#1C1C1E',
    marginBottom: 12,
  },
  invRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  invRowName: { fontSize: 16, fontFamily: FontFamily.regular, color: '#1C1C1E' },
  invRowMeta: { fontSize: 13, fontFamily: FontFamily.regular, color: '#8E8E93', marginTop: 2 },
  invEmpty: {
    textAlign: 'center',
    color: '#8E8E93',
    fontSize: 15,
    fontFamily: FontFamily.regular,
    paddingVertical: 28,
  },
});
