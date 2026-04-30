/**
 * Vercel entry при Root Directory = празно (цялото repo).
 * Зависимостите са в backend/node_modules — resolve оттам.
 */
const path = require('path');

const backendDir = path.join(__dirname, '..', 'backend');
const serverless = require(require.resolve('serverless-http', { paths: [backendDir] }));
const { app, ensureInitialized } = require(path.join(backendDir, 'index.js'));

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
