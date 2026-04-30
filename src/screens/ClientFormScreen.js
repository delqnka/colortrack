import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { getCountryCallingCode } from 'libphonenumber-js';
import { apiGet, apiPatch, apiPost } from '../api/client';
import {
  getPhoneCountries,
  formatE164,
  splitPhoneForForm,
  flagEmoji,
} from '../lib/phoneCountries';
import { glassPurpleIconBtn } from '../theme/glassUi';

function patchDateToInput(v) {
  if (v == null || v === '') return '';
  const s = typeof v === 'string' ? v : String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

async function uploadAvatarToR2(clientId, pending) {
  const presign = await apiPost(`/api/clients/${clientId}/avatar/presign`, {
    contentType: pending.contentType,
  });
  const fileRes = await fetch(pending.uri);
  const blob = await fileRes.blob();
  const putRes = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': presign.contentType },
    body: blob,
  });
  if (!putRes.ok) {
    throw new Error(`Upload failed (${putRes.status})`);
  }
  await apiPost(`/api/clients/${clientId}/avatar/commit`, {
    key: presign.key,
    contentType: presign.contentType,
  });
}

const DEFAULT_ISO = 'BG';

/** Първа дума → име, останалото → фамилия (и две имена BG). */
function splitFullName(full) {
  const s = String(full || '').trim();
  if (!s) return { first: '', last: '' };
  const i = s.indexOf(' ');
  if (i === -1) return { first: s, last: '' };
  return { first: s.slice(0, i), last: s.slice(i + 1).trim() };
}

function joinFullName(first, last) {
  return `${String(first || '').trim()} ${String(last || '').trim()}`.replace(/\s+/g, ' ').trim();
}

