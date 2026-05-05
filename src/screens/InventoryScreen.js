import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet, apiPost } from '../api/client';
import { useCurrency } from '../context/CurrencyContext';
import { formatMinorFromStoredCents } from '../format/moneyDisplay';
import { FontFamily } from '../theme/fonts';
import { Type, typeLh } from '../theme/typography';
import SFIcon from '../components/SFIcon';
import {
  displayStockUnit,
  importCategoryForItem,
  inventoryCategoryKey,
  isColorItem,
} from '../inventory/inventoryCategories';
import { MY_LAB_VIOLET } from '../theme/glassUi';
import { hapticImpactLight } from '../theme/haptics';
import LowStockHeaderPill from '../components/LowStockHeaderPill';

const IMAGE_MEDIA_TYPES = ImagePicker.MediaType?.Images ? [ImagePicker.MediaType.Images] : ['images'];
const ORDER = ['dye', 'oxidant', 'retail', 'consumable'];
const BRAND_ACCENT = '#6B4EFF';

const LABEL = {
  dye: 'Color',
  oxidant: 'Developer',
  retail: 'Retail',
  consumable: 'Consumables',
};

const STOCK_CATEGORY_OPTIONS = [
  { key: 'dye', label: 'Color' },
  { key: 'oxidant', label: 'Developer' },
  { key: 'mixtone', label: 'Mixtone' },
  { key: 'toner', label: 'Toner' },
  { key: 'consumable', label: 'Consumables' },
];

const RETAIL_CATEGORY_OPTIONS = [
  { key: 'shampoo', label: 'Shampoo' },
  { key: 'conditioner', label: 'Conditioner' },
  { key: 'mask', label: 'Mask' },
  { key: 'serum', label: 'Serum' },
  { key: 'styling', label: 'Styling' },
  { key: 'treatment', label: 'Treatment' },
  { key: 'scalp', label: 'Scalp' },
  { key: 'color_care', label: 'Color Care' },
  { key: 'other_retail', label: 'Other' },
];

const INVENTORY_FILTERS = [
  {
    key: 'stock',
    label: 'Stock',
    icon: 'swap-vertical-outline',
    iosIcon: 'plusminus.circle.fill',
    addCategory: 'consumable',
  },
  {
    key: 'retail',
    label: 'Retail',
    icon: 'water-outline',
    iosIcon: 'waterbottle.fill',
    addCategory: 'retail',
  },
  {
    key: 'colors',
    label: 'Colors',
    icon: 'color-wand-outline',
    iosIcon: 'paintpalette.fill',
    addCategory: 'dye',
  },
  {
    key: 'developer',
    label: 'Developer',
    icon: 'flask-outline',
    iosIcon: 'flask.fill',
    addCategory: 'oxidant',
  },
];

function isRetailItem(item) {
  return inventoryCategoryKey(item?.category) === 'retail';
}

function isOxidantItem(item) {
  return inventoryCategoryKey(item?.category) === 'oxidant';
}

function sectionTitle(cat) {
  if (LABEL[cat]) return LABEL[cat];
  const s = String(cat).replace(/_/g, ' ');
  return s.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Colors tab: same ammonia split as developer; mixtone/toner separate. */
function colorTabGroupKey(item) {
  const c = inventoryCategoryKey(item?.category);
  if (c === 'mixtone') return 'mixtone';
  if (c === 'toner') return 'toner';
  if (c === 'dye') {
    const sub = String(item?.custom_subcategory || '').trim().toLowerCase();
    if (sub === 'ammonia') return 'dye_ammonia';
    if (sub === 'non-ammonia') return 'dye_non_ammonia';
    return 'dye_other';
  }
  return 'dye_other';
}

const COLOR_TAB_SECTION_ORDER = ['dye_ammonia', 'dye_non_ammonia', 'dye_other', 'mixtone', 'toner'];

function colorTabSectionTitle(key) {
  switch (key) {
    case 'dye_ammonia':
      return 'Ammonia';
    case 'dye_non_ammonia':
      return 'Non-ammonia';
    case 'dye_other':
      return 'Color';
    case 'mixtone':
      return 'Mixtone';
    case 'toner':
      return 'Toner';
    default:
      return sectionTitle(key);
  }
}

/** Value sent to clear-subcategory API for this list section, or null. */
function sectionSubcategoryClearLabel(inventoryFilter, sectionKey, useSubcategoryGrouping) {
  if (sectionKey === '_all') return null;
  if (inventoryFilter === 'colors') {
    if (sectionKey === 'dye_ammonia') return 'Ammonia';
    if (sectionKey === 'dye_non_ammonia') return 'Non-ammonia';
    return null;
  }
  if (useSubcategoryGrouping) return sectionKey;
  return null;
}

/** BGR queries often don’t match Latin product names — map to EN/category needles. */
const SEARCH_NEEDLE_ALIASES = {
  // Avoid 'color/colour/colors': they match unrelated retail/consumables ("Colour care" etc.).
  боя: ['dye', 'colorant', 'tint'],
  бои: ['dye', 'colorant'],
  боичка: ['dye', 'tint'],
  боички: ['dye', 'dyes'],
  цвят: ['shade', 'dye'],
  окиснител: ['oxidant', 'developer', 'oxydant'],
  оксид: ['oxidant', 'developer'],
  оксидант: ['oxidant', 'developer'],
  тонер: ['toner'],
  микстон: ['mixtone'],
  микстони: ['mixtone'],
};

function normalizedSearchTokens(query) {
  const raw = String(query || '')
    .normalize('NFC')
    .trim()
    .toLowerCase();
  if (!raw) return [];
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts.length ? parts : [raw];
}

function needlesForToken(token) {
  const t = String(token || '')
    .normalize('NFC')
    .trim()
    .toLowerCase();
  if (!t) return [];
  const set = new Set([t]);
  const extra = SEARCH_NEEDLE_ALIASES[t];
  if (extra) {
    for (const e of extra) {
      const n = String(e).normalize('NFC').trim().toLowerCase();
      if (n) set.add(n);
    }
  }
  const out = [...set];
  return out.filter((needle) => {
    if (!needle) return false;
    if (/[\u0370-\u04FF\u2000-\u2BFF]/u.test(needle)) return true;
    if (/^\d+$/.test(needle)) return true;
    if (needle.length < 2) return false;
    return true;
  });
}

/** When typing a query: search ALL inventory (tabs only filter idle list). */
function itemMatchesInventorySearch(item, queryRaw) {
  const tokens = normalizedSearchTokens(queryRaw);
  if (!tokens.length) return false;

  const ck = inventoryCategoryKey(item?.category);
  const hayStrings = [
    item?.name,
    item?.brand,
    item?.shade_code,
    item?.package_size,
    item?.supplier_hint,
    item?.category,
    ck,
    LABEL[ck],
    sectionTitle(ck),
    isRetailItem(item) ? 'retail' : '',
  ]
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) =>
      String(x)
        .normalize('NFC')
        .trim()
        .toLowerCase(),
    );

  return tokens.every((token) => {
    const needles = needlesForToken(token);
    if (!needles.length) return false;
    return needles.some(
      (needle) => needle.length > 0 && hayStrings.some((hay) => hay.includes(needle)),
    );
  });
}

