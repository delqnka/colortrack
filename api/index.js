/**
 * Vercel entry при празен Root Directory.
 * Production: `api/colortrack-server.cjs` е комитнат (esbuild); `api/node_modules` се инсталира при installCommand.
 * Локално без .cjs: `npm run bundle:api` или зарежда се ../backend/index.js.
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
      const err = new Error(
        'colortrack-server.cjs missing from repo or api/ bundle. Run: npm run bundle:api and commit api/colortrack-server.cjs',
      );
      err.code = 'vercel_bundle_missing';
      err.expose = true;
      throw err;
    }
    return require('../backend/index.js');
  }
}

let app;
let ensureInitialized;
let backendLoadError;
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
      if (e && e.code === 'missing_database_url') {
        res.status(503).json({ ok: false, error: 'unavailable' });
        return;
      }
      console.error('ColorTrack ensureInitialized:', e);
      sendErrorJson(res, e);
      return;
    }

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