export default function ClientFormScreen({ route, navigation }) {
  const clientId = route.params?.clientId;
  const isEdit = Number.isFinite(clientId) && clientId > 0;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [countryIso, setCountryIso] = useState(DEFAULT_ISO);
  const [nationalNumber, setNationalNumber] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [pendingAvatar, setPendingAvatar] = useState(null);
  const [notes, setNotes] = useState('');
  const [patchTest, setPatchTest] = useState('');
  const [countryModal, setCountryModal] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const calendarPrefillKeyRef = useRef(null);

  const allCountries = useMemo(() => getPhoneCountries(), []);

  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return allCountries;
    return allCountries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        c.iso.toLowerCase().includes(q),
    );
  }, [allCountries, countryQuery]);

  const dialDisplay = useMemo(() => {
    try {
      return getCountryCallingCode(countryIso);
    } catch {
      return '';
    }
  }, [countryIso]);

  const load = useCallback(async () => {
    if (!isEdit) return;
    setLoading(true);
    try {
      const c = await apiGet(`/api/clients/${clientId}`);
      const { first, last } = splitFullName(c.full_name);
      setFirstName(first);
      setLastName(last);
      const { iso, national } = splitPhoneForForm(c.phone, DEFAULT_ISO);
      setCountryIso(iso);
      setNationalNumber(national);
      setEmail(c.email || '');
      setAvatarUrl(c.avatar_url || '');
      setPendingAvatar(null);
      setNotes(c.notes || '');
      setPatchTest(patchDateToInput(c.last_patch_test_at));
    } catch {
      Alert.alert('', 'Load failed');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [clientId, isEdit, navigation]);

  useFocusEffect(
    useCallback(() => {
      if (!isEdit) {
        const calKey = route.params?.fromDeviceCalendarEventId;
        if (calKey != null && String(calKey).trim()) {
          const ck = String(calKey).trim();
          if (calendarPrefillKeyRef.current !== ck) {
            calendarPrefillKeyRef.current = ck;
            const { first, last } = splitFullName(route.params?.initialFullName);
            setFirstName(first);
            setLastName(last);
            setNotes(String(route.params?.initialNotesFromCalendar || '').trim());
          }
        } else {
          calendarPrefillKeyRef.current = null;
          setFirstName('');
          setLastName('');
          setNotes('');
        }
        setCountryIso(DEFAULT_ISO);
        setNationalNumber('');
        setEmail('');
        setAvatarUrl('');
        setPendingAvatar(null);
        setPatchTest('');
        setCountryQuery('');
        setLoading(false);
        return;
      }
      load();
    }, [
      isEdit,
      load,
      route.params?.fromDeviceCalendarEventId,
      route.params?.initialFullName,
      route.params?.initialNotesFromCalendar,
    ]),
  );

  const pickAvatar = async () => {
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
    const contentType =
      asset.mimeType && asset.mimeType.startsWith('image/')
        ? asset.mimeType.split(';')[0].trim().toLowerCase() === 'image/jpg'
          ? 'image/jpeg'
          : asset.mimeType.split(';')[0].trim().toLowerCase()
        : 'image/jpeg';
    setPendingAvatar({ uri: asset.uri, contentType });
  };

  const displayAvatarUri = pendingAvatar?.uri || avatarUrl || null;

  const tryUploadAvatar = async (id) => {
    if (!pendingAvatar) return;
    setUploadingPhoto(true);
    try {
      await uploadAvatarToR2(id, pendingAvatar);
      setPendingAvatar(null);
    } catch (uploadErr) {
      const m = String(uploadErr?.message || '').toLowerCase();
      setPendingAvatar(null);
      if (m.includes('unavailable')) {
        Alert.alert(
          'Saved',
          'Client saved. Photo was not uploaded — file storage (R2) is not configured on the server. Add R2 env vars in backend, or create the client without a photo.',
        );
      } else {
        Alert.alert('', String(uploadErr?.message || 'Photo upload failed'));
      }
    } finally {
      setUploadingPhoto(false);
    }
  };

  const save = async () => {
    const name = joinFullName(firstName, lastName);
    if (!name) {
      Alert.alert('', 'First or last name');
      return;
    }
    const phoneVal = formatE164(countryIso, nationalNumber);
    const body = {
      full_name: name,
      phone: phoneVal,
      email: email.trim() || null,
      notes: notes.trim() || null,
      last_patch_test_at: patchTest.trim() ? patchTest.trim() : null,
    };
    if (!pendingAvatar) {
      body.avatar_url = avatarUrl.trim() || null;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await apiPatch(`/api/clients/${clientId}`, body);
        await tryUploadAvatar(clientId);
        navigation.goBack();
      } else {
        const row = await apiPost('/api/clients', body);
        await tryUploadAvatar(row.id);
        navigation.replace('ClientDetail', { clientId: row.id });
      }
    } catch (e) {
      Alert.alert('', e.message || '');
    } finally {
      setSaving(false);
      setUploadingPhoto(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={styles.header}>
          <View style={styles.headerSide} />
          <Text style={styles.title}>{isEdit ? 'Edit' : 'New'}</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={12}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.label}>First name</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={firstName}
            onChangeText={setFirstName}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Last name</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={lastName}
            onChangeText={setLastName}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Phone</Text>
          <View style={styles.phoneRow}>
            <TouchableOpacity
              style={styles.countryBtn}
              onPress={() => {
                setCountryQuery('');
                setCountryModal(true);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.countryBtnText}>
                {flagEmoji(countryIso)} +{dialDisplay}
              </Text>
              <Ionicons name="chevron-down" size={18} color="#1C1C1E" />
            </TouchableOpacity>
            <TextInput
              style={styles.phoneInput}
              placeholder=""
              placeholderTextColor="#1C1C1E"
              value={nationalNumber}
              onChangeText={setNationalNumber}
              keyboardType="phone-pad"
            />
          </View>

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={styles.label}>Photo</Text>
          <View style={styles.photoRow}>
            <TouchableOpacity onPress={pickAvatar} activeOpacity={0.88}>
              {displayAvatarUri ? (
                <View style={styles.photoThumbWrap}>
                  <Image source={{ uri: displayAvatarUri }} style={styles.photoThumb} />
                </View>
              ) : (
                <View style={styles.photoIconOnly}>
                  <Ionicons name="cloud-upload-outline" size={36} color="#5E35B1" />
                </View>
              )}
            </TouchableOpacity>
            <View style={styles.photoActions}>
              <TouchableOpacity onPress={pickAvatar} style={styles.photoLink} activeOpacity={0.85}>
                <Text style={styles.photoLinkText}>
                  {displayAvatarUri ? 'Change' : 'Add'}
                </Text>
              </TouchableOpacity>
              {pendingAvatar ? (
                <TouchableOpacity
                  onPress={() => setPendingAvatar(null)}
                  style={styles.photoLink}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.photoLinkText, styles.photoLinkMuted]}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <Text style={styles.label}>Patch test (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={patchTest}
            onChangeText={setPatchTest}
            autoCapitalize="none"
          />

          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder=""
            placeholderTextColor="#1C1C1E"
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          <TouchableOpacity
            style={[styles.saveBtn, (saving || uploadingPhoto) && styles.saveDisabled]}
            onPress={save}
            disabled={saving || uploadingPhoto}
            activeOpacity={0.9}
          >
            {saving || uploadingPhoto ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveTxt}>Save</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={countryModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe} edges={['top']}>
          <View style={styles.modalHeader}>
            <View style={styles.headerSide} />
            <Text style={styles.modalTitle}>Country</Text>
            <TouchableOpacity
              onPress={() => setCountryModal(false)}
              style={styles.iconBtn}
              hitSlop={12}
            >
              <Ionicons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.modalSearch}
            placeholder="Search"
            placeholderTextColor="#1C1C1E"
            value={countryQuery}
            onChangeText={setCountryQuery}
            autoCapitalize="none"
          />
          <FlatList
            data={filteredCountries}
            keyExtractor={(item) => item.iso}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.countryRow}
                onPress={() => {
                  setCountryIso(item.iso);
                  setCountryModal(false);
                }}
              >
                <Text style={styles.countryRowFlag}>{flagEmoji(item.iso)}</Text>
                <Text style={styles.countryRowName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.countryRowDial}>+{item.dial}</Text>
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

/** Black shadow so white fields read as raised “tabs” on white page */
const reliefShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.14,
  shadowRadius: 5,
  elevation: 4,
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerSide: { width: 40, height: 40 },
  iconBtn: {
    ...glassPurpleIconBtn,
  },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '400', color: '#1C1C1E' },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 },
  label: { fontSize: 14, fontWeight: '400', color: '#1C1C1E', marginBottom: 8, marginTop: 4 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1C1C1E',
    marginBottom: 4,
    ...reliefShadow,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minWidth: 118,
    ...reliefShadow,
  },
  countryBtnText: { fontSize: 16, fontWeight: '400', color: '#1C1C1E' },
  phoneInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1C1C1E',
    ...reliefShadow,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 8,
  },
  photoThumbWrap: {
    width: 88,
    height: 88,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  photoThumb: { width: '100%', height: '100%' },
  photoIconOnly: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  photoActions: { gap: 8 },
  photoLink: { paddingVertical: 4 },
  photoLinkText: { fontSize: 16, fontWeight: '400', color: '#5E35B1' },
  photoLinkMuted: { color: '#1C1C1E', fontWeight: '400' },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  saveBtn: {
    marginTop: 28,
    backgroundColor: '#5E35B1',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 6,
  },
  saveDisabled: { opacity: 0.6 },
  saveTxt: { color: '#fff', fontSize: 16, fontWeight: '400' },
  modalSafe: { flex: 1, backgroundColor: '#FFFFFF' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  modalTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '400', color: '#1C1C1E' },
  modalSearch: {
    marginHorizontal: 16,
    marginVertical: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1C1C1E',
    ...reliefShadow,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
    gap: 12,
  },
  countryRowFlag: { fontSize: 22 },
  countryRowName: { flex: 1, fontSize: 16, color: '#1C1C1E' },
  countryRowDial: { fontSize: 16, fontWeight: '400', color: '#1C1C1E' },
});
