import React, { useCallback, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet, apiPatch, apiPost } from '../api/client';

function patchDateToInput(v) {
  if (v == null || v === '') return '';
  const s = typeof v === 'string' ? v : String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

export default function ClientFormScreen({ route, navigation }) {
  const clientId = route.params?.clientId;
  const isEdit = Number.isFinite(clientId) && clientId > 0;

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [patchTest, setPatchTest] = useState('');

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!isEdit) return;
    setLoading(true);
    try {
      const c = await apiGet(`/api/clients/${clientId}`);
      setFullName(c.full_name || '');
      setPhone(c.phone || '');
      setEmail(c.email || '');
      setAvatarUrl(c.avatar_url || '');
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
        setFullName('');
        setPhone('');
        setEmail('');
        setAvatarUrl('');
        setNotes('');
        setPatchTest('');
        setLoading(false);
        return;
      }
      load();
    }, [isEdit, load]),
  );

  const save = async () => {
    const name = fullName.trim();
    if (!name) {
      Alert.alert('', 'Name');
      return;
    }
    const body = {
      full_name: name,
      phone: phone.trim() || null,
      email: email.trim() || null,
      avatar_url: avatarUrl.trim() || null,
      notes: notes.trim() || null,
      last_patch_test_at: patchTest.trim() ? patchTest.trim() : null,
    };

    setSaving(true);
    try {
      if (isEdit) {
        await apiPatch(`/api/clients/${clientId}`, body);
        navigation.goBack();
      } else {
        const row = await apiPost('/api/clients', body);
        navigation.replace('ClientDetail', { clientId: row.id });
      }
    } catch (e) {
      Alert.alert('', e.message || '');
    } finally {
      setSaving(false);
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
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={12}>
            <Ionicons name="close" size={26} color="#1C1C1E" />
          </TouchableOpacity>
          <Text style={styles.title}>{isEdit ? 'Edit' : 'New'}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#C7C7CC"
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Phone</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#C7C7CC"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#C7C7CC"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={styles.label}>Photo URL</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#C7C7CC"
            value={avatarUrl}
            onChangeText={setAvatarUrl}
            autoCapitalize="none"
          />

          <Text style={styles.label}>Patch test (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            placeholder=""
            placeholderTextColor="#C7C7CC"
            value={patchTest}
            onChangeText={setPatchTest}
            autoCapitalize="none"
          />

          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder=""
            placeholderTextColor="#C7C7CC"
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveDisabled]}
            onPress={save}
            disabled={saving}
            activeOpacity={0.9}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Save</Text>}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#F5F5FA' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, fontWeight: '800', color: '#1C1C1E' },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 },
  label: { fontSize: 14, fontWeight: '700', color: '#8E8E93', marginBottom: 8, marginTop: 4 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1C1C1E',
    marginBottom: 4,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  saveBtn: {
    marginTop: 28,
    backgroundColor: '#5E35B1',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  saveDisabled: { opacity: 0.6 },
  saveTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
