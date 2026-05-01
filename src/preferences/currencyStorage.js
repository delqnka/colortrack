import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'colortrack_currency_iso';

export async function loadCurrencyPreference(defaultCode = 'USD') {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const t = String(raw || '').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(t) ? t : defaultCode;
  } catch {
    return defaultCode;
  }
}

export async function persistCurrencyPreference(iso4217Upper) {
  const t = String(iso4217Upper || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(t)) return;
  await AsyncStorage.setItem(STORAGE_KEY, t);
}
