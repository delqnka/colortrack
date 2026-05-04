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
  DeviceEventEmitter,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiGet, apiReadStaleCache, getProfileMeCacheStorageKey, resolveImagePublicUri } from '../api/client';
import { BRAND_PURPLE, MY_LAB_VIOLET } from '../theme/glassUi';
import { hapticImpactLight } from '../theme/haptics';
import { useCurrency } from '../context/CurrencyContext';
import CurrencyPickerModal from '../components/CurrencyPickerModal';
import { formatMinorFromStoredCents } from '../format/moneyDisplay';
import { FontFamily } from '../theme/fonts';
import { Type, typeLh } from '../theme/typography';

/** Per-card relief shadow — strong enough to read as raised; radius capped vs very wide blooms. */
const HOME_RAISED_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.12,
  shadowRadius: 15,
  elevation: 10,
};

/** My lab rim; date-active bubble rim only — white cards rely on shadow, no strokes. */
const SALON_LAB_GLASS_OUTLINE = 'rgba(255, 255, 255, 0.14)';

/** Black → visible deep violet — two similar stops looked flat on OLED. */
const SALON_LAB_GRADIENT_COLORS = ['#000000', '#160B28', MY_LAB_VIOLET];
const SALON_LAB_GRADIENT_LOCATIONS = [0, 0.42, 1];

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

function todayNoonLocal() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0, 0, 0);
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

/** Unused; kept so stale Metro bundles cannot throw ReferenceError on this identifier. */
const HEADER_AVATAR_FALLBACK = null;

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
const STOCK_SPLIT_COMPACT_FLEX = 5;
const STOCK_SPLIT_SERVICES_FLEX = 5;

/** Fixed cell width ~ active bubble + styles.dateStrip gap — scroll-into-view + no edge clipping. */
const HOME_DATE_GAP = 6;
const HOME_DATE_CELL_W = 56;

