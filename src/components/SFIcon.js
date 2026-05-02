/**
 * SF Symbols on iOS, Ionicons fallback on Android.
 * Usage: <SFIcon name="house.fill" size={24} color="#000" />
 */
import React from 'react';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SymbolView } from 'expo-symbols';

export default function SFIcon({ name, iosName, size = 24, color = '#000000', style, weight = 'regular' }) {
  if (Platform.OS === 'ios' && (iosName || name)) {
    return (
      <SymbolView
        name={iosName || name}
        size={size}
        tintColor={color}
        weight={weight}
        type="hierarchical"
        style={[{ width: size, height: size }, style]}
      />
    );
  }
  return <Ionicons name={name} size={size} color={color} style={style} />;
}
