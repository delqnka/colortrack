import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FontFamily } from '../theme/fonts';
import { MY_LAB_VIOLET } from '../theme/glassUi';

const BADGE_RED = '#FF3B30';

/**
 * Messenger-style badge: compact control next to search; hidden when count &lt; 1.
 */
export default function LowStockHeaderPill({ count, onPress, accessibilityLabel = 'Low stock' }) {
  if (count < 1) return null;
  const n = count > 99 ? '99+' : String(count);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={`${accessibilityLabel}, ${count}`}
      style={styles.hit}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
    >
      <View style={styles.pill}>
        <Ionicons name="cube-outline" size={17} color={MY_LAB_VIOLET} />
        <View style={[styles.badge, n.length > 2 && styles.badgeWide]}>
          <Text style={styles.badgeTxt} numberOfLines={1}>
            {n}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  hit: {
    marginTop: 2,
    flexShrink: 0,
  },
  pill: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: BADGE_RED,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  badgeWide: {
    minWidth: 22,
    paddingHorizontal: 3,
  },
  badgeTxt: {
    fontFamily: FontFamily.semibold,
    fontSize: 10,
    color: '#FFFFFF',
    marginTop: -0.5,
  },
});
