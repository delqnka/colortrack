import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { getAllSortedCurrencyCodes, getCurrencySymbol } from '../constants/currencyCodes';
import { MY_LAB_VIOLET } from '../theme/glassUi';
import { FontFamily } from '../theme/fonts';
import { typeLh } from '../theme/typography';

const ROW_GRADIENT = ['#000000', '#140B26', MY_LAB_VIOLET];
const ROW_GRADIENT_LOC = [0, 0.4, 1];

export default function CurrencyPickerModal({ visible, onClose, onSelect, currentCode }) {
  const [q, setQ] = useState('');
  const [keyboardH, setKeyboardH] = useState(0);
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) setQ('');
  }, [visible]);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e) => setKeyboardH(e?.endCoordinates?.height ?? 0);
    const onHide = () => setKeyboardH(0);
    const subShow = Keyboard.addListener(showEvt, onShow);
    const subHide = Keyboard.addListener(hideEvt, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  const sheetMaxHeight = useMemo(() => {
    const topReserve = Math.max(insets.top, 12) + 8;
    const bottomReserve = Math.max(insets.bottom, 8) + 8;
    const usable = winH - keyboardH - topReserve - bottomReserve;
    const cap = Math.round(winH * 0.72);
    return Math.max(260, Math.min(cap, usable));
  }, [winH, keyboardH, insets.top, insets.bottom]);
  const all = useMemo(() => getAllSortedCurrencyCodes(), []);
  const filtered = useMemo(() => {
    const t = q.trim().toUpperCase();
    if (!t) return all;
    return all.filter((c) => c.includes(t));
  }, [all, q]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={undefined} style={styles.root}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { height: sheetMaxHeight }]}>
          <View style={styles.grabberWrap}>
            <View style={styles.grabber} />
          </View>
          <View style={styles.head}>
            <Text style={styles.title}>Choose your currency</Text>
            <TouchableOpacity onPress={onClose} hitSlop={14} accessibilityRole="button" accessibilityLabel="Done">
              <Text style={styles.done}>Done</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.search}
            placeholder="Search"
            placeholderTextColor="#8E8E93"
            value={q}
            onChangeText={setQ}
            autoCapitalize="characters"
            autoCorrect={false}
            {...(Platform.OS === 'ios' ? { clearButtonMode: 'while-editing' } : {})}
          />
          <View style={styles.listWrap}>
            <FlatList
              data={filtered}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={24}
              showsVerticalScrollIndicator={false}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
              const on = currentCode === item;
              const sym = getCurrencySymbol(item);
              return (
                <TouchableOpacity
                  onPress={() => {
                    onSelect(item);
                    onClose();
                    setQ('');
                  }}
                  activeOpacity={0.88}
                  style={on ? styles.rowWrapOn : styles.rowWrapOff}
                >
                  {on ? (
                    <LinearGradient
                      colors={ROW_GRADIENT}
                      locations={ROW_GRADIENT_LOC}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.rowGrad}
                    >
                      <Text style={styles.symOn}>{sym || '·'}</Text>
                      <Text style={styles.codeOn}>{item}</Text>
                      <Text style={styles.checkOn}>✓</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.rowPlain}>
                      <Text style={styles.sym}>{sym || '·'}</Text>
                      <Text style={styles.code}>{item}</Text>
                      <View style={styles.rowSpacer} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    flexDirection: 'column',
    backgroundColor: '#F2F2F7',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingBottom: Platform.OS === 'ios' ? 12 : 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 24,
    overflow: 'hidden',
  },
  grabberWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(60,60,67,0.3)',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 8,
  },
  title: {
    flex: 1,
    paddingRight: 10,
    fontSize: 17,
    lineHeight: typeLh(17),
    fontFamily: FontFamily.semibold,
    color: '#000000',
    letterSpacing: -0.35,
  },
  done: {
    fontSize: 16,
    lineHeight: typeLh(16),
    fontFamily: FontFamily.semibold,
    color: '#007AFF',
    letterSpacing: -0.32,
  },
  search: {
    alignSelf: 'stretch',
    marginHorizontal: 16,
    marginBottom: 8,
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 16,
    lineHeight: typeLh(16),
    fontFamily: FontFamily.regular,
    color: '#000000',
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,60,67,0.18)',
  },
  listWrap: {
    flex: 1,
    minHeight: 0,
  },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: 14,
    paddingTop: 2,
    paddingBottom: 8,
  },
  rowWrapOff: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginBottom: 4,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,60,67,0.08)',
  },
  rowWrapOn: {
    marginBottom: 5,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  rowPlain: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 12,
    minHeight: 40,
  },
  rowGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 14,
    minHeight: 40,
  },
  sym: {
    width: 30,
    fontSize: 16,
    lineHeight: typeLh(16),
    fontFamily: FontFamily.semibold,
    color: '#636366',
    letterSpacing: -0.25,
  },
  code: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.medium,
    color: '#000000',
    letterSpacing: -0.28,
  },
  rowSpacer: { width: 18 },
  symOn: {
    width: 30,
    fontSize: 16,
    lineHeight: typeLh(16),
    fontFamily: FontFamily.semibold,
    color: 'rgba(255,255,255,0.95)',
    letterSpacing: -0.25,
  },
  codeOn: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.semibold,
    color: '#FFFFFF',
    letterSpacing: -0.28,
  },
  checkOn: {
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.semibold,
    color: 'rgba(255,255,255,0.92)',
    width: 20,
    textAlign: 'right',
  },
});
