import React, { useCallback, useMemo, useState } from 'react';
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
import * as FileSystem from 'expo-file-system';
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
  importCategoryForItem,
  inventoryCategoryKey,
  isColorItem,
} from '../inventory/inventoryCategories';
import { MY_LAB_VIOLET } from '../theme/glassUi';
import { hapticImpactLight } from '../theme/haptics';

const IMAGE_MEDIA_TYPES = ImagePicker.MediaType?.Images ? [ImagePicker.MediaType.Images] : ['images'];
const ORDER = ['dye', 'oxidant', 'retail', 'consumable'];
const BRAND_ACCENT = '#6B4EFF';
const LOW_STOCK_ORANGE = '#FF6B35';

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
    iosIcon: 'pencil.tip.crop.circle.badge.plus.fill',
    addCategory: 'dye',
  },
];

function isRetailItem(item) {
  return inventoryCategoryKey(item?.category) === 'retail';
}

function sectionTitle(cat) {
  if (LABEL[cat]) return LABEL[cat];
  const s = String(cat).replace(/_/g, ' ');
  return s.replace(/\b\w/g, (ch) => ch.toUpperCase());
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
      return {
        key: `${Date.now()}-${index}`,
        name: String(item?.name || '').trim(),
        category,
        stockCategory: category === 'retail' ? 'consumable' : category,
        addingCategory: false,
        categoryDraft: '',
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

export default function InventoryScreen({ navigation }) {
  const { currency } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importBusy, setImportBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [savingImport, setSavingImport] = useState(false);
  const [inventoryFilter, setInventoryFilter] = useState('stock');
  const [activeSubcategory, setActiveSubcategory] = useState(null); // null = All
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
      load();
    }, [load]),
  );

  const filteredRows = useMemo(() => {
    if (inventoryFilter === 'retail') return rows.filter(isRetailItem);
    if (inventoryFilter === 'colors') return rows.filter(isColorItem);
    return rows.filter((item) => !isRetailItem(item) && !isColorItem(item));
  }, [inventoryFilter, rows]);

  const inventorySearchNorm = inventorySearchQ.normalize('NFC').trim();

  const searchFilteredRows = useMemo(() => {
    if (!inventorySearchNorm) return filteredRows;
    return rows.filter((item) => itemMatchesInventorySearch(item, inventorySearchNorm));
  }, [rows, filteredRows, inventorySearchNorm]);

  const useSubcategoryGrouping = inventoryFilter === 'stock' || inventoryFilter === 'retail';

  // All unique subcategories present in the current filtered set (for pill row)
  const availableSubcategories = useMemo(() => {
    if (!useSubcategoryGrouping) return [];
    const seen = new Set();
    for (const item of filteredRows) {
      const s = item.custom_subcategory?.trim();
      if (s) seen.add(s);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [filteredRows, useSubcategoryGrouping]);

  // Apply subcategory pill filter on top of the tab filter
  const subcategoryFilteredRows = useMemo(() => {
    if (!useSubcategoryGrouping || !activeSubcategory) return searchFilteredRows;
    return searchFilteredRows.filter(
      (item) => (item.custom_subcategory?.trim() || null) === activeSubcategory,
    );
  }, [searchFilteredRows, useSubcategoryGrouping, activeSubcategory]);

  const grouped = useMemo(() => {
    const m = {};
    for (const item of subcategoryFilteredRows) {
      const key = useSubcategoryGrouping
        ? (item.custom_subcategory?.trim() || '_all')
        : inventoryCategoryKey(item.category);
      if (!m[key]) m[key] = [];
      m[key].push(item);
    }
    return m;
  }, [subcategoryFilteredRows, useSubcategoryGrouping]);

  const sectionKeys = useMemo(() => {
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
  }, [grouped, useSubcategoryGrouping]);

  const lowCount = rows.filter((r) => r.is_low_stock).length;

  const lowStockItems = useMemo(() => rows.filter((r) => r.is_low_stock), [rows]);
  const primaryLowStockItem = lowStockItems[0] || null;

  const onRefresh = useCallback(async () => {
    // Micro-interaction: pull to refresh uses a purple spinner instead of a default gray one.
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onLowBadgePress = useCallback(() => {
    if (lowStockItems.length === 0) return;
    hapticImpactLight();
    if (lowStockItems.length === 1) {
      navigation.navigate('InventoryItem', { itemId: lowStockItems[0].id });
      return;
    }
    setLowListOpen(true);
  }, [lowStockItems, navigation]);

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
        unit: item.unit || 'pcs',
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
                <Ionicons name="close-circle" size={20} color="#C7C7CC" />
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
              onPress={() => { setInventoryFilter(option.key); setActiveSubcategory(null); }}
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

          {primaryLowStockItem && !inventorySearchNorm ? (
            <TouchableOpacity
              style={styles.lowBanner}
              onPress={onLowBadgePress}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel="Low stock"
            >
              <View style={styles.lowBannerLeft}>
                <View style={styles.lowBannerDot} />
              </View>
              <View style={styles.lowBannerBody}>
                <Text style={styles.lowBannerName} numberOfLines={1}>
                  {[primaryLowStockItem.brand, primaryLowStockItem.name]
                    .filter(Boolean)
                    .join(' ') || primaryLowStockItem.name}
                </Text>
                {primaryLowStockItem.shade_code ? (
                  <Text style={styles.lowBannerShade} numberOfLines={1}>
                    {primaryLowStockItem.shade_code}
                    {primaryLowStockItem.package_size
                      ? `  ·  ${primaryLowStockItem.package_size}`
                      : ''}
                  </Text>
                ) : null}
              </View>
              <View style={styles.lowBannerRight}>
                <Text style={styles.lowBannerQtyNum}>
                  {primaryLowStockItem.quantity}
                </Text>
                <Text style={styles.lowBannerQtyUnit}>
                  {primaryLowStockItem.unit}
                </Text>
              </View>
              {lowCount > 1 ? (
                <View style={styles.lowBannerMore}>
                  <Text style={styles.lowBannerMoreText}>+{lowCount - 1}</Text>
                </View>
              ) : null}
              <Ionicons
                name="chevron-forward"
                size={13}
                color="rgba(204,68,0,0.45)"
                style={{ marginRight: 14 }}
              />
            </TouchableOpacity>
          ) : null}

          {sectionKeys.map((cat) => {
            const list = grouped[cat];
            if (!list?.length) return null;
            return (
              <View key={cat} style={styles.section}>
                {cat !== '_all' ? (
                  <Text style={styles.sectionTitle}>
                    {useSubcategoryGrouping ? cat : sectionTitle(cat)}
                  </Text>
                ) : null}
                {list.map((item) => {
                  const detailParts = [item.brand, item.shade_code, item.package_size].filter(Boolean);
                  const metaText = detailParts.join(' · ');
                  const isRetail = item.category === 'retail';
                  const costLine = item.price_per_unit_cents != null
                    ? formatMinorFromStoredCents(item.price_per_unit_cents, currency) : null;
                  const sellLine = item.sell_price_cents != null
                    ? formatMinorFromStoredCents(item.sell_price_cents, currency) : null;
                  const priceLine = isRetail ? sellLine : costLine;
                  const marginPct = isRetail && item.sell_price_cents > 0 && item.price_per_unit_cents > 0
                    ? Math.round((item.sell_price_cents - item.price_per_unit_cents) / item.sell_price_cents * 100)
                    : null;
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
                        <Text style={styles.rowName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        {metaText ? (
                          <Text style={styles.rowMeta} numberOfLines={1}>{metaText}</Text>
                        ) : null}
                      </View>
                      <View style={styles.rowRight}>
                        <View style={styles.rowPriceBlock}>
                          <View style={styles.rowQtyRow}>
                            <Text style={styles.rowQty}>{item.quantity}</Text>
                            <Text style={styles.rowQtyUnit}>{item.unit}</Text>
                          </View>
                          {priceLine ? (
                            <Text style={styles.rowPrice} numberOfLines={1}>{priceLine}</Text>
                          ) : null}
                          {marginPct != null ? (
                            <Text style={styles.rowMargin}>{marginPct}%</Text>
                          ) : null}
                        </View>
                        <SFIcon
                          name="chevron-forward"
                          iosName="chevron.right"
                          size={11}
                          color="rgba(13,13,13,0.22)"
                          weight="regular"
                        />
                      </View>
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
                        <Ionicons name="close-circle" size={22} color="#1C1C1E" />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.previewChoiceRow}>
                      <TouchableOpacity
                        style={styles.previewCheckChoice}
                        onPress={() =>
                          updatePreviewRow(item.key, {
                            category: item.stockCategory || 'consumable',
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
                      <>
                        <View style={styles.previewCategoryRow}>
                          {STOCK_CATEGORY_OPTIONS.map((option) => {
                            const selected = item.category === option.key;
                            return (
                              <TouchableOpacity
                                key={option.key}
                                style={[styles.previewCategoryChip, selected && styles.previewCategoryChipOn]}
                                onPress={() =>
                                  updatePreviewRow(item.key, {
                                    category: option.key,
                                    stockCategory: option.key,
                                    addingCategory: false,
                                    categoryDraft: '',
                                  })
                                }
                                activeOpacity={0.85}
                              >
                                <Text
                                  style={[
                                    styles.previewCategoryText,
                                    selected && styles.previewCategoryTextOn,
                                  ]}
                                >
                                  {option.label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                          {!STOCK_CATEGORY_OPTIONS.some((option) => option.key === item.category) ? (
                            <TouchableOpacity
                              style={[styles.previewCategoryChip, styles.previewCategoryChipOn]}
                              onPress={() =>
                                updatePreviewRow(item.key, {
                                  category: item.category,
                                  stockCategory: item.category,
                                  addingCategory: false,
                                  categoryDraft: '',
                                })
                              }
                              activeOpacity={0.85}
                            >
                              <Text style={[styles.previewCategoryText, styles.previewCategoryTextOn]}>
                                {sectionTitle(item.category)}
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                          <TouchableOpacity
                            style={styles.previewAddCategory}
                            onPress={() => updatePreviewRow(item.key, { addingCategory: true })}
                            activeOpacity={0.85}
                          >
                            <Ionicons name="add" size={16} color={MY_LAB_VIOLET} />
                            <Text style={styles.previewAddCategoryText}>Add new</Text>
                          </TouchableOpacity>
                        </View>
                        {item.addingCategory ? (
                          <View style={styles.previewNewCategoryRow}>
                            <TextInput
                              style={[styles.previewInput, styles.previewCategoryInput]}
                              value={item.categoryDraft}
                              onChangeText={(text) => updatePreviewRow(item.key, { categoryDraft: text })}
                              placeholder=""
                              placeholderTextColor="#1C1C1E"
                              returnKeyType="done"
                              onSubmitEditing={() => savePreviewCategory(item.key)}
                            />
                            <TouchableOpacity
                              style={styles.previewCategoryDone}
                              onPress={() => savePreviewCategory(item.key)}
                              activeOpacity={0.85}
                            >
                              <Text style={styles.previewCategoryDoneText}>Done</Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </>
                    ) : null}
                    <View style={styles.previewBottomRow}>
                      <TextInput
                        style={[styles.previewInput, styles.previewSmallInput]}
                        value={item.quantity}
                        onChangeText={(text) => updatePreviewRow(item.key, { quantity: text })}
                        placeholder=""
                        placeholderTextColor="#1C1C1E"
                        keyboardType="decimal-pad"
                      />
                      <Text style={styles.previewUnit}>{item.unit}</Text>
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
                      {[item.brand, item.shade_code].filter(Boolean).join(' · ') || '—'}
                    </Text>
                  </View>
                  <Text style={styles.lowPickQty}>{item.quantity} {item.unit}</Text>
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
    gap: 10,
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  filterCard: {
    flex: 1,
    minHeight: 96,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,60,67,0.14)',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 14,
    position: 'relative',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: {
        elevation: 3,
      },
      default: {},
    }),
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
    fontSize: 15,
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
  lowBanner: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.22)',
    ...Platform.select({
      ios: {
        shadowColor: LOW_STOCK_ORANGE,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  lowBannerLeft: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  lowBannerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: LOW_STOCK_ORANGE,
  },
  lowBannerBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  lowBannerName: {
    ...Type.listPrimary,
    letterSpacing: -0.15,
  },
  lowBannerShade: {
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.regular,
    color: LOW_STOCK_ORANGE,
    letterSpacing: 0.05,
  },
  lowBannerRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginRight: 10,
  },
  lowBannerQtyNum: {
    ...Type.price,
    color: '#0D0D0D',
    letterSpacing: -0.2,
  },
  lowBannerQtyUnit: {
    ...Type.tabBarLabel,
    lineHeight: typeLh(11),
    color: '#AEAEB2',
    letterSpacing: 0,
  },
  lowBannerMore: {
    marginRight: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(255,107,53,0.10)',
  },
  lowBannerMoreText: {
    ...Type.tabBarLabel,
    fontFamily: FontFamily.medium,
    lineHeight: typeLh(11),
    color: LOW_STOCK_ORANGE,
  },
  section: { marginBottom: 22 },
  sectionTitle: {
    ...Type.sectionLabel,
    marginBottom: 10,
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
  rowMain: { flex: 1, paddingRight: 10 },
  rowName: {
    ...Type.listPrimary,
    letterSpacing: -0.18,
    color: '#0D0D0D',
  },
  rowMeta: {
    marginTop: 2,
    ...Type.secondary,
    letterSpacing: -0.05,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowPriceBlock: { alignItems: 'flex-end' },
  rowQtyRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  rowQty: {
    fontFamily: FontFamily.semibold,
    fontSize: 15,
    color: '#0D0D0D',
    letterSpacing: -0.3,
  },
  rowQtyUnit: {
    fontFamily: FontFamily.regular,
    fontSize: 11,
    color: '#8A8A8E',
  },
  rowPrice: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    color: MY_LAB_VIOLET,
    letterSpacing: -0.1,
    marginTop: 1,
  },
  rowPriceUnit: { display: 'none' },
  rowPricePlaceholder: { display: 'none' },
  rowMargin: {
    fontFamily: FontFamily.semibold,
    fontSize: 11,
    color: '#00A86B',
    letterSpacing: -0.1,
    marginTop: 1,
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
