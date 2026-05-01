/**
 * Today's schedule banner (Home) — pink → magenta → lilac → brand purple.
 * Re-used for Lab "formula visits · this month" summary card.
 */
import { BRAND_PURPLE } from './glassUi';

export const SCHEDULE_BANNER_LEAD_PINK = '#EA4A8F';

export const SCHEDULE_BANNER_GRADIENT = [
  SCHEDULE_BANNER_LEAD_PINK,
  '#E055B0',
  '#D045C8',
  '#B84AE0',
  '#8F52E6',
  BRAND_PURPLE,
];

export const SCHEDULE_BANNER_LOCATIONS = [0, 0.17, 0.34, 0.5, 0.74, 1];

export const SCHEDULE_BANNER_GRADIENT_START = { x: 0, y: 0 };

export const SCHEDULE_BANNER_GRADIENT_END = { x: 0.82, y: 1 };
