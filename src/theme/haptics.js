import * as Haptics from 'expo-haptics';

export function hapticImpactLight() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
