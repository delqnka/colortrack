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
  Modal,
  FlatList,
  Alert,
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
  { key: 'roots', label: 'Roots' },
  { key: 'lengths', label: 'Lengths' },
  { key: 'toner', label: 'Toner' },
  { key: 'other', label: 'Other' },
];

/** Prefer when picking inventory for a Developer line (no search query). */
function inventoryLooksLikeDeveloper(item) {
  const t = `${item.name || ''} ${item.brand || ''} ${item.category || ''}`.toLowerCase();
  return /\boxid|oxid|perox|developer|vol\.|volume|\d+\s*%|\b10v\b|\b20v\b|\b30v\b|\b40v\b/.test(t);
}

/** iOS: decimal pad / number pad have no "return" — toolbar to dismiss keyboard */
const IOS_KB_ACCESSORY_ID = 'formula_input_accessory_done';

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

function newDeveloperLine() {
  const line = newLine();
  line.section = 'developer';
  return line;
}

function isLineEmpty(line) {
  return (
    !String(line.brand || '').trim() &&
    !line.inventory_item_id &&
    !String(line.amount || '').replace(',', '.').trim()
  );
}

function englishOrdinalSuffix(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function lineTabLabel(lines, idx) {
  const line = lines[idx];
  if (!line) return '';
  if (line.section === 'developer') {
    const oxNum = lines.slice(0, idx + 1).filter((l) => l.section === 'developer').length;
    return oxNum <= 1 ? 'Developer' : `Developer ${oxNum}`;
  }
  const colourNum = lines.slice(0, idx).filter((l) => l.section !== 'developer').length + 1;
  return `${englishOrdinalSuffix(colourNum)} color`;
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

const ADD_LINE_THEME = {
  pink: {
    fg: '#FFFFFF',
    bg: SCHEDULE_BANNER_LEAD_PINK,
    bgPressed: '#DF5186',
    border: '#C4477E',
    borderPressed: '#AE3D71',
  },
  blue: {
    fg: '#FFFFFF',
    bg: '#0D74FF',
    bgPressed: '#0060E6',
    border: '#004FC4',
    borderPressed: '#003DA3',
  },
};

function AddLineBouncyButton({ onPress, iconName, label, variant }) {
  const theme = ADD_LINE_THEME[variant];
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = useCallback(() => {
    Animated.spring(scale, {
      toValue: 0.93,
      useNativeDriver: true,
      friction: 5,
      tension: 320,
    }).start();
  }, [scale]);

  const pressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 4,
      tension: 200,
    }).start();
  }, [scale]);

  return (
    <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} style={{ flex: 1 }}>
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.addLineBtn,
            {
              transform: [{ scale }],
              backgroundColor: pressed ? theme.bgPressed : theme.bg,
              borderColor: pressed ? theme.borderPressed : theme.border,
            },
          ]}
        >
          <Ionicons name={iconName} size={18} color={theme.fg} />
          <Text style={[styles.addLineBtnTxt, { color: theme.fg }]}>{label}</Text>
        </Animated.View>
      )}
    </Pressable>
  );
}

