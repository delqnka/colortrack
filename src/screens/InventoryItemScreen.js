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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet, apiPatch, apiPost } from '../api/client';

const CAT_OPTIONS = [
  { key: 'dye', label: 'Color' },
  { key: 'oxidant', label: 'Oxidant' },
  { key: 'retail', label: 'Retail' },
  { key: 'consumable', label: 'Consumables' },
];

const PRESET_CATEGORY_KEYS = new Set(CAT_OPTIONS.map((c) => c.key));

const UNIT_OPTIONS = ['g', 'ml', 'pcs'];

function numToStr(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return String(n);
}

function fmtWhen(iso) {
  if (!iso) return '';
  const s = typeof iso === 'string' ? iso : String(iso);
  return s.replace('T', ' ').replace(/\.\d{3}Z?$/, '').slice(0, 16);
}

export default function InventoryItemScreen({ route, navigation }) {
  const itemId = route.params?.itemId;
  const isEdit = Number.isFinite(Number(itemId)) && Number(itemId) > 0;

  const [item, setItem] = useState(null);
  const [movements, setMovements] = useState([]);
  const [nameStr, setNameStr] = useState('');
  const [brandStr, setBrandStr] = useState('');
  const [shadeStr, setShadeStr] = useState('');
  const [categoryPreset, setCategoryPreset] = useState('dye');
  const [categoryCustom, setCategoryCustom] = useState('');
  const [unit, setUnit] = useState('g');
  const [supplierStr, setSupplierStr] = useState('');
  const [qtyStr, setQtyStr] = useState('');
  const [threshStr, setThreshStr] = useState('');
  const [reasonStr, setReasonStr] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!isEdit) return;
    setLoading(true);
    try {
      const [row, hist] = await Promise.all([
        apiGet(`/api/inventory/${itemId}`),
        apiGet(`/api/inventory/${itemId}/movements`),
      ]);
      setItem(row);
      setNameStr(row.name || '');
      setBrandStr(row.brand || '');
      setShadeStr(row.shade_code || '');
      const rc = row.category || 'dye';
      if (PRESET_CATEGORY_KEYS.has(rc)) {
        setCategoryPreset(rc);
        setCategoryCustom('');
      } else {
        setCategoryPreset(null);
        setCategoryCustom(rc);
      }
      setUnit(row.unit || 'g');
      setSupplierStr(row.supplier_hint || '');
      setQtyStr(numToStr(row.quantity));
      setThreshStr(numToStr(row.low_stock_threshold));
      setReasonStr('');
      setMovements(Array.isArray(hist) ? hist : []);
    } catch {
      Alert.alert('', 'Load failed');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [itemId, isEdit, navigation]);

  useFocusEffect(
    useCallback(() => {
      if (isEdit) {
        load();
        return;
      }
      setItem(null);
      setNameStr('');
      setBrandStr('');
      setShadeStr('');
      setCategoryPreset('dye');
      setCategoryCustom('');
      setUnit('g');
      setSupplierStr('');
      setQtyStr('0');
      setThreshStr('0');
      setReasonStr('');
      setMovements([]);
      setLoading(false);
    }, [isEdit, load]),
  );

  const save = async () => {
    const q = Number(qtyStr);
    const t = Number(threshStr);
    if (!Number.isFinite(q) || q < 0) {
      Alert.alert('', 'Quantity');
      return;
    }
    if (!Number.isFinite(t) || t < 0) {
      Alert.alert('', 'Threshold');
      return;
    }

    setSaving(true);
    try {
      if (!isEdit) {
        const name = nameStr.trim();
        if (!name) {
          Alert.alert('', 'Name');
          setSaving(false);
          return;
        }
        const resolvedCategory = categoryCustom.trim() || categoryPreset || 'dye';
        const row = await apiPost('/api/inventory', {
          name,
          category: resolvedCategory,
          unit,
          quantity: q,
          low_stock_threshold: t,
          brand: brandStr.trim() || null,
          shade_code: shadeStr.trim() || null,
          supplier_hint: supplierStr.trim() || null,
        });
        navigation.replace('InventoryItem', { itemId: row.id });
      } else {
        const body = {
          quantity: q,
          low_stock_threshold: t,
        };
        const note = reasonStr.trim();
        if (note) body.reason = note;
        const row = await apiPatch(`/api/inventory/${itemId}`, body);
        setItem(row);
        setQtyStr(numToStr(row.quantity));
        setThreshStr(numToStr(row.low_stock_threshold));
        setReasonStr('');
        const hist = await apiGet(`/api/inventory/${itemId}/movements`);
        setMovements(Array.isArray(hist) ? hist : []);
      }
    } catch (e) {
      Alert.alert('', e.message || '');
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && (loading || !item)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  const metaLine = [brandStr, shadeStr].filter(Boolean).join(' · ') || '—';

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
          <Text style={styles.headerTitle} numberOfLines={1}>
            {isEdit ? item.name : 'New'}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!isEdit ? (
            <>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#C7C7CC"
                value={nameStr}
                onChangeText={setNameStr}
              />
              <Text style={styles.label}>Category</Text>
              <View style={styles.chips}>
                {CAT_OPTIONS.map((c) => {
                  const chipOn = !categoryCustom.trim() && categoryPreset === c.key;
                  return (
                    <TouchableOpacity
                      key={c.key}
                      style={[styles.chip, chipOn && styles.chipOn]}
                      onPress={() => {
                        setCategoryPreset(c.key);
                        setCategoryCustom('');
                      }}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.chipTxt, chipOn && styles.chipTxtOn]}>{c.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.label}>New category</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#C7C7CC"
                value={categoryCustom}
                onChangeText={(text) => {
                  setCategoryCustom(text);
                  if (text.trim()) {
                    setCategoryPreset(null);
                  } else {
                    setCategoryPreset((p) => p || 'dye');
                  }
                }}
                autoCapitalize="sentences"
              />
              <Text style={styles.label}>Unit</Text>
              <View style={styles.chips}>
                {UNIT_OPTIONS.map((u) => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.chip, unit === u && styles.chipOn]}
                    onPress={() => setUnit(u)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.chipTxt, unit === u && styles.chipTxtOn]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>Brand</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#C7C7CC"
                value={brandStr}
                onChangeText={setBrandStr}
              />
              <Text style={styles.label}>Shade / code</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#C7C7CC"
                value={shadeStr}
                onChangeText={setShadeStr}
              />
              <Text style={styles.label}>Supplier</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#C7C7CC"
                value={supplierStr}
                onChangeText={setSupplierStr}
              />
            </>
          ) : (
            <>
              <Text style={styles.subMeta}>{metaLine}</Text>
              {item.supplier_hint ? (
                <Text style={styles.supplier}>{item.supplier_hint}</Text>
              ) : null}
            </>
          )}

          <Text style={styles.label}>Quantity ({isEdit ? item.unit : unit})</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#C7C7CC"
            value={qtyStr}
            onChangeText={setQtyStr}
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>Low stock at ({isEdit ? item.unit : unit})</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#C7C7CC"
            value={threshStr}
            onChangeText={setThreshStr}
            keyboardType="decimal-pad"
          />

          {isEdit ? (
            <>
              <Text style={styles.label}>Note</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#C7C7CC"
                value={reasonStr}
                onChangeText={setReasonStr}
              />
            </>
          ) : null}

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveDisabled]}
            onPress={save}
            disabled={saving}
            activeOpacity={0.9}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Save</Text>}
          </TouchableOpacity>

          {isEdit && movements.length ? (
            <View style={styles.histSection}>
              <Text style={styles.histTitle}>Recent</Text>
              {movements.map((m) => {
                const d = Number(m.delta);
                const deltaTxt = Number.isFinite(d) && d > 0 ? `+${d}` : String(m.delta ?? '');
                return (
                  <View key={m.id} style={styles.histRow}>
                    <Text style={[styles.histDelta, d < 0 && styles.histDeltaNeg]}>{deltaTxt}</Text>
                    <View style={styles.histMid}>
                      <Text style={styles.histReason} numberOfLines={2}>
                        {m.reason || '—'}
                      </Text>
                      <Text style={styles.histWhen}>{fmtWhen(m.created_at)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#F5F5FA' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: '#1C1C1E' },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 },
  subMeta: { fontSize: 14, color: '#8E8E93', marginBottom: 4 },
  supplier: { fontSize: 13, fontWeight: '600', color: '#5E35B1', marginBottom: 16 },
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  chipOn: {
    backgroundColor: '#5E35B1',
    borderColor: '#5E35B1',
  },
  chipTxt: { fontSize: 14, fontWeight: '700', color: '#1C1C1E' },
  chipTxtOn: { color: '#fff' },
  saveBtn: {
    marginTop: 28,
    backgroundColor: '#5E35B1',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  saveDisabled: { opacity: 0.6 },
  saveTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  histSection: { marginTop: 32 },
  histTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#8E8E93',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  histRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  histDelta: { fontSize: 16, fontWeight: '800', color: '#2E7D32', minWidth: 56 },
  histDeltaNeg: { color: '#C62828' },
  histMid: { flex: 1, paddingLeft: 8 },
  histReason: { fontSize: 14, fontWeight: '600', color: '#1C1C1E' },
  histWhen: { marginTop: 4, fontSize: 12, color: '#8E8E93' },
});
