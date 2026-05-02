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
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet, apiPost } from '../api/client';
import { glassPurpleFabBar } from '../theme/glassUi';
import { useCurrency } from '../context/CurrencyContext';
import { formatMinorFromStoredCents } from '../format/moneyDisplay';
import SFIcon from '../components/SFIcon';
import {
  importCategoryForItem,
  inventoryCategoryKey,
  isColorItem,
} from '../inventory/inventoryCategories';

const IMAGE_MEDIA_TYPES = ImagePicker.MediaType?.Images ? [ImagePicker.MediaType.Images] : ['images'];
const ORDER = ['dye', 'oxidant', 'retail', 'consumable'];

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

  const grouped = useMemo(() => {
    const m = {};
    for (const item of filteredRows) {
      const key = inventoryCategoryKey(item.category);
      if (!m[key]) m[key] = [];
      m[key].push(item);
    }
    return m;
  }, [filteredRows]);

  const sectionKeys = useMemo(() => {
    const keys = Object.keys(grouped);
    const preset = ORDER.filter((k) => grouped[k]?.length);
    const rest = keys.filter((k) => !ORDER.includes(k)).sort((a, b) => a.localeCompare(b));
    return [...preset, ...rest];
  }, [grouped]);

  const lowCount = rows.filter((r) => r.is_low_stock).length;

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

  const importInvoice = async (source) => {
    if (importBusy) return;
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('', 'Camera access');
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('', 'Photo library access');
          return;
        }
      }
      const picker = source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
      const result = await picker({
        mediaTypes: IMAGE_MEDIA_TYPES,
        base64: true,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert('', 'Image');
        return;
      }
      const contentType =
        asset.mimeType && asset.mimeType.startsWith('image/') ? asset.mimeType : 'image/jpeg';
      setImportBusy(true);
      const data = await apiPost(
        '/api/inventory/import/invoice',
        { image_base64: asset.base64, content_type: contentType },
        { queueOffline: false },
      );
      const parsed = invoiceRowsFromItems(data?.items);
      if (!parsed.length) {
        Alert.alert('', 'No products found.');
        return;
      }
      setPreviewRows(parsed);
      setPreviewOpen(true);
    } catch (e) {
      const message =
        String(e?.message || '') === 'not_found'
          ? 'Inventory import is not available on this server yet.'
          : e.message || 'Import failed';
      Alert.alert('', message);
    } finally {
      setImportBusy(false);
    }
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
        <Text style={styles.title}>Inventory</Text>
        <View style={styles.headerRight}>
          {lowCount > 0 ? (
            <View style={styles.badge}>
              <Ionicons name="alert-circle" size={18} color="#fff" />
              <Text style={styles.badgeText}>{lowCount} low</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.importRow}>
        <TouchableOpacity
          style={[styles.importBtn, importBusy && styles.importBtnDisabled]}
          onPress={() => importInvoice('camera')}
          disabled={importBusy}
          activeOpacity={0.88}
        >
          <Text style={styles.importBtnText}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.importBtn, importBusy && styles.importBtnDisabled]}
          onPress={() => importInvoice('library')}
          disabled={importBusy}
          activeOpacity={0.88}
        >
          {importBusy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.importBtnText}>Import invoice</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        {INVENTORY_FILTERS.map((option) => {
          const selected = inventoryFilter === option.key;
          return (
            <TouchableOpacity
              key={option.key}
              style={[styles.filterCard, selected && styles.filterCardOn]}
              onPress={() => setInventoryFilter(option.key)}
              activeOpacity={0.85}
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
                <Ionicons name="add" size={18} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={[styles.filterIconBubble, selected && styles.filterIconBubbleOn]}>
                <SFIcon
                  name={option.icon}
                  iosName={option.iosIcon}
                  size={26}
                  color={selected ? '#E84D93' : '#5E35B1'}
                />
              </View>
              <Text style={styles.filterCardText}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {sectionKeys.map((cat) => {
            const list = grouped[cat];
            if (!list?.length) return null;
            return (
              <View key={cat} style={styles.section}>
                <Text style={styles.sectionTitle}>{sectionTitle(cat)}</Text>
                {list.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.row, item.is_low_stock && styles.rowLow]}
                    activeOpacity={0.85}
                    onPress={() => navigation.navigate('InventoryItem', { itemId: item.id })}
                  >
                    <View style={styles.rowMain}>
                      <Text style={styles.rowName}>{item.name}</Text>
                      <Text style={styles.rowMeta}>
                        {[
                          item.brand,
                          item.shade_code,
                          item.package_size,
                          item.price_per_unit_cents != null
                            ? `${formatMinorFromStoredCents(item.price_per_unit_cents, currency)} / ${item.unit}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </Text>
                    </View>
                    <View style={styles.qtyRow}>
                      <View style={styles.qty}>
                        <Text style={[styles.qtyVal, item.is_low_stock && styles.qtyWarn]}>
                          {item.quantity} {item.unit}
                        </Text>
                        {item.is_low_stock ? (
                          <Text style={styles.lowLbl}>{item.low_stock_threshold}</Text>
                        ) : null}
                      </View>
                      <Ionicons name="chevron-forward" size={20} color="#1C1C1E" />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}

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
                            <Ionicons name="add" size={16} color="#5E35B1" />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 28, fontWeight: '800', color: '#1C1C1E' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addBtn: {
    ...glassPurpleFabBar,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E53935',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  badgeText: { color: '#fff', fontWeight: '400', fontSize: 13 },
  importRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  importBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 15,
    backgroundColor: '#5E35B1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 5,
  },
  importBtnDisabled: { opacity: 0.6 },
  importBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  filterRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    paddingBottom: 18,
  },
  filterCard: {
    flex: 1,
    minHeight: 112,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#F3D3E2',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 14,
    position: 'relative',
  },
  filterCardOn: {
    borderColor: '#5E35B1',
    backgroundColor: '#F8F3FF',
  },
  filterIconBubble: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F5EAFE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  filterIconBubbleOn: { backgroundColor: '#FFD7EA' },
  filterCardText: { fontSize: 15, fontWeight: '700', color: '#1C1C1E' },
  filterAddBtn: {
    position: 'absolute',
    top: 9,
    right: 9,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#5E35B1',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#5E35B1',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 5,
    elevation: 4,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 },
  section: { marginBottom: 22 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '400',
    color: '#1C1C1E',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowLow: { borderColor: '#FFCDD2', backgroundColor: '#FFF8F8' },
  rowMain: { flex: 1, paddingRight: 12 },
  rowName: { fontSize: 16, fontWeight: '400', color: '#1C1C1E' },
  rowMeta: { marginTop: 4, fontSize: 13, color: '#1C1C1E' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qty: { alignItems: 'flex-end' },
  qtyVal: { fontSize: 16, fontWeight: '400', color: '#1C1C1E' },
  qtyWarn: { color: '#C62828' },
  lowLbl: { marginTop: 4, fontSize: 11, fontWeight: '400', color: '#E53935' },
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
  modalTitle: { fontSize: 17, fontWeight: '400', color: '#1C1C1E' },
  modalClose: { fontSize: 17, fontWeight: '400', color: '#5E35B1' },
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
  previewChoiceText: { fontSize: 13, fontWeight: '600', color: '#5E35B1' },
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
  previewCategoryText: { fontSize: 12, fontWeight: '600', color: '#1C1C1E' },
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
  previewAddCategoryText: { fontSize: 12, fontWeight: '600', color: '#5E35B1' },
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
  previewCategoryDoneText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  previewInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1C1C1E',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
    elevation: 3,
  },
  previewNameInput: { flex: 1 },
  previewSmallInput: { width: 70 },
  previewPriceInput: { width: 82 },
  previewUnit: { minWidth: 28, fontSize: 13, color: '#1C1C1E' },
  previewCurrency: { fontSize: 12, fontWeight: '600', color: '#5E35B1' },
  previewTotal: { flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '600', color: '#5E35B1' },
  saveImportBtn: {
    marginTop: 16,
    backgroundColor: '#5E35B1',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
});
