/**
 * Stored amounts are integers in smallest standard fraction (typically hundredths): 5099 → 50.99 main units when showing 2-decimal currencies.
 */
import { normalizeCurrencyCode } from '../constants/currencyCodes';

/** @returns {null|string} */
export function formatMinorFromStoredCents(cents, currencyCode = 'USD') {
  if (cents == null || cents === '') return null;
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  const cur = normalizeCurrencyCode(String(currencyCode || 'USD'), 'USD');
  const major = n / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(major);
  } catch {
    try {
      return `${major.toFixed(2)} ${cur}`;
    } catch {
      return null;
    }
  }
}

export function formatMinorFromStoredCentsOrDash(cents, currencyCode = 'USD') {
  const s = formatMinorFromStoredCents(cents, currencyCode);
  return s == null ? '—' : s;
}
