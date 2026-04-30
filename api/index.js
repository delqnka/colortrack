/**
 * Vercel entry при празен Root Directory. Build: `vercel.json` installCommand
 * копира `serverless-http` в корен `node_modules`, за да се открие от трасера и Node.
 */
const path = require('path');

const backendRoot = path.join(__dirname, '..', 'backend');

function loadServerless() {
  try {
    return require('serverless-http');
  } catch {
    return require(path.join(backendRoot, 'node_modules', 'serverless-http'));
  }
}

const serverless = loadServerless();
const { app, ensureInitialized } = require(path.join(backendRoot, 'index.js'));

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
    if (!res.headersSent) res.status(500).json({ error: 'internal' });
    return;
  }
  if (!handler) {
    handler = serverless(app, { binary: ['image/*', 'application/octet-stream'] });
  }
  try {
    return await handler(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'internal' });
  }
};
