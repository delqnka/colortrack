import React, { memo, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';

function DotGridInner({ width, height, spacing = 20, dot = 2, color = '#E5E5E5', opacity = 0.6 }) {
  const rows = Math.max(0, Math.floor(height / spacing));
  const cols = Math.max(0, Math.floor(width / spacing));

  const dots = useMemo(() => {
    const cells = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        cells.push(
          <View
            key={`${r}:${c}`}
            style={[styles.dot, { left: c * spacing, top: r * spacing, width: dot, height: dot, backgroundColor: color, opacity }]}
          />,
        );
      }
    }
    return cells;
  }, [rows, cols, spacing, dot, color, opacity]);

  if (width <= 0 || height <= 0) return null;

  return (
    <View pointerEvents="none" style={[styles.wrap, { width, height }]}>
      {dots}
    </View>
  );
}

export default memo(DotGridInner);

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    overflow: 'hidden',
  },
  dot: {
    position: 'absolute',
    borderRadius: 99,
  },
});
