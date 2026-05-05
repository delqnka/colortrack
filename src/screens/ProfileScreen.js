import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  DeviceEventEmitter,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  saveSessionToken,
  resolveImagePublicUri,
  mergeStaffMeResponse,
  getProfileMeCacheStorageKey,
} from '../api/client';
import { FontFamily } from '../theme/fonts';
import { Type, typeLh } from '../theme/typography';
import { useCurrency } from '../context/CurrencyContext';
import CurrencyPickerModal from '../components/CurrencyPickerModal';

const DEFAULT_AVATAR =
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=150&auto=format&fit=crop';
const IMAGE_MEDIA_TYPES = ImagePicker.MediaType?.Images ? [ImagePicker.MediaType.Images] : ['images'];

function messageForProfileDeleteFailure(err) {
  const m = String(err?.message || '').trim().toLowerCase();
  if (m === 'last_staff') return 'Only staff member for this salon.';
  if (m === 'last_admin') return 'Only administrator for this salon.';
  return String(err?.message || '').trim() || 'Could not delete profile.';
}

function messageForProfileSaveFailure(err) {
  const m = String(err?.message || '').trim().toLowerCase();
  if (m === 'conflict') return 'This email is already registered.';
  if (m === 'unauthorized') return 'Current password is incorrect.';
  if (m === 'bad_request') return 'Check email and password.';
  return String(err?.message || '').trim() || 'Could not save';
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
  const { currency, setCurrency } = useCurrency();
  const [pickCurOpen, setPickCurOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [me, setMe] = useState(null);
  const [nameDraft, setNameDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [currentPasswordDraft, setCurrentPasswordDraft] = useState('');
  const [newPasswordDraft, setNewPasswordDraft] = useState('');
  const [confirmPasswordDraft, setConfirmPasswordDraft] = useState('');

  // Load avatar from AsyncStorage cache immediately — no network delay
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(getProfileMeCacheStorageKey());
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached && typeof cached === 'object') {
            setMe((prev) => prev ?? mergeStaffMeResponse(null, cached));
          }
        }
      } catch { /* noop */ }
    })();
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const row = await apiGet('/api/me', { allowStaleCache: false });
      if (!row || typeof row !== 'object') return;
      setMe((prev) => mergeStaffMeResponse(prev, row));
      setNameDraft(row.display_name || '');
      setEmailDraft(row.email || '');
      setCurrentPasswordDraft('');
      setNewPasswordDraft('');
      setConfirmPasswordDraft('');
    } catch {
      /* Do not clear profile/avatar on transient errors */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const saveProfile = async () => {
    if (!me || saving) return;
    const trimmedEmail = emailDraft.trim();
    const nextPassword = newPasswordDraft;
    if (!trimmedEmail) {
      Alert.alert('', 'Email is required.');
      return;
    }
    if (nextPassword || confirmPasswordDraft) {
      if (nextPassword.length < 8) {
        Alert.alert('', 'Password must be at least 8 characters.');
        return;
      }
      if (nextPassword !== confirmPasswordDraft) {
        Alert.alert('', 'Passwords do not match.');
        return;
      }
      if (me.has_password && !currentPasswordDraft) {
        Alert.alert('', 'Current password is required.');
        return;
      }
    }
    setSaving(true);
    try {
      const trimmed = nameDraft.trim();
      const payload = {
        display_name: trimmed.length ? trimmed : null,
        email: trimmedEmail,
      };
      if (nextPassword) {
        payload.password = nextPassword;
        if (me.has_password) payload.current_password = currentPasswordDraft;
      }
      const updated = await apiPatch('/api/me', payload, {
        clearSessionOn401: false,
        queueOffline: false,
      });
      setMe((prev) => ({ ...prev, ...updated }));
      setNameDraft(updated.display_name || '');
      setEmailDraft(updated.email || '');
      setCurrentPasswordDraft('');
      setNewPasswordDraft('');
      setConfirmPasswordDraft('');
      DeviceEventEmitter.emit('colortrack:profile-changed');
    } catch (e) {
      Alert.alert('', messageForProfileSaveFailure(e));
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
      mediaTypes: IMAGE_MEDIA_TYPES,
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
      DeviceEventEmitter.emit('colortrack:profile-changed');
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

  const rawStaffAvatar = String(me?.avatar_url ?? '').trim();
  const avatarUri =
    rawStaffAvatar.length > 0
      ? resolveImagePublicUri(rawStaffAvatar) || DEFAULT_AVATAR
      : DEFAULT_AVATAR;
  const titleLine = me?.display_name?.trim() || me?.email?.split('@')[0] || '';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.topBar}>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Ionicons name="chevron-back" size={26} color="#1C1C1E" />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Profile</Text>
        <TouchableOpacity hitSlop={12} onPress={() => navigation.navigate('PaywallPreview')} accessibilityRole="button">
          <Ionicons name="card-outline" size={24} color="#5E35B1" />
        </TouchableOpacity>
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
              <Image
                source={{ uri: avatarUri }}
                style={styles.avatar}
                cachePolicy="disk"
                transition={200}
                placeholder={{ thumbhash: null }}
              />
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

            <Text style={[styles.fieldLabel, styles.firstFieldLabel]}>Display name</Text>
            <TextInput
              style={styles.input}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder=""
              placeholderTextColor="#8A8A8E"
              autoCapitalize="words"
              editable={!saving}
            />

            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              style={styles.input}
              value={emailDraft}
              onChangeText={setEmailDraft}
              placeholder=""
              placeholderTextColor="#8A8A8E"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              editable={!saving}
            />

            {me?.has_password ? (
              <>
                <Text style={styles.fieldLabel}>Current password</Text>
                <TextInput
                  style={styles.input}
                  value={currentPasswordDraft}
                  onChangeText={setCurrentPasswordDraft}
                  placeholder=""
                  placeholderTextColor="#8A8A8E"
                  secureTextEntry
                  autoComplete="password"
                  editable={!saving}
                />
              </>
            ) : null}

            <Text style={styles.fieldLabel}>New password</Text>
            <TextInput
              style={styles.input}
              value={newPasswordDraft}
              onChangeText={setNewPasswordDraft}
              placeholder=""
              placeholderTextColor="#8A8A8E"
              secureTextEntry
              autoComplete="password-new"
              editable={!saving}
            />

            <Text style={styles.fieldLabel}>Confirm password</Text>
            <TextInput
              style={styles.input}
              value={confirmPasswordDraft}
              onChangeText={setConfirmPasswordDraft}
              placeholder=""
              placeholderTextColor="#8A8A8E"
              secureTextEntry
              autoComplete="password-new"
              editable={!saving}
            />
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={saveProfile}
              disabled={saving || !me}
              activeOpacity={0.88}
            >
              {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveBtnText}>Save</Text>}
            </TouchableOpacity>

            {/* Currency selector */}
            <TouchableOpacity style={styles.currencyRow} onPress={() => setPickCurOpen(true)} activeOpacity={0.8}>
              <Text style={styles.currencyLabel}>Currency</Text>
              <View style={styles.currencyRight}>
                <Text style={styles.currencyValue}>{currency}</Text>
                <Ionicons name="chevron-forward" size={16} color="#AEAEB2" />
              </View>
            </TouchableOpacity>


            {me?.role === 'admin' && (
              <TouchableOpacity style={styles.currencyRow} onPress={() => navigation.navigate('Affiliate')} activeOpacity={0.8}>
                <Text style={styles.currencyLabel}>Partner Program</Text>
                <View style={styles.currencyRight}>
                  <Text style={styles.currencyValue}>Affiliate</Text>
                  <Ionicons name="chevron-forward" size={16} color="#AEAEB2" />
                </View>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.signOut} onPress={confirmSignOut} activeOpacity={0.88}>
              <Text style={styles.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </ScrollView>

          <CurrencyPickerModal
            visible={pickCurOpen}
            currentCode={currency}
            onClose={() => setPickCurOpen(false)}
            onSelect={(code) => { setCurrency(code); setPickCurOpen(false); }}
          />

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
  topTitle: { ...Type.screenTitle, color: '#0D0D0D' },
  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentColumn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scroll: { flex: 1, backgroundColor: '#FFFFFF' },
  scrollInner: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignItems: 'center',
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
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
    ...Type.screenTitle,
    color: '#0D0D0D',
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  emailMuted: {
    marginTop: 4,
    ...Type.secondary,
    color: '#8A8A8E',
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  salonMuted: {
    marginTop: 2,
    ...Type.greetingDate,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  fieldLabel: {
    alignSelf: 'stretch',
    marginTop: 16,
    marginBottom: 8,
    fontSize: 13,
    lineHeight: typeLh(13),
    fontFamily: FontFamily.medium,
    color: '#0D0D0D',
  },
  firstFieldLabel: {
    marginTop: 28,
  },
  input: {
    alignSelf: 'stretch',
    borderWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: typeLh(15),
    fontFamily: FontFamily.regular,
    color: '#0D0D0D',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 3,
  },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  currencyLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 15,
    color: '#0D0D0D',
  },
  currencyRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  currencyValue: {
    fontFamily: FontFamily.semibold,
    fontSize: 15,
    color: '#5E35B1',
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
    ...Type.buttonLabel,
  },
  signOut: {
    marginTop: 32,
    paddingVertical: 12,
    alignSelf: 'center',
  },
  signOutText: {
    ...Type.buttonLabel,
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
    ...Type.buttonLabel,
    color: '#8E1616',
  },
});