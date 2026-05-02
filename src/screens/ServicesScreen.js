import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { apiGet, apiPatch, apiPost } from '../api/client';
import { glassPurpleIconBtn } from '../theme/glassUi';
import { FontFamily } from '../theme/fonts';
import { useCurrency } from '../context/CurrencyContext';
import { formatMinorFromStoredCents } from '../format/moneyDisplay';

const IMAGE_MEDIA_TYPES = ImagePicker.MediaType?.Images ? [ImagePicker.MediaType.Images] : ['images'];

function priceTextFromCents(cents) {
  if (cents == null || cents === '') return '';
  const n = Number(cents);
  if (!Number.isFinite(n)) return '';
  return String(n / 100).replace(/\.00$/, '');
}

function centsFromPriceText(text) {
  const raw = String(text || '').trim().replace(',', '.');
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function previewRowsFromServices(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, index) => ({
      key: `${Date.now()}-${index}`,
      name: String(row?.name || '').trim(),
      price: priceTextFromCents(row?.price_cents),
    }))
    .filter((row) => row.name);
}

export default function ServicesScreen({ navigation }) {
  const { currency } = useCurrency();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importBusy, setImportBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [savingServices, setSavingServices] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const loadServices = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await apiGet('/api/services', { allowStaleCache: false });
      setServices(Array.isArray(rows) ? rows : []);
    } catch {
      setServices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadServices();
    }, [loadServices]),
  );

  const updatePreviewRow = (key, patch) => {
    setPreviewRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removePreviewRow = (key) => {
    setPreviewRows((rows) => rows.filter((row) => row.key !== key));
  };

  const addPreviewRow = () => {
    setPreviewRows((rows) => [
      ...rows,
      { key: `${Date.now()}-${rows.length}`, name: '', price: '' },
    ]);
  };

  const importPriceList = async (source) => {
    if (importBusy) return;
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('', 'Camera access');
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('', 'Photo library access');
          return;
        }
      }
      const picker = source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
      const result = await picker({
        mediaTypes: IMAGE_MEDIA_TYPES,
        base64: true,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert('', 'Image');
        return;
      }
      const contentType =
        asset.mimeType && asset.mimeType.startsWith('image/') ? asset.mimeType : 'image/jpeg';
      setImportBusy(true);
      const data = await apiPost(
        '/api/services/import/ocr',
        { image_base64: asset.base64, content_type: contentType },
        { queueOffline: false },
      );
      const rows = previewRowsFromServices(data?.services);
      if (!rows.length) {
        Alert.alert('', 'No services found.');
        return;
      }
      setPreviewRows(rows);
      setPreviewOpen(true);
    } catch (e) {
      Alert.alert('', e.message || 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };

  const saveImportedServices = async () => {
    const servicesToSave = previewRows
      .map((row) => ({
        name: row.name.trim(),
        price_cents: centsFromPriceText(row.price),
        currency_code: currency,
      }))
      .filter((row) => row.name);
    if (!servicesToSave.length || savingServices) return;
    setSavingServices(true);
    try {
      const saved = await apiPost(
        '/api/services/bulk',
        { services: servicesToSave },
        { queueOffline: false },
      );
      setServices(Array.isArray(saved) ? saved : []);
      await loadServices();
      setPreviewOpen(false);
      setPreviewRows([]);
    } catch (e) {
      Alert.alert('', e.message || 'Save failed');
    } finally {
      setSavingServices(false);
    }
  };

  const openEditService = (service) => {
    setEditingService(service);
    setEditName(service.name || '');
    setEditPrice(priceTextFromCents(service.price_cents));
  };

  const closeEditService = () => {
    setEditingService(null);
    setEditName('');
    setEditPrice('');
  };

  const saveEditedService = async () => {
    if (!editingService || savingEdit) return;
    const name = editName.trim();
    if (!name) {
      Alert.alert('', 'Name');
      return;
    }
    setSavingEdit(true);
    try {
      const updated = await apiPatch(
        `/api/services/${editingService.id}`,
        {
          name,
          price_cents: centsFromPriceText(editPrice),
          currency_code: currency,
        },
        { queueOffline: false },
      );
      setServices((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      closeEditService();
    } catch (e) {
      const oldName = String(editingService.name || '').trim();
      if (
        String(e?.message || '') === 'not_found' &&
        oldName &&
        oldName.toLowerCase() === name.toLowerCase()
      ) {
        try {
          await apiPost(
            '/api/services/bulk',
            {
              services: [
                {
                  name,
                  price_cents: centsFromPriceText(editPrice),
                  currency_code: currency,
                },
              ],
            },
            { queueOffline: false },
          );
          await loadServices();
          closeEditService();
          return;
        } catch (fallbackError) {
          Alert.alert('', fallbackError.message || 'Save failed');
          return;
        }
      }
      Alert.alert('', e.message || 'Save failed');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerSide} />
        <Text style={styles.title}>Services</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={12}>
          <Ionicons name="close" size={26} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, importBusy && styles.actionBtnDisabled]}
            onPress={() => importPriceList('camera')}
            disabled={importBusy}
            activeOpacity={0.88}
          >
            <Text style={styles.actionBtnText}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, importBusy && styles.actionBtnDisabled]}
            onPress={() => importPriceList('library')}
            disabled={importBusy}
            activeOpacity={0.88}
          >
            {importBusy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.actionBtnText}>Import</Text>}
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 28 }} color="#1C1C1E" />
        ) : (
          <View style={styles.list}>
            {services.map((service) => (
              <View key={service.id} style={styles.serviceRow}>
                <View style={styles.serviceInfo}>
                  <Text style={styles.serviceName}>{service.name}</Text>
                  {service.price_cents != null ? (
                    <Text style={styles.servicePrice}>
                      {formatMinorFromStoredCents(service.price_cents, currency)}
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity onPress={() => openEditService(service)} hitSlop={10}>
                  <Ionicons name="pencil" size={20} color="#5E35B1" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={previewOpen} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Services</Text>
              <TouchableOpacity
                onPress={() => {
                  setPreviewOpen(false);
                  setPreviewRows([]);
                }}
              >
                <Text style={styles.modalClose}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              contentContainerStyle={styles.previewContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {previewRows.map((row) => (
                <View key={row.key} style={styles.previewRow}>
                  <TextInput
                    style={[styles.previewInput, styles.previewNameInput]}
                    value={row.name}
                    onChangeText={(text) => updatePreviewRow(row.key, { name: text })}
                    placeholder=""
                    placeholderTextColor="#1C1C1E"
                  />
                  <TextInput
                    style={[styles.previewInput, styles.previewPriceInput]}
                    value={row.price}
                    onChangeText={(text) => updatePreviewRow(row.key, { price: text })}
                    placeholder=""
                    placeholderTextColor="#1C1C1E"
                    keyboardType="decimal-pad"
                  />
                  <Text style={styles.currencyLabel}>{currency}</Text>
                  <TouchableOpacity onPress={() => removePreviewRow(row.key)} hitSlop={8}>
                    <Ionicons name="close-circle" size={22} color="#1C1C1E" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={styles.addRowBtn} onPress={addPreviewRow} activeOpacity={0.85}>
                <Text style={styles.addRowTxt}>Add row</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, savingServices && styles.actionBtnDisabled]}
                onPress={saveImportedServices}
                disabled={savingServices}
                activeOpacity={0.9}
              >
                {savingServices ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.actionBtnText}>Save services</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={Boolean(editingService)} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <View style={styles.editSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Edit</Text>
              <TouchableOpacity onPress={closeEditService}>
                <Text style={styles.modalClose}>Done</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.editContent}>
              <Text style={styles.editLabel}>Name</Text>
              <TextInput
                style={styles.editInput}
                value={editName}
                onChangeText={setEditName}
                placeholder=""
                placeholderTextColor="#1C1C1E"
              />
              <Text style={styles.editLabel}>Price</Text>
              <View style={styles.editPriceRow}>
                <TextInput
                  style={[styles.editInput, styles.editPriceInput]}
                  value={editPrice}
                  onChangeText={setEditPrice}
                  placeholder=""
                  placeholderTextColor="#1C1C1E"
                  keyboardType="decimal-pad"
                />
                <Text style={styles.editCurrencyLabel}>{currency}</Text>
              </View>
              <TouchableOpacity
                style={[styles.saveBtn, savingEdit && styles.actionBtnDisabled]}
                onPress={saveEditedService}
                disabled={savingEdit}
                activeOpacity={0.9}
              >
                {savingEdit ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.actionBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const reliefShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.14,
  shadowRadius: 5,
  elevation: 4,
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
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
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontFamily: FontFamily.regular,
    color: '#1C1C1E',
  },
  scroll: { paddingHorizontal: 24, paddingBottom: 32 },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    marginBottom: 18,
  },
  actionBtn: {
    flex: 1,
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: '#5E35B1',
    alignItems: 'center',
    justifyContent: 'center',
    ...reliefShadow,
  },
  actionBtnDisabled: { opacity: 0.6 },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: FontFamily.semibold,
  },
  list: {
    gap: 10,
  },
  serviceRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...reliefShadow,
  },
  serviceInfo: {
    flex: 1,
    paddingRight: 12,
  },
  serviceName: {
    fontSize: 16,
    fontFamily: FontFamily.medium,
    color: '#1C1C1E',
  },
  servicePrice: {
    marginTop: 4,
    fontSize: 14,
    fontFamily: FontFamily.regular,
    color: '#5E35B1',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '78%',
    paddingBottom: 16,
  },
  editSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 16,
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
  modalTitle: { fontSize: 17, fontFamily: FontFamily.regular, color: '#1C1C1E' },
  modalClose: { fontSize: 17, fontFamily: FontFamily.regular, color: '#5E35B1' },
  previewContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 160,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  previewInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1C1C1E',
    ...reliefShadow,
  },
  previewNameInput: {
    flex: 1,
  },
  previewPriceInput: {
    width: 86,
  },
  currencyLabel: {
    minWidth: 34,
    fontSize: 13,
    fontFamily: FontFamily.medium,
    color: '#5E35B1',
  },
  addRowBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  addRowTxt: {
    fontSize: 15,
    fontFamily: FontFamily.regular,
    color: '#5E35B1',
  },
  saveBtn: {
    marginTop: 18,
    backgroundColor: '#5E35B1',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    ...reliefShadow,
  },
  editContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  editLabel: {
    fontSize: 14,
    fontFamily: FontFamily.regular,
    color: '#1C1C1E',
    marginBottom: 8,
  },
  editInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1C1C1E',
    marginBottom: 14,
    ...reliefShadow,
  },
  editPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  editPriceInput: {
    flex: 1,
    marginBottom: 0,
  },
  editCurrencyLabel: {
    minWidth: 42,
    fontSize: 15,
    fontFamily: FontFamily.medium,
    color: '#5E35B1',
  },
});
