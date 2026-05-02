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
  useWindowDimensions,
  AppState,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { apiGet } from '../api/client';
import SFIcon from '../components/SFIcon';
import { glassPurpleFab, BRAND_PURPLE } from '../theme/glassUi';
import { FontFamily } from '../theme/fonts';
import {
  LAB_GRADIENT_COLORS,
  LAB_GRADIENT_END,
  LAB_GRADIENT_LOCATIONS,
  LAB_GRADIENT_START,
  LAB_ON_GRADIENT_TEXT,
} from '../theme/labGradient';
import {
  SCHEDULE_BANNER_GRADIENT,
  SCHEDULE_BANNER_GRADIENT_END,
  SCHEDULE_BANNER_GRADIENT_START,
  SCHEDULE_BANNER_LOCATIONS,
  SCHEDULE_BANNER_LEAD_PINK,
} from '../theme/scheduleBannerGradient';

const FINANCE_CARD_GRADIENT_COLORS = ['#BFDBFE', '#5AA7F7', '#2563EB', '#0E4788'];
const FINANCE_CARD_GRADIENT_LOCATIONS = [0, 0.32, 0.68, 1];
const FINANCE_CARD_GRADIENT_START = { x: 0.35, y: 0 };
const FINANCE_CARD_GRADIENT_END = { x: 0.65, y: 1 };

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

const HEADER_AVATAR_FALLBACK =
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=150&auto=format&fit=crop';

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

/** Must match `styles.gridTopRow` horizontal margin (4 + 4). */
const PLAN_GRID_ROW_MARGIN_H = 8;
/** Must match `styles.gridTopRow` gap. */
const PLAN_GRID_COL_GAP = 10;

/** Keep in sync with `App.js` (`MainTabs`) — `TAB_H` + `bottomOffset` footprint. */
const TAB_BAR_SURFACE_H = 64;
const TAB_BAR_BOTTOM_OFFSET_EXTRA = 20;
const TAB_ABOVE_PLAN_AIR = 14;

/**
 * Padding under the plan row inside the ScrollView — ends content just above the
 * floating tab (see `App.js` MainTabs absolute tab bar).
 * Safe-area bottom is already applied on the screen inset, so subtract it here.
 */
function homeScrollReserveBottom(insetBottom) {
  const bottomOffset = Math.max(insetBottom, 12) + TAB_BAR_BOTTOM_OFFSET_EXTRA;
  return Math.max(bottomOffset + TAB_BAR_SURFACE_H - insetBottom + TAB_ABOVE_PLAN_AIR, 72);
}

/**
 * Plan row fallback (before layout): Lab column width × ~1.42, clamped — no “stretched” column.
 */
function planGridRowHeight(windowWidth) {
  const gridRowW = Math.max(0, windowWidth - 48 - PLAN_GRID_ROW_MARGIN_H);
  const inner = Math.max(0, gridRowW - PLAN_GRID_COL_GAP);
  const leftColW = inner * (27 / 48);
  const h = Math.round(leftColW * 1.42);
  return Math.min(Math.max(h - 24, 254), 312);
}

const STOCK_SPLIT_LOW_FLEX = 7;
const STOCK_SPLIT_COMPACT_FLEX = 3;
const STOCK_SPLIT_SERVICES_FLEX = 3;

