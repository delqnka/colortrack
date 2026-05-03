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
  Platform,
  useWindowDimensions,
} from 'react-native';
import { getAllSortedCurrencyCodes } from '../constants/currencyCodes';
import { FontFamily } from '../theme/fonts';
import { typeLh } from '../theme/typography';

export default function CurrencyPickerModal({ visible, onClose, onSelect, currentCode }) {
  const [q, setQ] = useState('');
  const { height: winH } = useWindowDimensions();
  useEffect(() => {
    if (visible) setQ('');
  }, [visible]);
  const all = useMemo(() => getAllSortedCurrencyCodes(), []);
  const filtered = useMemo(() => {
    const t = q.trim().toUpperCase();
    if (!t) return all;
    return all.filter((c) => c.includes(t));
  }, [all, q]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: Math.round(winH * 0.72) }]}>
          <View style={styles.head}>
            <Text style={styles.title}>Currency</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={styles.done}>Done</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.search}
            placeholder=""
            placeholderTextColor="#8E8E93"
            value={q}
            onChangeText={setQ}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={24}
            renderItem={({ item }) => {
              const on = currentCode === item;
              return (
                <TouchableOpacity
                  style={[styles.row, on && styles.rowOn]}
                  onPress={() => {
                    onSelect(item);
                    onClose();
                    setQ('');
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.code}>{item}</Text>
                  {on ? <Text style={styles.check}>✓</Text> : null}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 12,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  title: {
    fontSize: 17,
    lineHeight: typeLh(17),
    fontFamily: FontFamily.semibold,
    color: '#1C1C1E',
  },
  done: {
    fontSize: 17,
    lineHeight: typeLh(17),
    fontFamily: FontFamily.medium,
    color: '#5E35B1',
  },
  search: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    lineHeight: typeLh(16),
    fontFamily: FontFamily.regular,
    color: '#1C1C1E',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingVertical: 14,
    marginHorizontal: 8,
    borderRadius: 12,
  },
  rowOn: { backgroundColor: 'rgba(94, 53, 177, 0.08)' },
  code: {
    fontSize: 16,
    lineHeight: typeLh(16),
    fontFamily: FontFamily.medium,
    color: '#1C1C1E',
  },
  check: { fontSize: 16, lineHeight: typeLh(16), color: '#5E35B1', fontFamily: FontFamily.semibold },
});
