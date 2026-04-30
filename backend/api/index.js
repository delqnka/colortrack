/**
 * Vercel entry при Root Directory = backend.
 */
let cached;

function getBackend() {
  if (!cached) {
    cached = require('../index.js');
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
    console.error('ColorTrack api: failed to load backend', e);
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
