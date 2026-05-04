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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, usePreventRemove } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import SFIcon from '../components/SFIcon';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { apiGet, apiPost } from '../api/client';
import { BRAND_PURPLE, BRAND_LILAC, MY_LAB_VIOLET } from '../theme/glassUi';
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
import { displayStockUnit, isColourFormulaPickItem, isDeveloperInventoryPickItem } from '../inventory/inventoryCategories';

const FORMULA_ZONE_ROOTS_ART = require('../../assets/formula-zone-roots.png');
const FORMULA_ZONE_LENGTHS_ART = require('../../assets/c.png');
const FORMULA_ZONE_TONER_ART = require('../../assets/t.png');
const FORMULA_ZONE_OTHER_ART = require('../../assets/d.png');

/** Vertical nudge (px) + optional scale so PNGs with different padding/coverage match in ZONE_ART_SLOT. */
const COLOUR_SECTIONS = [
  { key: 'roots', label: 'Roots', image: FORMULA_ZONE_ROOTS_ART, artNudgeY: -1 },
  { key: 'lengths', label: 'Lengths', image: FORMULA_ZONE_LENGTHS_ART, artNudgeY: 4 },
  { key: 'toner', label: 'Toner', image: FORMULA_ZONE_TONER_ART, artNudgeY: 0 },
  {
    key: 'other',
    label: 'Other',
    image: FORMULA_ZONE_OTHER_ART,
    artNudgeY: 2,
    /** ~match t.png bbox fill (d.png graphic is tighter in frame) */
    artScale: 1.36,
  },
];

function zoneImageTransforms(section) {
  const tf = [];
  if (section.artScale != null && section.artScale !== 1) {
    tf.push({ scale: section.artScale });
  }
  if (section.artNudgeY) {
    tf.push({ translateY: section.artNudgeY });
  }
  return tf.length ? { transform: tf } : null;
}

const ZONE_CARD_INNER_COLORS = [
  '#FEFEFE',
  '#FCFCFD',
  '#F8F7FA',
];
const ZONE_CARD_INNER_LOCATIONS = [0, 0.5, 1];
/** SF Symbol / Ionicons size inside the same square as PNG artwork */
const ZONE_CARD_ICON_PX = 30;
/** Fixed artwork slot — all zone cards share this footprint */
const ZONE_ART_SLOT = 56;
/** Header + steps strip — black → deep violet (same family as Home „My lab“ card). */
const FORMULA_TOP_BAR_GRADIENT_COLORS = ['#000000', '#160B28', MY_LAB_VIOLET];
const FORMULA_TOP_BAR_GRADIENT_LOCATIONS = [0, 0.42, 1];
const COUNT_CIRCLE_COLORS = ['#FFFFFF', '#FBFAFD', '#F3F0F7'];
const COUNT_CIRCLE_LOCATIONS = [0, 0.38, 1];

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
      toValue: 0.96,
      friction: 8,
      tension: 280,
      useNativeDriver: true,
    }).start();
  }, [scale]);

  const pressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 7,
      tension: 220,
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
        android_ripple={{ color: 'rgba(69,34,119,0.08)', borderless: true, radius: 32 }}
        style={styles.countCirclePressable}
      >
        <Animated.View style={[styles.countCircleElevate, { transform: [{ scale }] }]}>
          <LinearGradient
            colors={COUNT_CIRCLE_COLORS}
            locations={COUNT_CIRCLE_LOCATIONS}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.countCircle}
          >
            <View style={styles.countCircleGloss} pointerEvents="none" />
            <View style={styles.countCircleInnerRing} pointerEvents="none" />
            <Text style={styles.countCircleTxt}>{value}</Text>
          </LinearGradient>
        </Animated.View>
      </Pressable>
    </View>
  );
}

