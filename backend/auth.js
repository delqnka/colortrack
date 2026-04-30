const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const jwksClient = require('jwks-rsa');

const appleJwks = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
  cache: true,
  rateLimit: true,
});

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (s && String(s).trim()) return String(s).trim();
  const prodLike = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  if (prodLike) {
    const err = new Error(
      'JWT_SECRET is not set. Add it in Vercel → Settings → Environment Variables (Production).',
    );
    err.statusCode = 500;
    err.code = 'missing_jwt_secret';
    err.expose = true;
    throw err;
  }
  return 'dev-colortrack-jwt';
}

function authPayload(user) {
  return {
    sub: user.id,
    sid: user.salon_id,
    role: user.role,
  };
}

function signToken(user) {
  return jwt.sign(authPayload(user), jwtSecret(), { expiresIn: '30d' });
}

function verifyToken(token) {
  return jwt.verify(token, jwtSecret());
}

function authMiddleware(req, res, next) {
  if (process.env.DISABLE_AUTH === 'true' || process.env.DISABLE_AUTH === '1') {
    req.auth = { userId: 1, salonId: 1, role: 'admin' };
    return next();
  }
  const h = req.headers.authorization;
  const raw = typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!raw) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const p = verifyToken(raw);
    req.auth = {
      userId: Number(p.sub),
      salonId: Number(p.sid),
      role: String(p.role || 'staff'),
    };
    if (!Number.isFinite(req.auth.userId) || !Number.isFinite(req.auth.salonId)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

function requireAdmin(req, res, next) {
  if (req.auth && req.auth.role === 'admin') return next();
  return res.status(403).json({ error: 'forbidden' });
}

async function ensureBootstrapStaff(sql) {
  const emailRaw = process.env.INITIAL_ADMIN_EMAIL;
  const passRaw = process.env.INITIAL_ADMIN_PASSWORD;
  if (!emailRaw || !passRaw || !String(emailRaw).trim() || !String(passRaw)) {
    return;
  }
  const email = String(emailRaw).trim().toLowerCase();
  const password = String(passRaw);
  const salons = await sql`SELECT id FROM salons ORDER BY id LIMIT 1`;
  let salonId = salons[0]?.id;
  if (!salonId) {
    const ins = await sql`
      INSERT INTO salons (name) VALUES ('Default') RETURNING id
    `;
    salonId = ins[0].id;
  }
  const existing = await sql`
    SELECT id FROM staff WHERE salon_id = ${salonId} AND lower(email) = ${email} LIMIT 1
  `;
  if (existing.length) {
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  await sql`
    INSERT INTO staff (salon_id, email, password_hash, role)
    VALUES (${salonId}, ${email}, ${hash}, 'admin')
  `;
}

async function loginHandler(sql, req, res) {
  const b = req.body || {};
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const rows = await sql`
    SELECT id, salon_id, role, password_hash FROM staff
    WHERE lower(email) = ${email} LIMIT 1
  `;
  if (!rows.length) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const row = rows[0];
  if (!row.password_hash) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const token = signToken(row);
  return res.json({
    token,
    user_id: row.id,
    salon_id: row.salon_id,
    role: row.role,
  });
}

function emailLooksValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function appleAudience() {
  const a = process.env.APPLE_BUNDLE_ID || process.env.APPLE_AUDIENCE;
  if (a && String(a).trim()) return String(a).trim();
  return 'com.colortrack.app';
}

async function verifyAppleIdentityToken(idToken, audience) {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('bad_token');
  }
  const decodedHeader = jwt.decode(idToken, { complete: true });
  if (!decodedHeader?.header?.kid) {
    throw new Error('bad_token');
  }
  const pubKey = await new Promise((resolve, reject) => {
    appleJwks.getSigningKey(decodedHeader.header.kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
  return jwt.verify(idToken, pubKey, {
    algorithms: ['RS256'],
    issuer: 'https://appleid.apple.com',
    audience,
  });
}

function syntheticAppleEmail(sub) {
  const safe = String(sub).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return `${safe || 'user'}@appleid.local`;
}

async function appleAuthHandler(sql, req, res) {
  const audience = appleAudience();
  const b = req.body || {};
  const identityToken = typeof b.identity_token === 'string' ? b.identity_token.trim() : '';
  if (!identityToken) {
    return res.status(400).json({ error: 'bad_request' });
  }
  let payload;
  try {
    payload = await verifyAppleIdentityToken(identityToken, audience);
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const emailFromToken =
    typeof payload.email === 'string' && payload.email.trim()
      ? payload.email.trim().toLowerCase()
      : null;
  const emailFromBody =
    typeof b.email === 'string' && b.email.trim() ? b.email.trim().toLowerCase() : null;
  const emailResolved = emailFromToken || emailFromBody || syntheticAppleEmail(sub);

  let rows = await sql`
    SELECT id, salon_id, role FROM staff WHERE apple_sub = ${sub} LIMIT 1
  `;
  if (!rows.length) {
    const existing = await sql`
      SELECT id, salon_id, role, apple_sub FROM staff
      WHERE lower(email) = ${emailResolved} LIMIT 1
    `;
    if (existing.length && !existing[0].apple_sub) {
      await sql`UPDATE staff SET apple_sub = ${sub} WHERE id = ${existing[0].id}`;
      rows = [{ id: existing[0].id, salon_id: existing[0].salon_id, role: existing[0].role }];
    }
  }

  if (!rows.length) {
    if (process.env.ALLOW_PUBLIC_REGISTER === 'false' || process.env.ALLOW_PUBLIC_REGISTER === '0') {
      return res.status(403).json({ error: 'forbidden' });
    }
    let salons = await sql`SELECT id FROM salons ORDER BY id LIMIT 1`;
    let salonId = salons[0]?.id;
    if (!salonId) {
      const ins = await sql`INSERT INTO salons (name) VALUES ('Default') RETURNING id`;
      salonId = ins[0].id;
    }
    const cnt = await sql`SELECT COUNT(*)::int AS n FROM staff`;
    const role = Number(cnt[0]?.n) === 0 ? 'admin' : 'staff';
    const insStaff = await sql`
      INSERT INTO staff (salon_id, email, password_hash, role, apple_sub)
      VALUES (${salonId}, ${emailResolved}, NULL, ${role}, ${sub})
      RETURNING id, salon_id, role
    `;
    rows = [insStaff[0]];
  }

  const row = rows[0];
  const token = signToken({ id: row.id, salon_id: row.salon_id, role: row.role });
  return res.json({
    token,
    user_id: row.id,
    salon_id: row.salon_id,
    role: row.role,
  });
}

async function registerHandler(sql, req, res) {
  if (process.env.ALLOW_PUBLIC_REGISTER === 'false' || process.env.ALLOW_PUBLIC_REGISTER === '0') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const b = req.body || {};
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!email || !password || password.length < 8 || !emailLooksValid(email)) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const dup = await sql`SELECT id FROM staff WHERE lower(email) = ${email} LIMIT 1`;
  if (dup.length) {
    return res.status(409).json({ error: 'conflict' });
  }
  let salons = await sql`SELECT id FROM salons ORDER BY id LIMIT 1`;
  let salonId = salons[0]?.id;
  if (!salonId) {
    const ins = await sql`INSERT INTO salons (name) VALUES ('Default') RETURNING id`;
    salonId = ins[0].id;
  }
  const cnt = await sql`SELECT COUNT(*)::int AS n FROM staff`;
  const role = Number(cnt[0]?.n) === 0 ? 'admin' : 'staff';
  const hash = await bcrypt.hash(password, 10);
  const insStaff = await sql`
    INSERT INTO staff (salon_id, email, password_hash, role)
    VALUES (${salonId}, ${email}, ${hash}, ${role})
    RETURNING id, salon_id, role
  `;
  const row = insStaff[0];
  const token = signToken({ id: row.id, salon_id: row.salon_id, role: row.role });
  return res.status(201).json({
    token,
    user_id: row.id,
    salon_id: row.salon_id,
    role: row.role,
  });
}

module.exports = {
  authMiddleware,
  requireAdmin,
  ensureBootstrapStaff,
  loginHandler,
  registerHandler,
  appleAuthHandler,
  signToken,
};
