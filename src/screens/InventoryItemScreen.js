import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function CheckRow({ label, checked, onPress, style }) {
  return (
    <TouchableOpacity
      style={[crStyles.row, style]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="radio"
      accessibilityState={{ selected: checked }}
    >
      <View style={[crStyles.circle, checked && crStyles.circleOn]}>
        {checked ? <View style={crStyles.tick} /> : null}
      </View>
      <Text style={[crStyles.label, checked && crStyles.labelOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

const crStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
    gap: 12,
  },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#C7C7CC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleOn: {
    borderColor: '#5E35B1',
    backgroundColor: '#5E35B1',
  },
  tick: {
    width: 6,
    height: 10,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#FFFFFF',
    transform: [{ rotate: '45deg' }, { translateY: -1 }],
  },
  label: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 15,
    color: '#0D0D0D',
  },
  labelOn: {
    fontFamily: 'Manrope_600SemiBold',
    color: '#5E35B1',
  },
});
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
import { apiGet, apiPatch, apiPost, apiDelete } from '../api/client';
import ProductTypeComboField from '../components/ProductTypeComboField';
import { glassPurpleIconBtn, MY_LAB_VIOLET } from '../theme/glassUi';
import { useCurrency } from '../context/CurrencyContext';
import { FontFamily } from '../theme/fonts';
import { Type, typeLh } from '../theme/typography';
import { inventoryCategoryKey, isColorItem } from '../inventory/inventoryCategories';

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

function normalizeInventoryRowId(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const t = Math.trunc(v);
    return t > 0 && t <= Number.MAX_SAFE_INTEGER ? t : null;
  }
  const s = String(v).trim();
  if (!/^\d{1,12}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
}

/** Prefer server row id so DELETE/PATCH match the loaded item (avoids stale route params). */
function inventoryPersistId(row, routeItemId) {
  const fromRow = normalizeInventoryRowId(row?.id);
  const fromRoute = normalizeInventoryRowId(routeItemId);
  if (fromRow != null) return fromRow;
  if (fromRoute != null) return fromRoute;
  return null;
}

const UNIT_OPTIONS = ['g', 'ml', 'pcs', 'oz'];
const TUBE_UNIT_OPTIONS = ['g', 'ml', 'oz'];
const STOCK_BOTTLE_UNITS = ['ml', 'oz'];

/** Same rules as Inventory → Stock tab (excludes retail, developer, colour lines). */
function isStockTabInventoryItem(row) {
  if (!row) return false;
  if (inventoryCategoryKey(row.category) === 'retail') return false;
  if (inventoryCategoryKey(row.category) === 'oxidant') return false;
  if (isColorItem(row)) return false;
  return true;
}

function parseTubePackageSize(packageSize) {
  const s = String(packageSize || '').trim();
  const m = s.match(/^([\d.,]+)\s*(g|ml|oz)\s*$/i);
  if (!m) return { amount: '', unit: 'ml', raw: s };
  const u = m[2].toLowerCase();
  return { amount: m[1].replace(',', '.'), unit: u === 'g' || u === 'ml' || u === 'oz' ? u : 'ml', raw: '' };
}

function numToStr(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return String(n);
}