export default function FormulaBuilderScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
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
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={8}
        >
          <View style={[styles.formulaTopBarWrap, { paddingTop: Math.max(insets.top, 8) }]}>
            <LinearGradient
              colors={FORMULA_TOP_BAR_GRADIENT_COLORS}
              locations={FORMULA_TOP_BAR_GRADIENT_LOCATIONS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />
            <View style={styles.formulaTopBarContent}>
              <View style={styles.header}>
                <View style={styles.headerSide} />
                <Text style={[styles.navHeadline, styles.navHeadlineOnBar]}>New Formula</Text>
                <TouchableOpacity
                  onPress={() => { Keyboard.dismiss(); navigation.goBack(); }}
                  style={styles.formulaBarIconHit}
                  hitSlop={12}
                >
                  <SFIcon name="close" iosName="xmark" size={22} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>
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
            activeOpacity={0.92}
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
                    style={[styles.zoneCardRootsImage, zoneImageTransforms(s)]}
                    resizeMode="contain"
                    accessibilityIgnoresInvertColors
                  />
                </View>
              ) : (
                <View style={[styles.zoneArtworkWrap, zoneImageTransforms(s)]}>
                  <SFIcon
                    name={s.icon}
                    iosName={s.iosName}
                    size={ZONE_CARD_ICON_PX}
                    color={SCHEDULE_BANNER_LEAD_PINK}
                  />
                </View>
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
      <View style={styles.colourCardHeader}>
        <Text style={styles.colourCardTitle}>Colour {idx + 1}</Text>
        <View style={styles.colourHeaderPickCluster}>
          <TouchableOpacity
            style={styles.stockPickerBtnInline}
            onPress={() => openInvPicker(row.key)}
            activeOpacity={0.82}
          >
            <SFIcon name="cube-outline" iosName="cabinet.fill" size={14} color={MY_LAB_VIOLET} style={{ marginRight: 6 }} />
            <Text style={styles.stockPickerBtnTxtInline} numberOfLines={1}>
              {row.stockLabel
                ? row.shade_code
                  ? `${row.shade_code} · ${row.stockLabel}`
                  : row.stockLabel
                : 'Choose from colors'}
            </Text>
          </TouchableOpacity>
          {row.stockLabel ? (
            <TouchableOpacity
              onPress={() => updateDraftRow(row.key, { brand: '', shade_code: '', inventory_item_id: null, stockLabel: null })}
              hitSlop={10}
              activeOpacity={0.7}
            >
              <SFIcon name="close-circle-outline" iosName="xmark.circle" size={15} color={MY_LAB_VIOLET} />
            </TouchableOpacity>
          ) : null}
        </View>
        {draftColourRows.length > 1 ? (
          <TouchableOpacity onPress={() => removeDraftRow(row.key)} hitSlop={10} activeOpacity={0.7}>
            <SFIcon name="trash-outline" iosName="trash" size={17} color="#C62828" />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Manual brand/name with global product autocomplete */}
      {!row.stockLabel ? (
        <>
          <Text style={styles.fieldLabelOr}>— or type manually —</Text>
          <TextInput
            style={styles.inputManualLikePicker}
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
            underlineColorAndroid="transparent"
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

      {/* Amount + unit (label + controls, one row) */}
      <View style={styles.amountFieldRow}>
        <Text style={[styles.fieldLabel, styles.amountLabelInline]}>Amount</Text>
        <View style={styles.amountRow}>
          <TextInput
            style={[styles.input, styles.amountInput]}
            placeholder="0"
            placeholderTextColor="#8A8A8E"
            value={row.amount}
            onChangeText={(t) => updateDraftRow(row.key, { amount: t })}
            keyboardType="decimal-pad"
            inputAccessoryViewID={iosAccessoryId}
            underlineColorAndroid="transparent"
          />
          <View style={styles.unitToggle}>
            {['g', 'oz'].map((u) => (
              <TouchableOpacity
                key={u}
                style={[styles.unitBtn, styles.unitBtnCompact, row.unit === u && styles.unitBtnActive]}
                onPress={() => updateDraftRow(row.key, { unit: u })}
                activeOpacity={0.8}
              >
                <Text style={[styles.unitBtnTxt, styles.unitBtnTxtCompact, row.unit === u && styles.unitBtnTxtActive]}>{u}</Text>
              </TouchableOpacity>
            ))}
          </View>
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
      <View style={styles.step3TitleRow}>
        <Text style={[styles.stepQuestion, styles.step3TitleRowQuestion]}>Add your colours</Text>
        {draftSection ? (
          <Text style={styles.step3TitleRowZone}>
            {COLOUR_SECTIONS.find((s) => s.key === draftSection)?.label}
          </Text>
        ) : null}
      </View>

      {draftColourRows.map((row, idx) => (
        <React.Fragment key={row.key}>
          {renderColourRow(row, idx)}
          <View style={styles.step3BetweenCardsRow}>
            <Pressable
              onPress={addDraftRow}
              style={({ pressed }) => [styles.step3AddColourOrbWrap, pressed && styles.step3AddColourOrbPressed]}
              hitSlop={10}
            >
              <LinearGradient
                colors={['#6B4A9E', MY_LAB_VIOLET]}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.85, y: 1 }}
                style={styles.step3AddColourOrb}
              >
                <SFIcon name="add" iosName="plus" size={20} color="#FFFFFF" />
              </LinearGradient>
            </Pressable>
            <Pressable
              onPress={addDraftRow}
              style={({ pressed }) => [styles.addColourRowLink, pressed && styles.addColourRowLinkPressed]}
            >
              <Text style={styles.addColourRowLinkTxt}>Add another colour</Text>
            </Pressable>
          </View>
        </React.Fragment>
      ))}

      {/* Developer */}
      <View style={[styles.colourCard, styles.devCard]}>
        <View style={styles.colourCardHeader}>
          <Text style={[styles.colourCardTitle, styles.devCardTitle]}>Developer</Text>
          <View style={styles.colourHeaderPickCluster}>
            <TouchableOpacity
              style={[styles.stockPickerBtnInline, styles.stockPickerBtnInlineDev]}
              onPress={() => openInvPicker('developer')}
              activeOpacity={0.82}
            >
              <SFIcon name="cube-outline" iosName="cabinet.fill" size={14} color="#2563EB" style={{ marginRight: 6 }} />
              <Text style={styles.stockPickerBtnTxtInline} numberOfLines={1}>
                {draftDeveloper.stockLabel
                  ? draftDeveloper.shade_code
                    ? `${draftDeveloper.shade_code} · ${draftDeveloper.stockLabel}`
                    : draftDeveloper.stockLabel
                  : 'Choose developer'}
              </Text>
            </TouchableOpacity>
            {draftDeveloper.stockLabel ? (
              <TouchableOpacity
                onPress={() => setDraftDeveloper((d) => ({ ...d, brand: '', shade_code: '', inventory_item_id: null, stockLabel: null }))}
                hitSlop={10}
                activeOpacity={0.7}
              >
                <SFIcon name="close-circle-outline" iosName="xmark.circle" size={15} color={MY_LAB_VIOLET} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {!draftDeveloper.stockLabel ? (
          <TextInput
            style={[styles.inputManualLikePicker, styles.inputManualLikePickerDev]}
            placeholder="e.g. Wella Welloxon 6%"
            placeholderTextColor="#8A8A8E"
            value={draftDeveloper.brand}
            onChangeText={(t) => setDraftDeveloper((d) => ({ ...d, brand: t }))}
            inputAccessoryViewID={iosAccessoryId}
            returnKeyType="done"
            blurOnSubmit
            underlineColorAndroid="transparent"
          />
        ) : null}

        <View style={styles.amountFieldRow}>
          <Text style={[styles.fieldLabel, styles.amountLabelInline]}>Amount</Text>
          <View style={styles.amountRow}>
            <TextInput
              style={[styles.input, styles.amountInput]}
              placeholder="0"
              placeholderTextColor="#8A8A8E"
              value={draftDeveloper.amount}
              onChangeText={(t) => setDraftDeveloper((d) => ({ ...d, amount: t }))}
              keyboardType="decimal-pad"
              inputAccessoryViewID={iosAccessoryId}
              underlineColorAndroid="transparent"
            />
            <View style={styles.unitToggle}>
              {['g', 'ml', 'oz'].map((u) => (
                <TouchableOpacity
                  key={u}
                  style={[styles.unitBtn, styles.unitBtnCompact, draftDeveloper.unit === u && styles.unitBtnActive]}
                  onPress={() => setDraftDeveloper((d) => ({ ...d, unit: u }))}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.unitBtnTxt, styles.unitBtnTxtCompact, draftDeveloper.unit === u && styles.unitBtnTxtActive]}>
                    {u}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
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
                    <SFIcon name="close-circle-outline" iosName="xmark.circle" size={20} color={MY_LAB_VIOLET} />
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
                    {item.quantity != null ? `  ·  In stock: ${item.quantity} ${displayStockUnit(item)}` : ''}
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
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
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
        <View style={[styles.formulaTopBarWrap, { paddingTop: Math.max(insets.top, 8) }]}>
          <LinearGradient
            colors={FORMULA_TOP_BAR_GRADIENT_COLORS}
            locations={FORMULA_TOP_BAR_GRADIENT_LOCATIONS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
          <View style={styles.formulaTopBarContent}>
            <View style={styles.header}>
              <View style={styles.headerSide}>
                {wizardStep > 1 && wizardStep < 4 ? (
                  <TouchableOpacity onPress={wizardBack} style={styles.formulaBarIconHit} hitSlop={12}>
                    <SFIcon name="chevron-back" iosName="chevron.left" size={22} color="#FFFFFF" />
                  </TouchableOpacity>
                ) : null}
              </View>
              <Text style={[styles.navHeadline, styles.navHeadlineOnBar]}>New Formula</Text>
              <TouchableOpacity
                onPress={() => { Keyboard.dismiss(); navigation.goBack(); }}
                style={styles.formulaBarIconHit}
                hitSlop={12}
              >
                <SFIcon name="close" iosName="xmark" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

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
          </View>
        </View>

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

  formulaTopBarWrap: {
    position: 'relative',
    overflow: 'hidden',
    paddingBottom: 10,
  },
  formulaTopBarContent: {
    position: 'relative',
    zIndex: 1,
  },
  formulaBarIconHit: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerSide: { width: 40, height: 40 },
  navHeadline: {
    flex: 1,
    textAlign: 'center',
    ...Type.screenTitle,
    letterSpacing: -0.41,
    color: '#000000',
  },
  navHeadlineOnBar: {
    color: '#FFFFFF',
  },

  // progress bar (on dark lilac bar)
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
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  progressSegmentDone: {
    backgroundColor: 'rgba(255,255,255,0.5)',
    opacity: 1,
  },
  progressSegmentActive: {
    backgroundColor: '#FFFFFF',
    opacity: 1,
  },
  progressLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    lineHeight: typeLh(12),
    color: 'rgba(255,255,255,0.72)',
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
    backgroundColor: '#FFFFFF',
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
  step3TitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 20,
  },
  step3TitleRowQuestion: {
    flex: 1,
    marginBottom: 0,
    minWidth: 0,
  },
  step3TitleRowZone: {
    fontFamily: FontFamily.medium,
    fontSize: 15,
    lineHeight: typeLh(15),
    color: BRAND_LILAC,
    letterSpacing: -0.2,
    flexShrink: 0,
  },
  forClient: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    lineHeight: typeLh(13),
    color: '#8A8A8E',
    marginBottom: 20,
    letterSpacing: -0.2,
  },

  // step 1 — zone grid (micro cards, strong floor shadow)
  zoneGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingBottom: 6,
    rowGap: 8,
    columnGap: 8,
  },
  zoneCard: {
    width: '47.5%',
    marginBottom: 0,
    borderRadius: 14,
    backgroundColor: '#FEFEFE',
    // Emphasize shadow below the card (floating shelf)
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 22,
    elevation: 8,
  },
  zoneCardInner: {
    height: 102,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.045)',
  },
  zoneGlassHighlight: {
    position: 'absolute',
    top: 0,
    left: 10,
    right: 10,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  zoneArtworkWrap: {
    width: ZONE_ART_SLOT,
    height: ZONE_ART_SLOT,
    marginBottom: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneCardRootsImage: {
    width: ZONE_ART_SLOT,
    height: ZONE_ART_SLOT,
  },
  zoneCardLabel: {
    fontFamily: FontFamily.semibold,
    fontSize: 10,
    lineHeight: typeLh(10),
    color: '#3A3A3C',
    letterSpacing: 0.65,
    textTransform: 'uppercase',
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

  // step 2 — count grid (pearl discs, lilac-tint shadow, inset highlight)
  countGrid: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 22,
    marginBottom: 18,
    paddingHorizontal: 0,
  },
  countCircleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 6,
  },
  countCirclePressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  countCircleElevate: {
    borderRadius: 24,
    backgroundColor: '#FBFAFD',
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 22,
    elevation: 14,
  },
  countCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.055)',
    overflow: 'hidden',
  },
  countCircleGloss: {
    position: 'absolute',
    top: 1,
    left: 14,
    right: 14,
    height: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  countCircleInnerRing: {
    position: 'absolute',
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    borderRadius: 23,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  countCircleTxt: {
    fontSize: 16,
    lineHeight: typeLh(16),
    fontFamily: FontFamily.semibold,
    color: '#24122E',
    letterSpacing: -0.35,
    fontVariant: ['tabular-nums'],
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
    fontFamily: FontFamily.regular,
    fontSize: 15,
    lineHeight: typeLh(15),
    color: MY_LAB_VIOLET,
  },

  // step 3 — colour cards (premium surfaces)
  colourCard: {
    backgroundColor: '#FEFEFE',
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.055)',
    shadowColor: '#1A0F24',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.09,
    shadowRadius: 20,
    elevation: 8,
  },
  devCard: {
    backgroundColor: '#FAFBFF',
    borderColor: 'rgba(37,99,235,0.12)',
    shadowColor: '#1D4ED8',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 22,
    elevation: 12,
  },
  colourCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  colourHeaderPickCluster: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: 4,
  },
  stockPickerBtnInline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    backgroundColor: '#F8F8FA',
    borderWidth: 1,
    borderColor: '#C6C6CC',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  stockPickerBtnInlineDev: {
    backgroundColor: '#EEF3FF',
    borderColor: 'rgba(37,99,235,0.35)',
    shadowColor: '#1E3A8A',
    shadowOpacity: 0.08,
  },
  stockPickerBtnTxtInline: {
    flex: 1,
    minWidth: 0,
    fontFamily: FontFamily.medium,
    fontSize: 13,
    lineHeight: typeLh(13),
    color: '#1C1C1E',
  },
  /** Step 3 manual text fields — same footprint + chrome as stockPickerBtnInline */
  inputManualLikePicker: {
    backgroundColor: '#F8F8FA',
    borderWidth: 1,
    borderColor: '#C6C6CC',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: Platform.OS === 'android' ? 42 : 40,
    fontSize: 13,
    fontFamily: FontFamily.medium,
    color: '#1C1C1E',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  inputManualLikePickerDev: {
    backgroundColor: '#EEF3FF',
    borderColor: 'rgba(37,99,235,0.35)',
    shadowColor: '#1E3A8A',
    shadowOpacity: 0.08,
  },
  colourCardTitle: {
    fontFamily: FontFamily.semibold,
    fontSize: 13,
    color: MY_LAB_VIOLET,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  devCardTitle: {
    color: '#2563EB',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  fieldLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 11,
    color: '#6E6E73',
    marginBottom: 8,
    marginTop: 2,
    letterSpacing: 0.35,
    textTransform: 'uppercase',
  },
  fieldLabelOr: {
    fontFamily: FontFamily.regular,
    fontSize: 11,
    color: '#AEAEB2',
    textAlign: 'center',
    marginVertical: 10,
    letterSpacing: 0.15,
  },
  stockPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  stockPickerBtnDev: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(37,99,235,0.14)',
  },
  stockPickerBtnTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 15,
    color: '#1C1C1E',
    flex: 1,
  },
  stockPickerShade: {
    fontFamily: FontFamily.semibold,
    fontSize: 16,
    color: '#1C1C1E',
    letterSpacing: -0.25,
  },
  stockPickerName: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    color: '#8A8A8E',
    marginTop: 2,
  },
  step3BetweenCardsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: -2,
    paddingVertical: 4,
  },
  step3AddColourOrbWrap: {
    borderRadius: 22,
    shadowColor: MY_LAB_VIOLET,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 10,
  },
  step3AddColourOrb: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  step3AddColourOrbPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.96 }],
  },
  addColourRowLink: {
    paddingVertical: 6,
    paddingLeft: 8,
  },
  addColourRowLinkTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
    color: MY_LAB_VIOLET,
    letterSpacing: -0.15,
  },
  addColourRowLinkPressed: { opacity: 0.55 },
  amountFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
    minHeight: 28,
  },
  amountLabelInline: {
    marginBottom: 0,
    marginTop: 0,
    flexShrink: 0,
    alignSelf: 'center',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexShrink: 0,
  },
  amountInput: {
    width: 68,
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: Platform.OS === 'android' ? 8 : 9,
    minHeight: Platform.OS === 'android' ? 44 : 40,
    textAlign: 'right',
    fontSize: 15,
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(69,34,119,0.07)',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  unitBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 9,
  },
  unitBtnCompact: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
  },
  unitBtnTxtCompact: {
    fontSize: 12,
  },
  unitBtnActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(69,34,119,0.12)',
    shadowColor: '#1A0F24',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 3,
  },
  unitBtnTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 13,
    color: '#8A8A8E',
  },
  unitBtnTxtActive: {
    color: MY_LAB_VIOLET,
    fontFamily: FontFamily.semibold,
  },

  // next button (step 3)
  nextBtn: {
    backgroundColor: MY_LAB_VIOLET,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: MY_LAB_VIOLET,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 10,
  },
  nextBtnTxt: {
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: FontFamily.semibold,
    letterSpacing: -0.15,
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
    backgroundColor: '#F8F8FA',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'android' ? 12 : 15,
    minHeight: Platform.OS === 'android' ? 52 : 48,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    color: '#1C1C1E',
    borderWidth: 1,
    borderColor: '#C6C6CC',
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },

  // global product autocomplete dropdown
  suggestionBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginTop: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#1A0F24',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 12,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  suggestionRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  suggestionName: {
    fontFamily: FontFamily.semibold,
    fontSize: 14,
    color: '#1C1C1E',
    lineHeight: 18,
  },
  suggestionBrand: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    color: '#8A8A8E',
    marginTop: 2,
  },
  suggestionTrust: {
    fontFamily: FontFamily.medium,
    fontSize: 11,
    color: '#00A86B',
    flexShrink: 0,
  },
  suggestionManual: {
    backgroundColor: '#FBFAFD',
  },
  suggestionManualTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 13,
    color: MY_LAB_VIOLET,
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
