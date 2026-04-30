import { getCountries, getCountryCallingCode, parsePhoneNumber } from 'libphonenumber-js';

let cachedList;

export function getPhoneCountries() {
  if (!cachedList) {
    const nf =
      typeof Intl !== 'undefined' && Intl.DisplayNames
        ? new Intl.DisplayNames(['en'], { type: 'region' })
        : null;
    cachedList = getCountries()
      .map((iso) => ({
        iso,
        dial: getCountryCallingCode(iso),
        name: nf ? nf.of(iso) || iso : iso,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }
  return cachedList;
}

export function formatE164(iso, nationalRaw) {
  const digits = String(nationalRaw || '').replace(/\D/g, '');
  if (!digits) return null;
  try {
    const p = parsePhoneNumber(digits, iso);
    if (p && p.isValid()) return p.format('E.164');
  } catch (_) {
    /* fallback */
  }
  return `+${getCountryCallingCode(iso)}${digits}`;
}

/** Split stored E.164 or raw digits for the form (default country if unknown). */
export function splitPhoneForForm(stored, defaultIso = 'BG') {
  if (!stored || !String(stored).trim()) {
    return { iso: defaultIso, national: '' };
  }
  const s = String(stored).trim();
  try {
    const p = parsePhoneNumber(s);
    if (p) {
      return { iso: p.country || defaultIso, national: String(p.nationalNumber) };
    }
  } catch (_) {
    /* use heuristics below */
  }
  const digitsOnly = s.replace(/\D/g, '');
  return { iso: defaultIso, national: digitsOnly };
}

export function flagEmoji(iso) {
  if (!iso || iso.length !== 2) return '🏳️';
  const u = iso.toUpperCase();
  const A = 65;
  const a = u.charCodeAt(0);
  const b = u.charCodeAt(1);
  if (a < A || a > A + 25 || b < A || b > A + 25) return '🏳️';
  return String.fromCodePoint(a - A + 0x1f1e6, b - A + 0x1f1e6);
}
