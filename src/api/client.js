import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const PROD_API = 'https://colortrack.vercel.app';
const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
const BASE = fromEnv || (__DEV__ ? 'http://localhost:3001' : PROD_API);

/** Helps confirm which host the bundle uses (e.g. after changing .env). */
export function getApiBaseUrl() {
  return BASE;
}

const TOKEN_KEY = 'auth_token';
const OUTBOX_KEY = 'api_outbox';
const CACHE_PREFIX = 'http_cache:';

let sessionToken = null;

export function getSessionToken() {
  return sessionToken;
}

export async function loadStoredToken() {
  const t = await AsyncStorage.getItem(TOKEN_KEY);
  sessionToken = t || null;
  return sessionToken;
}

export async function saveSessionToken(token) {
  sessionToken = token || null;
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

/**
 * In-memory token is lost on Fast Refresh / some reloads while UI still shows "logged in".
 * Always rehydrate from AsyncStorage before authenticated requests.
 */
async function authHeaders() {
  if (!sessionToken) {
    const t = await AsyncStorage.getItem(TOKEN_KEY);
    sessionToken = t || null;
  }
  const h = {};
  if (sessionToken) h.Authorization = `Bearer ${sessionToken}`;
  return h;
}

function cacheKey(path) {
  return CACHE_PREFIX + path;
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
      const res = await fetch(`${BASE}${item.path}`, {
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

function parseErrorText(text, res) {
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

export async function apiGet(path) {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { ...(await authHeaders()) } });
    const text = await res.text();
    if (!res.ok) throw new Error(humanizeApiError(text, res));
    const data = JSON.parse(text);
    await writeCache(path, data);
    return data;
  } catch (e) {
    const cached = await readCache(path);
    if (cached != null) return cached;
    throw e;
  }
}

async function mutate(method, path, body) {
  const headers = { ...(await authHeaders()) };
  const opts = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(`${BASE}${path}`, opts);
    const text = await res.text();
    if (!res.ok) throw new Error(humanizeApiError(text, res));
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
      throw new Error('Invalid response from server');
    }
  } catch (e) {
    const msg = e && e.message ? String(e.message) : '';
    const state = await NetInfo.fetch();
    const offline = !state.isConnected || msg === 'Network request failed';
    if (offline && method !== 'GET') {
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

export async function apiPost(path, body) {
  return mutate('POST', path, body);
}

export async function apiPatch(path, body) {
  return mutate('PATCH', path, body);
}

export async function apiDelete(path) {
  return mutate('DELETE', path, undefined);
}

export async function apiLogin(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(email).trim(), password: String(password) }),
  });
  const text = await res.text();
  if (!res.ok) throwAuthResponseError(text, res);
  return JSON.parse(text);
}

export async function apiRegister(email, password) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(email).trim(), password: String(password) }),
  });
  const text = await res.text();
  if (!res.ok) throwAuthResponseError(text, res);
  return JSON.parse(text);
}

/** Body: { identity_token, email? } — email helps first Sign in with Apple when relay wasn’t in JWT yet. */
export async function apiLoginWithApple(body) {
  const res = await fetch(`${BASE}/api/auth/apple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  if (!res.ok) throwAuthResponseError(text, res);
  return JSON.parse(text);
}
