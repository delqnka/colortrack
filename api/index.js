/**
 * Vercel entry при празен Root Directory.
 * Express с native req/res (официалният модел на Vercel за Express).
 * Lazy require + includeFiles в vercel.json — пълно включване на backend при монорепо.
 */
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
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal' });
    }
    return;
  }

  try {
    await ensureInitialized();
  } catch (e) {
    const code = e && e.statusCode;
    if (code === 503) {
      res.status(503).json({ ok: false, error: 'unavailable' });
      return;
    }
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: 'internal' });
    return;
  }

  const done = untilResponseDone(res);
  try {
    app(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'internal' });
    return;
  }
  await done;
};
