import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar';

function toYmdLocal(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function boundsForDay(ymd) {
  const [y, mo, da] = ymd.split('-').map(Number);
  const start = new Date(y, mo - 1, da, 0, 0, 0, 0);
  const end = new Date(y, mo - 1, da, 23, 59, 59, 999);
  return { start, end };
}

async function eventCalendarIds() {
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return cals.filter((c) => c.isVisible !== false).map((c) => c.id);
}

export async function requestDeviceCalendarAccess() {
  if (Platform.OS === 'web') return false;
  const { status } = await Calendar.getCalendarPermissionsAsync();
  if (status === 'granted') return true;
  const res = await Calendar.requestCalendarPermissionsAsync();
  return res.status === 'granted';
}

export async function getDeviceCalendarPermissionStatus() {
  if (Platform.OS === 'web') return 'unavailable';
  const { status } = await Calendar.getCalendarPermissionsAsync();
  return status;
}

export async function fetchDeviceEventDatesInRange(ymdFrom, ymdTo) {
  if (Platform.OS === 'web') return new Set();
  const ok = await requestDeviceCalendarAccess();
  if (!ok) return new Set();
  const ids = await eventCalendarIds();
  if (!ids.length) return new Set();
  const { start: rangeStart } = boundsForDay(ymdFrom);
  const { end: rangeEnd } = boundsForDay(ymdTo);
  let events;
  try {
    events = await Calendar.getEventsAsync(ids, rangeStart, rangeEnd);
  } catch {
    return new Set();
  }
  const set = new Set();
  for (const ev of events) {
    const s = new Date(ev.startDate);
    const e = new Date(ev.endDate);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) continue;
    if (ev.allDay) {
      const d0 = new Date(s.getFullYear(), s.getMonth(), s.getDate());
      const d1 = new Date(e.getFullYear(), e.getMonth(), e.getDate());
      const walk = new Date(d0);
      while (walk < d1) {
        const ymd = toYmdLocal(walk);
        if (ymd) set.add(ymd);
        walk.setDate(walk.getDate() + 1);
      }
    } else {
      const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
      const last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
      if (last < cur) {
        const ymd = toYmdLocal(cur);
        if (ymd) set.add(ymd);
      } else {
        const walk = new Date(cur);
        while (walk <= last) {
          const ymd = toYmdLocal(walk);
          if (ymd) set.add(ymd);
          walk.setDate(walk.getDate() + 1);
        }
      }
    }
  }
  return set;
}

export async function fetchDeviceEventsForDay(ymd) {
  if (Platform.OS === 'web') return [];
  const ok = await requestDeviceCalendarAccess();
  if (!ok) return [];
  const ids = await eventCalendarIds();
  if (!ids.length) return [];
  const { start, end } = boundsForDay(ymd);
  let events;
  try {
    events = await Calendar.getEventsAsync(ids, start, end);
  } catch {
    return [];
  }
  const startMs = start.getTime();
  const endMs = end.getTime();
  const overlap = events.filter((ev) => {
    const s = new Date(ev.startDate).getTime();
    const e = new Date(ev.endDate).getTime();
    return s < endMs + 1 && e > startMs - 1;
  });
  overlap.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  return overlap;
}
