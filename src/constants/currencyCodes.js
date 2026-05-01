/**
 * Preferred: ECMA‑402 Intl.supportedValuesOf('currency') (current active ISO 4217 from engine).
 * Fallback: snapshot from Node Intl (≈162 codes).
 */
function codesFromIntl() {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      const raw = Intl.supportedValuesOf('currency');
      if (Array.isArray(raw) && raw.length > 80) {
        return [...new Set(raw.map((c) => String(c || '').trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c)))].sort(
          (a, b) => a.localeCompare(b),
        );
      }
    }
  } catch (_) {}
  return null;
}

/** @type {readonly string[]} */
const FALLBACK_SORTED_ISO = JSON.parse(`["AED","AFN","ALL","AMD","ANG","AOA","ARS","AUD","AWG","AZN","BAM","BBD","BDT","BGN","BHD","BIF","BMD","BND","BOB","BRL","BSD","BTN","BWP","BYN","BZD","CAD","CDF","CHF","CLP","CNY","COP","CRC","CUC","CUP","CVE","CZK","DJF","DKK","DOP","DZD","EGP","ERN","ETB","EUR","FJD","FKP","GBP","GEL","GHS","GIP","GMD","GNF","GTQ","GYD","HKD","HNL","HRK","HTG","HUF","IDR","ILS","INR","IQD","IRR","ISK","JMD","JOD","JPY","KES","KGS","KHR","KMF","KPW","KRW","KWD","KYD","KZT","LAK","LBP","LKR","LRD","LSL","LYD","MAD","MDL","MGA","MKD","MMK","MNT","MOP","MRU","MUR","MVR","MWK","MXN","MYR","MZN","NAD","NGN","NIO","NOK","NPR","NZD","OMR","PAB","PEN","PGK","PHP","PKR","PLN","PYG","QAR","RON","RSD","RUB","RWF","SAR","SBD","SCR","SDG","SEK","SGD","SHP","SLE","SLL","SOS","SRD","SSP","STN","SVC","SYP","SZL","THB","TJS","TMT","TND","TOP","TRY","TTD","TWD","TZS","UAH","UGX","USD","UYU","UZS","VES","VND","VUV","WST","XAF","XCD","XCG","XDR","XOF","XPF","XSU","YER","ZAR","ZMW","ZWG","ZWL"]`);

let memoList = null;
let memoSet = null;

export function getAllSortedCurrencyCodes() {
  if (memoList) return memoList;
  memoList = codesFromIntl() || [...FALLBACK_SORTED_ISO];
  memoSet = new Set(memoList);
  return memoList;
}

export function currencyCodeIsSupported(code) {
  if (!code || typeof code !== 'string') return false;
  const up = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(up)) return false;
  if (!memoSet) getAllSortedCurrencyCodes();
  return memoSet.has(up);
}

export function normalizeCurrencyCode(code, fallback = 'USD') {
  const up = typeof code === 'string' ? code.trim().toUpperCase() : '';
  return currencyCodeIsSupported(up) ? up : fallback;
}
