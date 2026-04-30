/**
 * Vercel entry при Root Directory = backend.
 */
const { sendErrorJson } = require('../errorResponse.js');

let app;
let ensureInitialized;
let backendLoadError;
try {
  ({ app, ensureInitialized } = require('../index.js'));
} catch (e) {
  backendLoadError = e;
  console.error('ColorTrack api: failed to load ../index.js', e);
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
