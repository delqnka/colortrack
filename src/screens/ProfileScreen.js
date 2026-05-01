import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { apiDelete, apiGet, apiPatch, apiPost, saveSessionToken } from '../api/client';
import { FontFamily } from '../theme/fonts';

const DEFAULT_AVATAR =
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=150&auto=format&fit=crop';

function messageForProfileDeleteFailure(err) {
  const m = String(err?.message || '').trim().toLowerCase();
  if (m === 'last_staff') return 'Only staff member for this salon.';
  if (m === 'last_admin') return 'Only administrator for this salon.';
  return String(err?.message || '').trim() || 'Could not delete profile.';
}

function pickContentType(asset) {
  if (asset.mimeType && asset.mimeType.startsWith('image/')) {
    const m = asset.mimeType.split(';')[0].trim().toLowerCase();
    return m === 'image/jpg' ? 'image/jpeg' : m;
  }
  return 'image/jpeg';
}

export default function ProfileScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [me, setMe] = useState(null);
  const [nameDraft, setNameDraft] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const row = await apiGet('/api/me', { allowStaleCache: false });
      setMe(row);
      setNameDraft(row.display_name || '');
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const saveName = async () => {
    if (!me || saving) return;
    setSaving(true);
    try {
      const trimmed = nameDraft.trim();
      const payload = { display_name: trimmed.length ? trimmed : null };
      const updated = await apiPatch('/api/me', payload);
      setMe((prev) => ({ ...prev, ...updated }));
      setNameDraft(updated.display_name || '');
    } catch (e) {
      Alert.alert('', e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const pickAndUploadPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('', 'Photo library access');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const uri = asset.uri;
    const contentType = pickContentType(asset);
    setUploading(true);
    try {
      const presign = await apiPost('/api/me/avatar/presign', { contentType });
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
      const { avatar_url: nextUrl } = await apiPost('/api/me/avatar/commit', {
        key: presign.key,
        contentType: presign.contentType,
      });
      setMe((prev) => (prev ? { ...prev, avatar_url: nextUrl } : prev));
    } catch (e) {
      Alert.alert('', e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const confirmSignOut = () => {
    Alert.alert('', 'Sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await saveSessionToken(null);
        },
      },
    ]);
  };

  const confirmDeleteProfile = () => {
    if (!me || deletingAccount) return;
    Alert.alert('', 'Delete your profile?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingAccount(true);
          try {
            await apiDelete('/api/me', { clearSessionOn401: false });
            await saveSessionToken(null);
          } catch (e) {
            Alert.alert('', messageForProfileDeleteFailure(e));
          } finally {
            setDeletingAccount(false);
          }
        },
      },
    ]);
  };

  const avatarUri = me?.avatar_url || DEFAULT_AVATAR;
  const titleLine = me?.display_name?.trim() || me?.email?.split('@')[0] || '';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.topBar}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Ionicons name="chevron-back" size={26} color="#1C1C1E" />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Profile</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading && !me ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color="#1C1C1E" />
        </View>
      ) : (
        <View style={styles.contentColumn}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollInner}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <TouchableOpacity
              style={styles.avatarTouch}
              activeOpacity={0.88}
              onPress={pickAndUploadPhoto}
              disabled={uploading}
              accessibilityRole="button"
            >
              <Image source={{ uri: avatarUri }} style={styles.avatar} />
              <View style={styles.avatarDim}>
                {uploading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Ionicons name="camera" size={26} color="#FFFFFF" />
                )}
              </View>
            </TouchableOpacity>

            <Text style={styles.namePreview} numberOfLines={1}>
              {titleLine || '—'}
            </Text>
            {me?.email ? (
              <Text style={styles.emailMuted} numberOfLines={1}>
                {me.email}
              </Text>
            ) : null}
            {me?.salon_name ? (
              <Text style={styles.salonMuted} numberOfLines={1}>
                {me.salon_name}
              </Text>
            ) : null}

            <Text style={styles.fieldLabel}>Display name</Text>
            <TextInput
              style={styles.input}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder=""
              placeholderTextColor="#8E8E93"
              autoCapitalize="words"
              editable={!saving}
            />
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={saveName}
              disabled={saving || !me}
              activeOpacity={0.88}
            >
              {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>Save</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.signOut} onPress={confirmSignOut} activeOpacity={0.88}>
              <Text style={styles.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={[styles.deleteFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <TouchableOpacity
              style={styles.deleteProfile}
              onPress={confirmDeleteProfile}
              disabled={deletingAccount || !me || uploading || saving}
              activeOpacity={0.88}
              accessibilityRole="button"
            >
              {deletingAccount ? (
                <ActivityIndicator color="#8E1616" />
              ) : (
                <Text style={styles.deleteProfileText}>Delete profile</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  topTitle: {
    fontSize: 18,
    fontFamily: FontFamily.semibold,
    color: '#1C1C1E',
  },
  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentColumn: {
    flex: 1,
  },
  scroll: { flex: 1 },
  scrollInner: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignItems: 'center',
    flexGrow: 1,
  },
  avatarTouch: {
    width: 112,
    height: 112,
    borderRadius: 56,
    overflow: 'hidden',
    marginTop: 16,
    marginBottom: 14,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.38)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  namePreview: {
    fontSize: 20,
    fontFamily: FontFamily.semibold,
    color: '#1C1C1E',
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  emailMuted: {
    marginTop: 4,
    fontSize: 14,
    fontFamily: FontFamily.regular,
    color: '#8E8E93',
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  salonMuted: {
    marginTop: 2,
    fontSize: 13,
    fontFamily: FontFamily.regular,
    color: '#AEAEB2',
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  fieldLabel: {
    alignSelf: 'stretch',
    marginTop: 28,
    marginBottom: 8,
    fontSize: 14,
    fontFamily: FontFamily.medium,
    color: '#1C1C1E',
  },
  input: {
    alignSelf: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    color: '#1C1C1E',
    backgroundColor: '#FFFFFF',
  },
  saveBtn: {
    alignSelf: 'stretch',
    marginTop: 16,
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.55,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: FontFamily.semibold,
  },
  signOut: {
    marginTop: 32,
    paddingVertical: 12,
    alignSelf: 'center',
  },
  signOutText: {
    fontSize: 16,
    fontFamily: FontFamily.medium,
    color: '#C62828',
  },
  deleteFooter: {
    alignItems: 'center',
    paddingTop: 8,
  },
  deleteProfile: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  deleteProfileText: {
    fontSize: 16,
    fontFamily: FontFamily.semibold,
    color: '#8E1616',
  },
});