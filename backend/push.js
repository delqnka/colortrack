const { Expo } = require('expo-server-sdk');

const expo = new Expo();

async function getTokensForSalon(sql, salonId) {
  const rows = await sql`
    SELECT DISTINCT p.expo_token
    FROM push_tokens p
    INNER JOIN staff s ON s.id = p.staff_id
    WHERE s.salon_id = ${salonId}
  `;
  return rows.map((r) => String(r.expo_token)).filter((t) => Expo.isExpoPushToken(t));
}

async function notifySalon(sql, salonId, title, body, data) {
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

module.exports = { notifySalon, getTokensForSalon, Expo };
