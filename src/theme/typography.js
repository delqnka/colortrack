import { FontFamily } from './fonts';

/** lineHeight = fontSize * 1.45 (rounded) */
export function typeLh(fs) {
  return Math.round(fs * 1.45);
}

export const Type = {
  screenTitle: {
    fontFamily: FontFamily.semibold,
    fontSize: 22,
    lineHeight: typeLh(22),
    color: '#0D0D0D',
  },
  sectionLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 11,
    lineHeight: typeLh(11),
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: '#AEAEB2',
  },
  listPrimary: {
    fontFamily: FontFamily.medium,
    fontSize: 15,
    lineHeight: typeLh(15),
    color: '#0D0D0D',
  },
  secondary: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    lineHeight: typeLh(13),
    color: '#8A8A8E',
  },
  price: {
    fontFamily: FontFamily.semibold,
    fontSize: 15,
    lineHeight: typeLh(15),
    color: '#6B4EFF',
  },
  statBig: {
    fontFamily: FontFamily.semibold,
    fontSize: 28,
    lineHeight: typeLh(28),
    color: '#0D0D0D',
  },
  buttonLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 15,
    lineHeight: typeLh(15),
  },
  tabBarLabel: {
    fontFamily: FontFamily.regular,
    fontSize: 11,
    lineHeight: typeLh(11),
  },
  greetingHello: {
    fontFamily: FontFamily.medium,
    fontSize: 17,
    lineHeight: typeLh(17),
    color: '#0D0D0D',
  },
  greetingDate: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    lineHeight: typeLh(13),
    color: '#AEAEB2',
  },
  /** Calendar month grid: weekday row (S M T …). */
  calendarWeekdayAbbrev: {
    fontFamily: FontFamily.regular,
    fontSize: 11,
    lineHeight: typeLh(11),
    color: '#1C1C1E',
  },
  /** Calendar month grid: digits inside day circles */
  calendarMonthCell: {
    fontFamily: FontFamily.medium,
    fontSize: 15,
    lineHeight: typeLh(15),
    color: '#1C1C1E',
  },
};
