import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function lineTabLabel(lines, idx) {
  const line = lines[idx];
  if (!line) return '';
  if (line.section === 'developer') {
    const oxNum = lines.slice(0, idx + 1).filter((l) => l.section === 'developer').length;
    return oxNum <= 1 ? 'Oxidant' : `Oxidant ${oxNum}`;
  }
  const colourNum = lines.slice(0, idx).filter((l) => l.section !== 'developer').length + 1;
  return `Colour ${colourNum}`;
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
  const [datePickMode, setDatePickMode] = useState(null);

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
    const proc = procedureName.trim();
    if (!proc) {
      Alert.alert(
        'Procedure name required',
        'Enter what you did on this visit (e.g. full colour, root touch-up, balayage).',
      );
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
      Alert.alert(
        'Formula lines',
        'Add at least one line: choose a product from inventory (or enter brand manually), then enter amount (greater than 0).',
      );
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

  if (!clientId) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.err}>Missing client.</Text>
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
          <Text style={styles.title}>Formula</Text>
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

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.label}>Procedure</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Full colour, root touch-up, toner refresh"
            placeholderTextColor="#8E8E93"
            value={procedureName}
            onChangeText={setProcedureName}
            inputAccessoryViewID={iosAccessoryId}
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={() => Keyboard.dismiss()}
          />

          <Text style={styles.label}>Date</Text>
          <TouchableOpacity
            style={[styles.input, styles.datePickRow]}
            onPress={() => {
              Keyboard.dismiss();
              setDatePickMode('date');
            }}
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
            <Text style={styles.sectionTitle}>Formula lines</Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickCountRow}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <TouchableOpacity
                key={n}
                style={styles.quickCountChip}
                onPress={() => applyColourCountQuickStart(n)}
                activeOpacity={0.85}
              >
                <Text style={styles.quickCountChipTxt}>{n}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            contentContainerStyle={styles.tabRow}
          >
            {lines.map((line, idx) => (
              <TouchableOpacity
                key={line.key}
                onPress={() => {
                  Keyboard.dismiss();
                  setActiveLineIndex(idx);
                }}
                style={[styles.tabPill, idx === activeLineIndex && styles.tabPillOn]}
                activeOpacity={0.88}
              >
                <Text style={[styles.tabPillTxt, idx === activeLineIndex && styles.tabPillTxtOn]}>
                  {lineTabLabel(lines, idx)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.addLineRow}>
            <TouchableOpacity style={styles.addLineBtn} onPress={appendColourLine} activeOpacity={0.88}>
              <Ionicons name="color-fill-outline" size={18} color={BRAND_PURPLE} />
              <Text style={styles.addLineBtnTxt}>+ Colour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addLineBtn} onPress={appendOxidantLine} activeOpacity={0.88}>
              <Ionicons name="flask-outline" size={18} color={BRAND_PURPLE} />
              <Text style={styles.addLineBtnTxt}>+ Oxidant</Text>
            </TouchableOpacity>
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
                    <TouchableOpacity onPress={() => convertDeveloperToColourLine(activeLine.key)} hitSlop={8}>
                      <Text style={styles.lineTypeSwitch}>As colour</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {lines.length > 1 ? (
                  <TouchableOpacity onPress={() => removeLineByKey(activeLine.key)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={20} color="#E53935" />
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
                  color={activeLine.section === 'developer' ? '#6A1B9A' : '#5E35B1'}
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
              placeholder="Search name, brand, shade…"
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
                        ? 'No products in inventory. Add items under the Inventory tab.'
                        : 'No matches. Try another search.'}
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
  kbAccessoryDoneTxt: { fontSize: 17, fontWeight: '600', color: '#5E35B1' },
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
    marginBottom: 6,
  },
  quickCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    paddingRight: 8,
  },
  quickCountChip: {
    minWidth: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#EDE7F6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  quickCountChipTxt: { fontSize: 17, fontWeight: '600', color: BRAND_PURPLE },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingRight: 8,
  },
  tabPill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: '#F2F2F7',
  },
  tabPillOn: { backgroundColor: '#1C1C1E' },
  tabPillTxt: { fontSize: 14, fontWeight: '600', color: '#1C1C1E' },
  tabPillTxtOn: { color: '#fff' },
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
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#EDE7F6',
  },
  addLineBtnTxt: { fontSize: 14, fontWeight: '600', color: BRAND_PURPLE },
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
  lineCardDev: {
    borderColor: '#CE93D8',
    backgroundColor: '#FDF8FF',
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
    color: '#5E35B1',
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
    borderColor: '#CE93D8',
    backgroundColor: '#FFFFFF',
  },
  inputDevManual: {
    borderColor: '#CE93D8',
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
