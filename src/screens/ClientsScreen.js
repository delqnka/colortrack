import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { apiGet, resolveImagePublicUri } from '../api/client';
import { glassPurpleFabBar } from '../theme/glassUi';
import { Type } from '../theme/typography';
import { hapticImpactLight } from '../theme/haptics';

export default function ClientsScreen({ navigation }) {
  const route = useRoute();
  const pickPayload = route.params?.pickForCalendarVisit;
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  const clearPickMode = useCallback(() => {
    navigation.setParams({ pickForCalendarVisit: undefined });
  }, [navigation]);

  const fetchClients = useCallback(async () => {
    try {
      const rows = await apiGet('/api/clients');
      setClients(Array.isArray(rows) ? rows : []);
    } catch {
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchClients();
    }, [fetchClients]),
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Clients</Text>
        <TouchableOpacity
          style={styles.addBtn}
          activeOpacity={0.85}
          onPress={() => {
            if (pickPayload) {
              navigation.navigate('ClientForm', {
                fromDeviceCalendarEventId: pickPayload.deviceCalendarEventId,
                initialFullName: pickPayload.suggestedClientName || '',
                initialNotesFromCalendar: pickPayload.initialNotes || '',
              });
            } else {
              navigation.navigate('ClientForm');
            }
          }}
        >
          <Ionicons name="add" size={26} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
      {pickPayload ? (
        <View style={styles.pickBanner}>
          <Text style={styles.pickBannerTxt} numberOfLines={2}>
            Choose a client for this calendar visit ({pickPayload.suggestedClientName || 'event'}).
          </Text>
          <TouchableOpacity onPress={clearPickMode} hitSlop={10}>
            <Text style={styles.pickCancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={clients}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.88}
              onPress={() => {
                hapticImpactLight();
                if (pickPayload) {
                  const {
                    deviceCalendarEventId,
                    initialProcedure,
                    initialDate,
                    initialNotes,
                    initialChair,
                  } = pickPayload;
                  navigation.navigate('FormulaBuilder', {
                    clientId: item.id,
                    deviceCalendarEventId,
                    initialProcedure,
                    initialDate,
                    initialNotes,
                    initialChair,
                  });
                  clearPickMode();
                } else {
                  navigation.navigate('ClientDetail', { clientId: item.id });
                }
              }}
            >
              <Image
                source={{
                  uri:
                    resolveImagePublicUri(item.avatar_url || '') ||
                    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=200&auto=format&fit=crop',
                }}
                style={styles.avatar}
              />
              <View style={styles.rowBody}>
                <Text style={styles.name}>{item.full_name}</Text>
                {item.phone ? <Text style={styles.phone}>{item.phone}</Text> : null}
              </View>
              {item.patch_overdue ? (
                <View style={styles.patchBadge}>
                  <Ionicons name="medical" size={14} color="#fff" />
                  <Text style={styles.patchText}>Patch</Text>
                </View>
              ) : (
                <Ionicons name="chevron-forward" size={20} color="#1C1C1E" />
              )}
            </TouchableOpacity>
          )}
          ListEmptyComponent={null}
        />
      )}
      <View style={{ height: 130 }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { ...Type.screenTitle },
  pickBanner: {
    marginHorizontal: 24,
    marginBottom: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#EDE7F6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pickBannerTxt: { flex: 1, ...Type.secondary, color: '#0D0D0D' },
  pickCancel: { ...Type.buttonLabel, color: '#5E35B1' },
  addBtn: {
    ...glassPurpleFabBar,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { paddingHorizontal: 24, paddingBottom: 24 },
  sep: { height: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginRight: 14,
    backgroundColor: '#FFFFFF',
  },
  rowBody: { flex: 1 },
  name: { ...Type.listPrimary },
  phone: { marginTop: 4, ...Type.secondary },
  patchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E53935',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  patchText: { ...Type.tabBarLabel, color: '#fff' },
});
