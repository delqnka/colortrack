import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { apiGet, apiPost, apiDelete, resolveImagePublicUri } from '../api/client';
import { BRAND_PURPLE, glassPurpleIconBtn } from '../theme/glassUi';
import { formatDisplayDate } from '../lib/formatDate';
import { useCurrency } from '../context/CurrencyContext';
import { formatMinorFromStoredCents } from '../format/moneyDisplay';
import { FontFamily } from '../theme/fonts';
import { Type, typeLh } from '../theme/typography';
import { hapticImpactLight } from '../theme/haptics';

const IMAGE_MEDIA_TYPES = ImagePicker.MediaType?.Images ? [ImagePicker.MediaType.Images] : ['images'];

const SECTION_LABEL = {
  roots: 'Roots',
  lengths: 'Lengths',
  toner: 'Toner',
  developer: 'Developer / oxidant',
  other: 'Other',
};

const VISIT_SOURCE_LABEL = {
  device_calendar: 'Device calendar',
  appointment: 'Salon booking',
  manual: null,
};

export default function ClientDetailScreen({route, navigation}) {
  const { currency } = useCurrency();
  const clientId = route.params?.clientId;
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const c = await apiGet(`/api/clients/${clientId}`);
      setClient(c);
    } catch {
      setClient(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading && !client) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (!client) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.miss}>Client not found.</Text>
      </SafeAreaView>
    );
  }

  const visits = client.visits || [];
  const photos = client.photos || [];

  const pickAndUpload = async () => {
    if (!Number.isFinite(clientId)) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('', 'Photo library access');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: IMAGE_MEDIA_TYPES,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const uri = asset.uri;
    const contentType = asset.mimeType && asset.mimeType.startsWith('image/')
      ? asset.mimeType.split(';')[0].trim().toLowerCase() === 'image/jpg'
        ? 'image/jpeg'
        : asset.mimeType.split(';')[0].trim().toLowerCase()
      : 'image/jpeg';

    setUploading(true);
    try {
      const presign = await apiPost(`/api/clients/${clientId}/photos/presign`, { contentType });
      const fileRes = await fetch(uri);
      const blob = await fileRes.blob();
      const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': presign.contentType },
        body: blob,
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed (${putRes.status})`);
      }
      await apiPost(`/api/clients/${clientId}/photos/commit`, {
        key: presign.key,
        contentType: presign.contentType,
      });
      await load();
    } catch (e) {
      Alert.alert('', e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const confirmRemovePhoto = (photo) => {
    Alert.alert(
      'Delete photo',
      'This removes the photo from the dossier and from cloud storage. You cannot undo this.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiDelete(`/api/clients/${clientId}/photos/${photo.id}`);
              await load();
            } catch (e) {
              Alert.alert('', e.message || '');
            }
          },
        },
      ],
    );
  };

  const thumbW = Math.floor((Dimensions.get('window').width - 48 - 16) / 3);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.top}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Dossier</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('ClientForm', { clientId })}
          style={styles.back}
          hitSlop={12}
        >
          <Ionicons name="pencil" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Image
          source={{
            uri:
              resolveImagePublicUri(client.avatar_url || '') ||
              'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=400&auto=format&fit=crop',
          }}
          style={styles.hero}
        />
        <Text style={styles.name}>{client.full_name}</Text>
        {client.phone ? <Text style={styles.meta}>{client.phone}</Text> : null}

        <TouchableOpacity
          style={styles.cta}
          activeOpacity={0.9}
          onPress={() => {
            hapticImpactLight();
            navigation.navigate('FormulaBuilder', { clientId });
          }}
        >
          <Ionicons name="brush-outline" size={22} color="#fff" />
          <Text style={styles.ctaText}>Visit</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => {
            hapticImpactLight();
            navigation.navigate('ClientForm', { clientId });
          }}
        >
          <View
            style={[
              styles.patchTouch,
              client.patch_overdue ? styles.patchRowWarn : styles.patchRowOk,
            ]}
          >
            <Ionicons
              name={client.patch_overdue ? 'warning' : 'checkmark-circle'}
              size={20}
              color={client.patch_overdue ? '#B71C1C' : '#2E7D32'}
            />
            <View style={styles.patchMid}>
              <Text
                style={[
                  styles.patchTitle,
                  { color: client.patch_overdue ? '#B71C1C' : '#2E7D32' },
                ]}
              >
                Patch test
              </Text>
              <Text style={styles.patchDate}>
                {client.last_patch_test_at ? formatDisplayDate(client.last_patch_test_at) : '—'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#1C1C1E" />
          </View>
        </TouchableOpacity>

        <Text style={styles.section}>Visits</Text>
        {visits.length === 0 ? null : (
          visits.map((v) => (
            <TouchableOpacity
              key={v.id}
              style={styles.visitCard}
              activeOpacity={0.88}
              onPress={() => {
                hapticImpactLight();
                navigation.navigate('VisitDetail', { visitId: v.id });
              }}
            >
              <View style={styles.visitCardTop}>
                <View style={styles.visitCardMain}>
                  <Text style={styles.visitTitle}>{v.procedure_name}</Text>
                  <Text style={styles.visitDate}>{formatDisplayDate(v.visit_date)}</Text>
                  {formatMinorFromStoredCents(v.amount_paid_cents, currency) ? (
                    <Text style={styles.visitPaid}>{formatMinorFromStoredCents(v.amount_paid_cents, currency)}</Text>
                  ) : null}
                  {VISIT_SOURCE_LABEL[v.source] ? (
                    <Text style={styles.visitSource}>{VISIT_SOURCE_LABEL[v.source]}</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={20} color="#1C1C1E" />
              </View>
              {v.chair_label ? <Text style={styles.visitSub}>{v.chair_label}</Text> : null}
              {v.formula_lines?.length ? (
                <View style={styles.formulaBox}>
                  {v.formula_lines.map((fl) => (
                    <Text key={fl.id} style={styles.formulaLine}>
                      <Text style={styles.formulaSec}>{SECTION_LABEL[fl.section] || fl.section}</Text>
                      {' · '}
                      {fl.brand} {fl.shade_code !== '-' ? fl.shade_code : ''}
                      {' — '}
                      {fl.amount}
                      {fl.inventory_item_id ? ' · \u25CF' : ''}
                    </Text>
                  ))}
                </View>
              ) : null}
            </TouchableOpacity>
          ))
        )}

        <Text style={styles.section}>Photos</Text>
        <View style={styles.photoGrid}>
          {photos.map((p) => {
            const u = resolveImagePublicUri(p.url || '');
            if (!u) return null;
            return (
              <View key={p.id} style={[styles.photoCell, { width: thumbW, height: thumbW }]}>
              <Image source={{ uri: u }} style={styles.photoImage} />
              <TouchableOpacity
                style={styles.photoDeleteBtn}
                onPress={() => confirmRemovePhoto(p)}
                hitSlop={10}
                accessibilityLabel="Delete photo"
                activeOpacity={0.85}
              >
                <Ionicons name="trash-outline" size={18} color="#fff" />
              </TouchableOpacity>
              </View>
            );
          })}
          <TouchableOpacity
            style={[styles.addPhotoCell, { width: thumbW, height: thumbW }]}
            onPress={() => {
              hapticImpactLight();
              pickAndUpload();
            }}
            disabled={uploading}
            activeOpacity={0.85}
          >
            {uploading ? (
              <ActivityIndicator color="#5E35B1" />
            ) : (
              <Ionicons name="add" size={32} color={BRAND_PURPLE} />
            )}
          </TouchableOpacity>
        </View>
        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  miss: { textAlign: 'center', marginTop: 48, color: '#1C1C1E' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  back: {
    ...glassPurpleIconBtn,
  },
  topTitle: { ...Type.greetingHello, color: '#1C1C1E' },
  scroll: { paddingHorizontal: 24, paddingBottom: 32 },
  hero: {
    width: '100%',
    height: 200,
    borderRadius: 24,
    backgroundColor: '#ddd',
    marginTop: 8,
  },
  name: { marginTop: 20, ...Type.screenTitle },
  meta: { marginTop: 6, ...Type.secondary },
  cta: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#5E35B1',
    paddingVertical: 14,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaText: { color: '#fff', ...Type.buttonLabel },
  patchTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
  },
  patchRowWarn: { backgroundColor: '#FFEBEE' },
  patchRowOk: { backgroundColor: '#E8F5E9' },
  patchMid: { flex: 1 },
  patchTitle: {
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.regular,
    color: '#1C1C1E',
  },
  patchDate: { marginTop: 4, ...Type.secondary },
  section: { marginTop: 28, marginBottom: 12, ...Type.sectionLabel },
  visitCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  visitCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  visitCardMain: { flex: 1 },
  visitTitle: { ...Type.listPrimary, color: '#1C1C1E' },
  visitDate: { marginTop: 6, ...Type.secondary, color: '#1C1C1E' },
  visitPaid: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.medium,
    color: '#2E7D32',
  },
  visitSource: { marginTop: 4, ...Type.tabBarLabel, color: '#007AFF' },
  visitSub: { marginTop: 4, ...Type.secondary, color: '#1C1C1E' },
  formulaBox: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5EA' },
  formulaLine: { ...Type.secondary, color: '#1C1C1E', marginBottom: 6 },
  formulaSec: { fontFamily: FontFamily.medium, fontSize: 13, lineHeight: typeLh(13), color: '#5E35B1' },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'flex-start',
  },
  photoCell: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#eee', position: 'relative' },
  photoImage: { width: '100%', height: '100%' },
  photoDeleteBtn: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoCell: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D1C4E9',
    borderStyle: 'dashed',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
