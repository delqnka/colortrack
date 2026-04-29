import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { apiGet } from '../api/client';

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

function formatPlanDayLine(d) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}.`;
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
  const [y, mo, da] = s.split('-').map(Number);
  return new Date(y, mo - 1, da);
}

function sameCalendarLocal(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

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

export default function HomeScreen() {
  const navigation = useNavigation();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef(null);

  const strip = useMemo(() => weekDaysForContainingMonday(selectedDate), [selectedDate]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const ymd = toYMDLocal(selectedDate);
      const d = await apiGet(`/api/dashboard/day?date=${encodeURIComponent(ymd)}`);
      setData(d);
    } catch {
      setData(FALLBACK_DASH);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (cancelled) return;
        setLoading(true);
        try {
          const ymd = toYMDLocal(selectedDate);
          const d = await apiGet(`/api/dashboard/day?date=${encodeURIComponent(ymd)}`);
          if (!cancelled) setData(d);
        } catch {
          if (!cancelled) setData(FALLBACK_DASH);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [selectedDate]),
  );

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
  const banner = d.banner || FALLBACK_DASH.banner;
  const bannerTitleDisplay = sameCalendarLocal(selectedDate, new Date())
    ? "Today's Schedule"
    : 'Schedule';
  const avatars = d.bannerAvatars?.length ? d.bannerAvatars : FALLBACK_DASH.bannerAvatars;
  const extra = d.extraClientCount ?? 0;
  const upcoming = d.upcoming;
  const low = d.lowStockPreview || FALLBACK_DASH.lowStockPreview;
  const lowCount = d.lowStockCount ?? 1;

  const timeRange =
    upcoming?.start_at && upcoming?.end_at
      ? `${fmtTime(upcoming.start_at)} - ${fmtTime(upcoming.end_at)}`
      : '—';

  const nowTick = new Date();

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
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

        {loading ? (
          <View style={styles.loadingBanner}>
            <ActivityIndicator color="#1C1C1E" />
          </View>
        ) : null}

        <View style={styles.bannerContainer}>
          <View style={styles.bannerTextContainer}>
            <Text style={styles.bannerTitle}>{bannerTitleDisplay}</Text>
            {banner.subtitle ? <Text style={styles.bannerSubtitle}>{banner.subtitle}</Text> : null}
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
          </View>
          <View style={styles.abstractShape} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateStrip}>
          {strip.map((item) => {
            const cellDate = parseYMD(item.ymd);
            const isSelected = sameCalendarLocal(cellDate, selectedDate);
            const isToday = sameCalendarLocal(cellDate, nowTick);
            return (
              <TouchableOpacity
                key={item.key}
                style={styles.dateCell}
                onPress={() => setSelectedDate(cellDate)}
                activeOpacity={0.85}
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

        <View style={styles.gridContainer}>
          <TouchableOpacity
            style={[styles.card, styles.cardOrange]}
            activeOpacity={0.92}
            onPress={() => {
              if (upcoming?.client_id) {
                navigation.navigate('ClientDetail', { clientId: upcoming.client_id });
              } else if (upcoming?.start_at) {
                navigation.navigate('Calendar', {
                  openDate: toYMDLocal(new Date(upcoming.start_at)),
                });
              } else {
                navigation.navigate('Calendar', { openDate: toYMDLocal(selectedDate) });
              }
            }}
          >
            <View style={styles.badgeOrange}>
              <Text style={styles.badgeTextOrange}>Upcoming</Text>
            </View>
            <Text style={styles.cardTitle}>{upcoming?.procedure_name || upcoming?.title || '—'}</Text>
            <Text style={styles.cardSubtitle}>{formatPlanDayLine(selectedDate)}</Text>
            <Text style={styles.cardSubtitle}>{timeRange}</Text>
            <Text style={styles.cardSubtitle}>{upcoming?.chair_label || '—'}</Text>

            <View style={styles.cardFooter}>
              {upcoming?.client_avatar_url ? (
                <Image source={{ uri: upcoming.client_avatar_url }} style={styles.cardFooterAvatar} />
              ) : (
                <View style={[styles.cardFooterAvatar, styles.avatarFallback]} />
              )}
              <View>
                <Text style={styles.cardFooterSubtitle}>{upcoming?.client_name || ''}</Text>
              </View>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.card, styles.cardBlue]}
            activeOpacity={0.92}
            onPress={() => navigation.navigate('Inventory')}
          >
            <View style={styles.badgeBlue}>
              <Text style={styles.badgeTextBlue}>Low stock</Text>
            </View>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {low.name}
              {low.shade_code ? ` · ${low.shade_code}` : ''}
            </Text>
            <Text style={styles.cardSubtitle}>
              {low.quantity}/{+low.low_stock_threshold} {low.unit || 'g'}
            </Text>
            {lowCount > 1 ? (
              <View style={styles.moreDots}>
                {Array.from({ length: Math.min(lowCount - 1, 4) }).map((_, i) => (
                  <View key={i} style={styles.miniDot} />
                ))}
              </View>
            ) : (
              <View style={{ height: 20 }} />
            )}

            <View style={styles.iconsRow}>
              <View style={styles.iconCircle}>
                <Ionicons name="cube" size={16} color="#fff" />
              </View>
              <View style={styles.iconCircle}>
                <Ionicons name="cart" size={16} color="#fff" />
              </View>
            </View>
          </TouchableOpacity>
        </View>

        <View style={{ height: 130 }} />
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
              <Ionicons name="search" size={20} color="#8E8E93" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder=""
                placeholderTextColor="#C7C7CC"
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
    backgroundColor: '#F5F5FA',
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
    fontWeight: '800',
    color: '#1C1C1E',
  },
  date: {
    fontSize: 14,
    color: '#8E8E93',
    fontWeight: '500',
    marginTop: 2,
  },
  searchButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  bannerContainer: {
    backgroundColor: '#D1C4E9',
    borderRadius: 24,
    padding: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  bannerTextContainer: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 4,
  },
  bannerSubtitle: {
    fontSize: 14,
    color: '#4A4A4A',
    fontWeight: '500',
    marginBottom: 16,
  },
  moreDots: { flexDirection: 'row', gap: 6, marginTop: 12, alignItems: 'center' },
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
    borderColor: '#D1C4E9',
  },
  miniAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#D1C4E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniAvatarText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1C1C1E',
  },
  abstractShape: {
    width: 80,
    height: 80,
    backgroundColor: '#A38BD8',
    borderRadius: 20,
    transform: [{ rotate: '15deg' }],
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
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  dateTextNumActive: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  dateTextDayIdle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    marginBottom: 4,
  },
  dateTextNumIdle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#AEAEB2',
  },
  dateTextDayToday: {
    color: '#5E35B1',
  },
  dateTextNumToday: {
    color: '#5E35B1',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 16,
  },
  gridContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  card: {
    width: '48%',
    borderRadius: 24,
    padding: 20,
  },
  cardOrange: {
    backgroundColor: '#FFE0B2',
  },
  cardBlue: {
    backgroundColor: '#BBDEFB',
  },
  badgeOrange: {
    backgroundColor: '#FFB74D',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  badgeTextOrange: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFF',
  },
  badgeBlue: {
    backgroundColor: '#64B5F6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  badgeTextBlue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFF',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#555',
    marginBottom: 2,
    fontWeight: '500',
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
    fontWeight: 'bold',
    color: '#1C1C1E',
  },
  iconsRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 8,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#64B5F6',
    justifyContent: 'center',
    alignItems: 'center',
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
    backgroundColor: '#F5F5FA',
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
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#1C1C1E' },
  modalClose: { fontSize: 17, fontWeight: '600', color: '#5E35B1' },
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
  searchHitName: { fontSize: 16, fontWeight: '700', color: '#1C1C1E' },
  searchHitPhone: { fontSize: 14, color: '#8E8E93', marginTop: 4 },
  emptySearch: { textAlign: 'center', color: '#8E8E93', marginTop: 24 },
});
