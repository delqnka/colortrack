import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet, apiPost, apiDelete } from '../api/client';
import { BRAND_PURPLE, MY_LAB_VIOLET } from '../theme/glassUi';
import { FontFamily } from '../theme/fonts';
import { Type, typeLh } from '../theme/typography';
import { useCurrency } from '../context/CurrencyContext';
import { formatMinorFromStoredCents } from '../format/moneyDisplay';
import { inventoryCategoryKey } from '../inventory/inventoryCategories';

function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function centsFromText(t) {
  const s = String(t||'').trim().replace(',','.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/**
 * Unit price to pre-fill the sale line: prefer sell_price_cents, else price_per_unit_cents
 * (many retail rows only have the latter filled as “price”).
 * DB may return cents as string or bigint-serialized string.
 */
function retailUnitSellCents(item) {
  if (!item) return null;
  const sell = Number(item.sell_price_cents);
  if (Number.isFinite(sell) && sell > 0) return Math.round(sell);
  const unit = Number(item.price_per_unit_cents);
  if (Number.isFinite(unit) && unit > 0) return Math.round(unit);
  return null;
}

/** Major units string for amount field (line total = unit × qty is applied in effects). */
function formatMajorFromCents(cents) {
  const n = Math.round(Number(cents));
  if (!Number.isFinite(n) || n <= 0) return '';
  const v = n / 100;
  return v % 1 === 0 ? String(v) : v.toFixed(2);
}

export default function TodaySalesScreen({ navigation, route }) {
  const { currency } = useCurrency();
  const today = toYMD(new Date());
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalCents, setTotalCents] = useState(0);

  // Pre-fill client from route params (coming from FormulaBuilderScreen)
  const routeClientId = route?.params?.clientId ?? null;
  const routeClientName = route?.params?.clientName ?? null;

  // add-sale form state
  const [showForm, setShowForm] = useState(Boolean(routeClientId));
  const [clientMode, setClientMode] = useState(routeClientId ? 'client' : 'walkin');
  const [clientQuery, setClientQuery] = useState('');
  const [clientHits, setClientHits] = useState([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState(
    routeClientId ? { id: routeClientId, full_name: routeClientName || 'Client' } : null
  );
  const [productQuery, setProductQuery] = useState('');
  const [productHits, setProductHits] = useState([]);
  const [allRetailItems, setAllRetailItems] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [descStr, setDescStr] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [qty, setQty] = useState('1');
  /** When set, Amount field tracks unit sell price × qty (backend stores line total in amount_cents). */
  const [unitSellCents, setUnitSellCents] = useState(null);
  const [saving, setSaving] = useState(false);
  const clientTimer = useRef(null);
  const productPickSeq = useRef(0);
  const qtyRef = useRef(qty);
  useEffect(() => {
    qtyRef.current = qty;
  }, [qty]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet(`/api/finance/lines?date=${today}`);
      const list = Array.isArray(data?.product_sales) ? data.product_sales : [];
      setSales(list);
      setTotalCents(list.reduce((s, r) => s + Number(r.amount_cents || 0), 0));
    } catch { setSales([]); setTotalCents(0); }
    finally { setLoading(false); }
  }, [today]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadRetailInventory = useCallback(() => {
    apiGet('/api/inventory', { allowStaleCache: false })
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setAllRetailItems(list.filter((r) => inventoryCategoryKey(r.category) === 'retail'));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadRetailInventory();
  }, [loadRetailInventory]);

  useEffect(() => {
    if (showForm) loadRetailInventory();
  }, [showForm, loadRetailInventory]);

  // Client search
  const searchClients = useCallback(async (q) => {
    setClientLoading(true);
    try {
      const rows = await apiGet(q.trim() ? `/api/clients?q=${encodeURIComponent(q.trim())}` : '/api/clients');
      setClientHits(Array.isArray(rows) ? rows : []);
    } catch { setClientHits([]); }
    finally { setClientLoading(false); }
  }, []);

  const onClientQueryChange = (t) => {
    setClientQuery(t);
    if (clientTimer.current) clearTimeout(clientTimer.current);
    clientTimer.current = setTimeout(() => searchClients(t), 280);
  };

  useEffect(() => {
    if (clientMode === 'client' && showForm) searchClients('');
  }, [clientMode, showForm, searchClients]);

  // Product filter
  const filteredProducts = productQuery.trim()
    ? allRetailItems.filter(p =>
        p.name?.toLowerCase().includes(productQuery.toLowerCase()) ||
        p.brand?.toLowerCase().includes(productQuery.toLowerCase()))
    : allRetailItems;

  const resetForm = () => {
    setShowForm(false);
    setClientMode('walkin');
    setClientQuery('');
    setClientHits([]);
    setSelectedClient(null);
    setProductQuery('');
    setSelectedProduct(null);
    setDescStr('');
    setAmountStr('');
    setQty('1');
    setUnitSellCents(null);
  };

  const onPickProduct = (item) => {
    const seq = ++productPickSeq.current;
    const id = item.id;
    setSelectedProduct(item);
    setProductQuery('');
    setDescStr(item.name || '');
    const applyRow = (row) => {
      const unit = retailUnitSellCents(row);
      setUnitSellCents(unit);
      const qn = Math.max(1, Math.floor(Number(qtyRef.current)) || 1);
      setAmountStr(unit != null ? formatMajorFromCents(unit * qn) : '');
    };
    applyRow(item);
    apiGet(`/api/inventory/${id}`, { allowStaleCache: false })
      .then((row) => {
        if (seq !== productPickSeq.current || !row || Number(row.id) !== Number(id)) return;
        setSelectedProduct(row);
        applyRow(row);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (unitSellCents == null || !selectedProduct) return;
    const q = Math.max(1, Math.floor(Number(qty)) || 1);
    setAmountStr(formatMajorFromCents(unitSellCents * q));
  }, [qty, unitSellCents, selectedProduct]);

  const submit = async () => {
    const cents = centsFromText(amountStr);
    if (!cents || cents <= 0) { Alert.alert('', 'Enter an amount.'); return; }
    if (clientMode === 'client' && !selectedClient) { Alert.alert('', 'Pick a client or choose Walk-in.'); return; }
    setSaving(true);
    try {
      await apiPost('/api/finance/product-sales', {
        sale_date: today,
        description: descStr.trim() || selectedProduct?.name || 'Sale',
        quantity: Number(qty) || 1,
        amount_cents: cents,
        inventory_item_id: selectedProduct?.id ?? null,
        client_id: selectedClient?.id ?? null,
      });
      resetForm();
      load();
    } catch (e) { Alert.alert('', e.message || ''); }
    finally { setSaving(false); }
  };

  const deleteSale = (id) => {
    Alert.alert('Remove sale?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          await apiDelete(`/api/finance/product-sales/${id}`);
          load();
        } catch {}
      }},
    ]);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Header */}
        <View style={s.header}>
          <View style={s.headerSide} />
          <Text style={s.headerTitle}>Today's Sales</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={s.closeBtn}>
            <Ionicons name="close" size={20} color="#0D0D0D" />
          </TouchableOpacity>
        </View>

        {/* Total */}
        <View style={s.totalBanner}>
          <Text style={s.totalLabel}>Total today</Text>
          <Text style={s.totalAmt}>{formatMinorFromStoredCents(totalCents, currency) || '—'}</Text>
        </View>

        <ScrollView
          style={s.flex}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Add sale form */}
          {showForm ? (
            <View style={s.form}>
              {/* Client toggle */}
              <View style={s.toggleRow}>
                {['walkin','client'].map(m => (
                  <TouchableOpacity
                    key={m}
                    style={[s.toggleBtn, clientMode === m && s.toggleBtnOn]}
                    onPress={() => { setClientMode(m); setSelectedClient(null); setClientQuery(''); }}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.toggleTxt, clientMode === m && s.toggleTxtOn]}>
                      {m === 'walkin' ? 'Walk-in' : 'Client'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Client search */}
              {clientMode === 'client' && !selectedClient ? (
                <View style={s.pickerBox}>
                  <TextInput
                    style={s.searchInput}
                    placeholder="Search client…"
                    placeholderTextColor="#AEAEB2"
                    value={clientQuery}
                    onChangeText={onClientQueryChange}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {clientLoading ? <ActivityIndicator style={{ marginVertical: 8 }} color={BRAND_PURPLE} /> : null}
                  {clientHits.slice(0, 5).map(c => (
                    <TouchableOpacity key={c.id} style={s.pickRow} onPress={() => setSelectedClient(c)} activeOpacity={0.8}>
                      <Text style={s.pickRowName}>{c.full_name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : clientMode === 'client' && selectedClient ? (
                <TouchableOpacity style={s.selectedChip} onPress={() => setSelectedClient(null)} activeOpacity={0.8}>
                  <Text style={s.selectedChipTxt}>{selectedClient.full_name}</Text>
                  <Ionicons name="close-circle-outline" size={16} color={MY_LAB_VIOLET} />
                </TouchableOpacity>
              ) : null}

              {/* Product picker */}
              {!selectedProduct ? (
                <View style={s.pickerBox}>
                  <TextInput
                    style={s.searchInput}
                    placeholder="Search retail product (optional)…"
                    placeholderTextColor="#AEAEB2"
                    value={productQuery}
                    onChangeText={setProductQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {filteredProducts.slice(0, 5).map((p) => {
                    const hintCents = retailUnitSellCents(p);
                    return (
                      <TouchableOpacity key={p.id} style={s.pickRow} onPress={() => onPickProduct(p)} activeOpacity={0.8}>
                        <Text style={s.pickRowName}>{p.name}</Text>
                        {hintCents != null ? (
                          <Text style={s.pickRowPrice}>{formatMinorFromStoredCents(hintCents, currency)}</Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <TouchableOpacity
                  style={s.selectedChip}
                  onPress={() => {
                    setSelectedProduct(null);
                    setDescStr('');
                    setAmountStr('');
                    setUnitSellCents(null);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={s.selectedChipTxt}>{selectedProduct.name}</Text>
                  <Ionicons name="close-circle-outline" size={16} color={MY_LAB_VIOLET} />
                </TouchableOpacity>
              )}

              {/* Description (if no product) */}
              {!selectedProduct ? (
                <>
                  <Text style={s.fieldLabel}>Service / description</Text>
                  <TextInput
                    style={s.input}
                    placeholder="e.g. Balayage, Cut, Toner…"
                    placeholderTextColor="#AEAEB2"
                    value={descStr}
                    onChangeText={setDescStr}
                    autoCapitalize="words"
                  />
                </>
              ) : null}

              {/* Amount + qty */}
              <View style={s.amtRow}>
                <View style={s.amtBlock}>
                  <Text style={s.fieldLabel}>Amount ({currency})</Text>
                  <TextInput
                    style={[s.input, s.amtInput]}
                    placeholder="0.00"
                    placeholderTextColor="#AEAEB2"
                    value={amountStr}
                    onChangeText={(t) => {
                      setAmountStr(t);
                      setUnitSellCents(null);
                    }}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                  />
                </View>
                <View style={s.qtyBlock}>
                  <Text style={s.fieldLabel}>Qty</Text>
                  <TextInput
                    style={[s.input, s.qtyInput]}
                    placeholder="1"
                    placeholderTextColor="#AEAEB2"
                    value={qty}
                    onChangeText={setQty}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              {/* Form actions */}
              <View style={s.formBtns}>
                <TouchableOpacity style={s.cancelBtn} onPress={resetForm} activeOpacity={0.8}>
                  <Text style={s.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving} activeOpacity={0.85}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.saveTxt}>Save sale</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={s.addBtn} onPress={() => setShowForm(true)} activeOpacity={0.85}>
              <Ionicons name="add-circle-outline" size={20} color={BRAND_PURPLE} />
              <Text style={s.addBtnTxt}>Add sale</Text>
            </TouchableOpacity>
          )}

          {/* Sales list */}
          {loading ? <ActivityIndicator style={{ marginTop: 24 }} color={BRAND_PURPLE} /> : null}
          {sales.map(sale => {
            const name = sale.client_full_name || sale.client_name_snapshot || 'Walk-in';
            const product = sale.item_name || sale.description || '—';
            const amt = formatMinorFromStoredCents(sale.amount_cents, currency);
            return (
              <View key={sale.id} style={s.saleRow}>
                <View style={s.saleMain}>
                  <Text style={s.saleName} numberOfLines={1}>{name}</Text>
                  <Text style={s.saleDesc} numberOfLines={1}>{product}</Text>
                </View>
                <Text style={s.saleAmt}>{amt}</Text>
                <TouchableOpacity onPress={() => deleteSale(sale.id)} hitSlop={10} style={{ marginLeft: 8 }}>
                  <Ionicons name="trash-outline" size={16} color="#C62828" />
                </TouchableOpacity>
              </View>
            );
          })}
          {!loading && sales.length === 0 && !showForm ? (
            <Text style={s.empty}>No sales logged yet today.</Text>
          ) : null}
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  headerSide: { width: 32 },
  headerTitle: { ...Type.screenTitle, fontSize: 17, letterSpacing: -0.4 },
  closeBtn: { width: 32, alignItems: 'flex-end' },
  totalBanner: {
    marginHorizontal: 20, marginBottom: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16, padding: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 12, elevation: 6,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  totalLabel: { fontFamily: FontFamily.medium, fontSize: 13, color: '#8A8A8E' },
  totalAmt: { fontFamily: FontFamily.semibold, fontSize: 26, color: MY_LAB_VIOLET, letterSpacing: -0.8 },
  scroll: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: 14, borderWidth: 1, borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF', marginBottom: 20,
  },
  addBtnTxt: { fontFamily: FontFamily.semibold, fontSize: 15, color: BRAND_PURPLE },
  form: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16,
    marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 14, elevation: 6,
  },
  toggleRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  toggleBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: '#E5E5EA', alignItems: 'center',
  },
  toggleBtnOn: { backgroundColor: '#0D0D0D', borderColor: '#0D0D0D' },
  toggleTxt: { fontFamily: FontFamily.semibold, fontSize: 14, color: '#0D0D0D' },
  toggleTxtOn: { color: '#FFFFFF' },
  pickerBox: {
    borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 12,
    marginBottom: 12, overflow: 'hidden',
  },
  searchInput: {
    paddingHorizontal: 14, paddingVertical: 11,
    fontFamily: FontFamily.regular, fontSize: 14, color: '#0D0D0D',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA',
  },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA',
  },
  pickRowName: { ...Type.listPrimary, fontSize: 14 },
  pickRowPrice: { fontFamily: FontFamily.semibold, fontSize: 14, color: MY_LAB_VIOLET },
  selectedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: BRAND_PURPLE,
    alignSelf: 'flex-start', marginBottom: 12,
  },
  selectedChipTxt: { fontFamily: FontFamily.medium, fontSize: 13, color: BRAND_PURPLE },
  fieldLabel: { fontFamily: FontFamily.medium, fontSize: 12, color: '#8A8A8E', marginBottom: 6, marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    fontFamily: FontFamily.regular, fontSize: 15, color: '#0D0D0D',
    marginBottom: 12,
  },
  amtRow: { flexDirection: 'row', gap: 10 },
  amtBlock: { flex: 2 },
  qtyBlock: { flex: 1 },
  amtInput: { marginBottom: 0 },
  qtyInput: { marginBottom: 0 },
  formBtns: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: '#E5E5EA', alignItems: 'center',
  },
  cancelTxt: { fontFamily: FontFamily.medium, fontSize: 14, color: '#8A8A8E' },
  saveBtn: {
    flex: 2, paddingVertical: 12, borderRadius: 12,
    backgroundColor: BRAND_PURPLE, alignItems: 'center',
  },
  saveTxt: { fontFamily: FontFamily.semibold, fontSize: 14, color: '#FFFFFF' },
  saleRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: '#FFFFFF', borderRadius: 12, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  saleMain: { flex: 1 },
  saleName: { fontFamily: FontFamily.semibold, fontSize: 14, color: '#0D0D0D' },
  saleDesc: { ...Type.secondary, marginTop: 2, fontSize: 12 },
  saleAmt: { fontFamily: FontFamily.semibold, fontSize: 15, color: MY_LAB_VIOLET, letterSpacing: -0.3 },
  empty: { textAlign: 'center', ...Type.secondary, marginTop: 32 },
});
