/**
 * My Lab — green → yellow gradient (emerald → lime → lemon).
 * No amber/orange-gold stops; mids stay green-chartreuse so it reads as green→yellow, not green→orange.
 */
export const LAB_GRADIENT_COLORS = [
  '#065F46',
  '#047857',
  '#059669',
  '#16A34A',
  '#84CC16',
  '#EAB308',
];

export const LAB_GRADIENT_LOCATIONS = [0, 0.17, 0.34, 0.5, 0.74, 1];

export const LAB_GRADIENT_START = { x: 0, y: 0 };
export const LAB_GRADIENT_END = { x: 0.82, y: 1 };

/** Primary accent on Lab screen (chips, buttons, icons) — deep green, works with gradient */
export const LAB_ACCENT = '#166534';

/** Text on / over lab gradient cards */
export const LAB_ON_GRADIENT_TEXT = '#0F1F17';
