/** Brand purple + frosted-glass chips (header close, FABs, tab bar tint). */

const P = { r: 94, g: 53, b: 177 };

export const BRAND_PURPLE = '#5E35B1';
/** Focused tab icon + header accents aligned with bottom bar */
export const TAB_BAR_ACCENT_PURPLE = '#6D43BE';
/** Tab bar pill background (legacy / non-blur fallbacks) */
export const TAB_BAR_FILL = `rgba(${P.r}, ${P.g}, ${P.b}, 0.88)`;
/** My lab card gradient violet (end stop); matches focused tab-bar icon hue */
export const MY_LAB_VIOLET = '#452277';
/** Active tab: white circle behind icon; focused icon uses MY_LAB_VIOLET */
export const TAB_BAR_ACTIVE_BUBBLE = '#FFFFFF';
/** Warmer lilac from schedule gradients — reads less blue than BRAND_PURPLE on pale cards */
export const BRAND_LILAC = '#B84AE0';

export const glassPurpleIconBtn = {
  width: 40,
  height: 40,
  borderRadius: 20,
  backgroundColor: `rgba(${P.r}, ${P.g}, ${P.b}, 0.32)`,
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.55)',
  alignItems: 'center',
  justifyContent: 'center',
  shadowColor: BRAND_PURPLE,
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.32,
  shadowRadius: 5,
  elevation: 4,
};

export const glassPurpleFab = {
  width: 44,
  height: 44,
  borderRadius: 22,
  backgroundColor: `rgba(${P.r}, ${P.g}, ${P.b}, 0.32)`,
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.55)',
  alignItems: 'center',
  justifyContent: 'center',
  shadowColor: BRAND_PURPLE,
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.35,
  shadowRadius: 8,
  elevation: 4,
};

/** Header + FAB: solid brand purple + tight shadow (crisper than translucent tab pill). */
export const glassPurpleFabBar = {
  width: 44,
  height: 44,
  borderRadius: 22,
  backgroundColor: MY_LAB_VIOLET,
  alignItems: 'center',
  justifyContent: 'center',
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.14,
  shadowRadius: 3,
  elevation: 3,
};

export const glassPurpleTabBar = {
  backgroundColor: '#1C1033',
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.08)',
};
