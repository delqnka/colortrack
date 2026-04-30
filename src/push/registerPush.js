import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import { apiPost, getSessionToken, loadStoredToken } from '../api/client';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function registerExpoPushIfPossible() {
  await loadStoredToken();
  if (!getSessionToken()) return;
  if (!Device.isDevice) return;
  const { status: cur } = await Notifications.getPermissionsAsync();
  let next = cur;
  if (cur !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    next = req.status;
  }
  if (next !== 'granted') return;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  let tokenRow;
  try {
    tokenRow = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
  } catch {
    return;
  }
  const token = tokenRow?.data;
  if (!token) return;
  try {
    await apiPost('/api/push/register', { token });
  } catch {
    /* ignore */
  }
}
