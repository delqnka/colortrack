import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { apiDelete, apiGet, apiPost, getApiBaseUrl, getApiResolvedUrl } from '../api/client';
import { useCurrency } from '../context/CurrencyContext';
import { formatMinorFromStoredCentsOrDash } from '../format/moneyDisplay';
import CurrencyPickerModal from '../components/CurrencyPickerModal';
import IsoDatePickField from '../components/IsoDatePickField';
import { FontFamily } from '../theme/fonts';
import { Type, typeLh } from '../theme/typography';
import { hapticImpactLight } from '../theme/haptics';

const CHIP_BORDER_ON = '#5E35B1';

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toYMDLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftYMD(ymd, deltaDays) {
  const [yy, mm, dd] = ymd.split('-').map(Number);
  const t = new Date(yy, mm - 1, dd + deltaDays, 12, 0, 0, 0);
  return toYMDLocal(t);
}

function daysInCalendarMonthYmd(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return 30;
  return new Date(y, m, 0).getDate();
}

function parseAmountToCents(text) {
  const s = String(text || '').trim().replace(',', '.');
  if (!s) return null;
  const x = Number(s);
  if (!Number.isFinite(x) || x < 0) return null;
  const c = Math.round(x * 100);
  if (c > 1_000_000_000) return null;
  return c;
}

function serviceIncomeSourceLabel(bookingCount, walkinCount) {
  const b = Math.max(0, Number(bookingCount) || 0);
  const w = Math.max(0, Number(walkinCount) || 0);
  if (!b && !w) return null;
  const parts = [];
  if (b) parts.push(`${b} ${b === 1 ? 'booking' : 'bookings'}`);
  if (w) parts.push(`${w} ${w === 1 ? 'visit' : 'visits'}`);
  return parts.join(' · ');
}

function retailSalesCountLabel(lineCount) {
  const c = Math.max(0, Number(lineCount) || 0);
  if (!c) return null;
  return `${c} ${c === 1 ? 'sale' : 'sales'}`;
}

function expenseLinesLabel(lineCount) {
  const c = Math.max(0, Number(lineCount) || 0);
  if (!c) return null;
  return `${c} ${c === 1 ? 'entry' : 'entries'}`;
}

const EXPENSE_CATEGORIES = [
  { code: 'rent', label: 'Rent' },
  { code: 'utilities', label: 'Utilities' },
  { code: 'salary', label: 'Salary' },
  { code: 'supplies', label: 'Supplies' },
  { code: 'inventory', label: 'Stock buy' },
  { code: 'equipment', label: 'Equipment' },
  { code: 'marketing', label: 'Marketing' },
  { code: 'taxes', label: 'Taxes' },
  { code: 'other', label: 'Other' },
];

