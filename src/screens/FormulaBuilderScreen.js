import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Pressable,
  Animated,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  InputAccessoryView,
  Platform,
  FlatList,
  Alert,
  Modal,
  Image,
  PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, usePreventRemove } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import SFIcon from '../components/SFIcon';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { apiGet, apiPost } from '../api/client';
import { BRAND_PURPLE, BRAND_LILAC, glassPurpleIconBtn, MY_LAB_VIOLET } from '../theme/glassUi';
import {
  SCHEDULE_BANNER_GRADIENT,
  SCHEDULE_BANNER_GRADIENT_END,
  SCHEDULE_BANNER_GRADIENT_START,
  SCHEDULE_BANNER_LEAD_PINK,
  SCHEDULE_BANNER_LOCATIONS,
} from '../theme/scheduleBannerGradient';
import { FontFamily } from '../theme/fonts';
import { Type, typeLh } from '../theme/typography';
import IsoDatePickField from '../components/IsoDatePickField';
import { isColourFormulaPickItem, isDeveloperInventoryPickItem } from '../inventory/inventoryCategories';

const FORMULA_ZONE_ROOTS_ART = require('../../assets/formula-zone-roots.png');
const FORMULA_ZONE_LENGTHS_ART = require('../../assets/formula-zone-lengths.png');
const FORMULA_ZONE_TONER_ART = require('../../assets/formula-zone-toner.png');
const FORMULA_ZONE_OTHER_ART = require('../../assets/formula-zone-other.png');

const COLOUR_SECTIONS = [
  { key: 'roots', label: 'Roots', image: FORMULA_ZONE_ROOTS_ART },
  { key: 'lengths', label: 'Lengths', image: FORMULA_ZONE_LENGTHS_ART },
  { key: 'toner', label: 'Toner', image: FORMULA_ZONE_TONER_ART },
  { key: 'other', label: 'Other', image: FORMULA_ZONE_OTHER_ART },
];

const ZONE_CARD_INNER_COLORS = [
  'rgba(255,255,255,0.98)',
  'rgba(255,255,255,0.94)',
  'rgba(255,255,255,0.9)',
];
const ZONE_CARD_INNER_LOCATIONS = [0, 0.58, 1];
const COUNT_CIRCLE_COLORS = ['rgba(255,255,255,0.98)', 'rgba(250,247,255,0.94)'];
const COUNT_CIRCLE_LOCATIONS = [0, 1];

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

