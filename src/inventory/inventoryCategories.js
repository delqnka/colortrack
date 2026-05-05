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

const RETAIL_KEYWORDS = /\b(conditioner|shampoo|serum|treatment|mask|spray|styling|gel|cream|mousse|lotion|oil|scalp|hair\s*care|retail)\b/i;
const OXIDANT_KEYWORDS = /\b(oxid|developer|welloxon|blondor|lightener|bleach|perox|creme\s*ox)\b/i;
const TONER_KEYWORDS = /\b(toner|gloss|shinefinity|color\s*gloss)\b/i;
const MIXTONE_KEYWORDS = /\b(mixtone|mix.tone|direct|special\s*mix)\b/i;

export function importCategoryForItem(item) {
  const cat = String(item?.category || '').toLowerCase();
  if (cat === 'retail') return 'retail';
  if (cat === 'oxidant') return 'oxidant';
  if (cat === 'mixtone') return 'mixtone';
  if (cat === 'toner') return 'toner';

  const text = [item?.name, item?.brand].filter(Boolean).join(' ');
  if (RETAIL_KEYWORDS.test(text)) return 'retail';
  if (OXIDANT_KEYWORDS.test(text)) return 'oxidant';
  if (TONER_KEYWORDS.test(text)) return 'toner';
  if (MIXTONE_KEYWORDS.test(text)) return 'mixtone';
  if (cat === 'dye' && looksLikeColorProduct(item)) return 'dye';
  if (looksLikeColorProduct(item)) return 'dye';
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