export default function FormulaBuilderScreen({ route, navigation }) {
  const [clientId, setClientId] = useState(() => parseRouteClientId(route.params?.clientId));
  const [pickedClientLabel, setPickedClientLabel] = useState('');
  const [clientPickQuery, setClientPickQuery] = useState('');
  const [clientPickHits, setClientPickHits] = useState([]);
  const [clientPickLoading, setClientPickLoading] = useState(false);
  const clientPickTimerRef = useRef(null);
  const openedWithPresetClientRef = useRef(parseRouteClientId(route.params?.clientId) != null);

  useEffect(() => {
    const next = parseRouteClientId(route.params?.clientId);
    if (next != null) setClientId(next);
  }, [route.params?.clientId]);

  useEffect(() => {
    return () => {
      if (clientPickTimerRef.current) clearTimeout(clientPickTimerRef.current);
    };
  }, []);

  const runClientPickSearch = useCallback(async (q) => {
    const t = q.trim();
    setClientPickLoading(true);
    try {
      let rows;
      if (!t) {
        rows = await apiGet('/api/clients');
      } else {
        rows = await apiGet(`/api/clients?q=${encodeURIComponent(t)}`);
      }
      setClientPickHits(Array.isArray(rows) ? rows : []);
    } catch {
      setClientPickHits([]);
    } finally {
      setClientPickLoading(false);
    }
  }, []);

  useEffect(() => {
    if (clientId != null) return;
    runClientPickSearch('');
  }, [clientId, runClientPickSearch]);

  const onClientPickQueryChange = useCallback(
    (text) => {
      setClientPickQuery(text);
      if (clientPickTimerRef.current) clearTimeout(clientPickTimerRef.current);
      clientPickTimerRef.current = setTimeout(() => runClientPickSearch(text), 280);
    },
    [runClientPickSearch],
  );

  const [procedureName, setProcedureName] = useState('');
  const [chairLabel, setChairLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [amountUsd, setAmountUsd] = useState('');
  const [visitDate, setVisitDate] = useState(() => toYMD(new Date()));
  const [lines, setLines] = useState(() => [newLine()]);
  const [activeLineIndex, setActiveLineIndex] = useState(0);

  const [linkedAppointmentId, setLinkedAppointmentId] = useState(null);
  const prefilledApptRef = useRef(null);
  const prefilledDeviceCalRef = useRef(null);
  const sectionChipScrollRefs = useRef({});

  const [inventory, setInventory] = useState([]);
  const [loadingStock, setLoadingStock] = useState(true);
  const [pickerForKey, setPickerForKey] = useState(null);
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setActiveLineIndex((i) => Math.max(0, Math.min(i, lines.length - 1)));
  }, [lines.length]);

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

  useEffect(() => {
    if (!pickerForKey) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiGet('/api/inventory');
        if (!cancelled) setInventory(Array.isArray(rows) ? rows : []);
      } catch {
        /* keep existing list */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickerForKey]);

  const filteredInventory = useMemo(() => {
    const qRaw = inventoryQuery.trim();
    const q = qRaw.toLowerCase();
    const pickerLine = pickerForKey ? lines.find((l) => l.key === pickerForKey) : null;
    const devLine = pickerLine?.section === 'developer';

    let list = inventory;
    if (q) {
      list = inventory.filter((it) => {
        const name = String(it.name || '').toLowerCase();
        const brand = String(it.brand || '').toLowerCase();
        const shade = String(it.shade_code || '').toLowerCase();
        const cat = String(it.category || '').toLowerCase();
        return name.includes(q) || brand.includes(q) || shade.includes(q) || cat.includes(q);
      });
    } else if (devLine) {
      const hits = inventory.filter((it) => inventoryLooksLikeDeveloper(it));
      if (hits.length) list = hits;
    }

    return list;
  }, [inventory, inventoryQuery, pickerForKey, lines]);

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

  const MAX_FORMULA_LINES = 16;

  const updateLine = (key, patch) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const selectColourSection = (lineKey, sectionKey) => {
    Keyboard.dismiss();
    updateLine(lineKey, { section: sectionKey });
    const idx = COLOUR_SECTIONS.findIndex((s) => s.key === sectionKey);
    requestAnimationFrame(() => {
      const ref = sectionChipScrollRefs.current[lineKey];
      if (ref && idx >= 0) {
        ref.scrollTo({ x: Math.max(0, idx * 118 - 20), animated: true });
      }
    });
  };

  const appendColourLine = () => {
    Keyboard.dismiss();
    if (lines.length >= MAX_FORMULA_LINES) {
      Alert.alert('', `At most ${MAX_FORMULA_LINES} lines.`);
      return;
    }
    setLines((prev) => {
      const next = [...prev, newLine()];
      setActiveLineIndex(next.length - 1);
      return next;
    });
  };

  const appendOxidantLine = () => {
    Keyboard.dismiss();
    if (lines.length >= MAX_FORMULA_LINES) {
      Alert.alert('', `At most ${MAX_FORMULA_LINES} lines.`);
      return;
    }
    setLines((prev) => {
      const next = [...prev, newDeveloperLine()];
      setActiveLineIndex(next.length - 1);
      return next;
    });
  };

  const applyColourCountQuickStart = (n) => {
    if (n < 1 || n > 8) return;
    const go = () => {
      Keyboard.dismiss();
      setLines(Array.from({ length: n }, () => newLine()));
      setActiveLineIndex(0);
    };
    const allEmpty = lines.every(isLineEmpty);
    if (allEmpty) {
      go();
      return;
    }
    Alert.alert(
      'Replace lines?',
      `Replace with ${n} empty colour rows?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: go },
      ],
    );
  };

  const removeLineByKey = (key) => {
    Keyboard.dismiss();
    setLines((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((l) => l.key === key);
      if (idx < 0) return prev;
      const nextLen = prev.length - 1;
      setActiveLineIndex((ai) => {
        if (ai === idx) return Math.min(idx, nextLen - 1);
        if (ai > idx) return ai - 1;
        return ai;
      });
      return prev.filter((l) => l.key !== key);
    });
  };

  const promptRemoveLineAtIndex = (idx) => {
    Keyboard.dismiss();
    const line = lines[idx];
    if (!line || lines.length <= 1) {
      Alert.alert("Can't delete", 'Your formula needs at least one row.');
      return;
    }
    const label = lineTabLabel(lines, idx);
    if (isLineEmpty(line)) {
      removeLineByKey(line.key);
      return;
    }
    Alert.alert('Remove row?', `"${label}" will be cleared.`, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeLineByKey(line.key) },
    ]);
  };

  const convertDeveloperToColourLine = (lineKey) => {
    Keyboard.dismiss();
    updateLine(lineKey, { section: 'roots' });
  };

  const pickStock = (item) => {
    if (!pickerForKey) return;
    updateLine(pickerForKey, {
      inventory_item_id: item.id,
      stockLabel: `${item.brand ? item.brand + ' ' : ''}${item.name}${item.shade_code ? ' · ' + item.shade_code : ''}`,
      brand: item.brand || item.name || '',
      shade_code: item.shade_code || '-',
    });
    closeProductPicker();
  };

  const clearStock = (key) => {
    updateLine(key, {
      inventory_item_id: null,
      stockLabel: null,
      brand: '',
      shade_code: '',
    });
  };

  const openProductPicker = (lineKey) => {
    Keyboard.dismiss();
    setInventoryQuery('');
    setPickerForKey(lineKey);
  };

  const closeProductPicker = () => {
    Keyboard.dismiss();
    setPickerForKey(null);
    setInventoryQuery('');
  };

  const submit = async () => {
    if (!clientId) return;
    const proc = procedureName.trim();
    if (!proc) {
      Alert.alert('Procedure', 'Enter a procedure for this visit.');
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
      Alert.alert('', 'Add at least one line with quantity.');
      return;
    }

    Keyboard.dismiss();
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

  const quickCountSelected = useMemo(() => {
    const c = lines.filter((l) => l.section !== 'developer').length;
    if (c >= 1 && c <= 6) return c;
    return null;
  }, [lines]);

  if (!clientId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <View style={styles.header}>
            <View style={styles.headerSide} />
            <Text style={styles.navHeadline}>Choose Client</Text>
            <TouchableOpacity
              onPress={() => {
                Keyboard.dismiss();
                navigation.goBack();
              }}
              style={styles.iconBtn}
              hitSlop={12}
            >
              <Ionicons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <Text style={styles.stepMarker}>Step 1 of 2</Text>
          <Text style={styles.pickPurpose}>Pick who this formula visit is for.</Text>
          <View style={styles.pickSearchRow}>
            <Ionicons name="search-outline" size={20} color="#1C1C1E" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.pickSearchField}
              placeholder="Search"
              placeholderTextColor="#8E8E93"
              value={clientPickQuery}
              onChangeText={onClientPickQueryChange}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          {clientPickLoading ? <ActivityIndicator style={{ marginVertical: 10 }} /> : null}
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
                  setPickedClientLabel(String(item.full_name || '').trim() || '');
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.pickRowName}>{item.full_name}</Text>
                {item.phone ? <Text style={styles.pickRowPhone}>{item.phone}</Text> : null}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              !clientPickLoading && clientPickHits.length === 0 ? (
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

  const activeLine = lines[activeLineIndex] || lines[0];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={IOS_KB_ACCESSORY_ID}>
          <View style={styles.kbAccessory}>
            <TouchableOpacity onPress={() => Keyboard.dismiss()} hitSlop={12} style={styles.kbAccessoryDoneBtn}>
              <Text style={styles.kbAccessoryDoneTxt}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      ) : null}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={styles.header}>
          <View style={styles.headerSide} />
          <Text style={styles.navHeadline}>New Formula</Text>
          <TouchableOpacity
            onPress={() => {
              Keyboard.dismiss();
              navigation.goBack();
            }}
            style={styles.iconBtn}
            hitSlop={12}
          >
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        {!openedWithPresetClientRef.current ? (
          <Text style={styles.stepMarker}>Step 2 of 2 · formula & lines</Text>
        ) : null}
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          {pickedClientLabel ? (
            <Text style={styles.forClientTitle} numberOfLines={2}>
              For {pickedClientLabel}
            </Text>
          ) : null}
          <Text style={styles.label}>Procedure</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#8E8E93"
            value={procedureName}
            onChangeText={setProcedureName}
            inputAccessoryViewID={iosAccessoryId}
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={() => Keyboard.dismiss()}
          />

          <Text style={styles.label}>Date</Text>
          <IsoDatePickField
            value={visitDate}
            onChange={setVisitDate}
            style={[styles.input, styles.datePickRow]}
            textStyle={styles.datePickText}
          />

          <Text style={styles.label}>Chair</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={chairLabel}
            onChangeText={setChairLabel}
            inputAccessoryViewID={iosAccessoryId}
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={() => Keyboard.dismiss()}
          />

          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={notes}
            onChangeText={setNotes}
            multiline
            inputAccessoryViewID={iosAccessoryId}
          />

          <Text style={styles.label}>Paid (USD, optional)</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={amountUsd}
            onChangeText={setAmountUsd}
            keyboardType="decimal-pad"
            inputAccessoryViewID={iosAccessoryId}
          />

          <View style={styles.linesHeader}>
            <Text style={styles.sectionTitle}>How many colors did you mix?</Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickCountRow}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => {
              const isSel = quickCountSelected === n;
              return (
                <TouchableOpacity
                  key={n}
                  style={styles.quickCountTouchable}
                  onPress={() => applyColourCountQuickStart(n)}
                  activeOpacity={0.88}
                  accessibilityState={{ selected: isSel }}
                >
                  {isSel ? (
                    <View style={styles.quickCountRing}>
                      <LinearGradient
                        colors={SCHEDULE_BANNER_GRADIENT}
                        locations={SCHEDULE_BANNER_LOCATIONS}
                        start={SCHEDULE_BANNER_GRADIENT_START}
                        end={SCHEDULE_BANNER_GRADIENT_END}
                        style={styles.quickCountGradInset}
                      >
                        <Text style={styles.quickCountChipTxt}>{n}</Text>
                      </LinearGradient>
                    </View>
                  ) : (
                    <LinearGradient
                      colors={SCHEDULE_BANNER_GRADIENT}
                      locations={SCHEDULE_BANNER_LOCATIONS}
                      start={SCHEDULE_BANNER_GRADIENT_START}
                      end={SCHEDULE_BANNER_GRADIENT_END}
                      style={styles.quickCountGradDim}
                    >
                      <Text style={styles.quickCountChipTxt}>{n}</Text>
                    </LinearGradient>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.lineSegScroller}
            contentContainerStyle={styles.lineSegScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.lineSegTrack}>
              {lines.map((line, idx) => {
                const sel = idx === activeLineIndex;
                return (
                  <View
                    key={line.key}
                    style={[styles.lineSegSegment, sel && styles.lineSegSegmentOn]}
                  >
                    <Pressable
                      onPress={() => {
                        Keyboard.dismiss();
                        setActiveLineIndex(idx);
                      }}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: sel }}
                      accessibilityLabel={lineTabLabel(lines, idx)}
                      style={styles.lineSegLabelPress}
                    >
                      <Text
                        style={[styles.lineSegTxt, sel && styles.lineSegTxtOn]}
                        numberOfLines={1}
                      >
                        {lineTabLabel(lines, idx)}
                      </Text>
                    </Pressable>
                    {lines.length > 1 ? (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${lineTabLabel(lines, idx)}`}
                        hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
                        onPress={() => promptRemoveLineAtIndex(idx)}
                        style={styles.lineSegRemovePress}
                        activeOpacity={0.65}
                      >
                        <Ionicons
                          name="close"
                          size={18}
                          color={sel ? '#E53935' : 'rgba(255,255,255,0.88)'}
                        />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.addLineRow}>
            <AddLineBouncyButton
              onPress={appendColourLine}
              iconName="color-fill-outline"
              label="+ Colour"
              variant="pink"
            />
            <AddLineBouncyButton
              onPress={appendOxidantLine}
              iconName="flask-outline"
              label="+ Developer"
              variant="blue"
            />
          </View>

          {activeLine ? (
            <View
              key={activeLine.key}
              style={[styles.lineCard, activeLine.section === 'developer' && styles.lineCardDev]}
            >
              <View style={styles.lineTop}>
                <View style={styles.lineTopLeft}>
                  <Text style={styles.lineTitle}>{lineTabLabel(lines, activeLineIndex)}</Text>
                  {activeLine.section === 'developer' ? (
                    <TouchableOpacity
                      onPress={() => convertDeveloperToColourLine(activeLine.key)}
                      hitSlop={8}
                      accessibilityRole="link"
                      accessibilityLabel="Switch this row to colour"
                    >
                      <Text style={styles.lineTypeSwitch}>Switch to colour</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {lines.length > 1 ? (
                  <TouchableOpacity
                    onPress={() => promptRemoveLineAtIndex(activeLineIndex)}
                    accessibilityLabel="Remove row"
                    hitSlop={14}
                    activeOpacity={0.65}
                  >
                    <Ionicons name="trash-outline" size={22} color="#E53935" />
                  </TouchableOpacity>
                ) : null}
              </View>

              {activeLine.section !== 'developer' ? (
                <ScrollView
                  ref={(r) => {
                    sectionChipScrollRefs.current[activeLine.key] = r;
                  }}
                  horizontal
                  showsHorizontalScrollIndicator
                  contentContainerStyle={styles.segScroll}
                >
                  {COLOUR_SECTIONS.map((s) => (
                    <TouchableOpacity
                      key={s.key}
                      onPress={() => selectColourSection(activeLine.key, s.key)}
                      style={[styles.seg, activeLine.section === s.key && styles.segOn]}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.segTxt, activeLine.section === s.key && styles.segTxtOn]}>
                        {s.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : null}

              <Text style={styles.labSm}>Product (inventory)</Text>
              <TouchableOpacity
                style={[
                  styles.input,
                  styles.productPickRow,
                  activeLine.section === 'developer' && styles.productPickRowDev,
                ]}
                onPress={() => openProductPicker(activeLine.key)}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={activeLine.section === 'developer' ? 'flask-outline' : 'cube-outline'}
                  size={20}
                  color={activeLine.section === 'developer' ? ADD_LINE_THEME.blue.bg : ADD_LINE_THEME.pink.bg}
                  style={styles.productIcon}
                />
                <Text
                  style={[
                    styles.productPickText,
                    !activeLine.stockLabel && styles.productPickPlaceholder,
                  ]}
                  numberOfLines={2}
                >
                  {activeLine.stockLabel || 'Choose from your inventory…'}
                </Text>
                <Ionicons name="chevron-down" size={22} color="#1C1C1E" />
              </TouchableOpacity>
              {activeLine.inventory_item_id ? (
                <TouchableOpacity
                  onPress={() => {
                    Keyboard.dismiss();
                    clearStock(activeLine.key);
                  }}
                  style={styles.clearProductBtn}
                  hitSlop={8}
                >
                  <Text style={styles.unlink}>Clear</Text>
                </TouchableOpacity>
              ) : null}

              {!activeLine.inventory_item_id ? (
                activeLine.section === 'developer' ? (
                  <>
                    <Text style={styles.labSm}>Manual</Text>
                    <TextInput
                      style={[styles.input, styles.inputDevManual]}
                      placeholder=""
                      placeholderTextColor="#8E8E93"
                      value={activeLine.brand}
                      onChangeText={(t) =>
                        updateLine(activeLine.key, { brand: t, shade_code: '-' })
                      }
                      inputAccessoryViewID={iosAccessoryId}
                      returnKeyType="done"
                      blurOnSubmit
                      onSubmitEditing={() => Keyboard.dismiss()}
                    />
                  </>
                ) : (
                  <>
                    <Text style={styles.labSm}>Brand (manual)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder=""
                      placeholderTextColor="#1C1C1E"
                      value={activeLine.brand}
                      onChangeText={(t) => updateLine(activeLine.key, { brand: t })}
                      inputAccessoryViewID={iosAccessoryId}
                      returnKeyType="done"
                      blurOnSubmit
                      onSubmitEditing={() => Keyboard.dismiss()}
                    />

                    <Text style={styles.labSm}>Shade (manual)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder=""
                      placeholderTextColor="#1C1C1E"
                      value={activeLine.shade_code}
                      onChangeText={(t) => updateLine(activeLine.key, { shade_code: t })}
                      autoCapitalize="characters"
                      inputAccessoryViewID={iosAccessoryId}
                      returnKeyType="done"
                      blurOnSubmit
                      onSubmitEditing={() => Keyboard.dismiss()}
                    />
                  </>
                )
              ) : null}

              <Text style={styles.labSm}>Amount</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#8E8E93"
                value={String(activeLine.amount)}
                onChangeText={(t) => updateLine(activeLine.key, { amount: t })}
                keyboardType="decimal-pad"
                inputAccessoryViewID={iosAccessoryId}
              />
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.saveBtn, submitting && styles.saveDisabled]}
            onPress={() => {
              Keyboard.dismiss();
              submit();
            }}
            disabled={submitting || loadingStock}
            activeOpacity={0.9}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveTxt}>Save visit</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={!!pickerForKey} animationType="slide" transparent onRequestClose={closeProductPicker}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Inventory</Text>
              <TouchableOpacity onPress={closeProductPicker}>
                <Text style={styles.modalClose}>Done</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.inventorySearch}
              placeholder="Search…"
              placeholderTextColor="#8E8E93"
              value={inventoryQuery}
              onChangeText={setInventoryQuery}
              autoCapitalize="none"
              autoCorrect={false}
              inputAccessoryViewID={iosAccessoryId}
              returnKeyType="search"
              blurOnSubmit={false}
            />
            {loadingStock && inventory.length === 0 ? (
              <ActivityIndicator style={{ marginTop: 24 }} />
            ) : (
              <FlatList
                data={filteredInventory}
                keyExtractor={(it) => String(it.id)}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={
                  filteredInventory.length === 0 ? styles.invEmptyList : { paddingBottom: 24 }
                }
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
                ListEmptyComponent={
                  !loadingStock ? (
                    <Text style={styles.invEmptyText}>
                      {inventory.length === 0
                        ? 'No products in inventory.'
                        : 'No matches.'}
                    </Text>
                  ) : null
                }
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
  pickEmpty: {
    fontFamily: FontFamily.regular,
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    lineHeight: 20,
  },
  stepMarker: {
    fontFamily: FontFamily.medium,
    fontSize: 13,
    color: '#8E8E93',
    paddingHorizontal: 24,
    marginTop: 4,
    marginBottom: 20,
    letterSpacing: -0.08,
  },
  pickPurpose: {
    fontFamily: FontFamily.regular,
    fontSize: 17,
    color: '#000000',
    paddingHorizontal: 24,
    marginTop: 6,
    marginBottom: 10,
    lineHeight: 22,
    letterSpacing: -0.41,
  },
  forClientTitle: {
    fontFamily: FontFamily.semibold,
    fontSize: 22,
    color: '#000000',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
    letterSpacing: -0.45,
    lineHeight: 28,
    paddingHorizontal: 8,
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
  pickSearchField: { flex: 1, fontSize: 17, fontFamily: FontFamily.regular, color: '#000000', padding: 0 },
  pickList: { flex: 1, paddingHorizontal: 24 },
  pickRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  pickRowName: { fontSize: 17, fontFamily: FontFamily.regular, color: '#000000' },
  pickRowPhone: { fontSize: 15, fontFamily: FontFamily.regular, color: '#8E8E93', marginTop: 2 },
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
  navHeadline: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FontFamily.bold,
    fontSize: 17,
    letterSpacing: -0.41,
    color: '#000000',
  },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 },
  label: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
    color: '#000000',
    marginBottom: 8,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '400',
    color: '#1C1C1E',
    flex: 1,
    flexWrap: 'wrap',
    lineHeight: 23,
    letterSpacing: -0.3,
    paddingRight: 8,
  },
  linesHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 10,
  },
  quickCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    paddingRight: 8,
  },
  quickCountTouchable: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Ясна „избрана“ рамка: бяло около по-малък градиент */
  quickCountRing: {
    padding: 4,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    shadowColor: BRAND_PURPLE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.38,
    shadowRadius: 7,
    elevation: 6,
  },
  quickCountGradInset: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Неизбраните — по-слаби, избраният се откроява */
  quickCountGradDim: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.68,
  },
  quickCountChipTxt: {
    fontSize: 17,
    fontFamily: FontFamily.semibold,
    color: '#FFFFFF',
    letterSpacing: 0.25,
    textShadowColor: 'rgba(0,0,0,0.18)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  lineSegScroller: {
    alignSelf: 'stretch',
    marginBottom: 12,
  },
  lineSegScrollContent: {
    paddingRight: 8,
    alignItems: 'flex-start',
  },
  /** UISegmentedControl-style track */
  lineSegTrack: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  /** One pill: tap label → select tab; ✕ removes row when there are 2+ rows */
  lineSegSegment: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 7,
    overflow: 'hidden',
    flexShrink: 0,
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
  },
  lineSegSegmentOn: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  lineSegLabelPress: {
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 9,
    paddingLeft: 12,
    paddingRight: 4,
    minHeight: 36,
  },
  lineSegRemovePress: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingRight: 8,
    paddingLeft: 4,
    minWidth: 30,
  },
  lineSegTxt: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
    color: 'rgba(255, 255, 255, 0.92)',
    letterSpacing: -0.08,
  },
  lineSegTxtOn: {
    fontFamily: FontFamily.semibold,
    color: '#000000',
  },
  addLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  addLineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  addLineBtnTxt: { fontSize: 14, fontFamily: FontFamily.semibold },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    fontFamily: FontFamily.regular,
    color: '#000000',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
  },
  inputMulti: { minHeight: 88, textAlignVertical: 'top' },
  datePickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  datePickText: { fontSize: 16, color: '#1C1C1E', flex: 1 },
  lineCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 2,
    borderColor: ADD_LINE_THEME.pink.bg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  lineCardDev: {
    borderColor: ADD_LINE_THEME.blue.bg,
  },
  lineTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  lineTopLeft: { flex: 1, paddingRight: 8 },
  lineTypeSwitch: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
    color: ADD_LINE_THEME.blue.bg,
  },
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
  productPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  productPickRowDev: {
    borderColor: ADD_LINE_THEME.blue.border,
    backgroundColor: '#FFFFFF',
  },
  inputDevManual: {
    borderColor: ADD_LINE_THEME.blue.border,
    backgroundColor: '#FFFFFF',
  },
  productIcon: { marginRight: 2 },
  productPickText: { flex: 1, fontSize: 16, color: '#1C1C1E' },
  productPickPlaceholder: { color: '#8E8E93' },
  clearProductBtn: { alignSelf: 'flex-start', marginTop: 6, marginBottom: 4 },
  unlink: { fontWeight: '400', color: '#C62828', fontSize: 13 },
  inventorySearch: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1C1C1E',
    marginBottom: 12,
  },
  invEmptyList: { flexGrow: 1, paddingBottom: 24 },
  invEmptyText: { textAlign: 'center', color: '#8E8E93', fontSize: 15, paddingVertical: 28, paddingHorizontal: 12 },
  saveBtn: {
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveDisabled: { opacity: 0.6 },
  saveTxt: { color: '#fff', fontSize: 17, fontFamily: FontFamily.semibold },
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
});
