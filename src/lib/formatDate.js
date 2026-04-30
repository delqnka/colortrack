/**
 * Calendar dates from API are YYYY-MM-DD (local calendar day). Parse without UTC shift.
 */
export function parseISODateToLocal(isoYmd) {
  const t = (isoYmd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }
  const [y, m, day] = t.split('-').map(Number);
  const d = new Date(y, m - 1, day, 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Localized “day month year” (e.g. 1 януари 2026 г. / January 1, 2026). */
export function formatDisplayDate(value) {
  if (value == null || value === '') return '—';
  const s = typeof value === 'string' ? value : String(value);
  let y;
  let mo;
  let day;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    [y, mo, day] = s.slice(0, 10).split('-').map(Number);
  } else {
    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) return s;
    y = dt.getFullYear();
    mo = dt.getMonth() + 1;
    day = dt.getDate();
  }
  const local = new Date(y, mo - 1, day, 12, 0, 0, 0);
  try {
    return local.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return `${day}.${mo}.${y}`;
  }
}