export default function HomeScreen() {
  const navigation = useNavigation();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [selectedDate, setSelectedDate] = useState(() => todayNoonLocal());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [labStats, setLabStats] = useState(null);
  const hasFetchedOnce = useRef(false);
  const selectedDateRef = useRef(selectedDate);
  const homeFocusedRef = useRef(false);
  const homeFocusInitial = useRef(true);
  const dateStripScrollRef = useRef(null);
  const homeDateCacheRef = useRef(new Map()); // per-date data cache
  const [financeSummary, setFinanceSummary] = useState(null);
  const { currency, setCurrency } = useCurrency();
  const [pickCurOpen, setPickCurOpen] = useState(false);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef(null);

  const [profileMe, setProfileMe] = useState(null);
  const [headerAvatarLoadFailed, setHeaderAvatarLoadFailed] = useState(false);

  // Load from AsyncStorage immediately on mount so avatar survives hot reloads
  useEffect(() => {
    const legacy = 'colortrack_profile_me_v1';
    const k = getProfileMeCacheStorageKey();
    (async () => {
      try {
        let raw = await AsyncStorage.getItem(k);
        if (!raw) {
          raw = await AsyncStorage.getItem(legacy);
          if (raw) {
            await AsyncStorage.setItem(k, raw);
            await AsyncStorage.removeItem(legacy);
          }
        }
        if (!raw) return;
        const row = JSON.parse(raw);
        if (row && typeof row === 'object') setProfileMe(row);
      } catch {}
    })();
  }, []);

  const loadProfileMe = useCallback((opts) => {
    const forceFresh = opts && opts.force === true;
    const cacheKey = getProfileMeCacheStorageKey();
    apiGet('/api/me', { allowStaleCache: !forceFresh })
      .then((row) => {
        if (row && typeof row === 'object') {
          setProfileMe(row);
          AsyncStorage.setItem(cacheKey, JSON.stringify(row)).catch(() => {});
          AsyncStorage.removeItem('colortrack_profile_me_v1').catch(() => {});
        }
      })
      .catch(() => {
        /* Keep last good name/avatar on transient errors */
      });
  }, []);

  const headerAvatarUri = useMemo(
    () => resolveImagePublicUri(profileMe?.avatar_url),
    [profileMe?.avatar_url],
  );

  useEffect(() => {
    setHeaderAvatarLoadFailed(false);
  }, [headerAvatarUri]);

  const refreshHomeDataSilent = useCallback(async () => {
    const ymd = toYMDLocal(selectedDateRef.current);
    try {
      const home = await apiGet(`/api/dashboard/home?date=${encodeURIComponent(ymd)}`, {
        allowStaleCache: false,
      }).catch(() => null);
      if (toYMDLocal(selectedDateRef.current) !== ymd) return;
      if (home != null) {
        setData(home);
        setFinanceSummary({ service_income_cents: home.income_cents, expenses_cents: home.expense_cents, product_sales_cents: 0 });
        homeDateCacheRef.current.set(ymd, home);
      }
    } catch {
      if (toYMDLocal(selectedDateRef.current) !== ymd) return;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      homeFocusedRef.current = true;
      const today = todayNoonLocal();
      setSelectedDate(today);
      selectedDateRef.current = today;
      loadProfileMe();
      if (homeFocusInitial.current) {
        homeFocusInitial.current = false;
      }
      return () => {
        homeFocusedRef.current = false;
      };
    }, [loadProfileMe]),
  );

  const strip = useMemo(() => weekDaysForContainingMonday(selectedDate), [selectedDate]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const selIdx = strip.findIndex((item) =>
        sameCalendarLocal(parseYMD(item.ymd), selectedDate),
      );
      if (selIdx < 0 || !dateStripScrollRef.current) return;
      const stride = HOME_DATE_CELL_W + HOME_DATE_GAP;
      const containerInnerW = Math.max(stride * 3, windowWidth - 48);
      let x = selIdx * stride - containerInnerW / 2 + stride / 2;
      x = Math.max(0, x);
      dateStripScrollRef.current.scrollTo({ x, animated: true });
    });
    return () => cancelAnimationFrame(id);
  }, [strip, selectedDate, windowWidth]);

  // Load labStats once — it's date-independent
  useEffect(() => {
    apiGet('/api/lab/stats').then(lab => {
      if (lab != null) setLabStats(lab);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ymd = toYMDLocal(selectedDate);

    // Show cached data immediately if available
    const cached = homeDateCacheRef.current.get(ymd);
    if (cached) {
      setData(cached);
      setFinanceSummary({ service_income_cents: cached.income_cents ?? 0, expenses_cents: cached.expense_cents ?? 0, product_sales_cents: 0 });
    } else {
      setFinanceSummary(null);
    }

    (async () => {
      if (!hasFetchedOnce.current && !cached) setLoading(true);
      try {
        const home = await apiGet(`/api/dashboard/home?date=${encodeURIComponent(ymd)}`).catch(() => null);
        if (!cancelled) {
          if (home != null) {
            setData(home);
            setFinanceSummary({ service_income_cents: home.income_cents ?? 0, expenses_cents: home.expense_cents ?? 0, product_sales_cents: 0 });
            homeDateCacheRef.current.set(ymd, home);
          } else {
            setData((prev) => prev ?? FALLBACK_DASH);
          }
        }
      } catch {
        if (!cancelled) setData((prev) => prev ?? FALLBACK_DASH);
      } finally {
        if (!cancelled) {
          setLoading(false);
          hasFetchedOnce.current = true;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedDate]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !homeFocusedRef.current) return;
      refreshHomeDataSilent();
      loadProfileMe();
    });
    return () => sub.remove();
  }, [refreshHomeDataSilent, loadProfileMe]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('colortrack:appointments-changed', () => {
      refreshHomeDataSilent();
    });
    return () => sub.remove();
  }, [refreshHomeDataSilent]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('colortrack:profile-changed', () => {
      loadProfileMe({ force: true });
    });
    return () => sub.remove();
  }, [loadProfileMe]);

  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await refreshHomeDataSilent();
      loadProfileMe({ force: true });
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

  const openCalendarForSelection = () => {
    hapticImpactLight();
    navigation.navigate('DashboardCalendar', { openDate: toYMDLocal(selectedDate) });
  };

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

  const formulasVisitCount = Number(labStats?.visits_with_formula_this_month ?? 0);
  const labInitialsRecent = Array.isArray(labStats?.formula_client_initials_last3)
    ? labStats.formula_client_initials_last3.slice(0, 3)
    : [];
  const lowStockPhrase = lowCount === 1 ? '1 product low' : `${lowCount} products low`;

  const financeIncomeExpenseParts = useMemo(() => {
    if (financeSummary == null || typeof financeSummary !== 'object') {
      return { income: '—', expense: '—' };
    }
    const inc =
      Number(financeSummary.service_income_cents ?? 0) +
      Number(financeSummary.product_sales_cents ?? 0);
    const exp = Number(financeSummary.expenses_cents ?? 0);
    return {
      income: formatMinorFromStoredCents(inc, currency) ?? '—',
      expense: formatMinorFromStoredCents(exp, currency) ?? '—',
    };
  }, [financeSummary, currency]);

  const greetingName = profileMe?.display_name?.trim();

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
              {headerAvatarUri && !headerAvatarLoadFailed ? (
                <Image
                  source={{ uri: headerAvatarUri }}
                  style={styles.avatar}
                  onError={() => setHeaderAvatarLoadFailed(true)}
                />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Ionicons name="person" size={22} color="#AEAEB2" />
                </View>
              )}
            </TouchableOpacity>
            <View style={styles.headerTextWrap}>
              <Text style={styles.greeting} numberOfLines={1}>
                {greetingName ? `Hello, ${greetingName}` : 'Hello'}
              </Text>
              <Text style={styles.date}>{formatHeaderSubtitle(selectedDate)}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.currencyBtn} activeOpacity={0.85} onPress={() => setPickCurOpen(true)}>
              <Text style={styles.currencyBtnTxt}>{currency}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.searchButton} activeOpacity={0.85} onPress={openSearch}>
              <Ionicons name="search" size={20} color={MY_LAB_VIOLET} />
            </TouchableOpacity>
          </View>
        </View>
        <CurrencyPickerModal
          visible={pickCurOpen}
          currentCode={currency}
          onClose={() => setPickCurOpen(false)}
          onSelect={(code) => { setCurrency(code); setPickCurOpen(false); }}
        />

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
              <View style={styles.bannerCardClip}>
                <View style={styles.bannerCard}>
                <View style={styles.bannerInnerRow}>
                  <View style={styles.bannerTextContainer}>
                    <Text style={styles.bannerTitle}>{bannerTitleDisplay}</Text>
                    <Text style={styles.bannerSubtitle}>{scheduleBannerSubtitle}</Text>
                    {appointmentCount != null && appointmentCount > 0 && !isDashboardStale ? (
                      <View style={styles.avatarGroup}>
                        {avatars.slice(0, 3).map((uri, i) => {
                          const r = resolveImagePublicUri(uri);
                          if (!r) return null;
                          return (
                            <Image
                              key={String(uri) + i}
                              source={{ uri: r }}
                              style={[styles.miniAvatar, { marginLeft: i ? -10 : 0, zIndex: 3 - i }]}
                            />
                          );
                        })}
                        {extra > 0 ? (
                          <View style={[styles.miniAvatarPlaceholder, { marginLeft: -10, zIndex: 0 }]}>
                            <Text style={styles.miniAvatarText}>+{extra}</Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.bannerCalendarCue}>
                    <Ionicons name="calendar-outline" size={26} color={MY_LAB_VIOLET} />
                  </View>
                </View>
                {sameCalendarLocal(selectedDate, new Date()) ? (
                  <TouchableOpacity
                    style={styles.bannerSalesLink}
                    onPress={(e) => { e.stopPropagation?.(); hapticImpactLight(); navigation.navigate('TodaySales'); }}
                    activeOpacity={0.7}
                    hitSlop={{ top: 4, bottom: 8 }}
                  >
                    <Text style={styles.bannerSalesLinkTxt}>Log a sale →</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              </View>
            </TouchableOpacity>

            <ScrollView
              ref={dateStripScrollRef}
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
                      hapticImpactLight();
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
                        <LinearGradient
                          colors={SALON_LAB_GRADIENT_COLORS}
                          locations={SALON_LAB_GRADIENT_LOCATIONS}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.dateActiveBubbleGradient}
                          pointerEvents="none"
                        />
                        <View
                          style={[StyleSheet.absoluteFillObject, styles.dateActiveBubbleGlassRim]}
                          pointerEvents="none"
                        />
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

          <View style={styles.salonToolsGridWrap}>
            <View style={[styles.gridTopRow, { height: planGridRowH }]}>
            <View style={styles.gridLeft}>
              <TouchableOpacity
                style={[styles.salonLabCardTouchable, styles.gridTallCard, styles.gridTallCardFill]}
                activeOpacity={0.92}
                onPress={() => {
                  hapticImpactLight();
                  navigation.navigate('Lab');
                }}
              >
                <LinearGradient
                  colors={SALON_LAB_GRADIENT_COLORS}
                  locations={SALON_LAB_GRADIENT_LOCATIONS}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.salonLabGradientFill}
                  pointerEvents="none"
                />
                <View style={styles.salonLabCardInner}>
                  <Text style={styles.salonLabKicker}>My lab</Text>
                  <View>
                    <Text style={styles.salonLabHugeNumber}>{String(formulasVisitCount)}</Text>
                    <View style={styles.salonLabSubtitleBlock}>
                      <Text style={styles.salonLabFormulasWord}>formulas</Text>
                      <Text style={styles.salonLabThisMonth}>this month</Text>
                    </View>
                  </View>
                  {labInitialsRecent.length ? (
                  <View style={styles.salonLabInitialsRow}>
                    {labInitialsRecent.map((init, idx) => (
                      <View
                        key={`${idx}-${init}`}
                        style={[
                          styles.salonLabInitialCircle,
                          idx > 0 ? styles.salonLabInitialOverlap : null,
                          { zIndex: 10 - idx },
                        ]}
                      >
                        <Text style={styles.salonLabInitialText}>{init}</Text>
                      </View>
                    ))}
                  </View>
                  ) : null}
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.gridRight}>
              <View style={styles.stockVerticalStack}>
                <TouchableOpacity
                  style={[
                    styles.salonFinanceCard,
                    styles.stockCardSized,
                    styles.stockLowInStack,
                    { flex: STOCK_SPLIT_LOW_FLEX },
                  ]}
                  activeOpacity={0.92}
                  onPress={() => {
                    hapticImpactLight();
                    navigation.navigate('Finance', { date: toYMDLocal(selectedDate) });
                  }}
                >
                  <View style={styles.salonFinanceInner}>
                    <Text style={styles.salonFinanceEyebrow}>Finance</Text>
                    <View style={styles.salonFinanceAmountsBlock}>
                      <Text style={styles.salonFinanceIncomeLine}>
                        ↑ {financeIncomeExpenseParts.income}
                      </Text>
                      <Text style={styles.salonFinanceExpenseLine}>
                        ↓ {financeIncomeExpenseParts.expense}
                      </Text>
                    </View>
                </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.salonLowStockCard,
                    styles.stockCardSized,
                    styles.stockCompactInStack,
                    { flex: STOCK_SPLIT_COMPACT_FLEX },
                  ]}
                  activeOpacity={0.92}
                  onPress={() => {
                    hapticImpactLight();
                    navigation.navigate('InventoryStack');
                  }}
                >
                  <View style={styles.salonLowStockInner}>
                    <Text style={styles.salonMutedKicker}>Low stock</Text>
                    <View style={styles.salonLowStockPhraseRow}>
                      <View style={styles.salonLowStockDot} />
                      <Text style={styles.salonLowStockCopy}>{lowStockPhrase}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.salonServicesCard,
                    styles.stockCardSized,
                    styles.stockCompactInStack,
                    { flex: STOCK_SPLIT_SERVICES_FLEX },
                  ]}
                  activeOpacity={0.92}
                  onPress={() => {
                    hapticImpactLight();
                    navigation.navigate('Services');
                  }}
                >
                  <View style={styles.salonServicesInner}>
                    <Text style={styles.salonMutedKicker}>Services</Text>
                    <View style={styles.salonServicesBottomRow}>
                      <Text style={styles.salonPriceList}>My price list</Text>
                      <Text style={styles.salonArrowGlyph}>→</Text>
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
                      hapticImpactLight();
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
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
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
    alignItems: 'flex-start',
    marginTop: 16,
    marginBottom: 18,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    alignSelf: 'stretch',
    paddingTop: 2,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 16,
  },
  avatarPlaceholder: {
    backgroundColor: '#EFEFF4',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  greeting: {
    ...Type.greetingHello,
  },
  date: {
    ...Type.greetingDate,
    marginTop: 2,
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  currencyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(94,53,177,0.25)',
  },
  currencyBtnTxt: {
    fontFamily: FontFamily.semibold,
    fontSize: 13,
    color: MY_LAB_VIOLET,
    letterSpacing: 0.3,
  },
  searchButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  bannerTouchable: {
    borderRadius: 24,
    marginBottom: 18,
    backgroundColor: '#FFFFFF',
    ...HOME_RAISED_SHADOW,
  },
  bannerCardClip: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  bannerCard: {
    paddingVertical: 18,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
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
    fontFamily: FontFamily.semibold,
    fontSize: 15,
    lineHeight: typeLh(15),
    color: '#0D0D0D',
    marginBottom: 2,
  },
  bannerSubtitle: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    lineHeight: typeLh(13),
    color: '#8A8A8E',
    marginBottom: 10,
  },
  bannerSalesLink: {
    alignSelf: 'flex-start',
    paddingTop: 8,
    paddingBottom: 2,
  },
  bannerSalesLinkTxt: {
    fontFamily: FontFamily.semibold,
    fontSize: 13,
    color: MY_LAB_VIOLET,
    letterSpacing: -0.1,
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
    borderColor: '#EFEFF4',
  },
  miniAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EFEFF4',
    borderWidth: 2,
    borderColor: '#E5E5EA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniAvatarText: {
    fontSize: 12,
    lineHeight: typeLh(12),
    fontFamily: FontFamily.semibold,
    color: '#0D0D0D',
  },
  dateStrip: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: HOME_DATE_GAP,
    paddingVertical: 10,
    paddingLeft: 2,
    paddingRight: 2,
    marginBottom: 20,
  },
  dateCell: {
    width: HOME_DATE_CELL_W,
    height: 60,
    paddingHorizontal: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 2,
    overflow: 'visible',
  },
  dateActiveBubble: {
    width: 54,
    height: 54,
    borderRadius: 27,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  dateActiveBubbleGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  dateActiveBubbleGlassRim: {
    borderRadius: 27,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SALON_LAB_GLASS_OUTLINE,
  },
  dateTextDayActive: {
    fontSize: 12,
    lineHeight: typeLh(12),
    fontFamily: FontFamily.regular,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  dateTextNumActive: {
    fontSize: 16,
    lineHeight: typeLh(16),
    fontFamily: FontFamily.regular,
    color: '#FFFFFF',
  },
  dateTextDayIdle: {
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.regular,
    color: '#1C1C1E',
    marginBottom: 4,
  },
  dateTextNumIdle: {
    fontSize: 16,
    lineHeight: typeLh(16),
    fontFamily: FontFamily.regular,
    color: '#1C1C1E',
  },
  dateTextDayToday: {
    color: '#5E35B1',
  },
  dateTextNumToday: {
    color: '#5E35B1',
  },
  sectionTitle: {
    ...Type.sectionLabel,
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
  },
  stockCompactInStack: {
    minHeight: 0,
    justifyContent: 'center',
  },

  salonLabCardTouchable: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000000',
    ...HOME_RAISED_SHADOW,
  },
  salonLabGradientFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
  },
  salonLabCardInner: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
    justifyContent: 'space-between',
    zIndex: 2,
  },
  salonLabKicker: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
    lineHeight: typeLh(14),
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },

  salonLabHugeNumber: {
    fontFamily: FontFamily.semibold,
    fontSize: 52,
    lineHeight: 56,
    color: '#FFFFFF',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  salonLabSubtitleBlock: {
    marginTop: 10,
  },
  salonLabFormulasWord: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
    lineHeight: typeLh(14),
    color: '#FFFFFF',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  salonLabThisMonth: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
    lineHeight: typeLh(12),
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  salonLabInitialsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  salonLabInitialCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  salonLabInitialOverlap: {
    marginLeft: -8,
  },
  salonLabInitialText: {
    fontFamily: FontFamily.medium,
    fontSize: 11,
    lineHeight: typeLh(11),
    color: '#FFFFFF',
  },
  salonToolsGridWrap: {
    backgroundColor: '#FFFFFF',
  },
  salonFinanceCard: {
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    ...HOME_RAISED_SHADOW,
  },
  salonFinanceInner: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    justifyContent: 'flex-start',
  },
  salonFinanceEyebrow: {
    fontFamily: FontFamily.medium,
    fontSize: 11,
    lineHeight: typeLh(11),
    color: '#0D0D0D',
    textTransform: 'uppercase',
    letterSpacing: 0.85,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  salonFinanceAmountsBlock: {
    marginTop: 12,
  },
  salonFinanceIncomeLine: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
    lineHeight: typeLh(14),
    color: '#00A86B',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  salonFinanceExpenseLine: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
    lineHeight: typeLh(14),
    color: '#FF6B35',
    marginTop: 6,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  salonMutedKicker: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    lineHeight: typeLh(10),
    color: '#0D0D0D',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  salonLowStockCard: {
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    ...HOME_RAISED_SHADOW,
  },
  salonLowStockInner: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  salonLowStockPhraseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  salonLowStockDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF6B35',
    marginRight: 10,
    flexShrink: 0,
  },
  salonLowStockCopy: {
    fontFamily: FontFamily.medium,
    fontSize: 13,
    lineHeight: typeLh(13),
    color: '#FF6B35',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  salonServicesCard: {
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    ...HOME_RAISED_SHADOW,
  },
  salonServicesInner: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  salonServicesBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  salonPriceList: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
    lineHeight: typeLh(14),
    color: '#8A8A8E',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  salonArrowGlyph: {
    fontFamily: FontFamily.medium,
    fontSize: 18,
    lineHeight: 22,
    color: '#6B4EFF',
  },

  stockCardSized: {
    width: '100%',
  },
  gridTallCard: {
    width: '100%',
  },
  /** Fill column when parent has explicit height (grid row). */
  gridTallCardFill: {
    flex: 1,
    minHeight: 96,
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
    lineHeight: typeLh(11),
    fontFamily: FontFamily.medium,
    color: '#FFF',
  },
  cardTitle: {
    ...Type.listPrimary,
    color: '#1C1C1E',
    marginBottom: 8,
  },
  cardTitleStock: {
    marginBottom: 2,
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.medium,
    color: '#1C1C1E',
  },
  cardSubtitleStock: {
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.regular,
    color: '#8A8A8E',
    marginBottom: 0,
  },
  cardSubtitle: {
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.regular,
    color: '#1C1C1E',
    marginBottom: 2,
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
    lineHeight: typeLh(13),
    fontFamily: FontFamily.regular,
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
  modalTitle: {
    fontSize: 17,
    lineHeight: typeLh(17),
    fontFamily: FontFamily.regular,
    color: '#1C1C1E',
  },
  modalClose: {
    fontSize: 17,
    lineHeight: typeLh(17),
    fontFamily: FontFamily.regular,
    color: '#5E35B1',
  },
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
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.regular,
    color: '#1C1C1E',
  },
  searchHit: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  searchHitName: { ...Type.listPrimary, color: '#1C1C1E' },
  searchHitPhone: { marginTop: 4, ...Type.secondary },
  emptySearch: { textAlign: 'center', color: '#1C1C1E', marginTop: 24 },
});
