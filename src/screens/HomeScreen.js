import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Modal,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { apiGet } from '../api/client';
import { glassPurpleFab, BRAND_PURPLE } from '../theme/glassUi';
import {
  LAB_ACCENT,
  LAB_GRADIENT_COLORS,
  LAB_GRADIENT_END,
  LAB_GRADIENT_LOCATIONS,
  LAB_GRADIENT_START,
  LAB_ON_GRADIENT_TEXT,
} from '../theme/labGradient';
/** Mid stops stay saturated — very light lilacs (#B899F5–type) interpolate to a whitish band in RGB. */
const SCHEDULE_BANNER_GRADIENT = [
  '#EA4A8F',
  '#E055B0',
  '#D045C8',
  '#B84AE0',
  '#8F52E6',
  BRAND_PURPLE,
];
const SCHEDULE_BANNER_LOCATIONS = [0, 0.17, 0.34, 0.5, 0.74, 1];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatHeaderSubtitle(d) {
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) {
    return `Today ${d.getDate()} ${MONTHS[d.getMonth()]}.`;
  }
  return `${DOW_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}.`;
}

function fmtTime(iso) {
  if (!iso) return '';
  const x = new Date(iso);
  return x.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function toYMDLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYMD(s) {
  const t = (s || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }
  const [y, mo, da] = t.split('-').map(Number);
  const d = new Date(y, mo - 1, da, 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function sameCalendarLocal(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * One row = Mon–Sun for the week that contains the currently selected calendar day.
 * Choosing another day updates the whole home for that date; if the day lies in another week, the row re-centers on that week.
 */
function weekDaysForContainingMonday(selected) {
  const d = new Date(selected);
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + mondayOffset);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    out.push({
      key: toYMDLocal(x),
      day: DOW_SHORT[x.getDay()],
      num: String(x.getDate()),
      ymd: toYMDLocal(x),
    });
  }
  return out;
}

const FALLBACK_DASH = {
  banner: { title: "Today's Schedule", subtitle: '' },
  dashboardDate: null,
  appointmentCount: 2,
  bannerAvatars: [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=100&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=100&auto=format&fit=crop',
  ],
  extraClientCount: 2,
  upcoming: {
    procedure_name: 'Balayage',
    client_name: 'Jennifer S.',
    start_at: null,
    end_at: null,
    chair_label: 'Chair 1',
    client_avatar_url:
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=100&auto=format&fit=crop',
  },
  lowStockPreview: {
    name: 'Koleston Perfect 7.21',
    brand: 'Wella',
    shade_code: '7.21',
    quantity: 45,
    low_stock_threshold: 80,
    unit: 'g',
  },
  lowStockCount: 2,
};

/** Plan row height (Lab | right column). */
const PLAN_GRID_ROW_H = 372;
const STOCK_SPLIT_LOW_FLEX = 7;
const STOCK_SPLIT_COMPACT_FLEX = 3;

export default function HomeScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [labStats, setLabStats] = useState(null);
  const hasFetchedOnce = useRef(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef(null);

  const strip = useMemo(() => weekDaysForContainingMonday(selectedDate), [selectedDate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!hasFetchedOnce.current) setLoading(true);
      try {
        const ymd = toYMDLocal(selectedDate);
        const dashP = apiGet(`/api/dashboard/day?date=${encodeURIComponent(ymd)}`).catch(() => null);
        const labP = apiGet('/api/lab/stats').catch(() => null);
        const [dash, lab] = await Promise.all([dashP, labP]);
        if (!cancelled) {
          setData(dash || FALLBACK_DASH);
          setLabStats(lab);
        }
      } catch {
        if (!cancelled) setData(FALLBACK_DASH);
        if (!cancelled) setLabStats(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
          hasFetchedOnce.current = true;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  const runSearch = useCallback(async (q) => {
    const t = q.trim();
    if (!t) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    try {
      const rows = await apiGet(`/api/clients?q=${encodeURIComponent(t)}`);
      setSearchResults(Array.isArray(rows) ? rows : []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const onSearchChange = useCallback(
    (text) => {
      setSearchQ(text);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        runSearch(text);
      }, 320);
    },
    [runSearch],
  );

  const openSearch = () => {
    setSearchOpen(true);
    setSearchQ('');
    setSearchResults([]);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQ('');
    setSearchResults([]);
    if (searchTimer.current) clearTimeout(searchTimer.current);
  };

  const d = data || FALLBACK_DASH;
  const bannerTitleDisplay = sameCalendarLocal(selectedDate, new Date())
    ? "Today's Schedule"
    : 'Schedule';
  const avatars = d.bannerAvatars?.length ? d.bannerAvatars : FALLBACK_DASH.bannerAvatars;
  const extra = d.extraClientCount ?? 0;
  const upcoming = d.upcoming;
  const appointmentCount =
    data != null && typeof data.appointmentCount === 'number' ? data.appointmentCount : null;
  const lowCount = d.lowStockCount ?? 1;

  const loadedYmd =
    data != null && typeof data.dashboardDate === 'string' ? data.dashboardDate : null;
  const selectedYmd = toYMDLocal(selectedDate);
  const isDashboardStale = loadedYmd != null && loadedYmd !== selectedYmd;

  const scheduleBannerSubtitle = isDashboardStale
    ? 'Updating…'
    : appointmentCount === null
      ? 'Tap to open calendar'
      : appointmentCount === 0
        ? 'No bookings for this day · tap to open calendar'
        : appointmentCount === 1
          ? `1 booking${upcoming?.start_at ? ` · ${fmtTime(upcoming.start_at)}` : ''} · tap for day`
          : `${appointmentCount} bookings · tap to view day`;

  const openCalendarForSelection = () =>
    navigation.navigate('Calendar', { openDate: toYMDLocal(selectedDate) });

  const nowTick = new Date();
  const planGridRowH = PLAN_GRID_ROW_H;

  const lowStockLine =
    lowCount === 1
      ? '1 product running low'
      : `${lowCount} products running low`;

  const lowStockCompactInner = (
    <View style={styles.stockCompactStack}>
      <View style={styles.badgeBlueCompact}>
        <Text style={styles.badgeTextBlueCompact}>Low stock</Text>
      </View>
      <Text style={styles.stockCompactSummary} numberOfLines={2}>
        {lowStockLine}
      </Text>
      <View style={styles.stockCompactFooter}>
        <View style={[styles.iconCircle, styles.iconCircleStockCompact]}>
          <Ionicons name="cube" size={13} color="#fff" />
        </View>
        <View style={[styles.iconCircle, styles.iconCircleStockCompact]}>
          <Ionicons name="cart" size={13} color="#fff" />
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        <View style={styles.header}>
          <View style={styles.userInfo}>
            <Image
              source={{
                uri: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=150&auto=format&fit=crop',
              }}
              style={styles.avatar}
            />
            <View>
              <Text style={styles.greeting}>Hello</Text>
              <Text style={styles.date}>{formatHeaderSubtitle(selectedDate)}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.searchButton} activeOpacity={0.85} onPress={openSearch}>
            <Ionicons name="search" size={20} color="#1C1C1E" />
          </TouchableOpacity>
        </View>

        {loading && !hasFetchedOnce.current ? (
          <View style={styles.loadingBanner}>
            <ActivityIndicator color="#1C1C1E" />
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.bannerTouchable}
          activeOpacity={0.9}
          onPress={openCalendarForSelection}
          accessibilityRole="button"
          accessibilityLabel={`Calendar for ${toYMDLocal(selectedDate)}`}
        >
          <LinearGradient
            colors={SCHEDULE_BANNER_GRADIENT}
            locations={SCHEDULE_BANNER_LOCATIONS}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.82, y: 1 }}
            style={styles.bannerGradient}
          >
            <View style={styles.bannerInnerRow}>
              <View style={styles.bannerTextContainer}>
                <Text style={styles.bannerTitle}>{bannerTitleDisplay}</Text>
                <Text style={styles.bannerSubtitle}>{scheduleBannerSubtitle}</Text>
                {appointmentCount != null && appointmentCount > 0 && !isDashboardStale ? (
                  <View style={styles.avatarGroup}>
                    {avatars.slice(0, 3).map((uri, i) => (
                      <Image
                        key={uri + i}
                        source={{ uri }}
                        style={[styles.miniAvatar, { marginLeft: i ? -10 : 0, zIndex: 3 - i }]}
                      />
                    ))}
                    {extra > 0 ? (
                      <View style={[styles.miniAvatarPlaceholder, { marginLeft: -10, zIndex: 0 }]}>
                        <Text style={styles.miniAvatarText}>+{extra}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
              <View style={styles.bannerCalendarCue}>
                <Ionicons name="calendar-outline" size={26} color="rgba(255,255,255,0.98)" />
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color="rgba(255,255,255,0.82)"
                  style={{ marginTop: 4 }}
                />
              </View>
            </View>
          </LinearGradient>
        </TouchableOpacity>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dateStrip}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {strip.map((item) => {
            const cellDate = parseYMD(item.ymd);
            const isSelected = sameCalendarLocal(cellDate, selectedDate);
            const isToday = sameCalendarLocal(cellDate, nowTick);
            return (
              <TouchableOpacity
                key={item.key}
                style={styles.dateCell}
                onPress={() => {
                  setSelectedDate((prev) => {
                    if (sameCalendarLocal(cellDate, prev)) return prev;
                    return new Date(cellDate.getTime());
                  });
                }}
                activeOpacity={0.85}
                delayPressIn={0}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                {isSelected ? (
                  <View style={styles.dateActiveBubble}>
                    <Text style={styles.dateTextDayActive}>{item.day}</Text>
                    <Text style={styles.dateTextNumActive}>{item.num}</Text>
                  </View>
                ) : (
                  <>
                    <Text
                      style={[
                        styles.dateTextDayIdle,
                        isToday && styles.dateTextDayToday,
                      ]}
                    >
                      {item.day}
                    </Text>
                    <Text
                      style={[
                        styles.dateTextNumIdle,
                        isToday && styles.dateTextNumToday,
                      ]}
                    >
                      {item.num}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Text style={styles.sectionTitle}>Your plan</Text>

        <View>
          <View style={[styles.gridTopRow, { height: planGridRowH }]}>
            <View style={styles.gridLeft}>
              <TouchableOpacity
                style={[styles.labCardOuter, styles.gridTallCard, styles.gridTallCardFill]}
                activeOpacity={0.92}
                onPress={() => navigation.navigate('Lab')}
              >
                <LinearGradient
                  colors={LAB_GRADIENT_COLORS}
                  locations={LAB_GRADIENT_LOCATIONS}
                  start={LAB_GRADIENT_START}
                  end={LAB_GRADIENT_END}
                  style={styles.labCardGradient}
                >
                  <View style={styles.badgeLab}>
                    <Text style={styles.badgeTextLab}>My lab</Text>
                  </View>
                  <Text style={[styles.cardTitle, styles.labCardTitle, styles.labPromoText]}>
                    Formulas & templates
                  </Text>
                  <Text style={[styles.cardSubtitle, styles.labPromoText]} numberOfLines={4}>
                    {labStats?.visits_with_formula_this_month != null
                      ? `${labStats.visits_with_formula_this_month} visits with formulas this month`
                      : 'Search, duplicate, save templates'}
                  </Text>
                  <View style={styles.labCardSpacer} />
                  <View style={styles.labRowCompact}>
                    <View style={styles.labIconCircle}>
                      <Ionicons name="flask-outline" size={18} color="#fff" />
                    </View>
                    <Text style={[styles.labHint, styles.labPromoText]}>Open lab</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            </View>

            <View style={styles.gridRight}>
              <View style={styles.stockVerticalStack}>
                <TouchableOpacity
                  style={[
                    styles.clientsShortcutCard,
                    styles.stockCardSized,
                    styles.stockLowInStack,
                    { flex: STOCK_SPLIT_LOW_FLEX },
                  ]}
                  activeOpacity={0.92}
                  onPress={() =>
                    navigation.navigate('Finance', { date: toYMDLocal(selectedDate) })
                  }
                >
                  <View style={styles.clientsShortcutHead}>
                    <View style={styles.clientsShortcutBadge}>
                      <Text style={styles.clientsShortcutBadgeText}>Finance</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
                  </View>
                  <View style={styles.clientsShortcutBody}>
                    <Ionicons name="wallet-outline" size={44} color="#C7C7CC" />
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.stockCompactSecondary,
                    styles.cardBlue,
                    styles.stockCardSized,
                    styles.stockCompactInStack,
                    { flex: STOCK_SPLIT_COMPACT_FLEX },
                  ]}
                  activeOpacity={0.92}
                  onPress={() => navigation.navigate('Inventory')}
                >
                  {lowStockCompactInner}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      <Modal visible={searchOpen} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalRoot}
        >
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeSearch} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Clients</Text>
              <TouchableOpacity onPress={closeSearch} hitSlop={12}>
                <Text style={styles.modalClose}>Done</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder=""
                placeholderTextColor="#1C1C1E"
                value={searchQ}
                onChangeText={onSearchChange}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {searchLoading ? (
              <ActivityIndicator style={{ marginTop: 20 }} />
            ) : (
              <FlatList
                data={searchResults}
                keyExtractor={(it) => String(it.id)}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 24 }}
                ListEmptyComponent={
                  searchQ.trim() ? (
                    <Text style={styles.emptySearch}>—</Text>
                  ) : null
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.searchHit}
                    activeOpacity={0.88}
                    onPress={() => {
                      closeSearch();
                      navigation.navigate('ClientDetail', { clientId: item.id });
                    }}
                  >
                    <Text style={styles.searchHitName}>{item.full_name}</Text>
                    {item.phone ? <Text style={styles.searchHitPhone}>{item.phone}</Text> : null}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  loadingBanner: {
    paddingVertical: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 30,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 16,
  },
  greeting: {
    fontSize: 18,
    fontWeight: '400',
    color: '#1C1C1E',
  },
  date: {
    fontSize: 14,
    color: '#1C1C1E',
    fontWeight: '400',
    marginTop: 2,
  },
  searchButton: {
    ...glassPurpleFab,
    justifyContent: 'center',
  },
  bannerTouchable: {
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 24,
    shadowColor: '#5E35B1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  bannerGradient: {
    paddingVertical: 24,
    paddingHorizontal: 24,
  },
  bannerInnerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bannerTextContainer: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.18)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  bannerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.94)',
    fontWeight: '400',
    marginBottom: 12,
  },
  bannerCalendarCue: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 8,
  },
  moreDots: { flexDirection: 'row', gap: 6, marginTop: 6, alignItems: 'center' },
  miniDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#64B5F6' },
  avatarGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  miniAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.88)',
  },
  miniAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniAvatarText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  dateStrip: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingVertical: 8,
    paddingRight: 8,
    marginBottom: 24,
  },
  dateCell: {
    minWidth: 48,
    minHeight: 56,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 4,
  },
  dateActiveBubble: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateTextDayActive: {
    fontSize: 12,
    fontWeight: '400',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  dateTextNumActive: {
    fontSize: 16,
    fontWeight: '400',
    color: '#FFFFFF',
  },
  dateTextDayIdle: {
    fontSize: 13,
    fontWeight: '400',
    color: '#1C1C1E',
    marginBottom: 4,
  },
  dateTextNumIdle: {
    fontSize: 16,
    fontWeight: '400',
    color: '#1C1C1E',
  },
  dateTextDayToday: {
    color: '#5E35B1',
  },
  dateTextNumToday: {
    color: '#5E35B1',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '400',
    color: '#1C1C1E',
    marginBottom: 16,
  },
  /**
   * Row `height` = `planGridRowH` — Lab | (Finance + compact low-stock).
   */
  gridTopRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
    marginHorizontal: 4,
  },
  gridLeft: {
    flex: 27,
    minWidth: 0,
  },
  gridRight: {
    flex: 21,
    minWidth: 0,
    minHeight: 0,
  },
  stockVerticalStack: {
    flex: 1,
    flexDirection: 'column',
    minHeight: 0,
    gap: 6,
  },
  stockLowInStack: {
    minHeight: 0,
    overflow: 'hidden',
  },
  stockCompactInStack: {
    minHeight: 0,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  clientsShortcutCard: {
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  clientsShortcutHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  clientsShortcutBadge: {
    backgroundColor: 'rgba(94, 53, 177, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  clientsShortcutBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: BRAND_PURPLE,
    letterSpacing: 0.3,
  },
  clientsShortcutBody: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridTallCard: {
    width: '100%',
  },
  /** Fill column when parent has explicit height (grid row). */
  gridTallCardFill: {
    flex: 1,
    minHeight: 100,
  },
  badgeBlueCompact: {
    backgroundColor: '#64B5F6',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: 5,
  },
  badgeTextBlueCompact: {
    fontSize: 9,
    fontWeight: '600',
    color: '#FFF',
  },
  stockCompactStack: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    justifyContent: 'center',
  },
  stockCompactSummary: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1C1C1E',
    lineHeight: 16,
  },
  stockCompactFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  iconCircleStockCompact: {
    width: 23,
    height: 23,
    borderRadius: 11,
  },
  stockCardSized: {
    width: '100%',
    overflow: 'hidden',
  },
  stockCompactSecondary: {
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 9,
    justifyContent: 'center',
  },
  cardStockCompact: {
    paddingVertical: 10,
    paddingHorizontal: 11,
  },
  card: {
    width: '48%',
    borderRadius: 24,
    padding: 20,
  },
  cardBlue: {
    backgroundColor: '#BBDEFB',
  },
  labCardOuter: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#14532d',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 8,
  },
  labCardGradient: {
    padding: 18,
    flex: 1,
  },
  labPromoText: {
    color: LAB_ON_GRADIENT_TEXT,
  },
  labCardTitle: {
    fontSize: 20,
    fontWeight: '500',
    lineHeight: 26,
    marginBottom: 6,
  },
  badgeLab: {
    backgroundColor: 'rgba(15, 31, 23, 0.35)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  badgeTextLab: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  labRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
  },
  labRowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  labCardSpacer: {
    flex: 1,
    minHeight: 4,
  },
  labIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: LAB_ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  labHint: {
    fontSize: 13,
    flex: 1,
    fontWeight: '500',
  },
  badgeBlue: {
    backgroundColor: '#64B5F6',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  badgeTextBlue: {
    fontSize: 11,
    fontWeight: '500',
    color: '#FFF',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '400',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  cardTitleStock: {
    marginBottom: 2,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '500',
  },
  cardSubtitleStock: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 0,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#1C1C1E',
    marginBottom: 2,
    fontWeight: '400',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },
  cardFooterAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
  },
  avatarFallback: {
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  cardFooterSubtitle: {
    fontSize: 13,
    fontWeight: '400',
    color: '#1C1C1E',
  },
  iconsRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 8,
  },
  iconsRowStock: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 6,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#64B5F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircleStock: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  iconCircleStockSecondary: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    minHeight: '45%',
    paddingBottom: 8,
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  modalTitle: { fontSize: 17, fontWeight: '400', color: '#1C1C1E' },
  modalClose: { fontSize: 17, fontWeight: '400', color: '#5E35B1' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1C1C1E',
  },
  searchHit: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  searchHitName: { fontSize: 16, fontWeight: '400', color: '#1C1C1E' },
  searchHitPhone: { fontSize: 14, color: '#1C1C1E', marginTop: 4 },
  emptySearch: { textAlign: 'center', color: '#1C1C1E', marginTop: 24 },
});
