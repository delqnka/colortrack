/**
 * Vercel entry при празен Root Directory.
 * Express с native req/res (официалният модел на Vercel за Express).
 * Lazy require + includeFiles в vercel.json — пълно включване на backend при монорепо.
 */
const { sendErrorJson } = require('../backend/errorResponse.js');

let cached;

function getBackend() {
  if (!cached) {
    cached = require('../backend/index.js');
  }
  return cached;
}

function untilResponseDone(res) {
  return new Promise((resolve) => {
    res.once('finish', resolve);
    res.once('close', resolve);
  });
}

module.exports = async (req, res) => {
  let app;
  let ensureInitialized;
  try {
    ({ app, ensureInitialized } = getBackend());
  } catch (e) {
    console.error('ColorTrack api: failed to load backend bundle', e);
    sendErrorJson(res, e);
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
};
