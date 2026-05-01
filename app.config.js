const appJson = require('./app.json');

/** Used when EXPO_PUBLIC_API_URL is absent at config time so release builds never point at nowhere. */
const PROD_FALLBACK_API = 'https://colortrack.vercel.app';

const inlinedRaw =
  typeof process.env.EXPO_PUBLIC_API_URL === 'string' ? process.env.EXPO_PUBLIC_API_URL.trim() : '';

function stripTrailingSlash(s) {
  return String(s || '')
    .trim()
    .replace(/\/+$/, '');
}

/** Mirrors app client: tolerate `…/api` suffix in env so extra never bakes wrong base. */
function stripEndingApiSegments(urlStr) {
  let s = stripTrailingSlash(urlStr);
  if (!s) return s;
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    let pathname = (u.pathname || '/').replace(/\/+$/, '');
    while (pathname.length > 0 && /\/api$/i.test(pathname)) {
      pathname = pathname.slice(0, -4).replace(/\/+$/, '');
    }
    if (pathname === '/') {
      pathname = '';
    }
    return `${u.protocol}//${u.host}${pathname}`.replace(/\/+$/, '');
  } catch {
    return s.replace(/\/api$/i, '').trim().replace(/\/+$/, '');
  }
}

const apiPublicUrl = inlinedRaw ? stripEndingApiSegments(inlinedRaw) : PROD_FALLBACK_API;

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      ...(appJson.expo?.extra ?? {}),
      apiPublicUrl,
    },
  },
};
