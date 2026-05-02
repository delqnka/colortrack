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

const COLOUR_ZONE_KEYS = ['roots', 'lengths', 'toner', 'other'];

const ZONE_FIELDS = ['brand', 'shade_code', 'amount', 'inventory_item_id', 'stockLabel'];

function emptyColourZone() {
  return {
    brand: '',
    shade_code: '',
    amount: '',
    inventory_item_id: null,
    stockLabel: null,
  };
}

function emptyColourByZone() {
  return {
    roots: emptyColourZone(),
    lengths: emptyColourZone(),
    toner: emptyColourZone(),
    other: emptyColourZone(),
  };
}

function newMixGroupId() {
  return `mg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function mixGroupKeyOf(line) {
  if (!line || line.section === 'developer') return null;
  return line.mixGroupKey || `mg_${line.key}`;
}

function colourLineCountForMix(lines, mixKey) {
  if (!mixKey) return 0;
  return lines.filter((l) => l.section !== 'developer' && mixGroupKeyOf(l) === mixKey).length;
}

/** Legacy colour rows stored product on the line root; fold into zone buckets. */
function migrateColourLine(line) {
  if (line.section === 'developer') return line;
  if (line.colourByZone) {
    return line.mixGroupKey ? line : { ...line, mixGroupKey: line.mixGroupKey ?? `mg_${line.key}` };
  }
  const sec = COLOUR_ZONE_KEYS.includes(line.section) ? line.section : 'roots';
  const colourByZone = emptyColourByZone();
  colourByZone[sec] = {
    brand: line.brand ?? '',
    shade_code: line.shade_code ?? '',
    amount: line.amount ?? '',
    inventory_item_id: line.inventory_item_id ?? null,
    stockLabel: line.stockLabel ?? null,
  };
  return {
    key: line.key,
    mixGroupKey: line.mixGroupKey ?? `mg_${line.key}`,
    section: sec,
    colourByZone,
  };
}

function getActiveZone(line) {
  if (!line) return emptyColourZone();
  if (line.section === 'developer') {
    return {
      brand: line.brand ?? '',
      shade_code: line.shade_code ?? '',
      amount: line.amount ?? '',
      inventory_item_id: line.inventory_item_id ?? null,
      stockLabel: line.stockLabel ?? null,
    };
  }
  const migrated = line.colourByZone ? line : migrateColourLine(line);
  if (line.section == null || !COLOUR_ZONE_KEYS.includes(line.section)) {
    return emptyColourZone();
  }
  return migrated.colourByZone[line.section] || emptyColourZone();
}

function isZoneEmpty(z) {
  return (
    !String(z.brand || '').trim() &&
    !z.inventory_item_id &&
    !String(z.amount ?? '').replace(',', '.').trim()
  );
}

/** Prefer when picking inventory for a Developer line (no search query). */
function inventoryLooksLikeDeveloper(item) {
  const t = `${item.name || ''} ${item.brand || ''} ${item.category || ''}`.toLowerCase();
  return /\boxid|oxid|perox|developer|vol\.|volume|\d+\s*%|\b10v\b|\b20v\b|\b30v\b|\b40v\b/.test(t);
}

/** iOS: decimal pad / number pad have no "return" — toolbar to dismiss keyboard */
const IOS_KB_ACCESSORY_ID = 'formula_input_accessory_done';

function newLine(opts = {}) {
  const mixGroupKey = opts.mixGroupKey ?? newMixGroupId();
  const section = opts.section !== undefined ? opts.section : null;
  return {
    key: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    mixGroupKey,
    section,
    colourByZone: emptyColourByZone(),
  };
}

function newDeveloperLine() {
  return {
    key: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    section: 'developer',
    colourByZone: null,
    ...emptyColourZone(),
  };
}

function isLineEmpty(line) {
  if (line.section === 'developer') {
    return (
      !String(line.brand || '').trim() &&
      !line.inventory_item_id &&
      !String(line.amount || '').replace(',', '.').trim()
    );
  }
  if (line.section == null || !COLOUR_ZONE_KEYS.includes(line.section)) {
    return true;
  }
  const zones = line.colourByZone || migrateColourLine(line).colourByZone;
  return isZoneEmpty(zones[line.section]);
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
  const mgk = mixGroupKeyOf(line);
  const orderedMixKeys = [];
  for (const l of lines) {
    if (l.section === 'developer') continue;
    const k = mixGroupKeyOf(l);
    if (!orderedMixKeys.includes(k)) orderedMixKeys.push(k);
  }
  const mixIndex = Math.max(1, orderedMixKeys.indexOf(mgk) + 1);
  const tubeIndex =
    lines.slice(0, idx).filter((l) => l.section !== 'developer' && mixGroupKeyOf(l) === mgk).length + 1;
  const mixLabel = `${englishOrdinalSuffix(mixIndex)} mix`;
  if (tubeIndex <= 1) return mixLabel;
  return `${mixLabel} · ${tubeIndex}`;
}

function colourZoneTitle(sectionKey) {
  if (sectionKey === 'developer') return '';
  const s = COLOUR_SECTIONS.find((x) => x.key === sectionKey);
  return s ? s.label : '';
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
    setLines((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        if (l.section !== 'developer' && !l.colourByZone) {
          changed = true;
          return migrateColourLine(l);
        }
        if (l.section !== 'developer' && l.colourByZone && !l.mixGroupKey) {
          changed = true;
          return { ...l, mixGroupKey: `mg_${l.key}` };
        }
        return l;
      });
      return changed ? next : prev;
    });
  }, []);

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
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        let base = l.section !== 'developer' && !l.colourByZone ? migrateColourLine(l) : l;
        if (base.section === 'developer') {
          return { ...base, ...patch };
        }
        const zonePatch = {};
        for (const f of ZONE_FIELDS) {
          if (f in patch) zonePatch[f] = patch[f];
        }
        const nextSection = patch.section !== undefined ? patch.section : base.section;
        if (Object.keys(zonePatch).length === 0) {
          if (patch.section !== undefined) return { ...base, section: nextSection };
          return { ...base, ...patch };
        }
        const targetSec = patch.section !== undefined ? patch.section : base.section;
        if (!targetSec || !COLOUR_ZONE_KEYS.includes(targetSec)) {
          if (Object.keys(zonePatch).length === 0) {
            if (patch.section !== undefined) return { ...base, section: nextSection };
            return { ...base, ...patch };
          }
          return base;
        }
        const nextZones = {
          ...base.colourByZone,
          [targetSec]: {
            ...(base.colourByZone[targetSec] || emptyColourZone()),
            ...zonePatch,
          },
        };
        return { ...base, section: nextSection, colourByZone: nextZones };
      }),
    );
  };

  const selectColourSection = (lineKey, sectionKey) => {
    Keyboard.dismiss();
    setLines((prev) => {
      const target = prev.find((l) => l.key === lineKey);
      if (!target || target.section === 'developer') return prev;
      const mgk = mixGroupKeyOf(target);
      return prev.map((l) => {
        if (l.section === 'developer') return l;
        if (mixGroupKeyOf(l) !== mgk) return l;
        const base = l.section !== 'developer' && !l.colourByZone ? migrateColourLine(l) : l;
        const prevSec = base.section;
        let nextZones = base.colourByZone ? { ...base.colourByZone } : emptyColourByZone();
        if (prevSec != null && COLOUR_ZONE_KEYS.includes(prevSec) && prevSec !== sectionKey) {
          nextZones = emptyColourByZone();
        }
        return { ...base, section: sectionKey, colourByZone: nextZones };
      });
    });
    const idx = COLOUR_SECTIONS.findIndex((s) => s.key === sectionKey);
    requestAnimationFrame(() => {
      const ref = sectionChipScrollRefs.current[lineKey];
      if (ref && idx >= 0) {
        ref.scrollTo({ x: Math.max(0, idx * 92 - 16), animated: true });
      }
    });
  };

  const resetColourLineZonePick = (lineKey) => {
    Keyboard.dismiss();
    setLines((prev) => {
      const target = prev.find((l) => l.key === lineKey);
      if (!target || target.section === 'developer') return prev;
      if (colourLineCountForMix(prev, mixGroupKeyOf(target)) !== 1) return prev;
      return prev.map((l) => {
        if (l.key !== lineKey || l.section === 'developer') return l;
        return { ...l, section: null, colourByZone: emptyColourByZone() };
      });
    });
  };

  const appendNewMixLine = () => {
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

  const appendColourToActiveMix = () => {
    Keyboard.dismiss();
    const active = lines[activeLineIndex];
    if (!active || active.section === 'developer') return;
    if (active.section == null || !COLOUR_ZONE_KEYS.includes(active.section)) {
      Alert.alert('', 'Choose Roots, Lengths, or another area first.');
      return;
    }
    if (lines.length >= MAX_FORMULA_LINES) {
      Alert.alert('', `At most ${MAX_FORMULA_LINES} lines.`);
      return;
    }
    const mgk = mixGroupKeyOf(active);
    const nl = newLine({ mixGroupKey: mgk, section: active.section });
    setLines((prev) => {
      const next = [...prev, nl];
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
    Keyboard.dismiss();
    setLines((prev) => {
      const idx = Math.min(activeLineIndex, Math.max(0, prev.length - 1));
      const active = prev[idx];
      const devLines = prev.filter((l) => l.section === 'developer');
      const colourLines = prev.filter((l) => l.section !== 'developer');

      let targetMgk = null;
      if (active?.section !== 'developer') {
        targetMgk = mixGroupKeyOf(active);
      } else if (colourLines.length) {
        targetMgk = mixGroupKeyOf(colourLines[0]);
      }

      if (!targetMgk) {
        if (prev.length + n > MAX_FORMULA_LINES) {
          Alert.alert('', `At most ${MAX_FORMULA_LINES} lines.`);
          return prev;
        }
        const sharedMgk = newMixGroupId();
        const newCol = Array.from({ length: n }, () => newLine({ mixGroupKey: sharedMgk, section: null }));
        return [...newCol, ...devLines];
      }

      const groupIndices = prev
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => l.section !== 'developer' && mixGroupKeyOf(l) === targetMgk)
        .map((x) => x.i);
      const k = groupIndices.length;
      if (k === 0) return prev;

      const templateSection = prev.find(
        (l) =>
          mixGroupKeyOf(l) === targetMgk &&
          l.section != null &&
          COLOUR_ZONE_KEYS.includes(l.section),
      )?.section ?? null;

      if (n === k) return prev;

      if (n > k) {
        const toAdd = n - k;
        if (prev.length + toAdd > MAX_FORMULA_LINES) {
          Alert.alert('', `At most ${MAX_FORMULA_LINES} lines.`);
          return prev;
        }
        const lastIdx = groupIndices[groupIndices.length - 1];
        const additions = Array.from({ length: toAdd }, () =>
          newLine({ mixGroupKey: targetMgk, section: templateSection }),
        );
        return [...prev.slice(0, lastIdx + 1), ...additions, ...prev.slice(lastIdx + 1)];
      }

      const toRemove = k - n;
      const removeSet = new Set(groupIndices.slice(-toRemove));
      return prev.filter((_, i) => !removeSet.has(i));
    });
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
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== lineKey || l.section !== 'developer') return l;
        return {
          key: l.key,
          mixGroupKey: l.mixGroupKey ?? newMixGroupId(),
          section: 'roots',
          colourByZone: {
            roots: {
              brand: l.brand || '',
              shade_code: l.shade_code || '',
              amount: l.amount ?? '',
              inventory_item_id: l.inventory_item_id,
              stockLabel: l.stockLabel,
            },
            lengths: emptyColourZone(),
            toner: emptyColourZone(),
            other: emptyColourZone(),
          },
        };
      }),
    );
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
    const validLines = [];
    for (const l of lines) {
      if (l.section === 'developer') {
        const brand = String(l.brand || '').trim();
        const amount = Number(String(l.amount || '').replace(',', '.'));
        const shade_code = String(l.shade_code || '').trim() || '-';
        if (brand && Number.isFinite(amount) && amount > 0) {
          validLines.push({
            section: 'developer',
            brand,
            shade_code,
            amount,
            inventory_item_id: l.inventory_item_id,
          });
        }
        continue;
      }
      if (l.section == null || !COLOUR_ZONE_KEYS.includes(l.section)) continue;
      const zones = l.colourByZone || migrateColourLine(l).colourByZone;
      const z = zones[l.section];
      const brand = String(z.brand || '').trim();
      const amount = Number(String(z.amount || '').replace(',', '.'));
      const shade_code = String(z.shade_code || '').trim() || '-';
      if (brand && Number.isFinite(amount) && amount > 0) {
        validLines.push({
          section: l.section,
          brand,
          shade_code,
          amount,
          inventory_item_id: z.inventory_item_id,
        });
      }
    }

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
    const active = lines[activeLineIndex];
    let c = 0;
    if (active && active.section !== 'developer') {
      const mgk = mixGroupKeyOf(active);
      c = lines.filter((l) => l.section !== 'developer' && mixGroupKeyOf(l) === mgk).length;
    } else {
      c = lines.filter((l) => l.section !== 'developer').length;
    }
    if (c >= 1 && c <= 6) return c;
    return null;
  }, [lines, activeLineIndex]);

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
  const activeZoneSlice = activeLine ? getActiveZone(activeLine) : emptyColourZone();

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

          <View style={styles.afterPaidSpacing} />

          <View style={styles.linesHeader}>
            <Text style={styles.sectionTitle}>How many colours?</Text>
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
                          size={15}
                          color={sel ? '#E53935' : 'rgba(255,255,255,0.88)'}
                        />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          {activeLine && activeLine.section !== 'developer' && activeLine.section == null ? (
            <>
              <Text style={styles.zoneLeadTitle}>What is this mix for?</Text>
              <ScrollView
                ref={(r) => {
                  sectionChipScrollRefs.current[activeLine.key] = r;
                }}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.segScroll}
                style={styles.zoneTabsRow}
                keyboardShouldPersistTaps="handled"
              >
                {COLOUR_SECTIONS.map((s) => (
                  <TouchableOpacity
                    key={s.key}
                    onPress={() => selectColourSection(activeLine.key, s.key)}
                    style={styles.seg}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.segTxt}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          ) : null}

          <View style={styles.addLineRow}>
            <AddLineBouncyButton
              onPress={appendColourToActiveMix}
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

          {activeLine &&
          (activeLine.section === 'developer' ||
            (activeLine.section != null && COLOUR_ZONE_KEYS.includes(activeLine.section))) ? (
            <View
              key={activeLine.key}
              style={[styles.lineCard, activeLine.section === 'developer' && styles.lineCardDev]}
            >
              <View style={styles.lineTop}>
                <View style={styles.lineTopLeft}>
                  <Text style={styles.lineTitle}>
                    {activeLine.section === 'developer'
                      ? lineTabLabel(lines, activeLineIndex)
                      : `${lineTabLabel(lines, activeLineIndex)} · ${colourZoneTitle(activeLine.section)}`}
                  </Text>
                  {activeLine.section === 'developer' ? (
                    <TouchableOpacity
                      onPress={() => convertDeveloperToColourLine(activeLine.key)}
                      hitSlop={8}
                      accessibilityRole="link"
                      accessibilityLabel="Switch this row to colour"
                    >
                      <Text style={styles.lineTypeSwitch}>Switch to colour</Text>
                    </TouchableOpacity>
                  ) : isZoneEmpty(activeZoneSlice) &&
                    colourLineCountForMix(lines, mixGroupKeyOf(activeLine)) === 1 ? (
                    <TouchableOpacity
                      onPress={() => resetColourLineZonePick(activeLine.key)}
                      hitSlop={8}
                      accessibilityRole="link"
                      accessibilityLabel="Change mix area"
                    >
                      <Text style={styles.lineTypeSwitch}>Change area</Text>
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
                  color={
                    activeLine.section === 'developer' ? ADD_LINE_THEME.blue.bg : ADD_LINE_THEME.pink.bg
                  }
                  style={styles.productIcon}
                />
                <Text
                  style={[
                    styles.productPickText,
                    !activeZoneSlice.stockLabel && styles.productPickPlaceholder,
                  ]}
                  numberOfLines={2}
                >
                  {activeZoneSlice.stockLabel || 'Choose from your inventory…'}
                </Text>
                <Ionicons name="chevron-down" size={22} color="#1C1C1E" />
              </TouchableOpacity>
              {activeZoneSlice.inventory_item_id ? (
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

              {!activeZoneSlice.inventory_item_id ? (
                activeLine.section === 'developer' ? (
                  <>
                    <Text style={styles.labSm}>Manual</Text>
                    <TextInput
                      style={[styles.input, styles.inputDevManual]}
                      placeholder=""
                      placeholderTextColor="#8E8E93"
                      value={activeZoneSlice.brand}
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
                      value={activeZoneSlice.brand}
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
                      value={activeZoneSlice.shade_code}
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
                value={String(activeZoneSlice.amount ?? '')}
                onChangeText={(t) => updateLine(activeLine.key, { amount: t })}
                keyboardType="decimal-pad"
                inputAccessoryViewID={iosAccessoryId}
              />
            </View>
          ) : null}

          <TouchableOpacity
            style={styles.addAnotherMixBtn}
            onPress={() => {
              Keyboard.dismiss();
              appendNewMixLine();
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.addAnotherMixTxt}>+ Add another mix</Text>
          </TouchableOpacity>

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
  afterPaidSpacing: {
    marginTop: 26,
    marginBottom: 2,
  },
  addAnotherMixBtn: {
    alignSelf: 'stretch',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
    backgroundColor: '#FAFAFA',
    alignItems: 'center',
    marginBottom: 16,
  },
  addAnotherMixTxt: {
    fontSize: 15,
    fontFamily: FontFamily.semibold,
    color: '#1C1C1E',
    letterSpacing: -0.2,
  },
  zoneLeadTitle: {
    fontSize: 16,
    fontFamily: FontFamily.semibold,
    color: '#1C1C1E',
    marginBottom: 10,
    letterSpacing: -0.28,
    lineHeight: 22,
  },
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
    marginTop: 12,
    marginBottom: 8,
  },
  quickCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 10,
    paddingRight: 8,
  },
  quickCountTouchable: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickCountRing: {
    padding: 2,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: BRAND_PURPLE,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
    elevation: 3,
  },
  quickCountGradInset: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickCountGradDim: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.6,
  },
  quickCountChipTxt: {
    fontSize: 14,
    fontFamily: FontFamily.semibold,
    color: '#FFFFFF',
    letterSpacing: 0.2,
    textShadowColor: 'rgba(0,0,0,0.14)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1.5,
  },
  lineSegScroller: {
    alignSelf: 'stretch',
    marginBottom: 10,
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
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  /** One pill: tap label → select tab; ✕ removes row when there are 2+ rows */
  lineSegSegment: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 6,
    overflow: 'hidden',
    flexShrink: 0,
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
  },
  lineSegSegmentOn: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  lineSegLabelPress: {
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 3,
    minHeight: 30,
  },
  lineSegRemovePress: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingRight: 6,
    paddingLeft: 2,
    minWidth: 24,
  },
  lineSegTxt: {
    fontSize: 12,
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
  segScroll: { gap: 6 },
  zoneTabsRow: {
    alignSelf: 'stretch',
    marginBottom: 10,
    flexGrow: 0,
  },
  seg: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
  },
  segOn: { backgroundColor: '#1C1C1E' },
  segTxt: { fontWeight: '400', color: '#1C1C1E', fontSize: 12 },
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
