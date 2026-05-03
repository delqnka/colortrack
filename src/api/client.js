import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { DeviceEventEmitter } from 'react-native';

const PROD_API = 'https://colortrack.vercel.app';

function apiPublicUrlFromExpoExtra() {
  try {
    const Constants = require('expo-constants');
    const extra =
      Constants.expoConfig?.extra ??
      /** @type {any} */ (Constants).manifest?.extra ??
      /** @type {any} */ (Constants).manifest2?.extra ??
      null;
    const u = extra?.apiPublicUrl;
    return typeof u === 'string' ? u.trim() : '';
  } catch {
    return '';
  }
}

const inlinedPublicApi =
  typeof process.env.EXPO_PUBLIC_API_URL === 'string'
    ? process.env.EXPO_PUBLIC_API_URL.trim()
    : '';

/**
 * DEV: prefers .env (LAN IP) then localhost — never silently uses bundled production fallback.
 * Release: prefers app.config.js `extra.apiPublicUrl`, then inlined EXPO_PUBLIC, then PROD.
 */
const RAW_BASE = __DEV__
  ? inlinedPublicApi || 'http://localhost:3001'
  : apiPublicUrlFromExpoExtra() || inlinedPublicApi || PROD_API;

function isProbablyPrivateOrLocalHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h || h === 'localhost') return true;
  if (h.endsWith('.local')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const parts = h.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function normalizeApiBase(url) {
  const raw = String(url || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  try {
    const withProto = raw.includes('://') ? raw : `https://${raw}`;
    const u = new URL(withProto);
    if (u.protocol === 'http:' && !isProbablyPrivateOrLocalHostname(u.hostname)) {
      u.protocol = 'https:';
    }
    let pathname = (u.pathname || '/').replace(/\/$/, '');
    while (pathname.length > 0 && /\/api$/i.test(pathname)) {
      pathname = pathname.slice(0, -4).replace(/\/+$/, '');
    }
    if (pathname === '/') {
      pathname = '';
    }
    return `${u.protocol}//${u.host}${pathname}`.replace(/\/$/, '');
  } catch {
    return raw.replace(/\/$/, '').replace(/\/api$/i, '').replace(/\/$/, '');
  }
}

/** Canonical origin (+ optional base path); use everywhere for fetch. */
const BASE =
  normalizeApiBase(RAW_BASE) || (__DEV__ ? 'http://localhost:3001' : normalizeApiBase(PROD_API));

/** Full URL with no duplicated `/api/api/` segment (handles mis-set EXPO_PUBLIC_API_URL ending in `/api`). */
function apiFetchUrl(path) {
  const p = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
  const root = String(BASE || '').replace(/\/$/, '');
  let url = `${root}${p}`;
  while (url.includes('/api/api/')) {
    url = url.replace('/api/api/', '/api/');
  }
  return url;
}

/** Helps confirm which host the bundle uses (e.g. after changing .env). */
export function getApiBaseUrl() {
  return BASE;
}

/** Debug: resolved URL for a path (sanity checks against 404/HTML). */
export function getApiResolvedUrl(path) {
  return apiFetchUrl(path);
}

/**
 * Builds a usable absolute URI for <Image source={{ uri }} />.
 * - Relative paths (/api/...) → current API base via getApiResolvedUrl
 * - http(s) localhost / 127.0.0.1 (bad for device) → remapped to current API base + path
 */
export function resolveImagePublicUri(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^data:/i.test(s)) return s;
  if (/^file:\/\//i.test(s)) return s;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
        return getApiResolvedUrl(`${u.pathname}${u.search || ''}`);
      }
      /** Avatar/media URLs are often stored with an old LAN hostname; always use the app’s current API base. */
      const pathNorm = (u.pathname || '').replace(/\/+$/, '') || '/';
      if (pathNorm === '/api/media/r2') {
        const key = u.searchParams.get('key');
        if (key) {
          return getApiResolvedUrl(`/api/media/r2?key=${encodeURIComponent(key)}`);
        }
      }
    } catch {
      /* keep original */
    }
    return s;
  }
  const pathOnly = s.startsWith('/') ? s : `/${s}`;
  return getApiResolvedUrl(pathOnly);
}

