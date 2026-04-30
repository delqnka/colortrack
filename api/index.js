/**
 * Vercel entry при празен Root Directory.
 * Production: esbuild бъндъл (colortrack-server.cjs) при install — express е вътре;
 * малък api/node_modules само за externals (AWS SDK, expo-server-sdk).
 * Локално: няма .cjs файл → зарежда директно ../backend/index.js.
 */
const fs = require('fs');
const path = require('path');
const { sendErrorJson } = require('../backend/errorResponse.js');

const bundlePath = path.join(__dirname, 'colortrack-server.cjs');

let app;
let ensureInitialized;
let backendLoadError;
try {
  const m = fs.existsSync(bundlePath) ? require(bundlePath) : require('../backend/index.js');
  ({ app, ensureInitialized } = m);
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