export default function HomeScreen() {
  const navigation = useNavigation();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [labStats, setLabStats] = useState(null);
  const hasFetchedOnce = useRef(false);
  const selectedDateRef = useRef(selectedDate);
  const homeFocusedRef = useRef(false);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef(null);

  const [profileMe, setProfileMe] = useState(null);
  const loadProfileMe = useCallback(() => {
    apiGet('/api/me', { allowStaleCache: false })
      .then(setProfileMe)
      .catch(() => setProfileMe(null));
  }, []);

  useFocusEffect(
    useCallback(() => {
      homeFocusedRef.current = true;
      return () => {
        homeFocusedRef.current = false;
      };
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      loadProfileMe();
    }, [loadProfileMe]),
  );

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

  const refreshHomeDataSilent = useCallback(async () => {
    const ymd = toYMDLocal(selectedDateRef.current);
    try {
      const dashP = apiGet(`/api/dashboard/day?date=${encodeURIComponent(ymd)}`, {
        allowStaleCache: false,
      }).catch(() => null);
      const labP = apiGet('/api/lab/stats', { allowStaleCache: false }).catch(() => null);
      const [dash, lab] = await Promise.all([dashP, labP]);
      if (toYMDLocal(selectedDateRef.current) !== ymd) return;
      setData(dash || FALLBACK_DASH);
      setLabStats(lab);
    } catch {
      if (toYMDLocal(selectedDateRef.current) !== ymd) return;
      setData(FALLBACK_DASH);
      setLabStats(null);
    }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !homeFocusedRef.current) return;
      refreshHomeDataSilent();
      loadProfileMe();
    });
    return () => sub.remove();
  }, [refreshHomeDataSilent, loadProfileMe]);

  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refreshHomeDataSilent();
      loadProfileMe();
    } finally {
      setPullRefreshing(false);
    }
  }, [refreshHomeDataSilent, loadProfileMe]);

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

  const [homeViewportH, setHomeViewportH] = useState(0);
  const [abovePlanH, setAbovePlanH] = useState(0);

  const scrollReserveBottom = useMemo(
    () => homeScrollReserveBottom(insets.bottom),
    [insets.bottom],
  );

  const planGridRowH = useMemo(() => {
    const fallback = planGridRowHeight(windowWidth);
    const viewH =
      homeViewportH > 20
        ? homeViewportH
        : Math.max(0, windowHeight - insets.top - insets.bottom);
    if (viewH > 40 && abovePlanH > 24) {
      const fill = Math.round(viewH - abovePlanH - scrollReserveBottom);
      if (fill >= 248) {
        return Math.min(Math.max(fill - 24, fallback - 36), 360);
      }
    }
    return fallback;
  }, [
    windowWidth,
    windowHeight,
    homeViewportH,
    abovePlanH,
    scrollReserveBottom,
    insets.top,
    insets.bottom,
  ]);

  const lowStockLine =
    lowCount === 1
      ? '1 product running low'
      : `${lowCount} products running low`;
  const greetingName = profileMe?.display_name?.trim();
  const formulasVisitCount = Number(labStats?.visits_with_formula_this_month ?? 0);
  const formulasVisitLabel =
    formulasVisitCount === 1 ? ' visit with formulas this month' : ' visits with formulas this month';

  const lowStockCompactInner = (
    <View style={styles.stockCompactStack}>
      <Text style={styles.lowStockBadgeText}>Low stock</Text>
      <Text style={styles.lowStockSummary} numberOfLines={2}>
        {lowStockLine}
      </Text>
      <View style={styles.stockCompactFooter}>
        <View style={[styles.iconCircle, styles.iconCircleStockCompact, styles.iconCircleLowStock]}>
          <SFIcon name="file-tray-full" iosName="cabinet.fill" size={13} color="#FFFFFF" />
        </View>
        <View style={[styles.iconCircle, styles.iconCircleStockCompact, styles.iconCircleLowStock]}>
          <Ionicons name="cart" size={13} color="#fff" />
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.viewportFill} onLayout={(e) => setHomeViewportH(e.nativeEvent.layout.height)}>
        <ScrollView
          style={styles.container}
          contentContainerStyle={[
            homeViewportH > 0 ? { minHeight: homeViewportH } : null,
            { paddingBottom: scrollReserveBottom },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          refreshControl={
            <RefreshControl
              refreshing={pullRefreshing}
              onRefresh={onPullRefresh}
              tintColor={BRAND_PURPLE}
            />
          }
        >
          <View onLayout={(e) => setAbovePlanH(e.nativeEvent.layout.height)}>
        <View style={styles.header}>
          <View style={styles.userInfo}>
            <TouchableOpacity
              onPress={() => navigation.navigate('Profile')}
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel="Profile"
            >
              <Image
                source={{
                  uri: profileMe?.avatar_url || HEADER_AVATAR_FALLBACK,
                }}
                style={styles.avatar}
              />
            </TouchableOpacity>
            <View>
              <Text style={styles.greeting} numberOfLines={1}>
                {greetingName ? `Hello, ${greetingName}` : 'Hello'}
              </Text>
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
                start={SCHEDULE_BANNER_GRADIENT_START}
                end={SCHEDULE_BANNER_GRADIENT_END}
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

            <Text style={styles.sectionTitle}>Salon tools</Text>
          </View>

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
                  <Text style={styles.badgeTextLab}>My lab</Text>
                  <View style={styles.labCardMain}>
                    <Text style={[styles.labPlanTitle, styles.labPromoText]}>My formulas</Text>
                    <View style={styles.labIconCenter}>
                      <View style={styles.labIconPlate}>
                        <Ionicons name="flask" size={58} color="#F1FEE2" />
                      </View>
                    </View>
                    <Text style={[styles.labPlanMeta, styles.labPromoText]} numberOfLines={2}>
                      <Text style={styles.labPlanMetaNumber}>{formulasVisitCount}</Text>
                      {formulasVisitLabel}
                    </Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            </View>

            <View style={styles.gridRight}>
              <View style={styles.stockVerticalStack}>
                <TouchableOpacity
                  style={[
                    styles.financeCardOuter,
                    styles.stockCardSized,
                    styles.stockLowInStack,
                    { flex: STOCK_SPLIT_LOW_FLEX },
                  ]}
                  activeOpacity={0.92}
                  onPress={() =>
                    navigation.navigate('Finance', { date: toYMDLocal(selectedDate) })
                  }
                >
                  <LinearGradient
                    colors={FINANCE_CARD_GRADIENT_COLORS}
                    locations={FINANCE_CARD_GRADIENT_LOCATIONS}
                    start={FINANCE_CARD_GRADIENT_START}
                    end={FINANCE_CARD_GRADIENT_END}
                    style={styles.financeCardGradient}
                  >
                    <View style={styles.financeCardHead}>
                      <Text style={styles.financeBadgeText}>Finance</Text>
                      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.92)" />
                    </View>
                    <View style={styles.financeCardBody}>
                      <Ionicons name="wallet-outline" size={36} color="rgba(255,255,255,0.94)" />
                      <Text style={styles.financeCardSubtitle}>Revenue & Expenses</Text>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.stockCompactSecondary,
                    styles.lowStockCard,
                    styles.stockCardSized,
                    styles.stockCompactInStack,
                    { flex: STOCK_SPLIT_COMPACT_FLEX },
                  ]}
                  activeOpacity={0.92}
                  onPress={() => navigation.navigate('Inventory')}
                >
                  {lowStockCompactInner}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.stockCompactSecondary,
                    styles.servicesCompactCard,
                    styles.stockCardSized,
                    styles.stockCompactInStack,
                    { flex: STOCK_SPLIT_SERVICES_FLEX },
                  ]}
                  activeOpacity={0.92}
                  onPress={() => navigation.navigate('Services')}
                >
                  <View style={styles.servicesCompactInner}>
                    <Text style={styles.servicesCompactBadge}>Services</Text>
                    <Text style={styles.servicesCompactTitle} numberOfLines={2}>
                      Price list
                    </Text>
                    <View style={styles.servicesCompactFooter}>
                      <View style={[styles.iconCircle, styles.iconCircleStockCompact, styles.iconCircleServices]}>
                        <Ionicons name="cut-outline" size={13} color="#fff" />
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
            </View>
          </View>
        </ScrollView>
      </View>

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
  viewportFill: {
    flex: 1,
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
    marginTop: 16,
    marginBottom: 18,
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
    marginBottom: 18,
    shadowColor: '#5E35B1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  bannerGradient: {
    paddingVertical: 18,
    paddingHorizontal: 20,
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
    fontSize: 19,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
    textShadowColor: 'rgba(0,0,0,0.18)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  bannerSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.94)',
    fontWeight: '400',
    marginBottom: 10,
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
    marginBottom: 20,
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
    fontSize: 18,
    fontWeight: '400',
    color: '#1C1C1E',
    marginBottom: 14,
  },
  /**
   * Row `height` = `planGridRowH` — Lab | (Finance + compact low-stock).
   */
  gridTopRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
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
  financeCardOuter: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#0F4C9B',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.32,
    shadowRadius: 10,
    elevation: 6,
  },
  financeCardGradient: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 0,
  },
  financeCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  financeBadgeText: {
    fontSize: 10,
    fontFamily: FontFamily.bold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  financeCardBody: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  financeCardSubtitle: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 17,
    fontFamily: FontFamily.medium,
    color: 'rgba(255,255,255,0.96)',
    textAlign: 'center',
  },
  gridTallCard: {
    width: '100%',
  },
  /** Fill column when parent has explicit height (grid row). */
  gridTallCardFill: {
    flex: 1,
    minHeight: 96,
  },
  lowStockCard: {
    backgroundColor: SCHEDULE_BANNER_LEAD_PINK,
    shadowColor: '#B8326E',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.32,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 0,
  },
  lowStockBadgeText: {
    fontSize: 9,
    fontFamily: FontFamily.semibold,
    color: '#FFFFFF',
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  lowStockSummary: {
    marginTop: 5,
    fontSize: 12,
    fontFamily: FontFamily.semibold,
    color: 'rgba(255,255,255,0.96)',
    lineHeight: 16,
  },
  iconCircleLowStock: {
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  servicesCompactCard: {
    backgroundColor: '#F97316',
    borderWidth: 0,
    shadowColor: '#B7791F',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 4,
  },
  servicesCompactInner: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  servicesCompactBadge: {
    fontSize: 9,
    fontFamily: FontFamily.semibold,
    color: '#FFFFFF',
    alignSelf: 'flex-start',
    marginBottom: 5,
  },
  servicesCompactTitle: {
    fontSize: 12,
    fontFamily: FontFamily.semibold,
    color: '#FFFFFF',
    lineHeight: 16,
  },
  servicesCompactFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  iconCircleServices: {
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  stockCompactStack: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  stockCompactFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
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
    borderRadius: 24,
    paddingVertical: 8,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  cardStockCompact: {
    paddingVertical: 8,
    paddingHorizontal: 11,
  },
  card: {
    width: '48%',
    borderRadius: 24,
    padding: 20,
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
    padding: 13,
    flex: 1,
    flexDirection: 'column',
  },
  labPromoText: {
    color: LAB_ON_GRADIENT_TEXT,
  },
  labPlanTitle: {
    fontFamily: FontFamily.medium,
    fontSize: 18,
    lineHeight: 23,
    marginBottom: 10,
    textAlign: 'center',
  },
  labPlanMeta: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  labPlanMetaNumber: {
    fontFamily: FontFamily.bold,
    fontSize: 24,
    lineHeight: 28,
  },
  badgeTextLab: {
    fontSize: 12,
    fontFamily: FontFamily.semibold,
    color: LAB_ON_GRADIENT_TEXT,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  labCardMain: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ translateY: -8 }],
  },
  labIconCenter: {
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  labIconPlate: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: 'rgba(255,255,255,0.16)',
    justifyContent: 'center',
    alignItems: 'center',
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
