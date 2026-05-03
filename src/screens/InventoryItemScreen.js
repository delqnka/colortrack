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
import { FontFamily } from '../theme/fonts';
import { Type, typeLh } from '../theme/typography';

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
  const initialPresetCategory = PRESET_CATEGORY_KEYS.has(initialCategory) ? initialCategory : 'consumable';
  const initialCategoryMode =
    route.params?.categoryMode === 'colors' || COLOR_CATEGORY_KEYS.has(initialPresetCategory) ? 'colors' : 'general';

  const [item, setItem] = useState(null);
  const [movements, setMovements] = useState([]);
  const [nameStr, setNameStr] = useState('');
  const [brandStr, setBrandStr] = useState('');
  const [shadeStr, setShadeStr] = useState('');
  const [packageSizeStr, setPackageSizeStr] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [categoryPreset, setCategoryPreset] = useState('consumable');
  const [categoryCustom, setCategoryCustom] = useState('');
  const [categoryDraft, setCategoryDraft] = useState('');
  const [customCategoryOptions, setCustomCategoryOptions] = useState([]);
  const [addingCategory, setAddingCategory] = useState(false);
  const [unit, setUnit] = useState('g');
  const [supplierStr, setSupplierStr] = useState('');
  const [subcategoryStr, setSubcategoryStr] = useState('');
  const [subcategorySuggestions, setSubcategorySuggestions] = useState([]);
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
      const rc = row.category || 'consumable';
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
      setSubcategoryStr(row.custom_subcategory || '');
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
      setSubcategoryStr('');
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
      apiGet('/api/inventory/subcategories')
        .then((subs) => { if (!cancelled) setSubcategorySuggestions(Array.isArray(subs) ? subs : []); })
        .catch(() => {});
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
        const resolvedCategory = categoryCustom.trim() || categoryDraft.trim() || categoryPreset || 'consumable';
        setCustomCategoryOptions((prev) => addUniqueCategory(prev, resolvedCategory));
        await apiPost('/api/inventory', {
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
          custom_subcategory: subcategoryStr.trim() || null,
        });
        navigation.goBack();
      } else {
        const resolvedCategory = categoryCustom.trim() || categoryDraft.trim() || categoryPreset || item.category || 'consumable';
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
          custom_subcategory: subcategoryStr.trim() || null,
        };
        const note = reasonStr.trim();
        if (note) body.reason = note;
        await apiPatch(`/api/inventory/${itemId}`, body);
        navigation.goBack();
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

  const detailLabel = labelForDetailField(categoryPreset, categoryCustom);
  const customCategoryPills = addUniqueCategory(customCategoryOptions, categoryCustom);
  const isColorProduct = COLOR_CATEGORY_KEYS.has(categoryPreset) && !categoryCustom.trim();

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
          {/* ── Name ── */}
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#AEAEB2"
            value={nameStr}
            onChangeText={setNameStr}
          />

          {/* ── Brand ── */}
          <Text style={styles.label}>Brand</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#AEAEB2"
            value={brandStr}
            onChangeText={setBrandStr}
          />

          {/* ── Section toggle: Stock / Retail ── */}
          <Text style={styles.label}>Section</Text>
          <View style={styles.sectionToggle}>
            {[
              { key: 'consumable', label: 'Stock' },
              { key: 'retail',     label: 'Retail' },
            ].map(({ key, label }) => {
              const on = categoryPreset === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.sectionBtn, on && styles.sectionBtnOn]}
                  onPress={() => { setCategoryPreset(key); setCategoryCustom(''); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.sectionBtnTxt, on && styles.sectionBtnTxtOn]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Subcategory ── */}
          <Text style={styles.label}>Subcategory</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Shampoos, Styling, Thermal protection"
            placeholderTextColor="#AEAEB2"
            value={subcategoryStr}
            onChangeText={setSubcategoryStr}
            autoCapitalize="words"
          />
          {subcategorySuggestions.length > 0 && !subcategoryStr.trim() ? (
            <View style={styles.subSuggestions}>
              {subcategorySuggestions.slice(0, 6).map((s) => (
                <TouchableOpacity
                  key={s}
                  style={styles.subSuggestionChip}
                  onPress={() => setSubcategoryStr(s)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.subSuggestionTxt}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {/* ── Price ── */}
          <Text style={styles.label}>Price ({currency})</Text>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            placeholderTextColor="#AEAEB2"
            value={priceStr}
            onChangeText={setPriceStr}
            keyboardType="decimal-pad"
          />

          {/* ── Unit + Quantity inline ── */}
          <Text style={styles.label}>Stock</Text>
          <View style={styles.stockRow}>
            <TextInput
              style={[styles.input, styles.stockQtyInput]}
              placeholder="0"
              placeholderTextColor="#AEAEB2"
              value={qtyStr}
              onChangeText={setQtyStr}
              keyboardType="decimal-pad"
            />
            <View style={styles.unitChips}>
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
          </View>

          {/* ── Low stock ── */}
          <Text style={styles.label}>Low stock alert at  <Text style={styles.labelHint}>(notify when below)</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor="#AEAEB2"
            value={threshStr}
            onChangeText={setThreshStr}
            keyboardType="decimal-pad"
          />

          {/* ── Note (edit only) ── */}
          {isEdit ? (
            <>
              <Text style={styles.label}>Note  <Text style={styles.labelHint}>(reason for quantity change)</Text></Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#AEAEB2"
                value={reasonStr}
                onChangeText={setReasonStr}
              />
            </>
          ) : null}

          {/* ── Supplier (optional, at bottom) ── */}
          <Text style={styles.label}>Supplier  <Text style={styles.labelHint}>(optional)</Text></Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#AEAEB2"
            value={supplierStr}
            onChangeText={setSupplierStr}
          />

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
  headerTitle: { flex: 1, textAlign: 'center', ...Type.screenTitle, color: '#0D0D0D' },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 },
  subMeta: { ...Type.listPrimary, color: '#0D0D0D', marginBottom: 4 },
  supplier: {
    ...Type.secondary,
    color: '#5E35B1',
    marginBottom: 16,
  },
  sectionToggle: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  sectionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  sectionBtnOn: {
    backgroundColor: '#0D0D0D',
    borderColor: '#0D0D0D',
  },
  sectionBtnTxt: {
    fontFamily: FontFamily.semibold,
    fontSize: 14,
    color: '#0D0D0D',
  },
  sectionBtnTxtOn: {
    color: '#FFFFFF',
  },
  labelHint: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    color: '#AEAEB2',
    fontWeight: undefined,
  },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  stockQtyInput: {
    flex: 1,
    marginBottom: 0,
  },
  unitChips: {
    flexDirection: 'row',
    gap: 6,
  },
  subSuggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    marginTop: 4,
  },
  subSuggestionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
  },
  subSuggestionTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 13,
    color: '#0D0D0D',
  },
  label: {
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.regular,
    color: '#0D0D0D',
    marginBottom: 8,
    marginTop: 4,
  },
  labelInRow: {
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.regular,
    color: '#0D0D0D',
  },
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
    ...Type.secondary,
    color: '#5E35B1',
    fontFamily: FontFamily.medium,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.regular,
    color: '#0D0D0D',
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
  chipTxt: { ...Type.listPrimary, color: '#0D0D0D' },
  chipTxtOn: { color: '#fff', fontFamily: FontFamily.medium, fontSize: 15, lineHeight: typeLh(15) },
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
  saveTxt: { color: '#fff', ...Type.buttonLabel },
  histSection: { marginTop: 32 },
  histTitle: {
    ...Type.sectionLabel,
    marginBottom: 10,
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
  histDelta: {
    ...Type.price,
    color: '#2E7D32',
    minWidth: 56,
  },
  histDeltaNeg: { color: '#C62828' },
  histMid: { flex: 1, paddingLeft: 8 },
  histReason: { ...Type.secondary, color: '#0D0D0D' },
  histWhen: { marginTop: 4, ...Type.tabBarLabel, color: '#8A8A8E' },
});
