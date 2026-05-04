import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MY_LAB_VIOLET } from '../theme/glassUi';
import { FontFamily } from '../theme/fonts';
import { typeLh } from '../theme/typography';

const reliefShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.14,
  shadowRadius: 5,
  elevation: 4,
};

/**
 * Free-text field + sheet list of saved values. Typed or chosen text is the subcategory value.
 */
export default function ProductTypeComboField({
  label,
  value,
  onChangeText,
  options = [],
  sheetTitle,
  inputStyle,
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();

  const rows = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const s of options) {
      const t = String(s || '').trim();
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      out.push(t);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [options]);

  const optionKeySet = useMemo(() => {
    const set = new Set();
    for (const s of options) {
      const t = String(s || '').trim().toLowerCase();
      if (t) set.add(t);
    }
    return set;
  }, [options]);

  const trimmedValue = String(value || '').trim();
  const showSaveAsNew =
    trimmedValue.length > 0 && !optionKeySet.has(trimmedValue.toLowerCase());

  const valueNorm = trimmedValue.toLowerCase();
  const header = sheetTitle || label || '';
  const sheetBodyH = Math.min(Math.round(winH * 0.58), 440);

  return (
    <>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.fieldRow}>
        <TextInput
          style={[inputStyle, styles.textInputFlex]}
          placeholder=""
          placeholderTextColor="#AEAEB2"
          value={value}
          onChangeText={onChangeText}
          autoCapitalize="words"
        />
        {showSaveAsNew ? (
          <Text style={styles.saveInlineHint} numberOfLines={2} accessibilityLabel="Save as new">
            Save{'\n'}as new
          </Text>
        ) : null}
        <TouchableOpacity
          style={styles.chevronBtn}
          onPress={() => {
            Keyboard.dismiss();
            setOpen(true);
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="List"
        >
          <Ionicons name="chevron-down" size={22} color={MY_LAB_VIOLET} />
        </TouchableOpacity>
      </View>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.modalRoot}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setOpen(false)} />
          <View
            style={[
              styles.sheet,
              {
                height: sheetBodyH,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}
          >
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {header}
              </Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={12}>
                <Text style={styles.done}>Done</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={rows}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              style={styles.listFlex}
              renderItem={({ item }) => {
                const selected = valueNorm === item.toLowerCase();
                return (
                  <TouchableOpacity
                    style={styles.listRow}
                    onPress={() => {
                      onChangeText(item);
                      setOpen(false);
                    }}
                    activeOpacity={0.75}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <View style={styles.radioOuter}>
                      {selected ? <View style={styles.radioInner} /> : null}
                    </View>
                    <Text style={styles.listRowTxt}>{item}</Text>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyTxt}>—</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.regular,
    color: '#0D0D0D',
    marginBottom: 8,
    marginTop: 4,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
    marginBottom: 4,
  },
  textInputFlex: {
    flex: 1,
    minWidth: 0,
    marginBottom: 0,
  },
  saveInlineHint: {
    alignSelf: 'center',
    flexShrink: 0,
    maxWidth: 52,
    fontSize: 10,
    lineHeight: 12,
    fontFamily: FontFamily.semibold,
    color: MY_LAB_VIOLET,
    letterSpacing: -0.2,
    textAlign: 'right',
    opacity: 0.92,
  },
  chevronBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    ...reliefShadow,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingTop: 12,
    flexDirection: 'column',
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  sheetTitle: {
    flex: 1,
    paddingRight: 10,
    fontSize: 17,
    lineHeight: typeLh(17),
    fontFamily: FontFamily.semibold,
    color: '#0D0D0D',
  },
  done: {
    fontSize: 16,
    lineHeight: typeLh(16),
    fontFamily: FontFamily.semibold,
    color: MY_LAB_VIOLET,
  },
  listFlex: {
    flex: 1,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#000000',
  },
  listRowTxt: {
    flex: 1,
    fontSize: 16,
    lineHeight: typeLh(16),
    fontFamily: FontFamily.regular,
    color: '#0D0D0D',
  },
  emptyWrap: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyTxt: {
    fontSize: 15,
    color: '#8E8E93',
    fontFamily: FontFamily.regular,
  },
});