function FormulaColourCountBubble({ value, onPick }) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    Animated.spring(scale, {
      toValue: 0.9,
      friction: 6,
      tension: 260,
      useNativeDriver: true,
    }).start();
  }, [scale]);

  const pressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 200,
      useNativeDriver: true,
    }).start();
  }, [scale]);

  return (
    <View style={styles.countCircleWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${value} colours`}
        hitSlop={8}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onPress={() => onPick(value)}
        android_ripple={{ color: 'rgba(184,74,224,0.22)', borderless: true, radius: 24 }}
        style={styles.countCirclePressable}
      >
        <Animated.View style={[styles.countCircleElevate, { transform: [{ scale }] }]}>
          <LinearGradient
            colors={COUNT_CIRCLE_COLORS}
            locations={COUNT_CIRCLE_LOCATIONS}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={styles.countCircle}
          >
            <Text style={styles.countCircleTxt}>{value}</Text>
          </LinearGradient>
        </Animated.View>
      </Pressable>
    </View>
  );
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

  useEffect(() => {
    COLOUR_SECTIONS.forEach((section) => {
      if (!section.image) return;
      const source = Image.resolveAssetSource(section.image);
      if (source?.uri) Image.prefetch(source.uri).catch(() => {});
    });
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
  const [amountPaid, setAmountPaid] = useState('');
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
  const [photosBefore, setPhotosBefore] = useState([]); // { uri, mimeType }
  const [photosAfter, setPhotosAfter] = useState([]);
  const [retailPurchase, setRetailPurchase] = useState(null); // null | 'yes' | 'no'
  const IMAGE_MEDIA_TYPES = ImagePicker.MediaType?.Images ? [ImagePicker.MediaType.Images] : ['images'];

  // ── wizard draft ──
  const [wizardStep, setWizardStep] = useState(1);
  const wizardStepRef = useRef(1);
  const [draftSection, setDraftSection] = useState(null);
  const [draftColourRows, setDraftColourRows] = useState([]);
  const [draftDeveloper, setDraftDeveloper] = useState({ brand: '', amount: '', unit: 'g' });

  useEffect(() => {
    wizardStepRef.current = wizardStep;
  }, [wizardStep]);

  // ── global product autocomplete ──
  const [productSuggestions, setProductSuggestions] = useState([]);
  const [suggestionTargetKey, setSuggestionTargetKey] = useState(null);
  const productSearchTimer = useRef(null);

  useEffect(() => () => {
    if (productSearchTimer.current) clearTimeout(productSearchTimer.current);
  }, []);

  const dismissSuggestions = useCallback(() => {
    setProductSuggestions([]);
    setSuggestionTargetKey(null);
  }, []);

  const searchGlobalProducts = useCallback(async (q, rowKey) => {
    try {
      const results = await apiGet(`/api/products/search?q=${encodeURIComponent(q)}`);
      setSuggestionTargetKey((prev) => prev === rowKey ? rowKey : prev);
      setProductSuggestions(Array.isArray(results) ? results : []);
    } catch {
      setProductSuggestions([]);
    }
  }, []);

  const onColourNameChange = useCallback((rowKey, text) => {
    updateDraftRow(rowKey, { brand: text, inventory_item_id: null, stockLabel: null });
    setSuggestionTargetKey(rowKey);
    if (productSearchTimer.current) clearTimeout(productSearchTimer.current);
    if (text.length >= 2) {
      productSearchTimer.current = setTimeout(() => searchGlobalProducts(text, rowKey), 300);
    } else {
      setProductSuggestions([]);
    }
  }, [updateDraftRow, searchGlobalProducts]);

  const onPickGlobalSuggestion = useCallback((suggestion, rowKey) => {
    const name = `${suggestion.brand} ${suggestion.product_name}`.trim();
    updateDraftRow(rowKey, {
      brand: name,
      shade_code: '',
      unit: suggestion.unit || 'g',
      inventory_item_id: null,
      stockLabel: null,
    });
    setProductSuggestions([]);
    setSuggestionTargetKey(null);
    Keyboard.dismiss();
  }, [updateDraftRow]);

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
        const predicate =
          target === 'developer' ? isDeveloperInventoryPickItem : isColourFormulaPickItem;
        const filtered = list.filter(predicate);
        setInvAllItems(filtered);
        setInvItems(filtered);
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
    setRetailPurchase(null);
    setWizardStep(1);
  }, []);

  /** Same as header back — also used when swipe would leave the screen on steps 2–3 */
  const wizardBack = useCallback(() => {
    Keyboard.dismiss();
    const step = wizardStepRef.current;
    if (step === 2) {
      setDraftSection(null);
      setWizardStep(1);
    } else if (step === 3) {
      setDraftColourRows([]);
      setDraftDeveloper({ brand: '', amount: '', unit: 'g' });
      setWizardStep(2);
    }
  }, []);

  /** Native-stack: raw `beforeRemove` + preventDefault is unreliable; hook syncs with native navigator */
  usePreventRemove(wizardStep >= 2 && wizardStep <= 3, wizardBack);

  useEffect(() => {
    navigation.setOptions({ gestureEnabled: wizardStep <= 1 || wizardStep >= 4 });
  }, [navigation, wizardStep]);

  const wizardPanHandlers = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (evt, gesture) => {
          const step = wizardStepRef.current;
          if (step <= 1 || step >= 4) return false;
          if (evt.nativeEvent.pageX > 36) return false;
          return gesture.dx > 12 && Math.abs(gesture.dy) < 18;
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (gesture.dx > 52 && Math.abs(gesture.dy) < 44) wizardBack();
        },
      }).panHandlers,
    [wizardBack],
  );

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

  const pickPhoto = async (photoType) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('', 'Camera roll permission required.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: IMAGE_MEDIA_TYPES,
      allowsMultipleSelection: true,
      quality: 0.75,
      selectionLimit: 6,
    });
    if (result.canceled) return;
    const picked = result.assets.map(a => ({ uri: a.uri, mimeType: a.mimeType || 'image/jpeg' }));
    if (photoType === 'before') setPhotosBefore(prev => [...prev, ...picked].slice(0, 6));
    else setPhotosAfter(prev => [...prev, ...picked].slice(0, 6));
  };

  const uploadVisitPhotos = async (visitId, photos, photoType) => {
    for (const photo of photos) {
      try {
        const { uploadUrl, key, contentType } = await apiPost(`/api/visits/${visitId}/photos/presign`, {
          contentType: photo.mimeType,
          photo_type: photoType,
        });
        await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: await (await fetch(photo.uri)).blob(),
        });
        await apiPost(`/api/visits/${visitId}/photos/commit`, {
          key,
          contentType,
          photo_type: photoType,
        });
      } catch { /* best-effort photo upload */ }
    }
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
      const paidRaw = amountPaid.trim().replace(',', '.');
      if (paidRaw) {
        const u = Number(paidRaw);
        if (Number.isFinite(u) && u >= 0) body.amount_usd = u;
      }
      if (linkedAppointmentId) body.appointment_id = linkedAppointmentId;
      const evId = route.params?.deviceCalendarEventId;
      if (evId != null && String(evId).trim())
        body.device_calendar_event_id = String(evId).trim().slice(0, 256);
      const saved = await apiPost('/api/visits', body);
      const visitId = saved?.id;
      if (visitId && (photosBefore.length || photosAfter.length)) {
        await Promise.all([
          uploadVisitPhotos(visitId, photosBefore, 'before'),
          uploadVisitPhotos(visitId, photosAfter, 'after'),
        ]);
      }
      if (retailPurchase === 'yes') {
        navigation.goBack();
        navigation.navigate('TodaySales', { clientId, clientName: pickedClientLabel });
      } else {
        navigation.goBack();
      }
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
              <SFIcon name="close" iosName="xmark" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <Text style={styles.pickPurpose}>Who is this formula for?</Text>
          <View style={styles.pickSearchRow}>
            <SFIcon name="search-outline" iosName="magnifyingglass" size={20} color="#8A8A8E" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.pickSearchField}
              placeholder="Search clients"
              placeholderTextColor="#8A8A8E"
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
              colors={ZONE_CARD_INNER_COLORS}
              locations={ZONE_CARD_INNER_LOCATIONS}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.zoneCardInner}
            >
              <View style={styles.zoneGlassHighlight} pointerEvents="none" />
              {s.image ? (
                <View style={styles.zoneArtworkWrap}>
                  <Image
                    source={s.image}
                    style={styles.zoneCardRootsImage}
                    resizeMode="contain"
                    accessibilityIgnoresInvertColors
                  />
                </View>
              ) : (
                <SFIcon
                  name={s.icon}
                  iosName={s.iosIcon}
                  size={36}
                  color={SCHEDULE_BANNER_LEAD_PINK}
                  style={{ marginBottom: 10 }}
                />
              )}
              <Text style={styles.zoneCardLabel}>{s.label}</Text>
            </LinearGradient>
          </TouchableOpacity>
        ))}
      </View>

      {committedMixGroups.length > 0 ? (
        <View style={styles.mixesSummaryBox}>
          <Text style={styles.mixesSummaryTitle}>Added this visit</Text>
          {committedMixGroups.map((mgk, i) => {
            const colours = lines.filter(
              (l) => l.mixGroupKey === mgk && l.section !== 'developer',
            );
            const sLabel =
              COLOUR_SECTIONS.find((s) => s.key === colours[0]?.section)?.label || colours[0]?.section;
            return (
              <Text key={mgk} style={styles.mixesSummaryItem}>
                Mix {i + 1}: {sLabel}, {colours.length} colour{colours.length !== 1 ? 's' : ''}
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
          <FormulaColourCountBubble key={n} value={n} onPick={onPickColourCount} />
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
        <SFIcon name="add-circle-outline" iosName="plus.circle" size={20} color={MY_LAB_VIOLET} />
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
            <SFIcon name="trash-outline" iosName="trash" size={18} color="#C62828" />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Stock picker button — primary way to pick */}
      <TouchableOpacity
        style={styles.stockPickerBtn}
        onPress={() => openInvPicker(row.key)}
        activeOpacity={0.82}
      >
        <SFIcon name="cube-outline" iosName="cabinet.fill" size={18} color={BRAND_PURPLE} style={{ marginRight: 8 }} />
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
          <Text style={styles.stockPickerBtnTxt}>Choose from colors</Text>
        )}
        {row.stockLabel ? (
          <TouchableOpacity
            onPress={() => updateDraftRow(row.key, { brand: '', shade_code: '', inventory_item_id: null, stockLabel: null })}
            hitSlop={10}
            style={{ marginLeft: 'auto' }}
          >
            <SFIcon name="close-circle" iosName="xmark.circle.fill" size={17} color="#8A8A8E" />
          </TouchableOpacity>
        ) : (
          <SFIcon name="chevron-forward" iosName="chevron.right" size={16} color="#AEAEB2" style={{ marginLeft: 'auto' }} />
        )}
      </TouchableOpacity>

      {/* Manual brand/name with global product autocomplete */}
      {!row.stockLabel ? (
        <>
          <Text style={styles.fieldLabelOr}>— or type manually —</Text>
          <TextInput
            style={styles.input}
            placeholder="Brand / name  e.g. Wella Koleston 8/0"
            placeholderTextColor="#8A8A8E"
            value={row.brand}
            onChangeText={(t) => onColourNameChange(row.key, t)}
            onFocus={() => {
              if (row.brand.length >= 2 && suggestionTargetKey !== row.key) {
                setSuggestionTargetKey(row.key);
                searchGlobalProducts(row.brand, row.key);
              }
            }}
            inputAccessoryViewID={iosAccessoryId}
            returnKeyType="done"
            blurOnSubmit={false}
            onSubmitEditing={dismissSuggestions}
          />
          {/* Autocomplete dropdown */}
          {suggestionTargetKey === row.key && (
            <View style={styles.suggestionBox}>
              {productSuggestions.length > 0 ? (
                <>
                  {productSuggestions.slice(0, 6).map((s, i) => {
                    const trust = s.confirmed_count >= 10 ? '✓ 10+' : s.confirmed_count >= 3 ? '✓ 3+' : null;
                    return (
                      <TouchableOpacity
                        key={`${s.brand}-${s.product_name}-${i}`}
                        style={[styles.suggestionRow, i > 0 && styles.suggestionRowBorder]}
                        onPress={() => onPickGlobalSuggestion(s, row.key)}
                        activeOpacity={0.75}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.suggestionName} numberOfLines={1}>{s.product_name}</Text>
                          <Text style={styles.suggestionBrand} numberOfLines={1}>{s.brand}</Text>
                        </View>
                        {trust ? <Text style={styles.suggestionTrust}>{trust}</Text> : null}
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    style={[styles.suggestionRow, styles.suggestionRowBorder, styles.suggestionManual]}
                    onPress={dismissSuggestions}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.suggestionManualTxt}>Add manually →</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={styles.suggestionRow}
                  onPress={dismissSuggestions}
                  activeOpacity={0.75}
                >
                  <Text style={styles.suggestionManualTxt}>Add manually →</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </>
      ) : null}

      {/* Amount + unit */}
      <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Amount</Text>
      <View style={styles.amountRow}>
        <TextInput
          style={[styles.input, styles.amountInput]}
          placeholder="0"
          placeholderTextColor="#8A8A8E"
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
        <SFIcon name="add-circle-outline" iosName="plus.circle" size={20} color={MY_LAB_VIOLET} />
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
          <SFIcon name="cube-outline" iosName="cabinet.fill" size={18} color="#0D74FF" style={{ marginRight: 8 }} />
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
            <Text style={styles.stockPickerBtnTxt}>Choose developer</Text>
          )}
          {draftDeveloper.stockLabel ? (
            <TouchableOpacity
              onPress={() => setDraftDeveloper((d) => ({ ...d, brand: '', shade_code: '', inventory_item_id: null, stockLabel: null }))}
              hitSlop={10}
              style={{ marginLeft: 'auto' }}
            >
              <SFIcon name="close-circle" iosName="xmark.circle.fill" size={17} color="#8A8A8E" />
            </TouchableOpacity>
          ) : (
            <SFIcon name="chevron-forward" iosName="chevron.right" size={16} color="#AEAEB2" style={{ marginLeft: 'auto' }} />
          )}
        </TouchableOpacity>

        {!draftDeveloper.stockLabel ? (
          <>
            <Text style={styles.fieldLabelOr}>— or type manually —</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Wella Welloxon 6%"
              placeholderTextColor="#8A8A8E"
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
            placeholderTextColor="#8A8A8E"
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
              Mix {i + 1}: {sLabel}
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
        placeholderTextColor="#8A8A8E"
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
        textStyle={{ fontSize: 16, color: '#0D0D0D', flex: 1, fontFamily: FontFamily.regular }}
      />

      <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Notes (optional)</Text>
      <TextInput
        style={[styles.input, styles.inputMulti]}
        placeholder=""
        placeholderTextColor="#1C1C1E"
        value={notes}
        onChangeText={setNotes}
        multiline
        inputAccessoryViewID={iosAccessoryId}
      />

      <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Amount paid (optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="0.00"
        placeholderTextColor="#1C1C1E"
        value={amountPaid}
        onChangeText={setAmountPaid}
        keyboardType="decimal-pad"
        inputAccessoryViewID={iosAccessoryId}
      />

      {/* ── Photos ── */}
      <Text style={styles.sectionDivider}>Photos</Text>
      {[
        { label: 'Before', photos: photosBefore, setter: setPhotosBefore, type: 'before' },
        { label: 'After',  photos: photosAfter,  setter: setPhotosAfter,  type: 'after'  },
      ].map(({ label, photos, setter, type }) => (
        <View key={type} style={styles.photoSection}>
          <View style={styles.photoSectionHeader}>
            <Text style={styles.photoSectionLabel}>{label}</Text>
            <TouchableOpacity onPress={() => pickPhoto(type)} hitSlop={10} activeOpacity={0.8}>
              <SFIcon name="add-circle-outline" iosName="plus.circle" size={20} color={BRAND_PURPLE} />
            </TouchableOpacity>
          </View>
          {photos.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
              {photos.map((p, i) => (
                <TouchableOpacity
                  key={`${p.uri}-${i}`}
                  style={styles.photoThumb}
                  onPress={() => setter(prev => prev.filter((_, idx) => idx !== i))}
                  activeOpacity={0.8}
                >
                  <Image source={{ uri: p.uri }} style={styles.photoThumbImg} />
                  <View style={styles.photoRemove}>
                    <SFIcon name="close-circle" iosName="xmark.circle.fill" size={20} color="#FFFFFF" />
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.photoAddMore} onPress={() => pickPhoto(type)} activeOpacity={0.8}>
                <SFIcon name="camera-outline" iosName="camera.fill" size={22} color={BRAND_PURPLE} />
              </TouchableOpacity>
            </ScrollView>
          ) : (
            <TouchableOpacity style={styles.photoEmpty} onPress={() => pickPhoto(type)} activeOpacity={0.8}>
              <SFIcon name="camera-outline" iosName="camera.fill" size={26} color={BRAND_PURPLE} />
              <Text style={styles.photoEmptyTxt}>Add {label.toLowerCase()} photos</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}

      {/* ── Retail purchase question ── */}
      <View style={styles.retailQuestion}>
        <Text style={styles.retailQuestionTxt}>
          Did the client take home any retail products today?
        </Text>
        <View style={styles.retailToggle}>
          {[['yes','Yes'], ['no','No, thanks']].map(([val, label]) => (
            <TouchableOpacity
              key={val}
              style={[styles.retailBtn, retailPurchase === val && styles.retailBtnOn]}
              onPress={() => setRetailPurchase(val)}
              activeOpacity={0.8}
            >
              <Text style={[styles.retailBtnTxt, retailPurchase === val && styles.retailBtnTxtOn]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={{ height: 28 }} />

      <TouchableOpacity
        style={styles.saveBtn}
        onPress={submit}
        disabled={submitting}
        activeOpacity={0.9}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveBtnTxt}>
            {retailPurchase === 'yes' ? 'Save & log sale →' : 'Save visit ✓'}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.addAnotherBtn}
        onPress={() => { Keyboard.dismiss(); resetDraft(); }}
        activeOpacity={0.7}
        hitSlop={{ top: 10, bottom: 10 }}
      >
        <Text style={styles.addAnotherBtnTxt}>+ Add another mix</Text>
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
            <Text style={styles.modalTitle}>
              {invPickerTarget === 'developer' ? 'Choose developer' : 'Choose from colors'}
            </Text>
            <TouchableOpacity onPress={() => setInvPickerOpen(false)}>
              <Text style={styles.modalClose}>Done</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.invSearch}
            placeholder="Search by name, brand…"
            placeholderTextColor="#8A8A8E"
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
                <SFIcon name="add-circle-outline" iosName="plus.circle" size={22} color={MY_LAB_VIOLET} />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              !invLoading ? (
                <Text style={styles.invEmpty}>
                  {invAllItems.length === 0 ? 'Nothing to pick.' : 'No matching items.'}
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
        {...(wizardStep > 1 && wizardStep < 4 ? wizardPanHandlers : {})}
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerSide}>
            {wizardStep > 1 && wizardStep < 4 ? (
              <TouchableOpacity onPress={wizardBack} style={styles.iconBtn} hitSlop={12}>
                <SFIcon name="chevron-back" iosName="chevron.left" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.navHeadline}>New Formula</Text>
          <TouchableOpacity
            onPress={() => { Keyboard.dismiss(); navigation.goBack(); }}
            style={styles.iconBtn}
            hitSlop={12}
          >
            <SFIcon name="close" iosName="xmark" size={22} color="#FFFFFF" />
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
  flex: { flex: 1, backgroundColor: '#FFFFFF' },
  safe: { flex: 1, backgroundColor: '#FFFFFF' },

  // keyboard accessory
  kbAccessory: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5EA',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  kbAccessoryDoneBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  kbAccessoryDoneTxt: { ...Type.buttonLabel, color: BRAND_PURPLE },

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
    ...Type.screenTitle,
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
    backgroundColor: BRAND_LILAC,
    opacity: 0.5,
  },
  progressSegmentActive: {
    backgroundColor: BRAND_LILAC,
    opacity: 1,
  },
  progressLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    lineHeight: typeLh(12),
    color: '#8A8A8E',
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
    fontFamily: FontFamily.semibold,
    fontSize: 22,
    lineHeight: typeLh(22),
    color: '#0D0D0D',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  stepSubtitle: {
    fontFamily: FontFamily.medium,
    fontSize: 15,
    lineHeight: typeLh(15),
    color: BRAND_LILAC,
    marginBottom: 20,
    letterSpacing: -0.2,
  },
  forClient: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    lineHeight: typeLh(13),
    color: '#8A8A8E',
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
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 9,
  },
  zoneCardInner: {
    minHeight: 136,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.98)',
    borderLeftColor: 'rgba(255,255,255,0.9)',
    borderRightColor: 'rgba(184,74,224,0.26)',
    borderBottomColor: 'rgba(184,74,224,0.34)',
  },
  zoneGlassHighlight: {
    position: 'absolute',
    top: 1,
    left: 10,
    right: 10,
    height: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  zoneArtworkWrap: {
    width: 104,
    height: 78,
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneCardRootsImage: {
    width: 88,
    height: 68,
  },
  zoneCardLabel: {
    ...Type.listPrimary,
    color: '#0D0D0D',
    letterSpacing: -0.3,
  },
  mixesSummaryBox: {
    marginTop: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  mixesSummaryTitle: {
    ...Type.sectionLabel,
    marginBottom: 10,
  },
  mixesSummaryItem: {
    fontFamily: FontFamily.semibold,
    fontSize: 15,
    lineHeight: typeLh(15),
    color: '#0D0D0D',
    letterSpacing: -0.41,
    marginBottom: 4,
  },

  // step 2 — count grid
  countGrid: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 14,
    marginBottom: 12,
    paddingHorizontal: 0,
  },
  countCircleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 1,
  },
  countCirclePressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  countCircleElevate: {
    borderRadius: 18,
    backgroundColor: 'transparent',
    shadowColor: 'rgba(60,24,92,0.28)',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 5,
  },
  countCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(184,74,224,0.66)',
    overflow: 'hidden',
  },
  countCircleTxt: {
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.semibold,
    color: BRAND_LILAC,
    letterSpacing: -0.4,
  },
  moreColoursBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  moreColoursBtnTxt: {
    fontFamily: FontFamily.semibold,
    fontSize: 15,
    lineHeight: typeLh(15),
    color: BRAND_LILAC,
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
    color: '#0D0D0D',
  },
  devCardTitle: {
    color: '#0D74FF',
  },
  fieldLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    color: '#8A8A8E',
    marginBottom: 6,
    marginTop: 2,
    letterSpacing: 0.1,
  },
  fieldLabelOr: {
    fontFamily: FontFamily.regular,
    fontSize: 11,
    color: '#AEAEB2',
    textAlign: 'center',
    marginVertical: 8,
    letterSpacing: 0.2,
  },
  stockPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  stockPickerBtnDev: {
    backgroundColor: '#FFFFFF',
  },
  stockPickerBtnTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 15,
    color: '#0D0D0D',
    flex: 1,
  },
  stockPickerShade: {
    fontFamily: FontFamily.semibold,
    fontSize: 16,
    color: '#0D0D0D',
    letterSpacing: -0.2,
  },
  stockPickerName: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    color: '#8A8A8E',
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
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5EA',
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
    backgroundColor: 'rgba(94,53,177,0.07)',
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
    color: '#8A8A8E',
  },
  unitBtnTxtActive: {
    color: '#0D0D0D',
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
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  mixSummaryHeading: {
    fontFamily: FontFamily.semibold,
    fontSize: 18,
    color: '#0D0D0D',
    marginBottom: 10,
    letterSpacing: -0.43,
    lineHeight: 24,
  },
  mixSummaryLine: {
    fontFamily: FontFamily.regular,
    fontSize: 15,
    color: '#0D0D0D',
    lineHeight: 22,
    letterSpacing: -0.23,
  },
  mixSummaryDevLine: {
    fontFamily: FontFamily.regular,
    fontSize: 15,
    color: '#007AFF',
    lineHeight: 22,
    marginTop: 4,
    letterSpacing: -0.23,
  },
  sectionDivider: {
    fontFamily: FontFamily.semibold,
    fontSize: 13,
    color: '#8A8A8E',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 12,
  },
  retailQuestion: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  retailQuestionTxt: {
    fontFamily: FontFamily.semibold,
    fontSize: 15,
    color: '#0D0D0D',
    letterSpacing: -0.2,
    marginBottom: 14,
  },
  retailToggle: { flexDirection: 'row', gap: 10 },
  retailBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    alignItems: 'center',
  },
  retailBtnOn: { backgroundColor: '#0D0D0D', borderColor: '#0D0D0D' },
  retailBtnTxt: { fontFamily: FontFamily.semibold, fontSize: 14, color: '#0D0D0D' },
  retailBtnTxtOn: { color: '#FFFFFF' },
  photoSection: { marginBottom: 16 },
  photoSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  photoSectionLabel: {
    fontFamily: FontFamily.semibold,
    fontSize: 14,
    color: '#0D0D0D',
  },
  photoRow: { flexDirection: 'row' },
  photoThumb: {
    width: 80, height: 80,
    borderRadius: 10,
    marginRight: 8,
    overflow: 'hidden',
  },
  photoThumbImg: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute', top: 4, right: 4,
  },
  photoEmpty: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  photoEmptyTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
    color: BRAND_PURPLE,
  },
  photoAddMore: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
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
    borderColor: '#E5E5EA',
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },

  // global product autocomplete dropdown
  suggestionBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginTop: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 15,
    elevation: 10,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  suggestionRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5EA',
  },
  suggestionName: {
    fontFamily: FontFamily.semibold,
    fontSize: 14,
    color: '#0D0D0D',
    lineHeight: 18,
  },
  suggestionBrand: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    color: '#8A8A8E',
    marginTop: 1,
  },
  suggestionTrust: {
    fontFamily: FontFamily.medium,
    fontSize: 11,
    color: '#00A86B',
    flexShrink: 0,
  },
  suggestionManual: {
    backgroundColor: '#FAFAFA',
  },
  suggestionManualTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 13,
    color: '#5E35B1',
  },

  // step 4 action buttons
  addAnotherBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  addAnotherBtnTxt: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
    color: '#8A8A8E',
  },
  saveBtn: {
    backgroundColor: MY_LAB_VIOLET,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: MY_LAB_VIOLET,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
    marginBottom: 4,
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
    fontFamily: FontFamily.semibold,
    fontSize: 24,
    color: '#0D0D0D',
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
  pickRowName: { ...Type.listPrimary, color: '#000000' },
  pickRowPhone: { marginTop: 2, ...Type.secondary },
  pickEmpty: {
    fontFamily: FontFamily.regular,
    fontSize: 15,
    color: '#8A8A8E',
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
  modalTitle: { ...Type.screenTitle, color: '#0D0D0D' },
  modalClose: { fontSize: 16, fontFamily: FontFamily.regular, color: BRAND_PURPLE },
  invSearch: {
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    color: '#0D0D0D',
    marginBottom: 12,
  },
  invRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  invRowName: { ...Type.listPrimary, color: '#0D0D0D' },
  invRowMeta: { marginTop: 2, ...Type.secondary },
  invEmpty: {
    textAlign: 'center',
    color: '#8A8A8E',
    fontSize: 15,
    fontFamily: FontFamily.regular,
    paddingVertical: 28,
  },
});
