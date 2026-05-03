import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Platform,
  Keyboard,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { parseISODateToLocal, formatDisplayDate } from '../lib/formatDate';
import { BRAND_PURPLE } from '../theme/glassUi';
import { FontFamily } from '../theme/fonts';
import { typeLh } from '../theme/typography';

function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Date-only field: value is YYYY-MM-DD. iOS uses bottom sheet + spinner; Android uses system dialog.
 */
export default function IsoDatePickField({
  value,
  onChange,
  nullable = false,
  /** When set, shown instead of formatting `value` (e.g. Finance day label). */
  displayText,
  showCalendarIcon = true,
  toolbarTitle = 'Date',
  style,
  textStyle,
  hitSlop,
}) {
  const [open, setOpen] = useState(false);
  const v = typeof value === 'string' ? value.trim() : '';
  const hasYmd = /^\d{4}-\d{2}-\d{2}$/.test(v);

  const label =
    displayText != null && displayText !== ''
      ? displayText
      : hasYmd
        ? formatDisplayDate(v)
        : formatDisplayDate('');

  const openPicker = useCallback(() => {
    Keyboard.dismiss();
    setOpen(true);
  }, []);

  const closePicker = useCallback(() => setOpen(false), []);

  const onAndroidChange = useCallback(
    (event, selected) => {
      setOpen(false);
      if (event?.type === 'dismissed') return;
      if (selected) onChange(toYMD(selected));
    },
    [onChange],
  );

  const pickerDate = parseISODateToLocal(hasYmd ? v : '');

  const mainJustify =
    showCalendarIcon || nullable ? 'space-between' : 'center';

  return (
    <>
      <View style={[styles.field, style]}>
        {nullable && hasYmd ? (
          <TouchableOpacity
            onPress={() => onChange('')}
            hitSlop={10}
            style={styles.clearOuter}
            accessibilityRole="button"
            accessibilityLabel="Clear date"
          >
            <Ionicons name="close-circle" size={22} color="#8E8E93" />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.fieldMain, { justifyContent: mainJustify }]}
          onPress={openPicker}
          activeOpacity={0.85}
          hitSlop={hitSlop}
          accessibilityRole="button"
          accessibilityLabel={toolbarTitle}
        >
          <Text
            style={[
              styles.fieldText,
              showCalendarIcon || nullable ? styles.fieldTextFill : styles.fieldTextCenter,
              textStyle,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {showCalendarIcon ? (
            <Ionicons name="calendar-outline" size={22} color="#1C1C1E" style={styles.calIcon} />
          ) : null}
        </TouchableOpacity>
      </View>

      {Platform.OS === 'ios' && open ? (
        <Modal visible animationType="slide" transparent>
          <View style={styles.iosRoot}>
            <TouchableOpacity style={styles.iosBackdrop} activeOpacity={1} onPress={closePicker} />
            <View style={styles.iosSheet}>
              <View style={styles.iosToolbar}>
                <View style={styles.toolbarSide} />
                <Text style={styles.iosToolbarTitle}>{toolbarTitle}</Text>
                <TouchableOpacity style={[styles.toolbarSide, styles.toolbarSideRight]} onPress={closePicker} hitSlop={8}>
                  <Text style={styles.doneTxt}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={pickerDate}
                mode="date"
                display="spinner"
                themeVariant="light"
                onChange={(_, selected) => {
                  if (selected) onChange(toYMD(selected));
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}

      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={pickerDate}
          mode="date"
          display="default"
          onChange={onAndroidChange}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    minWidth: 0,
  },
  clearOuter: {
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fieldMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  fieldText: {
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.regular,
    color: '#1C1C1E',
    marginRight: 8,
  },
  fieldTextFill: {
    flexShrink: 1,
    flexGrow: 1,
    minWidth: 0,
  },
  fieldTextCenter: {
    textAlign: 'center',
    marginRight: 0,
    flexGrow: 0,
    flexShrink: 0,
  },
  calIcon: { alignSelf: 'center' },
  iosRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  iosBackdrop: { flex: 1 },
  iosSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 8,
  },
  iosToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  toolbarSide: {
    width: 72,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  toolbarSideRight: { alignItems: 'flex-end' },
  iosToolbarTitle: {
    flex: 1,
    fontSize: 17,
    lineHeight: typeLh(17),
    fontFamily: FontFamily.regular,
    color: '#1C1C1E',
    textAlign: 'center',
  },
  doneTxt: {
    fontSize: 17,
    lineHeight: typeLh(17),
    fontFamily: FontFamily.medium,
    color: BRAND_PURPLE,
  },
});
