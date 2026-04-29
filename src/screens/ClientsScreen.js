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
import { useFocusEffect } from '@react-navigation/native';
import { apiGet } from '../api/client';

export default function ClientsScreen({ navigation }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

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
          onPress={() => navigation.navigate('ClientForm')}
        >
          <Ionicons name="add" size={26} color="#1C1C1E" />
        </TouchableOpacity>
      </View>
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
              onPress={() => navigation.navigate('ClientDetail', { clientId: item.id })}
            >
              <Image
                source={{
                  uri:
                    item.avatar_url ||
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
                <Ionicons name="chevron-forward" size={20} color="#C7C7CC" />
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
  safe: { flex: 1, backgroundColor: '#F5F5FA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 28, fontWeight: '800', color: '#1C1C1E' },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
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
    backgroundColor: '#eee',
  },
  rowBody: { flex: 1 },
  name: { fontSize: 17, fontWeight: '700', color: '#1C1C1E' },
  phone: { marginTop: 4, fontSize: 14, color: '#8E8E93' },
  patchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E53935',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  patchText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
