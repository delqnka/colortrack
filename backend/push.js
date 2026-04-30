/** Matches expo-server-sdk static isExpoPushToken (must stay in sync with upstream). */
function isExpoPushToken(token) {
  return (
    typeof token === 'string' &&
    (((token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[')) &&
      token.endsWith(']')) ||
      /^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/i.test(token))
  );
}

let expoModulePromise = null;
function loadExpoModule() {
  if (!expoModulePromise) {
    expoModulePromise = import('expo-server-sdk');
  }
  return expoModulePromise;
}

/** Lazy singleton: expo-server-sdk uses createRequire(import.meta.url) and cannot live inside esbuild CJS bundle. */
let expoClient = null;
async function getExpo() {
  if (!expoClient) {
    const { Expo } = await loadExpoModule();
    expoClient = new Expo();
  }
  return expoClient;
}

async function getTokensForSalon(sql, salonId) {
  const rows = await sql`
    SELECT DISTINCT p.expo_token
    FROM push_tokens p
    INNER JOIN staff s ON s.id = p.staff_id
    WHERE s.salon_id = ${salonId}
  `;
  return rows.map((r) => String(r.expo_token)).filter((t) => isExpoPushToken(t));
}

async function notifySalon(sql, salonId, title, body, data) {
  const expo = await getExpo();
  const tokens = await getTokensForSalon(sql, salonId);
  if (!tokens.length) return { sent: 0 };

  const messages = tokens.map((to) => ({
    to,
    sound: 'default',
    title,
    body,
    data: data || {},
  }));

  const chunks = expo.chunkPushNotifications(messages);
  let sent = 0;
  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      for (const t of tickets) {
        if (t.status === 'ok') sent += 1;
      }
    } catch {
      /* ignore batch */
    }
  }
  return { sent };
}

module.exports = { notifySalon, getTokensForSalon, isExpoPushToken };