/** @deprecated Use resolveImagePublicUri (same behaviour). Kept for older bundles / callers. */
export function resolveStaffAvatarUri(raw) {
  return resolveImagePublicUri(raw);
}

const TOKEN_KEY = 'auth_token';
const API_BASE_KEY = 'colortrack_token_api_base';
const OUTBOX_KEY = 'api_outbox';
/** Keys include API host — never reuse JSON from another EXPO_PUBLIC / deployment. */
const CACHE_PREFIX = 'http_cache:h:';

let sessionToken = null;

export function getSessionToken() {
  return sessionToken;
}

async function clearHttpCaches() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter((k) => k.startsWith('http_cache'));
    if (stale.length) await AsyncStorage.multiRemove(stale);
  } catch {
    /* noop */
  }
}

async function clearTokenStorage() {
  const had = Boolean(await AsyncStorage.getItem(TOKEN_KEY));
  sessionToken = null;
  await clearHttpCaches();
  await AsyncStorage.multiRemove([TOKEN_KEY, API_BASE_KEY]);
  if (had) {
    DeviceEventEmitter.emit('colortrack:session-cleared');
  }
}

/** JWT was issued for this API origin only (different host ⇒ different JWT_SECRET / user DB). */
async function ensureTokenMatchesCurrentApi() {
  const t = await AsyncStorage.getItem(TOKEN_KEY);
  if (!t) {
    sessionToken = null;
    return;
  }
  const stored = await AsyncStorage.getItem(API_BASE_KEY);
  const sn = stored ? normalizeApiBase(stored) : '';
  if (!sn || sn !== BASE) {
    await clearTokenStorage();
    return;
  }
  sessionToken = t;
}

export async function loadStoredToken() {
  await ensureTokenMatchesCurrentApi();
  return sessionToken;
}

export async function saveSessionToken(token) {
  if (token) {
    sessionToken = token;
    await AsyncStorage.setItem(TOKEN_KEY, token);
    await AsyncStorage.setItem(API_BASE_KEY, BASE);
  } else {
    await clearTokenStorage();
  }
}

async function authHeaders() {
  await ensureTokenMatchesCurrentApi();
  const h = {};
  if (sessionToken) h.Authorization = `Bearer ${sessionToken}`;
  return h;
}

function cacheHostSegment() {
  try {
    return new URL(BASE.includes('://') ? BASE : `https://${BASE}`).host;
  } catch {
    return '_';
  }
}

function cacheKey(path) {
  return `${CACHE_PREFIX}${cacheHostSegment()}:${encodeURIComponent(path)}`;
}

async function readCache(path) {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(path));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCache(path, data) {
  try {
    await AsyncStorage.setItem(cacheKey(path), JSON.stringify(data));
  } catch {
    /* noop */
  }
}

/** Cached JSON from last successful GET (same key as offline fallback in apiGet). Hydrate UI without a network round-trip. */
export async function apiReadStaleCache(path) {
  return readCache(path);
}

async function enqueueOutbox(item) {
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  const q = raw ? JSON.parse(raw) : [];
  q.push(item);
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(q));
}

export async function flushOutbox() {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return;
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  if (!raw) return;
  const queue = JSON.parse(raw);
  const remain = [];
  for (const item of queue) {
    try {
      const headers = { ...(await authHeaders()) };
      if (item.body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(apiFetchUrl(item.path), {
        method: item.method,
        headers,
        body: item.body !== undefined ? JSON.stringify(item.body) : undefined,
      });
      if (!res.ok) remain.push(item);
    } catch {
      remain.push(item);
    }
  }
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(remain));
}

function responseLooksLikeHtml(text) {
  const s = String(text || '').trimStart().slice(0, 160).toLowerCase();
  return s.startsWith('<!doctype') || s.startsWith('<html') || s.startsWith('<head') || /^<\s*h1[\s>]/.test(s);
}

function parseErrorText(text, res) {
  if (responseLooksLikeHtml(text)) {
    const st = res && res.status != null ? res.status : '?';
    return `HTTP ${st}: HTML from server — fix EXPO_PUBLIC_API_URL (use https origin only; do not append /api; paths already include /api/).`;
  }
  let msg = text || res.statusText;
  try {
    const j = JSON.parse(text);
    if (j.error) msg = j.error;
    else if (j.message) msg = j.message;
  } catch (_) {}
  return msg;
}