function inventoryAccentForItem(item) {
  if (isRetailItem(item)) return '#34D399';
  if (isColorItem(item)) return '#C084FC';
  return '#60A5FA';
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

function invoiceRowsFromItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => {
      const category = importCategoryForItem(item);
      const name = String(item?.name || '').trim().toLowerCase();
      const autoRetailSub = RETAIL_CATEGORY_OPTIONS.find(o => name.includes(o.key) || name.includes(o.label.toLowerCase()))?.key || '';
      return {
        key: `${Date.now()}-${index}`,
        name: String(item?.name || '').trim(),
        category,
        stockCategory: category === 'retail' ? 'consumable' : category,
        addingCategory: false,
        categoryDraft: '',
        retailSubcategory: category === 'retail' ? autoRetailSub : '',
        brand: item?.brand || '',
        shade_code: item?.shade_code || '',
        package_size: item?.package_size || '',
        unit: item?.unit || 'pcs',
        quantity: String(item?.quantity || ''),
        price: priceTextFromCents(item?.price_per_unit_cents),
        supplier_hint: item?.supplier_hint || '',
      };
    })
    .filter((item) => item.name && item.quantity);
}

export default function InventoryScreen({ navigation, route }) {
  const { currency } = useCurrency();
  const pendingOpenLowStockRef = useRef(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importBusy, setImportBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [savingImport, setSavingImport] = useState(false);
  const [inventoryFilter, setInventoryFilter] = useState('stock');
  const [activeSubcategory, setActiveSubcategory] = useState(null); // null = All
  /** Colors tab: filter dye sections by formula type (matches developer pills). */
  const [activeColorPill, setActiveColorPill] = useState(null); // null | 'ammonia' | 'non-ammonia'
  const [lowListOpen, setLowListOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [inventorySearchOpen, setInventorySearchOpen] = useState(false);
  const [inventorySearchQ, setInventorySearchQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiGet('/api/inventory');
      setRows(Array.isArray(r) ? r : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (route.params?.openLowStock) {
        pendingOpenLowStockRef.current = true;
        navigation.setParams({ openLowStock: undefined });
      }
      load();
    }, [load, navigation, route.params?.openLowStock]),
  );

  const filteredRows = useMemo(() => {
    if (inventoryFilter === 'retail') return rows.filter(isRetailItem);
    if (inventoryFilter === 'developer') return rows.filter(isOxidantItem);
    if (inventoryFilter === 'colors') return rows.filter(
      (item) => isColorItem(item) && !isOxidantItem(item),
    );
    // stock: everything that's not retail, not color (dye/toner/mixtone), not oxidant
    return rows.filter(
      (item) => !isRetailItem(item) && !isColorItem(item) && !isOxidantItem(item),
    );
  }, [inventoryFilter, rows]);

  const inventorySearchNorm = inventorySearchQ.normalize('NFC').trim();

  const searchFilteredRows = useMemo(() => {
    if (!inventorySearchNorm) return filteredRows;
    return rows.filter((item) => itemMatchesInventorySearch(item, inventorySearchNorm));
  }, [rows, filteredRows, inventorySearchNorm]);

  const useSubcategoryGrouping = inventoryFilter === 'stock' || inventoryFilter === 'retail' || inventoryFilter === 'developer';

  // All unique subcategories present in the current filtered set (for pill row)
  const availableSubcategories = useMemo(() => {
    if (!useSubcategoryGrouping) return [];
    const seen = new Set();
    for (const item of filteredRows) {
      const s = item.custom_subcategory?.trim();
      if (s) seen.add(s);
    }
    let list = [...seen].sort((a, b) => a.localeCompare(b));
    if (inventoryFilter === 'retail' || inventoryFilter === 'stock') {
      list = list.filter((s) => {
        const t = String(s).trim().toLowerCase();
        return t !== 'ammonia' && t !== 'non-ammonia';
      });
    }
    return list;
  }, [filteredRows, useSubcategoryGrouping, inventoryFilter]);

  // Apply subcategory pill filter on top of the tab filter
  const subcategoryFilteredRows = useMemo(() => {
    if (!useSubcategoryGrouping || !activeSubcategory) return searchFilteredRows;
    return searchFilteredRows.filter(
      (item) => (item.custom_subcategory?.trim() || null) === activeSubcategory,
    );
  }, [searchFilteredRows, useSubcategoryGrouping, activeSubcategory]);

  const rowsForGrouping = useMemo(() => {
    if (inventoryFilter !== 'colors') return subcategoryFilteredRows;
    if (!activeColorPill) return searchFilteredRows;
    return searchFilteredRows.filter((item) => {
      const k = colorTabGroupKey(item);
      if (activeColorPill === 'ammonia') return k === 'dye_ammonia';
      if (activeColorPill === 'non-ammonia') return k === 'dye_non_ammonia';
      return true;
    });
  }, [inventoryFilter, subcategoryFilteredRows, searchFilteredRows, activeColorPill]);

  const grouped = useMemo(() => {
    const m = {};
    for (const item of rowsForGrouping) {
      let key;
      if (inventoryFilter === 'colors') {
        key = colorTabGroupKey(item);
      } else if (useSubcategoryGrouping) {
        key = item.custom_subcategory?.trim() || '_all';
      } else {
        key = inventoryCategoryKey(item.category);
      }
      if (!m[key]) m[key] = [];
      m[key].push(item);
    }
    return m;
  }, [rowsForGrouping, useSubcategoryGrouping, inventoryFilter]);

  const sectionKeys = useMemo(() => {
    if (inventoryFilter === 'colors') {
      const keys = Object.keys(grouped);
      const ordered = COLOR_TAB_SECTION_ORDER.filter((k) => grouped[k]?.length);
      const rest = keys.filter((k) => !COLOR_TAB_SECTION_ORDER.includes(k)).sort((a, b) =>
        a.localeCompare(b),
      );
      return [...ordered, ...rest];
    }
    if (useSubcategoryGrouping) {
      // Named subcategories first (alphabetical), then uncategorised ('_all') last
      const keys = Object.keys(grouped);
      return [
        ...keys.filter((k) => k !== '_all').sort((a, b) => a.localeCompare(b)),
        ...keys.filter((k) => k === '_all'),
      ];
    }
    const keys = Object.keys(grouped);
    const preset = ORDER.filter((k) => grouped[k]?.length);
    const rest = keys.filter((k) => !ORDER.includes(k)).sort((a, b) => a.localeCompare(b));
    return [...preset, ...rest];
  }, [grouped, useSubcategoryGrouping, inventoryFilter]);

  const lowCount = rows.filter((r) => r.is_low_stock).length;

  const lowStockItems = useMemo(() => rows.filter((r) => r.is_low_stock), [rows]);

  useEffect(() => {
    if (!pendingOpenLowStockRef.current || loading) return;
    pendingOpenLowStockRef.current = false;
    if (lowStockItems.length === 0) return;
    setLowListOpen(true);
  }, [loading, lowStockItems, navigation]);

  useEffect(() => {
    if (inventorySearchNorm) setActiveColorPill(null);
  }, [inventorySearchNorm]);

  const onRefresh = useCallback(async () => {
    // Micro-interaction: pull to refresh uses a purple spinner instead of a default gray one.
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onLowBadgePress = useCallback(() => {
    if (lowStockItems.length === 0) return;
    hapticImpactLight();
    setLowListOpen(true);
  }, [lowStockItems]);

  const promptClearSubcategory = useCallback(
    (label, categoryScope) => {
      if (!label) return;
      Alert.alert('', 'Remove label from all products in this group?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiPost('/api/inventory/clear-subcategory', {
                subcategory: label,
                ...(categoryScope ? { category: categoryScope } : {}),
              });
              setActiveSubcategory(null);
              setActiveColorPill(null);
              await load();
            } catch (e) {
              Alert.alert('', e.message || '');
            }
          },
        },
      ]);
    },
    [load],
  );

  const updatePreviewRow = (key, patch) => {
    setPreviewRows((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const removePreviewRow = (key) => {
    setPreviewRows((items) => items.filter((item) => item.key !== key));
  };

  const savePreviewCategory = (key) => {
    setPreviewRows((items) =>
      items.map((item) => {
        if (item.key !== key) return item;
        const nextCategory = String(item.categoryDraft || '').trim();
        if (!nextCategory) return { ...item, addingCategory: false, categoryDraft: '' };
        return {
          ...item,
          category: nextCategory,
          stockCategory: nextCategory,
          addingCategory: false,
          categoryDraft: '',
        };
      }),
    );
  };

  const importInvoiceViaR2 = async (localUri, contentType) => {
    const presign = await apiPost(
      '/api/inventory/import/invoice/presign',
      { content_type: contentType },
      { queueOffline: false },
    );
    const uploadUrl = presign?.uploadUrl;
    const key = presign?.key;
    const ct = presign?.contentType ?? contentType;
    if (!uploadUrl || !key) {
      throw new Error('bad_request');
    }
    const up = await FileSystem.uploadAsync(uploadUrl, localUri, {
      httpMethod: 'PUT',
      headers: { 'Content-Type': ct },
    });
    const st = typeof up.status === 'number' ? up.status : 0;
    if (st < 200 || st >= 300) {
      throw new Error('upload_failed');
    }
    return apiPost('/api/inventory/import/invoice', { import_key: key }, { queueOffline: false });
  };

  const humanizeInvoiceError = (msg) => {
    const m = String(msg || '').trim();
    if (m === 'pdf_no_extractable_text') return 'No selectable text in this PDF.';
    if (m === 'pdf_invalid') return 'Could not open this PDF.';
    if (m === 'ocr_failed') return 'Could not read this invoice.';
    if (m === 'missing_ocr_key') return 'Import is not available on this server.';
    if (m === 'import_key_required' || m === 'bad_request') return 'Something went wrong. Try again.';
    if (m === 'r2_unconfigured')
      return 'File storage is not configured. Check server environment variables.';
    if (m === 'import_not_found' || m === 'bad_import_key') return 'Upload expired. Try again.';
    if (m === 'upload_failed') return 'Upload failed.';
    if (m === 'not_found') return 'Inventory import is not available on this server yet.';
    return m || 'Import failed';
  };

  const applyInvoiceResponse = async (data) => {
    const parsed = invoiceRowsFromItems(data?.items);
    if (!parsed.length) {
      Alert.alert('', 'No products found.');
      return;
    }
    setPreviewRows(parsed);
    setPreviewOpen(true);
  };

  const importInvoiceFromCamera = async () => {
    if (importBusy) return;
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('', 'Camera access');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: IMAGE_MEDIA_TYPES,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const contentType =
        asset.mimeType && asset.mimeType.startsWith('image/') ? asset.mimeType : 'image/jpeg';
      if (!asset.uri) {
        Alert.alert('', 'Image');
        return;
      }
      setImportBusy(true);
      const data = await importInvoiceViaR2(asset.uri, contentType);
      await applyInvoiceResponse(data);
    } catch (e) {
      Alert.alert('', humanizeInvoiceError(e?.message));
    } finally {
      setImportBusy(false);
    }
  };

  const importInvoiceFromPhotoLibrary = async () => {
    if (importBusy) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('', 'Photo library access');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: IMAGE_MEDIA_TYPES,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const contentType =
        asset.mimeType && asset.mimeType.startsWith('image/') ? asset.mimeType : 'image/jpeg';
      if (!asset.uri) {
        Alert.alert('', 'Image');
        return;
      }
      setImportBusy(true);
      const data = await importInvoiceViaR2(asset.uri, contentType);
      await applyInvoiceResponse(data);
    } catch (e) {
      Alert.alert('', humanizeInvoiceError(e?.message));
    } finally {
      setImportBusy(false);
    }
  };

  const importInvoiceFromPdf = async () => {
    if (importBusy) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      const uri = file.uri;
      if (!uri) {
        Alert.alert('', 'PDF');
        return;
      }
      const mime =
        typeof file.mimeType === 'string' && file.mimeType.toLowerCase().includes('pdf')
          ? 'application/pdf'
          : 'application/pdf';
      setImportBusy(true);
      const data = await importInvoiceViaR2(uri, mime);
      await applyInvoiceResponse(data);
    } catch (e) {
      Alert.alert('', humanizeInvoiceError(e?.message));
    } finally {
      setImportBusy(false);
    }
  };

  const openImportInvoiceMenu = () => {
    if (importBusy) return;
    Alert.alert('', undefined, [
      { text: 'Photos', onPress: () => importInvoiceFromPhotoLibrary() },
      { text: 'PDF', onPress: () => importInvoiceFromPdf() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const saveInvoiceImport = async () => {
    const items = previewRows
      .map((item) => ({
        name: item.name.trim(),
        category: item.category || 'dye',
        brand: item.brand || null,
        shade_code: item.shade_code || null,
        package_size: item.package_size || null,
        unit: item.category === 'oxidant' ? 'pcs' : (item.unit || 'pcs'),
        quantity: Number(String(item.quantity).replace(',', '.')),
        price_per_unit_cents: centsFromPriceText(item.price),
        supplier_hint: item.supplier_hint || null,
      }))
      .filter((item) => item.name && Number.isFinite(item.quantity) && item.quantity > 0);
    if (!items.length || savingImport) return;
    setSavingImport(true);
    try {
      await apiPost('/api/inventory/import/bulk', { items }, { queueOffline: false });
      setPreviewOpen(false);
      setPreviewRows([]);
      await load();
    } catch (e) {
      Alert.alert('', e.message || 'Save failed');
    } finally {
      setSavingImport(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        {inventorySearchOpen ? (
          <View style={styles.headerSearchRow}>
            <Ionicons name="search-outline" size={18} color="#AEAEB2" style={styles.headerSearchLeadIcon} />
            <TextInput
              value={inventorySearchQ}
              onChangeText={setInventorySearchQ}
              style={styles.headerSearchInput}
              placeholder=""
              placeholderTextColor="#AEAEB2"
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel="Search inventory"
            />
            {inventorySearchQ.length > 0 ? (
              <TouchableOpacity
                onPress={() => setInventorySearchQ('')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Clear"
              >
                <Ionicons name="close-circle-outline" size={20} color={MY_LAB_VIOLET} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => {
                setInventorySearchOpen(false);
                setInventorySearchQ('');
              }}
              hitSlop={10}
              style={styles.headerSearchCloseBtn}
              accessibilityRole="button"
              accessibilityLabel="Close search"
            >
              <Ionicons name="close" size={22} color="#0D0D0D" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.headerTopRow}>
            <View style={styles.headerTitles}>
              <Text style={styles.title}>Inventory</Text>
              <Text style={styles.subtitle}>Add stock from a photo or invoice</Text>
            </View>
            <View style={styles.headerRightCluster}>
              <LowStockHeaderPill count={lowCount} onPress={onLowBadgePress} />
              <TouchableOpacity
                style={styles.headerSearchOpenBtn}
                onPress={() => setInventorySearchOpen(true)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Search"
              >
                <Ionicons name="search-outline" size={22} color="#0D0D0D" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View style={styles.importSection}>
        <View style={styles.importRow}>
          <TouchableOpacity
            style={[styles.importBtnCamera, importBusy && styles.importBtnDisabled]}
            onPress={() => importInvoiceFromCamera()}
            disabled={importBusy}
            activeOpacity={0.6}
          >
            <Ionicons name="add" size={14} color={MY_LAB_VIOLET} />
            <Ionicons name="camera-outline" size={14} color="#0D0D0D" />
            <Text style={styles.importBtnLabelSecondary}>Camera</Text>
          </TouchableOpacity>

          <View style={styles.importDivider} />

          <TouchableOpacity
            style={[styles.importBtnInvoice, importBusy && styles.importBtnDisabled]}
            onPress={() => openImportInvoiceMenu()}
            disabled={importBusy}
            activeOpacity={0.6}
          >
            {importBusy ? (
              <ActivityIndicator color={MY_LAB_VIOLET} size="small" />
            ) : (
              <>
                <Ionicons name="add" size={14} color={MY_LAB_VIOLET} />
                <Ionicons name="document-text-outline" size={14} color={MY_LAB_VIOLET} />
                <Text style={styles.importBtnLabelPrimary}>Import invoice</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.filterRow}>
        {INVENTORY_FILTERS.map((option) => {
          const selected = inventoryFilter === option.key;
          return (
            <TouchableOpacity
              key={option.key}
              style={[styles.filterCard, selected && styles.filterCardOn]}
              onPress={() => {
                setInventoryFilter(option.key);
                setActiveSubcategory(null);
                setActiveColorPill(null);
              }}
              activeOpacity={0.86}
            >
              <TouchableOpacity
                style={styles.filterAddBtn}
                onPress={() =>
                  navigation.navigate('InventoryItem', {
                    initialCategory: option.addCategory,
                    categoryMode: option.key === 'colors' ? 'colors' : 'general',
                  })
                }
                activeOpacity={0.85}
                hitSlop={6}
              >
                <Ionicons name="add" size={16} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={[styles.filterIconBubble, selected && styles.filterIconBubbleOn]}>
                <SFIcon
                  name={option.icon}
                  iosName={option.iosIcon}
                  size={20}
                  color={selected ? BRAND_ACCENT : '#0D0D0D'}
                  weight="semibold"
                />
              </View>
              <Text style={[styles.filterCardText, selected && styles.filterCardTextOn]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loaderFill}>
          {[0, 1, 2, 3].map((n) => (
            <View key={n} style={styles.skeletonCard}>
              <View style={styles.skeletonTitle} />
              <View style={styles.skeletonMeta} />
            </View>
          ))}
        </View>
      ) : (
        <ScrollView
          style={styles.scrollFill}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND_ACCENT} />
          }
        >
          {/* Subcategory filter pills — Stock and Retail tabs only */}
          {useSubcategoryGrouping && availableSubcategories.length > 0 && !inventorySearchNorm ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.subcatPillRow}
              style={styles.subcatPillScroll}
            >
              <TouchableOpacity
                style={[styles.subcatPill, !activeSubcategory && styles.subcatPillOn]}
                onPress={() => setActiveSubcategory(null)}
                activeOpacity={0.8}
              >
                <Text style={[styles.subcatPillTxt, !activeSubcategory && styles.subcatPillTxtOn]}>All</Text>
              </TouchableOpacity>
              {availableSubcategories.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.subcatPill, activeSubcategory === s && styles.subcatPillOn]}
                  onPress={() => setActiveSubcategory(activeSubcategory === s ? null : s)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.subcatPillTxt, activeSubcategory === s && styles.subcatPillTxtOn]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}

          {inventoryFilter === 'colors' && !inventorySearchNorm ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.subcatPillRow}
              style={styles.subcatPillScroll}
            >
              <TouchableOpacity
                style={[styles.subcatPill, !activeColorPill && styles.subcatPillOn]}
                onPress={() => setActiveColorPill(null)}
                activeOpacity={0.8}
              >
                <Text style={[styles.subcatPillTxt, !activeColorPill && styles.subcatPillTxtOn]}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.subcatPill, activeColorPill === 'ammonia' && styles.subcatPillOn]}
                onPress={() => setActiveColorPill(activeColorPill === 'ammonia' ? null : 'ammonia')}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.subcatPillTxt,
                    activeColorPill === 'ammonia' && styles.subcatPillTxtOn,
                  ]}
                >
                  Ammonia
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.subcatPill, activeColorPill === 'non-ammonia' && styles.subcatPillOn]}
                onPress={() =>
                  setActiveColorPill(activeColorPill === 'non-ammonia' ? null : 'non-ammonia')
                }
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.subcatPillTxt,
                    activeColorPill === 'non-ammonia' && styles.subcatPillTxtOn,
                  ]}
                >
                  Non-ammonia
                </Text>
              </TouchableOpacity>
            </ScrollView>
          ) : null}

          {sectionKeys.map((cat) => {
            const list = grouped[cat];
            if (!list?.length) return null;
            const showOtherBucketTitle =
              useSubcategoryGrouping &&
              cat === '_all' &&
              sectionKeys.some((k) => k !== '_all' && grouped[k]?.length);
            const sectionHeader =
              inventoryFilter === 'colors'
                ? colorTabSectionTitle(cat)
                : cat !== '_all'
                  ? useSubcategoryGrouping
                    ? cat
                    : sectionTitle(cat)
                  : showOtherBucketTitle
                    ? 'Other'
                    : null;
            const clearLabel = sectionSubcategoryClearLabel(
              inventoryFilter,
              cat,
              useSubcategoryGrouping,
            );
            const clearCategoryScope =
              inventoryFilter === 'colors' ? 'dye' : inventoryFilter === 'developer' ? 'oxidant' : null;
            return (
              <View key={cat} style={styles.section}>
                {sectionHeader ? (
                  <View style={styles.sectionTitleRow}>
                    <Text style={styles.sectionTitle}>{sectionHeader}</Text>
                    {clearLabel ? (
                      <TouchableOpacity
                        onPress={() => promptClearSubcategory(clearLabel, clearCategoryScope)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel="Remove label"
                      >
                        <Ionicons name="trash-outline" size={18} color="#8E8E93" />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
                {list.map((item) => {
                  const isRetail = item.category === 'retail';
                  const priceLine = isRetail && item.sell_price_cents != null
                    ? formatMinorFromStoredCents(item.sell_price_cents, currency)
                    : item.price_per_unit_cents != null
                      ? formatMinorFromStoredCents(item.price_per_unit_cents, currency)
                      : null;
                  const marginPct = isRetail && item.sell_price_cents > 0 && item.price_per_unit_cents > 0
                    ? Math.round((item.sell_price_cents - item.price_per_unit_cents) / item.sell_price_cents * 100)
                    : null;
                  const truncName = item.name.length > 20 ? item.name.slice(0, 20) + '…' : item.name;
                  const qtyBit = `${item.quantity} ${displayStockUnit(item)}`;
                  const pkgShow = String(item.package_size || '').trim();
                  const nameQtyLine = [truncName, ...(pkgShow ? [pkgShow] : []), qtyBit].join('  ·  ');
                  const shadeShow = String(item.shade_code || '').trim();
                  const brandMeta = String(item.brand || '').trim();
                  const catKey = inventoryCategoryKey(item.category);
                  const showBigShade = Boolean(
                    shadeShow && (catKey === 'dye' || catKey === 'mixtone' || catKey === 'toner'),
                  );
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.row}
                      activeOpacity={0.78}
                      onPress={() => {
                        hapticImpactLight();
                        navigation.navigate('InventoryItem', { itemId: item.id });
                      }}
                    >
                      <View style={styles.rowMain}>
                        {showBigShade ? (
                          <View style={styles.rowColorTop}>
                            <Text style={styles.rowShadeCodeLarge} numberOfLines={1}>
                              {shadeShow}
                            </Text>
                            <View style={styles.rowColorTopRest}>
                              <Text style={styles.rowLine} numberOfLines={1}>
                                {nameQtyLine}
                              </Text>
                            </View>
                          </View>
                        ) : (
                          <Text style={styles.rowLine} numberOfLines={1}>
                            {nameQtyLine}
                          </Text>
                        )}
                        {brandMeta ? (
                          <Text style={styles.rowMeta} numberOfLines={1}>{brandMeta}</Text>
                        ) : null}
                      </View>
                      {priceLine != null || marginPct != null ? (
                        <View style={styles.rowTail}>
                          {priceLine != null ? (
                            <Text style={styles.rowPriceTail} numberOfLines={1}>
                              {'\u00B7 '}
                              {priceLine}
                            </Text>
                          ) : null}
                          {marginPct != null ? (
                            <Text
                              style={[
                                styles.rowMarginPct,
                                marginPct >= 0 ? styles.rowMarginPctPositive : styles.rowMarginPctNegative,
                              ]}
                              numberOfLines={1}
                            >
                              {marginPct}%
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}

          {!sectionKeys.length ? (
            <View style={styles.emptyState}>
              {inventorySearchNorm && rows.length > 0 ? (
                <>
                  <View style={styles.emptyIllustration}>
                    <Ionicons name="search-outline" size={30} color={BRAND_ACCENT} />
                  </View>
                  <Text style={styles.emptyTitleMuted}>—</Text>
                </>
              ) : (
                <>
                  <View style={styles.emptyIllustration}>
                    <Ionicons name="cube-outline" size={34} color={BRAND_ACCENT} />
                  </View>
                  <Text style={styles.emptyTitle}>
                    No items in{' '}
                    {INVENTORY_FILTERS.find((f) => f.key === inventoryFilter)?.label || 'Stock'}
                  </Text>
                  <TouchableOpacity
                    style={styles.emptyCta}
                    onPress={openImportInvoiceMenu}
                    activeOpacity={0.86}
                  >
                    <Text style={styles.emptyCtaText}>Import invoice</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : null}

          <View style={{ height: 130 }} />
        </ScrollView>
      )}
      <Modal visible={previewOpen} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Invoice</Text>
              <TouchableOpacity
                onPress={() => {
                  setPreviewOpen(false);
                  setPreviewRows([]);
                }}
              >
                <Text style={styles.modalClose}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              contentContainerStyle={styles.previewContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {previewRows.map((item) => {
                const qty = Number(String(item.quantity).replace(',', '.'));
                const price = centsFromPriceText(item.price);
                const total = Number.isFinite(qty) && price != null ? Math.round(qty * price) : null;
                const isRetail = item.category === 'retail';
                return (
                  <View key={item.key} style={styles.previewCard}>
                    <View style={styles.previewTopRow}>
                      <TextInput
                        style={[styles.previewInput, styles.previewNameInput]}
                        value={item.name}
                        onChangeText={(text) => updatePreviewRow(item.key, { name: text })}
                        placeholder=""
                        placeholderTextColor="#1C1C1E"
                      />
                      <TouchableOpacity onPress={() => removePreviewRow(item.key)} hitSlop={8}>
                        <Ionicons name="close-circle-outline" size={22} color={MY_LAB_VIOLET} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.previewChoiceRow}>
                      <TouchableOpacity
                        style={styles.previewCheckChoice}
                        onPress={() =>
                          updatePreviewRow(item.key, {
                            category: 'consumable',
                            stockCategory: 'consumable',
                          })
                        }
                        activeOpacity={0.85}
                      >
                        <Ionicons
                          name={!isRetail ? 'checkbox' : 'square-outline'}
                          size={19}
                          color="#5E35B1"
                        />
                        <Text style={styles.previewChoiceText}>Stock</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.previewCheckChoice}
                        onPress={() =>
                          updatePreviewRow(item.key, {
                            stockCategory: item.category === 'retail' ? item.stockCategory : item.category,
                            category: 'retail',
                          })
                        }
                        activeOpacity={0.85}
                      >
                        <Ionicons
                          name={isRetail ? 'checkbox' : 'square-outline'}
                          size={19}
                          color="#5E35B1"
                        />
                        <Text style={styles.previewChoiceText}>Retail</Text>
                      </TouchableOpacity>
                    </View>
                    {!isRetail ? (
                      <View style={styles.previewCategoryDropdownRow}>
                        <Text style={styles.previewCategoryLabel}>Category</Text>
                        <View style={styles.previewDropdownWrap}>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                            {STOCK_CATEGORY_OPTIONS.map((option) => {
                              const selected = item.category === option.key;
                              return (
                                <TouchableOpacity
                                  key={option.key}
                                  style={[styles.previewCategoryChip, selected && styles.previewCategoryChipOn]}
                                  onPress={() => updatePreviewRow(item.key, { category: option.key, stockCategory: option.key })}
                                  activeOpacity={0.85}
                                >
                                  <Text style={[styles.previewCategoryText, selected && styles.previewCategoryTextOn]}>
                                    {option.label}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </ScrollView>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.previewCategoryDropdownRow}>
                        <Text style={styles.previewCategoryLabel}>Type</Text>
                        <View style={styles.previewDropdownWrap}>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                            {RETAIL_CATEGORY_OPTIONS.map((option) => {
                              const selected = item.retailSubcategory === option.key;
                              return (
                                <TouchableOpacity
                                  key={option.key}
                                  style={[styles.previewCategoryChip, selected && styles.previewCategoryChipOn]}
                                  onPress={() => updatePreviewRow(item.key, { retailSubcategory: option.key })}
                                  activeOpacity={0.85}
                                >
                                  <Text style={[styles.previewCategoryText, selected && styles.previewCategoryTextOn]}>
                                    {option.label}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </ScrollView>
                        </View>
                      </View>
                    )}
                    <View style={styles.previewBottomRow}>
                      <TextInput
                        style={[styles.previewInput, styles.previewSmallInput]}
                        value={item.quantity}
                        onChangeText={(text) => updatePreviewRow(item.key, { quantity: text })}
                        placeholder=""
                        placeholderTextColor="#1C1C1E"
                        keyboardType="decimal-pad"
                      />
                      <Text style={styles.previewUnit}>{displayStockUnit(item)}</Text>
                      <TextInput
                        style={[styles.previewInput, styles.previewPriceInput]}
                        value={item.price}
                        onChangeText={(text) => updatePreviewRow(item.key, { price: text })}
                        placeholder=""
                        placeholderTextColor="#1C1C1E"
                        keyboardType="decimal-pad"
                      />
                      <Text style={styles.previewCurrency}>{currency}</Text>
                      <Text style={styles.previewTotal}>
                        {total != null ? formatMinorFromStoredCents(total, currency) : '—'}
                      </Text>
                    </View>
                  </View>
                );
              })}
              <TouchableOpacity
                style={[styles.saveImportBtn, savingImport && styles.importBtnDisabled]}
                onPress={saveInvoiceImport}
                disabled={savingImport}
                activeOpacity={0.9}
              >
                {savingImport ? <ActivityIndicator color="#fff" /> : <Text style={styles.importBtnText}>Save stock</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={lowListOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setLowListOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.lowModalBackdropHit} activeOpacity={1} onPress={() => setLowListOpen(false)} />
          <View style={[styles.modalSheet, styles.lowModalSheet]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Low stock</Text>
              <TouchableOpacity onPress={() => setLowListOpen(false)} hitSlop={10}>
                <Text style={styles.modalClose}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              contentContainerStyle={styles.lowPickList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {lowStockItems.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.lowPickRow}
                  onPress={() => {
                    hapticImpactLight();
                    setLowListOpen(false);
                    navigation.navigate('InventoryItem', { itemId: item.id });
                  }}
                  activeOpacity={0.85}
                >
                  <View style={styles.lowPickRowMain}>
                    <Text style={styles.lowPickName} numberOfLines={2}>{item.name}</Text>
                    <Text style={styles.lowPickMeta} numberOfLines={1}>
                      {[item.brand, item.shade_code, String(item.package_size || '').trim()]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </Text>
                  </View>
                  <Text style={styles.lowPickQty}>{item.quantity} {displayStockUnit(item)}</Text>
                  <Ionicons name="chevron-forward" size={20} color="#1C1C1E" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 28,
    backgroundColor: '#FFFFFF',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerTitles: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  headerRightCluster: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexShrink: 0,
    gap: 2,
  },
  headerSearchOpenBtn: {
    marginTop: 2,
    padding: 6,
  },
  headerSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,60,67,0.18)',
    paddingHorizontal: 10,
    backgroundColor: '#FFFFFF',
  },
  headerSearchLeadIcon: {
    marginRight: 6,
  },
  headerSearchInput: {
    flex: 1,
    minHeight: 40,
    paddingVertical: 8,
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.regular,
    color: '#0D0D0D',
    letterSpacing: -0.2,
  },
  headerSearchCloseBtn: {
    marginLeft: 4,
    padding: 4,
  },
  title: {
    ...Type.screenTitle,
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.regular,
    color: '#AEAEB2',
    letterSpacing: -0.2,
  },
  importSection: {
    paddingHorizontal: 24,
    paddingBottom: 28,
    backgroundColor: '#FFFFFF',
  },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,60,67,0.18)',
  },
  importDivider: {
    width: StyleSheet.hairlineWidth,
    height: 18,
    backgroundColor: 'rgba(60,60,67,0.22)',
  },
  importBtnCamera: {
    flex: 1,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  importBtnInvoice: {
    flex: 1.55,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  importBtnDisabled: { opacity: 0.45 },
  importBtnLabelSecondary: {
    color: '#0D0D0D',
    fontFamily: FontFamily.medium,
    fontSize: 13,
    letterSpacing: -0.15,
  },
  importBtnLabelPrimary: {
    color: MY_LAB_VIOLET,
    fontFamily: FontFamily.semibold,
    fontSize: 13,
    letterSpacing: -0.15,
  },
  importBtnText: { color: '#fff', ...Type.buttonLabel },
  filterRow: {
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: '#FFFFFF',
  },
  filterCard: {
    flex: 1,
    minHeight: 96,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 12,
    position: 'relative',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  filterCardOn: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(107,78,255,0.32)',
    borderWidth: 1.5,
  },
  filterAddBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 29,
    height: 29,
    borderRadius: 14.5,
    backgroundColor: MY_LAB_VIOLET,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    shadowColor: MY_LAB_VIOLET,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 4,
  },
  filterIconBubble: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,60,67,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  filterIconBubbleOn: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(107,78,255,0.28)',
  },
  filterCardText: {
    fontSize: 13,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.medium,
    color: '#0D0D0D',
    letterSpacing: -0.18,
    textAlign: 'center',
  },
  filterCardTextOn: {
    color: BRAND_ACCENT,
  },
  scrollFill: { flex: 1, backgroundColor: '#FFFFFF' },
  loaderFill: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  skeletonCard: {
    height: 60,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(60,60,67,0.22)',
    marginBottom: 9,
    padding: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 8,
      },
      default: { elevation: 2 },
    }),
  },
  skeletonTitle: {
    width: '58%',
    height: 13,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  skeletonMeta: {
    width: '38%',
    height: 11,
    borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.04)',
    marginTop: 12,
  },
  scroll: { paddingHorizontal: 24, paddingBottom: 24, backgroundColor: '#FFFFFF' },
  subcatPillScroll: { flexGrow: 0, marginBottom: 12 },
  subcatPillRow: { paddingHorizontal: 24, gap: 8, flexDirection: 'row', alignItems: 'center' },
  subcatPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
  },
  subcatPillOn: {
    backgroundColor: '#0D0D0D',
    borderColor: '#0D0D0D',
  },
  subcatPillTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 13,
    color: '#0D0D0D',
  },
  subcatPillTxtOn: {
    color: '#FFFFFF',
  },
  section: { marginBottom: 22 },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    ...Type.sectionLabel,
    flex: 1,
    marginBottom: 0,
    color: '#0D0D0D',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.09,
    shadowRadius: 10,
    elevation: 4,
  },
  rowAccent: { display: 'none' },
  rowMain: { flex: 1, minWidth: 0, paddingRight: 10 },
  rowColorTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowShadeCodeLarge: {
    fontFamily: FontFamily.semibold,
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.6,
    color: '#0D0D0D',
    flexShrink: 0,
    minWidth: 40,
    fontVariant: ['tabular-nums'],
  },
  rowColorTopRest: {
    flex: 1,
    minWidth: 0,
  },
  rowTail: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexShrink: 0,
    gap: 14,
  },
  rowPriceTail: {
    fontFamily: FontFamily.semibold,
    fontSize: 14,
    color: '#0D0D0D',
    letterSpacing: -0.2,
    flexShrink: 0,
    textAlign: 'right',
  },
  rowLine: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
    color: '#0D0D0D',
    letterSpacing: -0.2,
  },
  rowName: { display: 'none' },
  rowMeta: {
    marginTop: 2,
    ...Type.secondary,
    fontSize: 12,
  },
  rowRight: { display: 'none' },
  rowPriceBlock: { display: 'none' },
  rowQtyRow: { display: 'none' },
  rowQty: { display: 'none' },
  rowQtyUnit: { display: 'none' },
  rowPrice: { display: 'none' },
  rowPriceUnit: { display: 'none' },
  rowPricePlaceholder: { display: 'none' },
  rowMargin: { display: 'none' },
  rowMarginPct: {
    fontFamily: FontFamily.semibold,
    fontSize: 13,
    letterSpacing: -0.2,
    flexShrink: 0,
  },
  rowMarginPctPositive: {
    color: '#2E7D32',
  },
  rowMarginPctNegative: {
    color: '#C62828',
  },
  chevronText: {
    fontSize: 20,
    lineHeight: typeLh(20),
    fontFamily: FontFamily.semibold,
    color: 'rgba(13,13,13,0.4)',
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 54,
    paddingBottom: 30,
  },
  emptyIllustration: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(107,78,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emptyTitle: {
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.medium,
    color: '#0D0D0D',
    marginBottom: 18,
    textAlign: 'center',
  },
  emptyTitleMuted: {
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.regular,
    color: '#C7C7CC',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyCta: {
    height: 48,
    borderRadius: 14,
    backgroundColor: BRAND_ACCENT,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCtaText: {
    color: '#FFFFFF',
    ...Type.buttonLabel,
    fontFamily: FontFamily.medium,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '78%',
    paddingBottom: 16,
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  modalTitle: {
    fontSize: 17,
    lineHeight: typeLh(17),
    fontFamily: FontFamily.regular,
    color: '#0D0D0D',
  },
  modalClose: {
    fontSize: 17,
    lineHeight: typeLh(17),
    fontFamily: FontFamily.regular,
    color: '#5E35B1',
  },
  lowModalBackdropHit: {
    flex: 1,
  },
  lowModalSheet: {
    maxHeight: '52%',
  },
  lowPickList: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 28,
  },
  lowPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  lowPickRowMain: { flex: 1, paddingRight: 10 },
  lowPickName: { ...Type.listPrimary, color: '#0D0D0D' },
  lowPickMeta: { marginTop: 4, ...Type.secondary, color: '#8A8A8E' },
  lowPickQty: {
    marginRight: 4,
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.semibold,
    color: '#C62828',
  },
  previewContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 160,
  },
  previewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
    elevation: 3,
  },
  previewTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  previewBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  previewChoiceRow: {
    flexDirection: 'row',
    gap: 18,
    marginBottom: 8,
  },
  previewCheckChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  previewChoiceText: {
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.semibold,
    color: '#5E35B1',
  },
  previewCategoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  previewCategoryDropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  previewCategoryLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    color: '#8A8A8E',
    width: 70,
  },
  previewDropdownWrap: {
    flex: 1,
    flexDirection: 'row',
  },
  previewCategoryChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  previewCategoryChipOn: {
    backgroundColor: '#1C1C1E',
    borderColor: '#1C1C1E',
  },
  previewCategoryText: {
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.medium,
    color: '#0D0D0D',
  },
  previewCategoryTextOn: { color: '#FFFFFF' },
  previewAddCategory: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  previewAddCategoryText: {
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.medium,
    color: MY_LAB_VIOLET,
  },
  previewNewCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  previewCategoryInput: { flex: 1 },
  previewCategoryDone: {
    borderRadius: 12,
    backgroundColor: '#5E35B1',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  previewCategoryDoneText: { color: '#FFFFFF', ...Type.buttonLabel },
  previewInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.regular,
    color: '#0D0D0D',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
    elevation: 3,
  },
  previewNameInput: { flex: 1 },
  previewSmallInput: { width: 70 },
  previewPriceInput: { width: 82 },
  previewUnit: {
    minWidth: 28,
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.regular,
    color: '#0D0D0D',
  },
  previewCurrency: {
    ...Type.secondary,
    fontFamily: FontFamily.semibold,
    color: '#5E35B1',
  },
  previewTotal: {
    flex: 1,
    textAlign: 'right',
    ...Type.secondary,
    fontFamily: FontFamily.semibold,
    color: '#5E35B1',
  },
  saveImportBtn: {
    marginTop: 16,
    backgroundColor: '#5E35B1',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
});
