function isApiDebug() {
  const v = process.env.COLORTRACK_API_DEBUG;
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * @returns {{ status: number, body: Record<string, unknown> }}
 */
function jsonForError(err) {
  if (!err) {
    return { status: 500, body: { error: 'internal' } };
  }

  if (err.expose === true && typeof err.code === 'string') {
    const status = Number(err.statusCode || err.status) || 500;
    const s = status >= 400 && status < 600 ? status : 500;
    const body = { error: err.code, message: err.message };
    if (isApiDebug() && err.stack) {
      body.stack = err.stack.split('\n').slice(0, 8).join('\n');
    }
    return { status: s, body };
  }

  const sys = err.code || (err.cause && err.cause.code);
  if (
    sys === 'ENOTFOUND' ||
    sys === 'ECONNREFUSED' ||
    sys === 'ETIMEDOUT' ||
    sys === 'ECONNRESET' ||
    sys === 'CERT_HAS_EXPIRED' ||
    sys === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  ) {
    const body = {
      error: 'db_unreachable',
      message: 'Cannot reach the database (network). Check DATABASE_URL and Neon project status.',
    };
    if (isApiDebug()) body.detail = String(err.message || err);
    return { status: 503, body };
  }

  const msg = String(err.message || '');
  if (/database url/i.test(msg) && /invalid|parse|hostname/i.test(msg)) {
    const body = {
      error: 'db_config',
      message: 'DATABASE_URL looks incorrect. Copy the full connection string from Neon.',
    };
    if (isApiDebug()) body.detail = msg;
    return { status: 503, body };
  }

  const status = Number(err.statusCode || err.status) || 500;
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const body = { error: 'internal' };
  if (isApiDebug()) {
    body.debug = msg || String(err);
    if (err.stack) body.stack = err.stack.split('\n').slice(0, 10).join('\n');
  }
  return { status: safeStatus, body };
}

function sendErrorJson(res, err) {
  const { status, body } = jsonForError(err);
  if (!res.headersSent) res.status(status).json(body);
}

module.exports = { jsonForError, sendErrorJson, isApiDebug };
