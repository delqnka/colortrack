/** Brand purple + frosted-glass chips (header close, FABs, tab bar tint). */

export const BRAND_PURPLE = '#5E35B1';
const P = { r: 94, g: 53, b: 177 };

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
  backgroundColor: BRAND_PURPLE,
  alignItems: 'center',
  justifyContent: 'center',
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.14,
  shadowRadius: 3,
  elevation: 3,
};

export const glassPurpleTabBar = {
  backgroundColor: `rgba(${P.r}, ${P.g}, ${P.b}, 0.76)`,
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.4)',
};
