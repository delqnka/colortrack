/**
 * Vercel entry при Root Directory = backend.
 */
const { sendErrorJson } = require('../errorResponse.js');
const { app, ensureInitialized } = require('../index.js');

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