function applyIntegerDraftChange(setter, text) {
  const d = String(text ?? '').replace(/[^\d]/g, '');
  if (d === '') {
    setter('');
    return;
  }
  const n = parseInt(d, 10);
  setter(Number.isFinite(n) ? String(n) : '');
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
  if (categoryPreset === 'dye') return 'Shade / code';
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

function subcategoriesApiPath(category) {
  const c = String(category || '').trim();
  if (c === 'retail' || c === 'consumable') {
    return `/api/inventory/subcategories?category=${encodeURIComponent(c)}`;
  }
  return '/api/inventory/subcategories';
}

/** Chips for retail/stock/mixtone lines — not developer/dye formula buckets. */
function subcategorySuggestionsForProductTypeChips(suggestions) {
  if (!Array.isArray(suggestions)) return [];
  return suggestions.filter((s) => {
    const t = String(s).trim().toLowerCase();
    return t !== 'ammonia' && t !== 'non-ammonia';
  });
}

export default function InventoryItemScreen({ route, navigation }) {
  const { currency } = useCurrency();
  const itemId = route.params?.itemId;
  const isEdit = normalizeInventoryRowId(itemId) != null;
  const initialCategory = typeof route.params?.initialCategory === 'string' ? route.params.initialCategory : '';
  const initialPresetCategory = PRESET_CATEGORY_KEYS.has(initialCategory) ? initialCategory : 'consumable';
  const initialCategoryMode =
    route.params?.categoryMode === 'colors' || COLOR_CATEGORY_KEYS.has(initialPresetCategory) ? 'colors' : 'general';

  const [item, setItem] = useState(null);
  const [movements, setMovements] = useState([]);
  const [brandStr, setBrandStr] = useState('');
  const [shadeStr, setShadeStr] = useState('');
  const [packageSizeStr, setPackageSizeStr] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [sellPriceStr, setSellPriceStr] = useState('');
  const [categoryPreset, setCategoryPreset] = useState('consumable');
  const [categoryCustom, setCategoryCustom] = useState('');
  const [categoryDraft, setCategoryDraft] = useState('');
  const [customCategoryOptions, setCustomCategoryOptions] = useState([]);
  const [addingCategory, setAddingCategory] = useState(false);
  const [unit, setUnit] = useState('g');
  const [supplierStr, setSupplierStr] = useState('');
  const [subcategoryStr, setSubcategoryStr] = useState('');
  // Developer + dye (color): ammonia / tube size
  const [ammoniaType, setAmmoniaType] = useState(null); // 'ammonia' | 'non-ammonia' | null
  const [strengthMode, setStrengthMode] = useState('percent'); // 'percent' | 'vol'
  const [tubeAmountStr, setTubeAmountStr] = useState('');
  const [tubeSizeUnit, setTubeSizeUnit] = useState('ml');
  const [subcategorySuggestions, setSubcategorySuggestions] = useState([]);
  const [qtyStr, setQtyStr] = useState('');
  const [threshStr, setThreshStr] = useState('');
  const [reasonStr, setReasonStr] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const loadedInventoryIdRef = useRef(null);

  const load = useCallback(async () => {
    if (!isEdit) return;
    loadedInventoryIdRef.current = null;
    setLoading(true);
    try {
      const routePk = normalizeInventoryRowId(itemId);
      if (routePk == null) {
        Alert.alert('', 'Load failed');
        navigation.goBack();
        return;
      }
      const [row, hist] = await Promise.all([
        apiGet(`/api/inventory/${routePk}`, { allowStaleCache: false }),
        apiGet(`/api/inventory/${routePk}/movements`, { allowStaleCache: false }),
      ]);
      const stableId = normalizeInventoryRowId(row?.id);
      if (!stableId) {
        Alert.alert('', 'Load failed');
        navigation.goBack();
        return;
      }
      loadedInventoryIdRef.current = stableId;
      setItem(row);
      setBrandStr(
        [row.brand, row.name]
          .map((x) => (x != null ? String(x).trim() : ''))
          .filter(Boolean)
          .join(' ')
          .trim(),
      );
      setShadeStr(row.shade_code || '');
      const ps = row.package_size || '';
      if (row.category === 'dye' || row.category === 'retail') {
        const parsed = parseTubePackageSize(ps);
        setTubeAmountStr(parsed.amount);
        setTubeSizeUnit(parsed.unit);
        setPackageSizeStr(parsed.raw && !parsed.amount ? parsed.raw : '');
      } else if (isStockTabInventoryItem(row)) {
        const parsed = parseTubePackageSize(ps);
        setTubeAmountStr(parsed.amount);
        const u = String(parsed.unit || 'ml').toLowerCase();
        setTubeSizeUnit(u === 'oz' ? 'oz' : 'ml');
        setPackageSizeStr(parsed.raw && !parsed.amount ? parsed.raw : '');
      } else {
        setPackageSizeStr(ps);
        setTubeAmountStr('');
        setTubeSizeUnit('ml');
      }
      setPriceStr(priceTextFromCents(row.price_per_unit_cents));
      setSellPriceStr(priceTextFromCents(row.sell_price_cents));
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
      setUnit(row.category === 'oxidant' || row.category === 'dye' ? 'pcs' : (row.unit || 'pcs'));
      setSupplierStr(row.supplier_hint || '');
      // Developer fields — ammonia stored in custom_subcategory, bottle size in package_size
      const subcat = String(row.custom_subcategory || '').toLowerCase();
      if (subcat === 'ammonia') setAmmoniaType('ammonia');
      else if (subcat === 'non-ammonia') setAmmoniaType('non-ammonia');
      else setAmmoniaType(null);
      const sh = String(row.shade_code || '');
      if (sh.includes('vol')) setStrengthMode('vol');
      else setStrengthMode('percent');
      setSubcategoryStr(row.custom_subcategory || '');
      setQtyStr(numToStr(row.quantity));
      setThreshStr(numToStr(row.low_stock_threshold));
      setReasonStr('');
      setMovements(Array.isArray(hist) ? hist : []);
      apiGet(subcategoriesApiPath(row.category))
        .then((subs) => setSubcategorySuggestions(Array.isArray(subs) ? subs : []))
        .catch(() => {});
    } catch {
      Alert.alert('', 'Load failed');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [itemId, isEdit, navigation]);

  const persistInventoryId = useMemo(() => inventoryPersistId(item, itemId), [item, itemId]);

  const prevItemIdRef = useRef(itemId);
  useEffect(() => {
    if (!isEdit) return;
    if (prevItemIdRef.current === itemId) return;
    prevItemIdRef.current = itemId;
    setItem(null);
    setMovements([]);
    load();
  }, [isEdit, itemId, load]);

  useFocusEffect(
    useCallback(() => {
      if (isEdit) {
        load();
        return;
      }
      let cancelled = false;
      setItem(null);
      setBrandStr('');
      setShadeStr('');
      setPackageSizeStr('');
      setTubeAmountStr('');
      setTubeSizeUnit('ml');
      setPriceStr('');
      setSellPriceStr('');
      setCategoryPreset(initialPresetCategory);
      setCategoryCustom(initialCategory && !PRESET_CATEGORY_KEYS.has(initialCategory) ? initialCategory : '');
      setCategoryDraft('');
      setAddingCategory(false);
      setUnit('pcs');
      setSupplierStr('');
      setAmmoniaType(null);
      setStrengthMode('percent');
      setSubcategoryStr('');
      setQtyStr('');
      setThreshStr('');
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
      apiGet(subcategoriesApiPath(initialPresetCategory))
        .then((subs) => { if (!cancelled) setSubcategorySuggestions(Array.isArray(subs) ? subs : []); })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [initialCategory, initialPresetCategory, isEdit, load]),
  );

  useEffect(() => {
    if (categoryPreset === 'dye' && !categoryCustom.trim()) setUnit('pcs');
  }, [categoryPreset, categoryCustom]);

  useEffect(() => {
    const stockProductForm =
      (categoryPreset === 'consumable' && !categoryCustom.trim()) ||
      (isEdit &&
        item &&
        isStockTabInventoryItem(item) &&
        categoryPreset !== 'dye');
    if (stockProductForm && tubeSizeUnit === 'g') {
      setTubeSizeUnit('ml');
    }
  }, [categoryPreset, categoryCustom, tubeSizeUnit, isEdit, item]);

  const subcategoryChipSuggestions = useMemo(
    () => subcategorySuggestionsForProductTypeChips(subcategorySuggestions),
    [subcategorySuggestions],
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
      const isDyeNew = categoryPreset === 'dye' && !categoryCustom.trim();
      const isRetailNew = categoryPreset === 'retail' && !categoryCustom.trim();
      const isStockNew = categoryPreset === 'consumable' && !categoryCustom.trim();
      const persistUnit =
        (categoryPreset === 'oxidant' && !categoryCustom.trim()) || isDyeNew ? 'pcs' : unit;
      const isDeveloperSave = categoryPreset === 'oxidant' && !categoryCustom.trim();
      const isDyeSave = isDyeNew;
      let packageSizeOut = packageSizeStr.trim() || null;
      if (isDyeSave || isRetailNew || isStockNew) {
        const ta = tubeAmountStr.trim().replace(',', '.');
        const u =
          isStockNew && !STOCK_BOTTLE_UNITS.includes(tubeSizeUnit) ? 'ml' : tubeSizeUnit;
        packageSizeOut =
          ta && Number.isFinite(Number(ta)) && Number(ta) > 0 ? `${ta} ${u}` : null;
      }
      if (!isEdit) {
        // Developer: brand line is the product name; others: single "Brand" field → API `name`
        const name = isDeveloperItem
          ? (brandStr.trim() || shadeStr.trim() || 'Developer')
          : brandStr.trim();
        if (!name) {
          Alert.alert('', isStockNew ? 'Enter a name.' : 'Enter a brand.');
          setSaving(false);
          return;
        }
        const resolvedCategory = categoryCustom.trim() || categoryDraft.trim() || categoryPreset || 'consumable';
        setCustomCategoryOptions((prev) => addUniqueCategory(prev, resolvedCategory));
        const ammoniaNew =
          isDeveloperSave || isDyeSave
            ? (ammoniaType === 'ammonia' ? 'Ammonia' : ammoniaType === 'non-ammonia' ? 'Non-ammonia' : null)
            : null;
        await apiPost('/api/inventory', {
          name,
          category: resolvedCategory,
          unit: persistUnit,
          quantity: q,
          low_stock_threshold: t,
          brand: isDeveloperItem ? (brandStr.trim() || null) : null,
          shade_code: isStockNew ? null : shadeStr.trim() || null,
          package_size: packageSizeOut,
          price_per_unit_cents: centsFromPriceText(priceStr),
          supplier_hint: supplierStr.trim() || null,
          custom_subcategory: ammoniaNew ?? (subcategoryStr.trim() || null),
          sell_price_cents: centsFromPriceText(sellPriceStr),
        });
        navigation.goBack();
      } else {
        const resolvedCategory = categoryCustom.trim() || categoryDraft.trim() || categoryPreset || item.category || 'consumable';
        const isDyeEdit = resolvedCategory === 'dye' && !categoryCustom.trim();
        const isRetailEdit = resolvedCategory === 'retail' && !categoryCustom.trim();
        const isStockEdit =
          (resolvedCategory === 'consumable' && !categoryCustom.trim()) ||
          (Boolean(categoryCustom.trim()) &&
            isStockTabInventoryItem({ category: resolvedCategory }));
        const isDeveloperEdit = resolvedCategory === 'oxidant' && !categoryCustom.trim();
        let packageSizeEdit = packageSizeStr.trim() || null;
        if (isDyeEdit || isRetailEdit || isStockEdit) {
          const ta = tubeAmountStr.trim().replace(',', '.');
          const u =
            isStockEdit && !STOCK_BOTTLE_UNITS.includes(tubeSizeUnit) ? 'ml' : tubeSizeUnit;
          packageSizeEdit =
            ta && Number.isFinite(Number(ta)) && Number(ta) > 0 ? `${ta} ${u}` : null;
        }
        const ammoniaEdit =
          isDeveloperEdit || isDyeEdit
            ? (ammoniaType === 'ammonia' ? 'Ammonia' : ammoniaType === 'non-ammonia' ? 'Non-ammonia' : null)
            : null;
        const persistUnitEdit =
          (resolvedCategory === 'oxidant' || resolvedCategory === 'dye') && !categoryCustom.trim()
            ? 'pcs'
            : unit;
        const body = {
          quantity: q,
          low_stock_threshold: t,
          unit: persistUnitEdit,
          category: resolvedCategory,
          name: isDeveloperItem
            ? (brandStr.trim() || shadeStr.trim() || item.name || 'Developer')
            : (brandStr.trim() || item.name),
          brand: isDeveloperItem ? (brandStr.trim() || null) : null,
          shade_code: isStockEdit ? null : shadeStr.trim() || null,
          package_size: packageSizeEdit,
          price_per_unit_cents: centsFromPriceText(priceStr),
          sell_price_cents: centsFromPriceText(sellPriceStr),
          supplier_hint: supplierStr.trim() || null,
          custom_subcategory: ammoniaEdit ?? (subcategoryStr.trim() || null),
        };
        const note = reasonStr.trim();
        if (note) body.reason = note;
        const pid = loadedInventoryIdRef.current ?? persistInventoryId;
        if (!pid) {
          Alert.alert('', 'Load failed');
          setSaving(false);
          return;
        }
        await apiPatch(`/api/inventory/${pid}`, body);
        navigation.goBack();
      }
    } catch (e) {
      Alert.alert('', e.message || '');
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = () => {
    const pid = loadedInventoryIdRef.current ?? persistInventoryId;
    if (!isEdit || !pid) return;
    Alert.alert('', 'Delete this product?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await apiDelete(`/api/inventory/${pid}`);
            navigation.goBack();
          } catch (e) {
            Alert.alert('', e.message || '');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
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
  const isDeveloperItem = categoryPreset === 'oxidant' && !categoryCustom.trim();
  const isDyeItem = categoryPreset === 'dye' && !categoryCustom.trim();
  const isRetailItem = categoryPreset === 'retail' && !categoryCustom.trim();
  const isStockConsumable = categoryPreset === 'consumable' && !categoryCustom.trim();
  const isStockProductForm =
    isStockConsumable ||
    (Boolean(item) && isStockTabInventoryItem(item) && categoryPreset !== 'dye');
  const showUnitChips =
    !isDeveloperItem && !isDyeItem && !(isStockProductForm && unit === 'pcs');
  const hideStockRetailSection =
    (!isEdit && initialPresetCategory === 'retail') ||
    (isEdit && item?.category === 'retail' && !categoryCustom.trim());
  const stockCategoryKey =
    isDeveloperItem
      ? 'oxidant'
      : COLOR_CATEGORY_KEYS.has(categoryPreset) && categoryPreset !== 'oxidant'
        ? categoryPreset
        : 'consumable';

  const BOTTLE_SIZES = ['250 ml', '500 ml', '1000 ml', '2 L'];

  const STRENGTH_PERCENT = ['1.9%', '3%', '6%', '9%', '12%'];
  const STRENGTH_VOL = ['5 vol', '10 vol', '20 vol', '30 vol', '40 vol'];

  const compactColorCodeField = isColorProduct && !isDeveloperItem;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.screenFill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={styles.header}>
          <View style={styles.headerSide} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {isEdit ? item.name : (
              isDeveloperItem ? 'Adding developer' :
              categoryPreset === 'retail' ? 'Adding retail product' :
              COLOR_CATEGORY_KEYS.has(categoryPreset) ? 'Adding color' :
              'Adding stock product'
            )}
          </Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={12}>
            <Ionicons name="close" size={22} color={MY_LAB_VIOLET} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1, backgroundColor: '#FFFFFF' }}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!hideStockRetailSection ? (
            <>
              <Text style={styles.label}>Section</Text>
              <View style={styles.checkGroup}>
                {[
                  { key: stockCategoryKey, label: 'Stock' },
                  { key: 'retail', label: 'Retail' },
                ].map(({ key, label }, i, arr) => (
                  <CheckRow
                    key={key}
                    label={label}
                    checked={categoryPreset === key}
                    onPress={() => { setCategoryPreset(key); setCategoryCustom(''); }}
                    style={i === arr.length - 1 ? { borderBottomWidth: 0 } : {}}
                  />
                ))}
              </View>
            </>
          ) : null}

          {isStockProductForm ? (
            <>
              <ProductTypeComboField
                label="Type of product"
                value={subcategoryStr}
                onChangeText={setSubcategoryStr}
                options={subcategoryChipSuggestions}
                inputStyle={styles.input}
              />
              <Text style={[styles.label, { marginTop: 4 }]}>Name</Text>
              <TextInput
                style={styles.input}
                placeholder=""
                placeholderTextColor="#AEAEB2"
                value={brandStr}
                onChangeText={setBrandStr}
              />
              <Text style={[styles.label, { marginTop: 14 }]}>Bottle size</Text>
              <View style={styles.tubeRow}>
                <TextInput
                  style={[styles.input, styles.inputTubeAmount]}
                  placeholder=""
                  placeholderTextColor="#AEAEB2"
                  value={tubeAmountStr}
                  onChangeText={(t) => applyIntegerDraftChange(setTubeAmountStr, t)}
                  keyboardType="decimal-pad"
                />
                <View style={styles.tubeUnitRow}>
                  {STOCK_BOTTLE_UNITS.map((u) => (
                    <TouchableOpacity
                      key={u}
                      style={[styles.tubeUnitChip, tubeSizeUnit === u && styles.tubeUnitChipOn]}
                      onPress={() => setTubeSizeUnit(u)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.tubeUnitTxt, tubeSizeUnit === u && styles.tubeUnitTxtOn]}>{u}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={[styles.inlineRow, { marginTop: 14 }]}>
                <Text style={styles.inlineLabel}>
                  Stock {`(${unit})`}
                </Text>
                <TextInput
                  style={[styles.input, styles.inputInline]}
                  placeholder=""
                  placeholderTextColor="#AEAEB2"
                  value={qtyStr}
                  onChangeText={(t) => applyIntegerDraftChange(setQtyStr, t)}
                  keyboardType="decimal-pad"
                  textAlign="right"
                />
              </View>
              {showUnitChips ? (
                <View style={[styles.chips, { marginTop: 4, marginBottom: 2 }]}>
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
              ) : null}
            </>
          ) : null}

          {!isStockProductForm ? (
            <>
              <Text style={styles.label}>Brand</Text>
              <TextInput
                style={styles.input}
                placeholder={isDeveloperItem ? 'e.g. Wella, Schwarzkopf, Alfaparf' : ''}
                placeholderTextColor="#AEAEB2"
                value={brandStr}
                onChangeText={setBrandStr}
              />
            </>
          ) : null}

          {isColorProduct && !isDeveloperItem && !isDyeItem ? (
            <>
              <Text style={[styles.label, { marginTop: 4 }]}>{detailLabel}</Text>
              <TextInput
                style={[styles.input, compactColorCodeField && styles.inputColorCodeTab]}
                placeholder=""
                placeholderTextColor="#AEAEB2"
                value={shadeStr}
                onChangeText={setShadeStr}
                autoCapitalize="characters"
              />
            </>
          ) : null}

          {isDyeItem ? (
            <>
              <Text style={[styles.label, { marginTop: 4 }]}>{detailLabel}</Text>
              <TextInput
                style={[styles.input, styles.inputColorCodeTab]}
                placeholder=""
                placeholderTextColor="#AEAEB2"
                value={shadeStr}
                onChangeText={setShadeStr}
                autoCapitalize="characters"
              />
              <Text style={[styles.label, { marginTop: 14 }]}>Tube size</Text>
              <View style={styles.tubeRowDyeStacked}>
                <TextInput
                  style={[styles.input, styles.inputTubeAmountXs]}
                  placeholder="0"
                  placeholderTextColor="#AEAEB2"
                  value={tubeAmountStr}
                  onChangeText={(t) => applyIntegerDraftChange(setTubeAmountStr, t)}
                  keyboardType="decimal-pad"
                />
                <View style={styles.tubeUnitRowTight}>
                  {TUBE_UNIT_OPTIONS.map((u) => (
                    <TouchableOpacity
                      key={u}
                      style={[styles.tubeUnitChipXs, tubeSizeUnit === u && styles.tubeUnitChipOn]}
                      onPress={() => setTubeSizeUnit(u)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.tubeUnitTxtXs, tubeSizeUnit === u && styles.tubeUnitTxtOn]}>{u}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <Text style={[styles.label, { marginTop: 14 }]}>Formula type</Text>
              <View style={styles.checkGroup}>
                {[['ammonia', 'Ammonia'], ['non-ammonia', 'Non-ammonia']].map(([val, lbl], i, arr) => (
                  <CheckRow
                    key={val}
                    label={lbl}
                    checked={ammoniaType === val}
                    onPress={() => {
                      const next = ammoniaType === val ? null : val;
                      setAmmoniaType(next);
                      if (next) setSubcategoryStr('');
                    }}
                    style={i === arr.length - 1 ? { borderBottomWidth: 0 } : {}}
                  />
                ))}
              </View>
              {ammoniaType == null ? (
                <ProductTypeComboField
                  label="Type of product"
                  value={subcategoryStr}
                  onChangeText={(t) => {
                    setSubcategoryStr(t);
                    setAmmoniaType(null);
                  }}
                  options={subcategoryChipSuggestions}
                  inputStyle={styles.input}
                />
              ) : null}
            </>
          ) : null}

          {/* ══ DEVELOPER-SPECIFIC FIELDS ══ */}
          {isDeveloperItem ? (
            <>
              {/* Strength mode toggle */}
              <Text style={styles.label}>Strength</Text>
              <View style={styles.devModeToggle}>
                {[['percent', '%'], ['vol', 'Vol']].map(([mode, lbl]) => (
                  <TouchableOpacity
                    key={mode}
                    style={[styles.devModeBtn, strengthMode === mode && styles.devModeBtnOn]}
                    onPress={() => { setStrengthMode(mode); setShadeStr(''); }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.devModeTxt, strengthMode === mode && styles.devModeTxtOn]}>{lbl}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* Strength presets */}
              <View style={[styles.chips, strengthMode === 'vol' && styles.chipsVolRow]}>
                {(strengthMode === 'percent' ? STRENGTH_PERCENT : STRENGTH_VOL).map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.chip,
                      strengthMode === 'vol' && styles.chipVolRowCell,
                      strengthMode === 'vol' && styles.chipVolSmaller,
                      shadeStr === s && styles.chipOn,
                    ]}
                    onPress={() => setShadeStr(shadeStr === s ? '' : s)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.chipTxt,
                        strengthMode === 'vol' && styles.chipVolTxtCenter,
                        strengthMode === 'vol' && styles.chipVolTxtSmaller,
                        shadeStr === s && styles.chipTxtOn,
                        strengthMode === 'vol' && shadeStr === s && styles.chipVolTxtOnSmaller,
                      ]}
                      numberOfLines={1}
                    >
                      {s}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* Custom strength */}
              <TextInput
                style={[styles.input, { marginTop: 6 }]}
                placeholder="or type custom e.g. 7.5%"
                placeholderTextColor="#AEAEB2"
                value={STRENGTH_PERCENT.includes(shadeStr) || STRENGTH_VOL.includes(shadeStr) ? '' : shadeStr}
                onChangeText={v => setShadeStr(v)}
              />

              {/* Ammonia toggle */}
              <Text style={[styles.label, { marginTop: 14 }]}>Formula type</Text>
              <View style={styles.checkGroup}>
                {[['ammonia', 'Ammonia'], ['non-ammonia', 'Non-ammonia']].map(([val, lbl], i, arr) => (
                  <CheckRow
                    key={val}
                    label={lbl}
                    checked={ammoniaType === val}
                    onPress={() => {
                      const next = ammoniaType === val ? null : val;
                      setAmmoniaType(next);
                      if (next) setSubcategoryStr('');
                    }}
                    style={i === arr.length - 1 ? { borderBottomWidth: 0 } : {}}
                  />
                ))}
              </View>
              {ammoniaType == null ? (
                <ProductTypeComboField
                  label="Type of product"
                  value={subcategoryStr}
                  onChangeText={(t) => {
                    setSubcategoryStr(t);
                    setAmmoniaType(null);
                  }}
                  options={subcategoryChipSuggestions}
                  inputStyle={styles.input}
                />
              ) : null}
            </>
          ) : null}

          {/* ── Subcategory — retail / custom lines; stock consumable uses Type of product above ── */}
          {!isDeveloperItem && !isDyeItem && !isStockProductForm ? (
            <>
              <ProductTypeComboField
                label="Type of product"
                value={subcategoryStr}
                onChangeText={setSubcategoryStr}
                options={subcategoryChipSuggestions}
                inputStyle={styles.input}
              />
              {isRetailItem ? (
                <>
                  <Text style={[styles.label, { marginTop: 14 }]}>Package size</Text>
                  <View style={styles.tubeRow}>
                    <TextInput
                      style={[styles.input, styles.inputTubeAmount]}
                      placeholder="0"
                      placeholderTextColor="#AEAEB2"
                      value={tubeAmountStr}
                      onChangeText={(t) => applyIntegerDraftChange(setTubeAmountStr, t)}
                      keyboardType="decimal-pad"
                    />
                    <View style={styles.tubeUnitRow}>
                      {TUBE_UNIT_OPTIONS.map((u) => (
                        <TouchableOpacity
                          key={u}
                          style={[styles.tubeUnitChip, tubeSizeUnit === u && styles.tubeUnitChipOn]}
                          onPress={() => setTubeSizeUnit(u)}
                          activeOpacity={0.85}
                        >
                          <Text style={[styles.tubeUnitTxt, tubeSizeUnit === u && styles.tubeUnitTxtOn]}>{u}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </>
              ) : null}
            </>
          ) : null}


          {/* ── Bottle size — developer only ── */}
          {isDeveloperItem ? (
            <>
              <Text style={styles.label}>Bottle size</Text>
              <View style={styles.chips}>
                {BOTTLE_SIZES.map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.chip, packageSizeStr === s && styles.chipOn]}
                    onPress={() => setPackageSizeStr(packageSizeStr === s ? '' : s)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.chipTxt, packageSizeStr === s && styles.chipTxtOn]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={[styles.input, { marginTop: 6 }]}
                placeholder="or type custom e.g. 750 ml"
                placeholderTextColor="#AEAEB2"
                value={BOTTLE_SIZES.includes(packageSizeStr) ? '' : packageSizeStr}
                onChangeText={setPackageSizeStr}
              />
            </>
          ) : null}

          {/* ── Stock quantity + unit chips (retail: after prices; consumable: block above) ── */}
          {!isRetailItem && !isStockProductForm ? (
            <>
              <View style={styles.inlineRow}>
                <Text style={styles.inlineLabel}>
                  Stock {isDeveloperItem || isDyeItem ? '(pcs)' : `(${unit})`}
                </Text>
                <TextInput
                  style={[styles.input, styles.inputInline]}
                  placeholder=""
                  placeholderTextColor="#AEAEB2"
                  value={qtyStr}
                  onChangeText={(t) => applyIntegerDraftChange(setQtyStr, t)}
                  keyboardType="decimal-pad"
                  textAlign="right"
                />
              </View>
              {showUnitChips ? (
                <View style={[styles.chips, { marginTop: -6 }]}>
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
              ) : null}
            </>
          ) : null}

          {/* ── Low stock ── */}
          <View style={styles.inlineRow}>
            <Text style={styles.inlineLabel}>Low stock at</Text>
            <TextInput
              style={[styles.input, styles.inputInline]}
              placeholder="0"
              placeholderTextColor="#AEAEB2"
              value={threshStr}
              onChangeText={(t) => applyIntegerDraftChange(setThreshStr, t)}
              keyboardType="decimal-pad"
              textAlign="right"
            />
          </View>

          {/* ── Price (cost) ── */}
          <View style={styles.inlineRow}>
            <Text style={styles.inlineLabel}>
              {categoryPreset === 'retail' ? `Cost price (${currency})` : `Price (${currency})`}
            </Text>
            <TextInput
              style={[styles.input, styles.inputInline]}
              placeholder="0.00"
              placeholderTextColor="#AEAEB2"
              value={priceStr}
              onChangeText={setPriceStr}
              keyboardType="decimal-pad"
              textAlign="right"
            />
          </View>

          {/* ── Sell price + margin — retail only ── */}
          {categoryPreset === 'retail' ? (() => {
            const cost = centsFromPriceText(priceStr);
            const sell = centsFromPriceText(sellPriceStr);
            const marginPct = cost != null && sell != null && cost > 0 && sell > cost
              ? Math.round((sell - cost) / sell * 100)
              : null;
            return (
              <>
                <View style={styles.inlineRow}>
                  <Text style={styles.inlineLabel}>Sell price ({currency})</Text>
                  <TextInput
                    style={[styles.input, styles.inputInline]}
                    placeholder="0.00"
                    placeholderTextColor="#AEAEB2"
                    textAlign="right"
                    value={sellPriceStr}
                    onChangeText={setSellPriceStr}
                    keyboardType="decimal-pad"
                  />
                </View>
                {marginPct != null ? (
                  <View style={styles.marginRow}>
                    <Text style={styles.marginTxt}>Margin  </Text>
                    <Text style={styles.marginPct}>{marginPct}%</Text>
                  </View>
                ) : null}
              </>
            );
          })() : null}

          {isRetailItem ? (
            <>
              <View style={[styles.inlineRow, { marginTop: 14 }]}>
                <Text style={styles.inlineLabel}>
                  Stock {`(${unit})`}
                </Text>
                <TextInput
                  style={[styles.input, styles.inputInline]}
                  placeholder=""
                  placeholderTextColor="#AEAEB2"
                  value={qtyStr}
                  onChangeText={(t) => applyIntegerDraftChange(setQtyStr, t)}
                  keyboardType="decimal-pad"
                  textAlign="right"
                />
              </View>
              {showUnitChips ? (
                <View style={[styles.chips, { marginTop: 4, marginBottom: 2 }]}>
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
              ) : null}
            </>
          ) : null}

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
            disabled={saving || deleting}
            activeOpacity={0.9}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Save</Text>}
          </TouchableOpacity>

          {isEdit ? (
            <TouchableOpacity
              style={[styles.deleteProductBtn, (saving || deleting) && styles.saveDisabled]}
              onPress={deleteProduct}
              disabled={saving || deleting}
              activeOpacity={0.85}
            >
              {deleting ? (
                <ActivityIndicator color="#C62828" />
              ) : (
                <Text style={styles.deleteProductTxt}>Delete product</Text>
              )}
            </TouchableOpacity>
          ) : null}

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
  screenFill: { flex: 1, backgroundColor: '#FFFFFF' },
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  headerSide: { width: 40, height: 40 },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FontFamily.regular,
    fontSize: 15,
    color: '#0D0D0D',
    letterSpacing: -0.2,
  },
  scroll: { paddingHorizontal: 24, paddingBottom: 24, backgroundColor: '#FFFFFF' },
  subMeta: { ...Type.listPrimary, color: '#0D0D0D', marginBottom: 4 },
  supplier: {
    ...Type.secondary,
    color: '#5E35B1',
    marginBottom: 16,
  },
  checkGroup: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    marginBottom: 14,
    ...reliefShadow,
  },
  marginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    marginTop: -6,
  },
  marginTxt: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    color: '#8A8A8E',
  },
  marginPct: {
    fontFamily: FontFamily.semibold,
    fontSize: 15,
    color: '#00A86B',
    letterSpacing: -0.2,
  },
  devModeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(94,53,177,0.07)',
    borderRadius: 10,
    padding: 3,
    gap: 2,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  devModeBtn: {
    paddingHorizontal: 20,
    paddingVertical: 7,
    borderRadius: 8,
  },
  devModeBtnOn: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  devModeTxt: { fontFamily: FontFamily.medium, fontSize: 14, color: '#8A8A8E' },
  devModeTxtOn: { color: '#0D0D0D', fontFamily: FontFamily.semibold },
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
    backgroundColor: '#FFFFFF',
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
  /** Narrow “tab” for shade / SKU-style numeric codes (color lines). */
  inputColorCodeTab: {
    alignSelf: 'flex-start',
    minWidth: 88,
    maxWidth: 132,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    fontSize: 15,
    fontFamily: FontFamily.medium,
    marginBottom: 4,
  },
  tubeRowDyeStacked: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  /** Dye tube amount — same footprint as `inputColorCodeTab` (shade). */
  inputTubeAmountXs: {
    alignSelf: 'flex-start',
    minWidth: 88,
    maxWidth: 132,
    marginBottom: 0,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.medium,
    textAlign: 'center',
  },
  tubeUnitRowTight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  tubeUnitChipXs: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  tubeUnitTxtXs: {
    fontSize: 14,
    lineHeight: typeLh(14),
    fontFamily: FontFamily.medium,
    color: '#0D0D0D',
  },
  inputCompact: {
    paddingVertical: 9,
    fontSize: 15,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  inlineLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
    color: '#0D0D0D',
    flex: 1,
  },
  inputInline: {
    width: 110,
    marginBottom: 0,
    paddingVertical: 9,
    textAlign: 'right',
  },
  tubeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  tubeRowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
    flexWrap: 'wrap',
  },
  inputTubeAmount: {
    flex: 1,
    minWidth: 0,
    marginBottom: 0,
  },
  inputTubeAmountSmall: {
    width: 76,
    marginBottom: 0,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    fontSize: 15,
    fontFamily: FontFamily.medium,
    textAlign: 'center',
  },
  tubeUnitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  tubeUnitChip: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  tubeUnitChipSm: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  tubeUnitChipOn: {
    backgroundColor: '#5E35B1',
    borderColor: '#5E35B1',
  },
  tubeUnitTxt: {
    fontSize: 14,
    lineHeight: typeLh(14),
    fontFamily: FontFamily.medium,
    color: '#0D0D0D',
  },
  tubeUnitTxtSm: {
    fontSize: 12,
    lineHeight: typeLh(12),
    fontFamily: FontFamily.medium,
    color: '#0D0D0D',
  },
  tubeUnitTxtOn: {
    color: '#FFFFFF',
  },
  stockRowInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  chipsVolRow: {
    flexWrap: 'nowrap',
    justifyContent: 'space-between',
    gap: 4,
  },
  chipVolRowCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  chipVolSmaller: {
    paddingHorizontal: 5,
    paddingVertical: 8,
    borderRadius: 10,
  },
  chipVolTxtCenter: {
    width: '100%',
    textAlign: 'center',
  },
  chipVolTxtSmaller: {
    fontSize: 12,
    lineHeight: typeLh(12),
  },
  chipVolTxtOnSmaller: {
    fontSize: 12,
    lineHeight: typeLh(12),
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
  deleteProductBtn: {
    marginTop: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteProductTxt: {
    fontFamily: FontFamily.semibold,
    fontSize: 15,
    color: '#C62828',
  },
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