function humanizeApiError(text, res) {
  const msg = String(parseErrorText(text, res) || '');
  if (res.status === 503 && msg.toLowerCase() === 'unavailable') {
    return 'Service unavailable (database or file storage may be missing on the server).';
  }
  return msg;
}

/** Auth endpoints hit BASE directly; 404 usually means API is not deployed at this URL. */
function throwAuthResponseError(text, res) {
  const msg = parseErrorText(text, res);
  if (res.status === 404) {
    throw new Error(
      `API not available at ${BASE} (404). Set EXPO_PUBLIC_API_URL to your backend (e.g. LAN IP in dev, or your API host).`,
    );
  }
  throw new Error(msg);
}

export async function apiGet(path, options = {}) {
  /** @type {{ allowStaleCache?: boolean }} */
  const { allowStaleCache = true } = options;
  try {
    const res = await fetch(apiFetchUrl(path), { headers: { ...(await authHeaders()) } });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401) await clearTokenStorage();
      throw new Error(humanizeApiError(text, res));
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      if (responseLooksLikeHtml(text)) {
        throw new Error(
          'Got HTML instead of JSON. Check API URL uses https without redirects on POST.',
        );
      }
      throw new Error('Invalid response from server');
    }
    await writeCache(path, data);
    return data;
  } catch (e) {
    if (!allowStaleCache) throw e;
    const cached = await readCache(path);
    if (cached != null) return cached;
    throw e;
  }
}

/**
 * @param {{ clearSessionOn401?: boolean, queueOffline?: boolean }} [options] - If false, 401 does not wipe the token (e.g. optional /api/push/register must not log the user out).
 */
async function mutate(method, path, body, options = {}) {
  const clearSessionOn401 = options.clearSessionOn401 !== false;
  const queueOffline = options.queueOffline !== false;
  const headers = { ...(await authHeaders()) };
  const opts = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(apiFetchUrl(path), opts);
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401 && clearSessionOn401) await clearTokenStorage();
      throw new Error(humanizeApiError(text, res));
    }
    if (res.status === 204) return null;
    if (!text) {
      if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
        throw new Error('Empty response from server');
      }
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      if (responseLooksLikeHtml(text)) {
        throw new Error(
          'Got HTML instead of JSON (often caused by HTTP→HTTPS redirects on POST). See EXPO_PUBLIC_API_URL.',
        );
      }
      throw new Error('Invalid response from server');
    }
  } catch (e) {
    const msg = e && e.message ? String(e.message) : '';
    const state = await NetInfo.fetch();
    const offline = !state.isConnected || msg === 'Network request failed';
    if (offline && method !== 'GET' && queueOffline) {
      /* Creating a client must return an id — queueing breaks navigation. */
      if (method === 'POST' && path === '/api/clients') {
        throw new Error('No connection. Connect to the internet and try again to create a client.');
      }
      await enqueueOutbox({ method, path, body });
      return { queued: true };
    }
    throw e;
  }
}

export async function apiPost(path, body, options) {
  return mutate('POST', path, body, options);
}

export async function apiPatch(path, body, options) {
  return mutate('PATCH', path, body, options);
}

export async function apiDelete(path, options) {
  return mutate('DELETE', path, undefined, options);
}

export async function apiLogin(email, password) {
  const res = await fetch(apiFetchUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(email).trim(), password: String(password) }),
  });
  const text = await res.text();
  if (!res.ok) throwAuthResponseError(text, res);
  return JSON.parse(text);
}

export async function apiRegister(email, password, { firstName, lastName, salonName } = {}) {
  const res = await fetch(apiFetchUrl('/api/auth/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email).trim(),
      password: String(password),
      first_name: firstName || undefined,
      last_name: lastName || undefined,
      salon_name: salonName || undefined,
    }),
  });
  const text = await res.text();
  if (!res.ok) throwAuthResponseError(text, res);
  return JSON.parse(text);
}

/** Body: { identity_token, email? } — email helps first Sign in with Apple when relay wasn’t in JWT yet. */
export async function apiLoginWithApple(body) {
  const res = await fetch(apiFetchUrl('/api/auth/apple'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  if (!res.ok) throwAuthResponseError(text, res);
  return JSON.parse(text);
}
