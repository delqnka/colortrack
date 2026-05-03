import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'colortrack_onboarding_complete_v2';

export async function isOnboardingComplete() {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setOnboardingComplete() {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
}
