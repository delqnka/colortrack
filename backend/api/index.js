/**
 * Vercel entry при Root Directory = backend (проектът е само папката backend).
 * Литерален require на бъндъла, за да го включи node-file-trace.
 */
const { sendErrorJson } = require('../errorResponse.js');

function onVercel() {
  return process.env.VERCEL === '1' || process.env.VERCEL === 'true';
}

  try {
    return require('./colortrack-server.cjs');
  } catch (e) {
    if (onVercel()) {
      if (e && e.code === 'MODULE_NOT_FOUND') {
        const err = new Error(
          `Missing backend/api/colortrack-server.cjs. Run from repo root: npm run bundle:api && commit.`,
        );
        err.code = 'vercel_bundle_missing';
        err.expose = true;
        throw err;
      }
      throw e;
    }
    return require('../index.js');
  }
}

let app;
let ensureInitialized;
let backendLoadError;
try {
  ({ app, ensureInitialized } = loadAppModule());
} catch (e) {
  backendLoadError = e;
  console.error('ColorTrack backend/api: failed to load app', e);
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
