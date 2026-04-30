/**
 * Vercel serverless entry: forwards all HTTP to Express (see ../index.js).
 * In Vercel Dashboard set Project → Root Directory to `backend`.
 */
const serverless = require('serverless-http');
const { app, ensureInitialized } = require('../index.js');

let handler;

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
    res.status(500).json({ error: 'internal' });
    return;
  }
  if (!handler) {
    handler = serverless(app, { binary: ['image/*', 'application/octet-stream'] });
  }
  return handler(req, res);
};
