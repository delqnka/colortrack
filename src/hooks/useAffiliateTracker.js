import { useEffect } from 'react';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@colortrack:affiliate_code';

function extractRef(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.searchParams.get('ref') || null;
  } catch {
    const m = url.match(/[?&]ref=([^&#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
}

function saveRef(url) {
  const ref = extractRef(url);
  if (ref) {
    AsyncStorage.setItem(STORAGE_KEY, ref.toUpperCase().trim()).catch(() => {});
  }
}

// Call at the top level of App to capture deep-link ref params.
export function useAffiliateTracker() {
  useEffect(() => {
    Linking.getInitialURL().then((url) => saveRef(url)).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => saveRef(url));
    return () => sub.remove();
  }, []);
}

// Call after login to push the stored affiliate code to RevenueCat.
export async function applyAffiliateAttribute() {
  try {
    const code = await AsyncStorage.getItem(STORAGE_KEY);
    if (!code) return;
    const { default: Purchases } = await import('react-native-purchases');
    await Purchases.setAttributes({ affiliate_id: code });
  } catch {
    // noop — RC not yet configured or no code stored
  }
}
