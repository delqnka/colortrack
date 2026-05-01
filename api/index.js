/**
 * Vercel entry при празен Root Directory (цялото repo).
 * Бъндълът е `api/colortrack-server.cjs` (редом с този файл), за да го включи node-file-trace.
 */
const { sendErrorJson } = require('../backend/errorResponse.js');

function onVercel() {
  return process.env.VERCEL === '1' || process.env.VERCEL === 'true';
}

function loadAppModule() {
  try {
    return require('./colortrack-server.cjs');
  } catch (e) {
    if (onVercel()) {
      if (e && e.code === 'MODULE_NOT_FOUND') {
        const err = new Error(
          `Missing api/colortrack-server.cjs in deployment. Run: npm run bundle:api then commit api/colortrack-server.cjs`,
        );
        err.code = 'vercel_bundle_missing';
        err.expose = true;
        throw err;
      }
      throw e;
    }
    return require('../backend/index.js');
  }
}

let app;
let ensureInitialized;
let backendLoadError;

/**
 * Vercel rewrites `/foo` → `/api/index?vpath=$1`. IncomingMessage.url is often `/api/index?...`;
 * Express must see the client's path (e.g. `/api/finance/expenses`) or routes never match.
 */
function restoreClientPathAfterVercelRewrite(req) {
  if (!(process.env.VERCEL === '1' || process.env.VERCEL === 'true')) return;
  if (!req || typeof req.url !== 'string' || req.url === '') return;
  try {
    const u = new URL(req.url, 'http://vercel.lambda');
    const raw = u.searchParams.get('vpath');
    if (raw === null || raw === '') return;
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    const trimmed = decoded.replace(/^\/+|\/$/g, '');
    if (trimmed.includes('..')) return;
    const pathname = trimmed === '' ? '/' : `/${trimmed}`;
    u.searchParams.delete('vpath');
    const qs = u.searchParams.toString();
    req.url = pathname + (qs ? `?${qs}` : '');
  } catch (_) {
    /* noop */
  }
}

try {
  ({ app, ensureInitialized } = loadAppModule());
} catch (e) {
  backendLoadError = e;
  console.error('ColorTrack api: failed to load app', e);
}

function untilResponseDone(res) {
  return new Promise((resolve) => {
    res.once('finish', resolve);
    res.once('close', resolve);
  });
}

module.exports = async (req, res) => {
  try {
    if (backendLoadError) {
      sendErrorJson(res, backendLoadError);
      return;
    }

    try {
      await ensureInitialized();
    } catch (e) {
      console.error('ColorTrack ensureInitialized:', e);
      sendErrorJson(res, e);
      return;
    }

    restoreClientPathAfterVercelRewrite(req);

    const done = untilResponseDone(res);
    try {
      app(req, res);
    } catch (err) {
      console.error(err);
      sendErrorJson(res, err);
      return;
    }
    await done;
  } catch (e) {
    console.error('ColorTrack api (uncaught):', e);
    if (!res.headersSent) sendErrorJson(res, e);
  }
};
