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
import { glassPurpleIconBtn } from '../theme/glassUi';
import { useCurrency } from '../context/CurrencyContext';

const COLOR_CATEGORY_OPTIONS = [
  { key: 'dye', label: 'Color' },
  { key: 'oxidant', label: 'Developer' },
  { key: 'mixtone', label: 'Mixtone' },
  { key: 'toner', label: 'Toner' },
];

const GENERAL_CATEGORY_OPTIONS = [
  ...COLOR_CATEGORY_OPTIONS,
  { key: 'retail', label: 'Retail' },
  { key: 'consumable', label: 'Consumables' },
];

const PRESET_CATEGORY_KEYS = new Set(GENERAL_CATEGORY_OPTIONS.map((c) => c.key));
const COLOR_CATEGORY_KEYS = new Set(COLOR_CATEGORY_OPTIONS.map((c) => c.key));

const UNIT_OPTIONS = ['g', 'ml', 'pcs', 'oz'];

function numToStr(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return String(n);
}

function priceTextFromCents(cents) {
  if (cents == null || cents === '') return '';
  const n = Number(cents);
  if (!Number.isFinite(n)) return '';
  return String(n / 100).replace(/\.00$/, '');
}

function centsFromPriceText(text) {
  const raw = String(text || '').trim().replace(',', '.');
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function fmtWhen(iso) {
  if (!iso) return '';
  const s = typeof iso === 'string' ? iso : String(iso);
  return s.replace('T', ' ').replace(/\.\d{3}Z?$/, '').slice(0, 16);
}

function labelForDetailField(categoryPreset, categoryCustom) {
  if (categoryCustom.trim()) return 'Product detail';
  if (categoryPreset === 'oxidant') return 'Volume / %';
  if (categoryPreset === 'mixtone' || categoryPreset === 'toner') return 'Shade / code';
  if (categoryPreset === 'retail') return 'SKU / code';
  if (categoryPreset === 'consumable') return 'Size / spec';
  return 'Shade / code';
}

function addUniqueCategory(list, category) {
  const clean = String(category || '').trim();
  if (!clean || PRESET_CATEGORY_KEYS.has(clean)) return list;
  const exists = list.some((c) => c.trim().toLowerCase() === clean.toLowerCase());
  return exists ? list : [...list, clean];
}

function customCategoriesFromInventory(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.reduce((out, row) => addUniqueCategory(out, row?.category), []);
}

export default function InventoryItemScreen({ route, navigation }) {
  const { currency } = useCurrency();
  const itemId = route.params?.itemId;
  const isEdit = Number.isFinite(Number(itemId)) && Number(itemId) > 0;
  const initialCategory = typeof route.params?.initialCategory === 'string' ? route.params.initialCategory : '';
  const initialPresetCategory = PRESET_CATEGORY_KEYS.has(initialCategory) ? initialCategory : 'dye';
  const initialCategoryMode =
    route.params?.categoryMode === 'colors' || COLOR_CATEGORY_KEYS.has(initialPresetCategory) ? 'colors' : 'general';

  const [item, setItem] = useState(null);
  const [movements, setMovements] = useState([]);
  const [nameStr, setNameStr] = useState('');
  const [brandStr, setBrandStr] = useState('');
  const [shadeStr, setShadeStr] = useState('');
  const [packageSizeStr, setPackageSizeStr] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [categoryPreset, setCategoryPreset] = useState('dye');
  const [categoryCustom, setCategoryCustom] = useState('');
  const [categoryDraft, setCategoryDraft] = useState('');
  const [customCategoryOptions, setCustomCategoryOptions] = useState([]);
  const [addingCategory, setAddingCategory] = useState(false);
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
      setPackageSizeStr(row.package_size || '');
      setPriceStr(priceTextFromCents(row.price_per_unit_cents));
      const rc = row.category || 'dye';
      if (PRESET_CATEGORY_KEYS.has(rc)) {
        setCategoryPreset(rc);
        setCategoryCustom('');
        setCategoryDraft('');
      } else {
        setCategoryPreset(null);
        setCategoryCustom(rc);
        setCategoryDraft('');
        setCustomCategoryOptions((prev) => addUniqueCategory(prev, rc));
      }
      setAddingCategory(false);
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
      let cancelled = false;
      setItem(null);
      setNameStr('');
      setBrandStr('');
      setShadeStr('');
      setPackageSizeStr('');
      setPriceStr('');
      setCategoryPreset(initialPresetCategory);
      setCategoryCustom(initialCategory && !PRESET_CATEGORY_KEYS.has(initialCategory) ? initialCategory : '');
      setCategoryDraft('');
      setAddingCategory(false);
      setUnit('pcs');
      setSupplierStr('');
      setQtyStr('0');
      setThreshStr('0');
      setReasonStr('');
      setMovements([]);
      setLoading(false);
      apiGet('/api/inventory', { allowStaleCache: false })
        .then((rows) => {
          if (!cancelled) setCustomCategoryOptions(customCategoriesFromInventory(rows));
        })
        .catch(() => {
          if (!cancelled) setCustomCategoryOptions([]);
        });
      return () => {
        cancelled = true;
      };
    }, [initialCategory, initialPresetCategory, isEdit, load]),
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
        const resolvedCategory = categoryCustom.trim() || categoryDraft.trim() || categoryPreset || 'dye';
        setCustomCategoryOptions((prev) => addUniqueCategory(prev, resolvedCategory));
        const row = await apiPost('/api/inventory', {
          name,
          category: resolvedCategory,
          unit,
          quantity: q,
          low_stock_threshold: t,
          brand: brandStr.trim() || null,
          shade_code: shadeStr.trim() || null,
          package_size: packageSizeStr.trim() || null,
          price_per_unit_cents: centsFromPriceText(priceStr),
          supplier_hint: supplierStr.trim() || null,
        });
        navigation.replace('InventoryItem', { itemId: row.id });
      } else {
        const resolvedCategory = categoryCustom.trim() || categoryDraft.trim() || categoryPreset || item.category || 'dye';
        const body = {
          quantity: q,
          low_stock_threshold: t,
          unit,
          category: resolvedCategory,
          name: nameStr.trim() || item.name,
          brand: brandStr.trim() || null,
          shade_code: shadeStr.trim() || null,
          package_size: packageSizeStr.trim() || null,
          price_per_unit_cents: centsFromPriceText(priceStr),
          supplier_hint: supplierStr.trim() || null,
        };
        const note = reasonStr.trim();
        if (note) body.reason = note;
        const row = await apiPatch(`/api/inventory/${itemId}`, body);
        setItem(row);
        setQtyStr(numToStr(row.quantity));
        setThreshStr(numToStr(row.low_stock_threshold));
        setUnit(row.unit || unit);
        setNameStr(row.name || '');
        setBrandStr(row.brand || '');
        setShadeStr(row.shade_code || '');
        setPackageSizeStr(row.package_size || '');
        setPriceStr(priceTextFromCents(row.price_per_unit_cents));
        setSupplierStr(row.supplier_hint || '');
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
  const detailLabel = labelForDetailField(categoryPreset, categoryCustom);
  const customCategoryPills = addUniqueCategory(customCategoryOptions, categoryCustom);
  const categoryOptions =
    initialCategoryMode === 'colors' || COLOR_CATEGORY_KEYS.has(categoryPreset)
      ? COLOR_CATEGORY_OPTIONS
      : GENERAL_CATEGORY_OPTIONS;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={styles.header}>
          <View style={styles.headerSide} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {isEdit ? item.name : 'New'}
          </Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={12}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </TouchableOpacity>
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
                placeholderTextColor="#1C1C1E"
                value={nameStr}
                onChangeText={setNameStr}
              />
              <View style={styles.labelRow}>
                <Text style={styles.labelInRow}>Category</Text>
                <TouchableOpacity
                  style={styles.addCategoryBtn}
                  onPress={() => {
                    if (addingCategory) {
                      const nextCategory = categoryDraft.trim();
                      setAddingCategory(false);
                      if (nextCategory) {
                        setCategoryCustom(nextCategory);
                        setCategoryPreset(null);
                        setCustomCategoryOptions((prev) => addUniqueCategory(prev, nextCategory));
                      }
                      setCategoryDraft('');
                    } else {
                      setAddingCategory(true);
                      setCategoryDraft('');
                    }
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.addCategoryTxt}>{addingCategory ? 'Done' : 'Add new'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.chips}>
                {categoryOptions.map((c) => {
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
                {customCategoryPills.map((category) => (
                  <TouchableOpacity
                    key={category}
                    style={styles.chip}
                    onPress={() => {
                      setCategoryCustom(category);
                      setCategoryPreset(null);
                      setAddingCategory(false);
                      setCategoryDraft('');
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.chipTxt}>{category}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {addingCategory ? (
                <TextInput
                  style={styles.input}
                  placeholder=""
                  placeholderTextColor="#1C1C1E"
                  value={categoryDraft}
                  onChangeText={(text) => {
                    setCategoryDraft(text);
                  }}
                  autoCapitalize="sentences"
                />
              ) : null}
              <Text style={styles.label}>Brand</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#1C1C1E"
                value={brandStr}
                onChangeText={setBrandStr}
              />
              <Text style={styles.label}>{detailLabel}</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#1C1C1E"
                value={shadeStr}
                onChangeText={setShadeStr}
              />
              <Text style={styles.label}>Product size</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#1C1C1E"
                value={packageSizeStr}
                onChangeText={setPackageSizeStr}
              />
              <Text style={styles.label}>Price ({currency})</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#1C1C1E"
                value={priceStr}
                onChangeText={setPriceStr}
                keyboardType="decimal-pad"
              />
              <Text style={styles.label}>Supplier</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#1C1C1E"
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
              <View style={styles.labelRow}>
                <Text style={styles.labelInRow}>Category</Text>
                <TouchableOpacity
                  style={styles.addCategoryBtn}
                  onPress={() => {
                    if (addingCategory) {
                      const nextCategory = categoryDraft.trim();
                      setAddingCategory(false);
                      if (nextCategory) {
                        setCategoryCustom(nextCategory);
                        setCategoryPreset(null);
                        setCustomCategoryOptions((prev) => addUniqueCategory(prev, nextCategory));
                      }
                      setCategoryDraft('');
                    } else {
                      setAddingCategory(true);
                      setCategoryDraft('');
                    }
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.addCategoryTxt}>{addingCategory ? 'Done' : 'Add new'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.chips}>
                {categoryOptions.map((c) => {
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
                {customCategoryPills.map((category) => (
                  <TouchableOpacity
                    key={category}
                    style={styles.chip}
                    onPress={() => {
                      setCategoryCustom(category);
                      setCategoryPreset(null);
                      setAddingCategory(false);
                      setCategoryDraft('');
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.chipTxt}>{category}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {addingCategory ? (
                <TextInput
                  style={styles.input}
                  placeholder=""
                  placeholderTextColor="#1C1C1E"
                  value={categoryDraft}
                  onChangeText={(text) => {
                    setCategoryDraft(text);
                  }}
                  autoCapitalize="sentences"
                />
              ) : null}
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#1C1C1E"
                value={nameStr}
                onChangeText={setNameStr}
              />
              <Text style={styles.label}>Brand</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#1C1C1E"
                value={brandStr}
                onChangeText={setBrandStr}
              />
              <Text style={styles.label}>{detailLabel}</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#1C1C1E"
                value={shadeStr}
                onChangeText={setShadeStr}
              />
              <Text style={styles.label}>Product size</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#1C1C1E"
                value={packageSizeStr}
                onChangeText={setPackageSizeStr}
              />
              <Text style={styles.label}>Price ({currency})</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#1C1C1E"
                value={priceStr}
                onChangeText={setPriceStr}
                keyboardType="decimal-pad"
              />
              <Text style={styles.label}>Supplier</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#1C1C1E"
                value={supplierStr}
                onChangeText={setSupplierStr}
              />
            </>
          )}

          <Text style={styles.label}>Inventory unit</Text>
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

          <Text style={styles.label}>Quantity</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={qtyStr}
            onChangeText={setQtyStr}
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>Low stock at</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#1C1C1E"
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
                placeholderTextColor="#1C1C1E"
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

const reliefShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.14,
  shadowRadius: 5,
  elevation: 4,
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '400', color: '#1C1C1E' },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 },
  subMeta: { fontSize: 14, color: '#1C1C1E', marginBottom: 4 },
  supplier: { fontSize: 13, fontWeight: '400', color: '#5E35B1', marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '400', color: '#1C1C1E', marginBottom: 8, marginTop: 4 },
  labelInRow: { fontSize: 14, fontWeight: '400', color: '#1C1C1E' },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 8,
  },
  addCategoryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5EA',
    ...reliefShadow,
  },
  addCategoryTxt: {
    fontSize: 13,
    fontWeight: '400',
    color: '#5E35B1',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1C1C1E',
    marginBottom: 4,
    ...reliefShadow,
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
    ...reliefShadow,
  },
  chipOn: {
    backgroundColor: '#5E35B1',
    borderColor: '#5E35B1',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 6,
  },
  chipTxt: { fontSize: 14, fontWeight: '400', color: '#1C1C1E' },
  chipTxtOn: { color: '#fff' },
  saveBtn: {
    marginTop: 28,
    backgroundColor: '#5E35B1',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 6,
  },
  saveDisabled: { opacity: 0.6 },
  saveTxt: { color: '#fff', fontSize: 16, fontWeight: '400' },
  histSection: { marginTop: 32 },
  histTitle: {
    fontSize: 15,
    fontWeight: '400',
    color: '#1C1C1E',
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
    ...reliefShadow,
  },
  histDelta: { fontSize: 16, fontWeight: '400', color: '#2E7D32', minWidth: 56 },
  histDeltaNeg: { color: '#C62828' },
  histMid: { flex: 1, paddingLeft: 8 },
  histReason: { fontSize: 14, fontWeight: '400', color: '#1C1C1E' },
  histWhen: { marginTop: 4, fontSize: 12, color: '#1C1C1E' },
});
