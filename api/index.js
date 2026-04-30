/**
 * Vercel entry при празен Root Directory.
 * Express се вика директно с Node req/res (без serverless-http — Express 5 не е стабилен с него).
 */
const { app, ensureInitialized } = require('../backend/index.js');

function untilResponseDone(res) {
  return new Promise((resolve) => {
    res.once('finish', resolve);
    res.once('close', resolve);
  });
}

module.exports = async (req, res) => {
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
