function isApiDebug() {
  const v = process.env.COLORTRACK_API_DEBUG;
  return v === '1' || v === 'true' || v === 'yes';
}

function vercelHint() {
  if (process.env.VERCEL !== '1' && process.env.VERCEL !== 'true') return null;
  return 'Set COLORTRACK_API_DEBUG=1 in Vercel env, redeploy, and repeat this request to see debug fields in JSON (then remove it).';
}

/** PostgreSQL SQLSTATE on err.code (5 alnum). */
function bodyForSqlState(code, err, msg) {
  const debug = isApiDebug() ? { detail: msg } : {};
  switch (code) {
    case '28P01':
      return {
        status: 503,
        body: {
          error: 'db_auth',
          message: 'Database rejected the password (check DATABASE_URL user/password).',
          ...debug,
        },
      };
    case '3D000':
      return {
        status: 503,
        body: {
          error: 'db_config',
          message: 'Database name in DATABASE_URL does not exist on the server.',
          ...debug,
        },
      };
    case '08001':
    case '08006':
    case '08003':
    case '08000':
      return {
        status: 503,
        body: {
          error: 'db_connection',
          message: 'Database connection failed (Neon reachable but session failed).',
          ...debug,
        },
      };
    case '42P01':
    case '42703':
      return {
        status: 500,
        body: {
          error: 'db_schema',
          message: 'Database schema mismatch. Run API with a DB that matches schemaEnsure, or inspect migrations.',
          ...debug,
        },
      };
    default:
      return null;
  }
}

function bodyFromMessage(msg, err) {
  const m = msg.toLowerCase();
  const debug = isApiDebug() ? { detail: msg } : {};

  if (m.includes('password authentication failed') || m.includes('authentication failed')) {
    return {
      status: 503,
      body: {
        error: 'db_auth',
        message: 'Database authentication failed. Check DATABASE_URL credentials.',
        ...debug,
      },
    };
  }
  if (m.includes('certificate') || m.includes('ssl') || m.includes('tls')) {
    return {
      status: 503,
      body: {
        error: 'db_tls',
        message: 'TLS/SSL problem talking to the database.',
        ...debug,
      },
    };
  }
  if (m.includes('terminating connection') || m.includes('connection closed')) {
    return {
      status: 503,
      body: {
        error: 'db_connection',
        message: 'Database closed the connection (pooling, timeout, or server limit).',
        ...debug,
      },
    };
  }
  if (m.includes('jwt_secret')) {
    return {
      status: 500,
      body: {
        error: 'missing_jwt_secret',
        message: 'JWT_SECRET is not set in the server environment.',
        ...debug,
      },
    };
  }
  return null;
}

/**
 * @returns {{ status: number, body: Record<string, unknown> }}
 */
function jsonForError(err) {
  const hint = vercelHint();
  if (!err) {
    return {
      status: 500,
      body: {
        error: 'internal',
        message: 'No error object (should not happen). Check Function logs.',
        ...(hint ? { hint } : {}),
      },
    };
  }
  const msg = String(err.message || '');
  const errClass = typeof err.name === 'string' && err.name ? err.name : 'Error';

  if (err.expose === true && typeof err.code === 'string') {
    const status = Number(err.statusCode || err.status) || 500;
    const s = status >= 400 && status < 600 ? status : 500;
    const body = { error: err.code, message: err.message };
    if (isApiDebug() && err.stack) {
      body.stack = err.stack.split('\n').slice(0, 8).join('\n');
    }
    return { status: s, body };
  }

  if (err.code === 'MODULE_NOT_FOUND') {
    const body = {
      error: 'module_not_found',
      message:
        'A Node module failed to resolve (deployment bundle may be incomplete). Check Vercel build logs and includeFiles.',
      error_class: errClass,
      detail: msg,
      ...(hint ? { hint } : {}),
    };
    if (isApiDebug() && err.stack) {
      body.stack = err.stack.split('\n').slice(0, 12).join('\n');
    }
    return { status: 500, body };
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
      message: 'Cannot reach the database (network). Check DATABASE_URL host and Neon status.',
      error_class: errClass,
      ...(hint ? { hint } : {}),
    };
    if (isApiDebug()) body.detail = msg;
    return { status: 503, body };
  }

  if (typeof sys === 'string' && /^[0-9A-Z]{5}$/.test(sys)) {
    const sql = bodyForSqlState(sys, err, msg);
    if (sql) {
      if (hint) sql.body.hint = hint;
      sql.body.error_class = errClass;
      return sql;
    }
  }

  if (/database url/i.test(msg) && /invalid|parse|hostname/i.test(msg)) {
    return {
      status: 503,
      body: {
        error: 'db_config',
        message: 'DATABASE_URL looks wrong. Paste the full connection string from Neon.',
        error_class: errClass,
        ...(hint ? { hint } : {}),
        ...(isApiDebug() ? { detail: msg } : {}),
      },
    };
  }

  const fromMsg = bodyFromMessage(msg, err);
  if (fromMsg) {
    fromMsg.body.error_class = errClass;
    if (hint) fromMsg.body.hint = hint;
    return fromMsg;
  }

  const status = Number(err.statusCode || err.status) || 500;
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const body = {
    error: 'internal',
    error_class: errClass,
    message: hint
      ? 'Unhandled error; check Vercel Function logs. Follow hint to add debug fields to this response temporarily.'
      : 'Unhandled error; check server logs.',
    ...(hint ? { hint } : {}),
  };
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