export default function FinanceScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { currency, setCurrency } = useCurrency();
  const [pickCur, setPickCur] = useState(false);
  const initial = route.params?.date;
  const [dateYmd, setDateYmd] = useState(
    typeof initial === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(initial) ? initial : toYMDLocal(new Date()),
  );
  const [summary, setSummary] = useState(null);
  const [lines, setLines] = useState({ expenses: [], product_sales: [] });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  useEffect(() => {
    const d = route.params?.date;
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDateYmd(d);
  }, [route.params?.date]);

  const dateLabel = useMemo(() => {
    const [y, m, d] = dateYmd.split('-').map(Number);
    const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
    return `${DOW_SHORT[dt.getDay()]} ${d}`;
  }, [dateYmd]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = encodeURIComponent(dateYmd);
      const [s, l] = await Promise.all([
        apiGet(`/api/finance/summary?date=${q}`, { allowStaleCache: false }),
        apiGet(`/api/finance/lines?date=${q}`, { allowStaleCache: false }),
      ]);
      setSummary(s && typeof s === 'object' ? s : null);
      setLines(
        l && typeof l === 'object'
          ? { expenses: l.expenses || [], product_sales: l.product_sales || [] }
          : { expenses: [], product_sales: [] },
      );
    } catch {
      setSummary(null);
      setLines({ expenses: [], product_sales: [] });
    } finally {
      setLoading(false);
    }
  }, [dateYmd]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openExpense = () => {
    hapticImpactLight();
    setModal({ type: 'expense', category: 'utilities', allocation: 'one_time', title: '', amount: '' });
  };

  const openRetail = () => {
    hapticImpactLight();
    setModal({ type: 'retail', description: '', quantity: '1', amount: '' });
  };

  const saveModal = async () => {
    if (!modal) return;
    if (modal.type === 'expense') {
      const cents = parseAmountToCents(modal.amount);
      if (cents == null) {
        Alert.alert('Error', 'Invalid amount');
        return;
      }
      try {
        const out = await apiPost('/api/finance/expenses', {
          expense_date: dateYmd,
          category: modal.category,
          allocation: modal.allocation === 'fixed_monthly' ? 'fixed_monthly' : 'one_time',
          title: modal.title?.trim() || '',
          amount_cents: cents,
        });
        if (out?.queued) {
          Alert.alert('Offline', 'Connect to save this expense.');
          return;
        }
        setModal(null);
        load();
      } catch (e) {
        const hint = `\nAPI: ${getApiBaseUrl()}\n→ ${getApiResolvedUrl('/api/finance/expenses')}`;
        Alert.alert('Error', `${e?.message ? String(e.message) : 'Could not save'}${hint}`);
      }
      return;
    }
    if (modal.type === 'retail') {
      const cents = parseAmountToCents(modal.amount);
      if (cents == null) {
        Alert.alert('Error', 'Invalid amount');
        return;
      }
      const q = String(modal.quantity || '1').trim();
      const qn = q ? Number(q) : 1;
      try {
        const out = await apiPost('/api/finance/product-sales', {
          sale_date: dateYmd,
          description: modal.description?.trim() || '',
          quantity: Number.isFinite(qn) && qn > 0 ? qn : 1,
          amount_cents: cents,
        });
        if (out?.queued) {
          Alert.alert('Offline', 'Connect to save this sale.');
          return;
        }
        setModal(null);
        load();
      } catch (e) {
        const hint = `\nAPI: ${getApiBaseUrl()}\n→ ${getApiResolvedUrl('/api/finance/product-sales')}`;
        Alert.alert('Error', `${e?.message ? String(e.message) : 'Could not save'}${hint}`);
      }
    }
  };

  const confirmDeleteExpense = (id) => {
    Alert.alert('Delete', 'Remove this expense?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiDelete(`/api/finance/expenses/${id}`);
            load();
          } catch {
            Alert.alert('Error', 'Could not delete');
          }
        },
      },
    ]);
  };

  const confirmDeleteSale = (id) => {
    Alert.alert('Delete', 'Remove this sale?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiDelete(`/api/finance/product-sales/${id}`);
            load();
          } catch {
            Alert.alert('Error', 'Could not delete');
          }
        },
      },
    ]);
  };

  const catLabel = (code) => EXPENSE_CATEGORIES.find((c) => c.code === code)?.label || code;

  const servicesSub = useMemo(
    () =>
      serviceIncomeSourceLabel(summary?.service_income_booking_count, summary?.service_income_walkin_count),
    [summary?.service_income_booking_count, summary?.service_income_walkin_count],
  );
  const retailSub = useMemo(() => retailSalesCountLabel(summary?.product_sales_line_count), [summary?.product_sales_line_count]);
  const costsSub = useMemo(() => expenseLinesLabel(summary?.expense_line_count), [summary?.expense_line_count]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.head}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color="#1C1C1E" />
        </TouchableOpacity>
        <Text style={styles.title}>Finance</Text>
        <TouchableOpacity style={styles.curBtn} onPress={() => setPickCur(true)} hitSlop={10}>
          <Text style={styles.curBtnTxt}>{currency}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.dateRow}>
        <TouchableOpacity onPress={() => setDateYmd((d) => shiftYMD(d, -1))} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color="#5E35B1" />
        </TouchableOpacity>
        <View style={styles.datePickSlot}>
          <IsoDatePickField
            value={dateYmd}
            onChange={setDateYmd}
            displayText={dateLabel}
            showCalendarIcon={false}
            toolbarTitle="Date"
            style={styles.datePickField}
            textStyle={styles.dateLabel}
          />
        </View>
        <TouchableOpacity onPress={() => setDateYmd((d) => shiftYMD(d, 1))} hitSlop={8}>
          <Ionicons name="chevron-forward" size={22} color="#5E35B1" />
        </TouchableOpacity>
      </View>

      {loading && !summary ? (
        <ActivityIndicator style={{ marginTop: 24 }} color="#1C1C1E" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.summaryHeading}>Summary</Text>
          <View style={styles.stats}>
            <View style={styles.statCell}>
              <Text style={styles.statLbl}>Services</Text>
              <Text style={styles.statVal}>{formatMinorFromStoredCentsOrDash(summary?.service_income_cents, currency)}</Text>
              {servicesSub ? (
                <Text style={styles.statSub} numberOfLines={2}>
                  {servicesSub}
                </Text>
              ) : null}
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLbl}>Retail</Text>
              <Text style={styles.statVal}>{formatMinorFromStoredCentsOrDash(summary?.product_sales_cents, currency)}</Text>
              {retailSub ? (
                <Text style={styles.statSub} numberOfLines={2}>
                  {retailSub}
                </Text>
              ) : null}
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLbl}>Costs</Text>
              <Text style={[styles.statVal, styles.statOut]}>{formatMinorFromStoredCentsOrDash(summary?.expenses_cents, currency)}</Text>
              {costsSub ? (
                <Text style={styles.statSub} numberOfLines={2}>
                  {costsSub}
                </Text>
              ) : null}
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statLbl}>Net</Text>
              <Text style={[styles.statVal, styles.statNet]}>{formatMinorFromStoredCentsOrDash(summary?.net_cents, currency)}</Text>
            </View>
          </View>

          <View style={styles.addCardsCol}>
            <TouchableOpacity style={styles.addCard} onPress={openExpense} activeOpacity={0.88}>
              <View style={[styles.addIconWrap, styles.addIconExpense]}>
                <Ionicons name="trending-down" size={20} color="#B71C1C" />
              </View>
              <Text style={styles.addCardTitle}>Expense</Text>
              <Ionicons name="chevron-forward" size={20} color="#C7C7CC" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.addCard} onPress={openRetail} activeOpacity={0.88}>
              <View style={[styles.addIconWrap, styles.addIconRetail]}>
                <Ionicons name="bag-handle-outline" size={20} color="#2E7D32" />
              </View>
              <Text style={styles.addCardTitle}>Retail sale</Text>
              <Ionicons name="chevron-forward" size={20} color="#C7C7CC" />
            </TouchableOpacity>
          </View>

          {lines.expenses.length ? (
            <>
              <Text style={styles.sec}>Costs</Text>
              {lines.expenses.map((row) => {
                const isFixed = row.allocation === 'fixed_monthly';
                const dim = daysInCalendarMonthYmd(dateYmd);
                const dailyCents = isFixed && dim > 0 ? Math.round(Number(row.amount_cents) / dim) : null;
                return (
                <View key={row.id} style={styles.lineCard}>
                  <View style={styles.lineMain}>
                    <Text style={styles.lineTitle} numberOfLines={1}>
                      {row.title?.trim() ? row.title.trim() : catLabel(row.category)}
                    </Text>
                    {row.title?.trim() ? (
                      <Text style={styles.lineSub} numberOfLines={1}>
                        {catLabel(row.category)}
                        {isFixed ? ' · month' : ''}
                      </Text>
                    ) : isFixed ? (
                      <Text style={styles.lineSub} numberOfLines={1}>
                        Monthly
                      </Text>
                    ) : null}
                    {dailyCents != null ? (
                      <Text style={styles.lineSub} numberOfLines={1}>
                        {formatMinorFromStoredCentsOrDash(dailyCents, currency)} / day
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.lineAmt}>{formatMinorFromStoredCentsOrDash(row.amount_cents, currency)}</Text>
                  <TouchableOpacity onPress={() => confirmDeleteExpense(row.id)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={20} color="#C62828" />
                  </TouchableOpacity>
                </View>
              );
              })}
            </>
          ) : null}

          {lines.product_sales.length ? (
            <>
              <Text style={[styles.sec, styles.secPad]}>Retail</Text>
              {lines.product_sales.map((row) => (
                <View key={row.id} style={styles.lineCard}>
                  <View style={styles.lineMain}>
                    <Text style={styles.lineTitle} numberOfLines={2}>
                      {row.description || '—'}
                    </Text>
                    <Text style={styles.lineSub} numberOfLines={1}>
                      ×{row.quantity}
                    </Text>
                  </View>
                  <Text style={styles.lineAmt}>{formatMinorFromStoredCentsOrDash(row.amount_cents, currency)}</Text>
                  <TouchableOpacity onPress={() => confirmDeleteSale(row.id)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={20} color="#C62828" />
                  </TouchableOpacity>
                </View>
              ))}
            </>
          ) : null}

          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      <Modal visible={Boolean(modal)} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalRoot}
        >
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setModal(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>{modal?.type === 'retail' ? 'Retail sale' : 'Expense'}</Text>
              <TouchableOpacity onPress={() => setModal(null)}>
                <Text style={styles.modalDone}>Done</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalBody}
            >
              {modal?.type === 'expense' ? (
                <>
                  <Text style={styles.fieldLbl}>Category</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
                    {EXPENSE_CATEGORIES.map((c) => {
                      const on = modal.category === c.code;
                      return (
                        <TouchableOpacity
                          key={c.code}
                          style={[styles.chip, on && styles.chipOn]}
                          onPress={() => setModal({ ...modal, category: c.code })}
                        >
                          <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{c.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <View style={styles.allocRow}>
                    {[
                      { code: 'one_time', label: 'Day' },
                      { code: 'fixed_monthly', label: 'Month' },
                    ].map(({ code, label }) => {
                      const on = (modal.allocation || 'one_time') === code;
                      return (
                        <TouchableOpacity
                          key={code}
                          style={[styles.chip, styles.allocChip, on && styles.chipOn]}
                          onPress={() => setModal({ ...modal, allocation: code })}
                        >
                          <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={styles.fieldLbl}>Amount</Text>
                  <View style={styles.amountBox}>
                    <TextInput
                      style={styles.inputAmountInner}
                      keyboardType="decimal-pad"
                      value={modal.amount}
                      onChangeText={(t) => setModal({ ...modal, amount: t })}
                      placeholderTextColor="#C7C7CC"
                    />
                    <Text style={styles.amountCur}>{currency}</Text>
                  </View>

                  <Text style={styles.fieldLbl}>Note</Text>
                  <TextInput
                    style={styles.input}
                    value={modal.title}
                    onChangeText={(t) => setModal({ ...modal, title: t })}
                    placeholderTextColor="#8A8A8E"
                  />
                </>
              ) : modal?.type === 'retail' ? (
                <>
                  <Text style={styles.fieldLbl}>Product</Text>
                  <TextInput
                    style={styles.input}
                    value={modal.description}
                    onChangeText={(t) => setModal({ ...modal, description: t })}
                    placeholderTextColor="#8A8A8E"
                  />

                  <View style={styles.retailRow}>
                    <View style={styles.retailCol}>
                      <Text style={styles.fieldLbl}>Qty</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        value={modal.quantity}
                        onChangeText={(t) => setModal({ ...modal, quantity: t })}
                        placeholderTextColor="#8A8A8E"
                      />
                    </View>
                    <View style={[styles.retailCol, styles.retailColWide]}>
                      <Text style={styles.fieldLbl}>Total</Text>
                      <View style={styles.amountBox}>
                        <TextInput
                          style={styles.inputAmountInner}
                          keyboardType="decimal-pad"
                          value={modal.amount}
                          onChangeText={(t) => setModal({ ...modal, amount: t })}
                          placeholderTextColor="#C7C7CC"
                        />
                        <Text style={styles.amountCur}>{currency}</Text>
                      </View>
                    </View>
                  </View>
                </>
              ) : null}

              <TouchableOpacity style={styles.saveBtn} onPress={saveModal} activeOpacity={0.9}>
                <Text style={styles.saveBtnTxt}>Save</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <CurrencyPickerModal
        visible={pickCur}
        onClose={() => setPickCur(false)}
        onSelect={(code) => {
          setCurrency(code);
        }}
        currentCode={currency}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  backBtn: { width: 40, alignItems: 'center' },
  title: { ...Type.screenTitle, flex: 1, textAlign: 'center', color: '#0D0D0D' },
  curBtn: { minWidth: 44, paddingHorizontal: 4, alignItems: 'flex-end', justifyContent: 'center' },
  curBtnTxt: { ...Type.price },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    marginBottom: 16,
  },
  datePickSlot: { flex: 1, minWidth: 0, alignItems: 'center' },
  datePickField: { minHeight: 40, paddingVertical: 4, justifyContent: 'center' },
  dateLabel: { ...Type.greetingHello, color: '#0D0D0D' },
  scroll: { paddingHorizontal: 20, paddingBottom: 24 },
  summaryHeading: { ...Type.sectionLabel, marginBottom: 10 },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  statCell: {
    width: '47%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  statVal: {
    fontSize: 17,
    lineHeight: typeLh(17),
    fontFamily: FontFamily.semibold,
    color: '#0D0D0D',
    marginTop: 8,
  },
  statOut: { color: '#B71C1C' },
  statNet: { color: '#1565C0' },
  statLbl: { ...Type.tabBarLabel, color: '#AEAEB2' },
  statSub: {
    fontSize: 12,
    lineHeight: typeLh(12),
    fontFamily: FontFamily.regular,
    color: '#8A8A8E',
    marginTop: 6,
    textAlign: 'center',
  },
  addCardsCol: { gap: 10, marginBottom: 22 },
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
  },
  addIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIconExpense: { backgroundColor: 'rgba(183, 28, 28, 0.09)' },
  addIconRetail: { backgroundColor: 'rgba(46, 125, 50, 0.09)' },
  addCardTitle: { flex: 1, ...Type.listPrimary, color: '#0D0D0D', fontFamily: FontFamily.semibold },
  sec: { ...Type.listPrimary, color: '#0D0D0D', fontFamily: FontFamily.semibold, marginBottom: 10 },
  secPad: { marginTop: 8 },
  lineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 10,
  },
  lineMain: { flex: 1, minWidth: 0 },
  lineTitle: { ...Type.listPrimary, color: '#0D0D0D' },
  lineSub: { fontSize: 13, lineHeight: typeLh(13), fontFamily: FontFamily.regular, color: '#8A8A8E', marginTop: 4 },
  lineAmt: { ...Type.price },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 28,
    paddingTop: 8,
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
    marginBottom: 0,
  },
  modalTitle: {
    fontSize: 17,
    lineHeight: typeLh(17),
    fontFamily: FontFamily.semibold,
    color: '#0D0D0D',
  },
  modalDone: {
    fontSize: 17,
    lineHeight: typeLh(17),
    fontFamily: FontFamily.medium,
    color: '#5E35B1',
  },
  modalBody: { paddingTop: 16, paddingBottom: 8 },
  fieldLbl: {
    ...Type.sectionLabel,
    marginBottom: 8,
  },
  chipsScroll: { marginBottom: 16, maxHeight: 44 },
  allocRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  allocChip: { marginRight: 0 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  chipOn: { backgroundColor: 'rgba(94, 53, 177, 0.12)', borderColor: CHIP_BORDER_ON },
  chipTxt: { ...Type.secondary, fontFamily: FontFamily.medium, color: '#0D0D0D' },
  chipTxtOn: { color: CHIP_BORDER_ON },
  input: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.regular,
    color: '#0D0D0D',
    marginBottom: 14,
    backgroundColor: '#FFFFFF',
  },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 14,
    paddingLeft: 14,
    paddingRight: 12,
    marginBottom: 14,
    backgroundColor: '#FFFFFF',
  },
  inputAmountInner: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 28,
    lineHeight: typeLh(28),
    fontFamily: FontFamily.semibold,
    color: '#0D0D0D',
  },
  amountCur: {
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.semibold,
    color: '#8A8A8E',
    paddingLeft: 4,
  },
  retailRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 4 },
  retailCol: { flex: 1, minWidth: 0 },
  retailColWide: { flex: 1.6 },
  saveBtn: {
    backgroundColor: '#5E35B1',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveBtnTxt: { color: '#FFFFFF', ...Type.buttonLabel },
});
