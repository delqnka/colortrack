const COLOR_CATEGORY_KEYS = new Set(['dye', 'oxidant', 'mixtone', 'toner']);

export function inventoryCategoryKey(raw) {
  const c = String(raw || '').trim().toLowerCase();
  if (c === 'color' || c === 'colors' || c === 'colour' || c === 'dyes') return 'dye';
  if (c === 'developer' || c === 'oxidants') return 'oxidant';
  if (c === 'mixtones') return 'mixtone';
  if (c === 'toners') return 'toner';
  if (c === 'consumables') return 'consumable';
  return c || 'other';
}

export function looksLikeColorProduct(item) {
  const shade = String(item?.shade_code || '').trim().toLowerCase();
  if (/\b\d{1,2}(?:[.,/-]\d{1,2}){0,2}\b/.test(shade)) return true;
  if (/\b\d{1,2}[a-z]{1,3}\b/i.test(shade)) return true;
  const text = [item?.name, item?.brand].filter(Boolean).join(' ').toLowerCase();
  return (
    /\b(koleston|illumina|color touch|majirel|inoa|dialight|igora|royal|wella|loreal|l'oreal|schwarzkopf|matrix|redken|shades eq|welloxon)\b/.test(
      text,
    )
  );
}

export function importCategoryForItem(item) {
  if (item?.category === 'retail') return 'retail';
  if (item?.category === 'oxidant') return 'oxidant';
  if (item?.category === 'dye' && looksLikeColorProduct(item)) return 'dye';
  return 'consumable';
}

/** Items shown under the Inventory “Colors” tab (includes developer). */
export function isColorItem(item) {
  const c = inventoryCategoryKey(item?.category);
  if (c !== 'dye') return COLOR_CATEGORY_KEYS.has(c);
  return looksLikeColorProduct(item);
}

/** Formula colour rows: dyes + mixtone + toner — not developer, retail, or general stock. */
export function isColourFormulaPickItem(item) {
  const c = inventoryCategoryKey(item?.category);
  if (c === 'dye') return looksLikeColorProduct(item);
  return c === 'mixtone' || c === 'toner';
}

export function isDeveloperInventoryPickItem(item) {
  return inventoryCategoryKey(item?.category) === 'oxidant';
}

/** List / picker: developer + tube dyes counted in bottles (pcs), not ml/g on hand. */
export function displayStockUnit(item) {
  const c = inventoryCategoryKey(item?.category);
  if (c === 'oxidant' || c === 'dye') return 'pcs';
  const u = String(item?.unit || '').trim().toLowerCase();
  return u || 'pcs';
}
