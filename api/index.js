/**
 * Vercel entry при празен Root Directory.
 * Production: colortrack-server.cjs (esbuild). На Vercel не падай към ../backend/index.js
 * — там няма node_modules в Lambda и express липсва.
 */
const fs = require('fs');
const path = require('path');
const { sendErrorJson } = require('../backend/errorResponse.js');

function onVercel() {
  return process.env.VERCEL === '1' || process.env.VERCEL === 'true';
}

function resolveBundlePath() {
  const candidates = [
    path.join(__dirname, 'colortrack-server.cjs'),
    path.join(__dirname, '..', 'lib', 'colortrack-server.cjs'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadAppModule() {
  const bundle = resolveBundlePath();
  if (bundle) {
    return require(bundle);
  }
  if (onVercel()) {
    const err = new Error(
      'Missing colortrack-server.cjs after build (check installCommand, includeFiles, and that the bundle path is not gitignored).',
    );
    err.code = 'vercel_bundle_missing';
    err.expose = true;
    throw err;
  }
  return require('../backend/index.js');
}

let app;
let ensureInitialized;
let backendLoadError;
try {
  ({ app, ensureInitialized } = loadAppModule());
} catch (e) {
  backendLoadError = e;
  console.error('ColorTrack api: failed to load app bundle', e);
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
