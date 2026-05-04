const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const { neon } = require('@neondatabase/serverless');
const { ensureSchema } = require('./schemaEnsure');
const r2 = require('./r2');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const {
  authMiddleware,
  ensureBootstrapStaff,
  loginHandler,
  registerHandler,
  appleAuthHandler,
  hashPassword,
  comparePassword,
} = require('./auth');
const push = require('./push');
const { jsonForError } = require('./errorResponse');

const app = express();
const PORT = process.env.PORT || 3001;

app.get(/^\/favicon\.(ico|png)$/i, (req, res) => res.status(204).end());

function authGate(req, res, next) {
  if (req.method === 'POST' && req.path === '/api/auth/register') return next();
  if (req.method === 'POST' && req.path === '/api/auth/login') return next();
  if (req.method === 'POST' && req.path === '/api/auth/apple') return next();
  if (req.method === 'GET' && req.path === '/health') return next();
  if (req.method === 'GET' && req.path === '/api/media/r2') return next();
  if (req.method === 'POST' && req.path === '/api/webhooks/revenuecat') return next();
  if (req.path.startsWith('/api')) return authMiddleware(req, res, next);
  return next();
}

app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));
app.use(authGate);

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const sql = getSql();
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    if (await checkRateLimit(sql, `register:${ip}`, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'too_many_attempts', message: 'Too many registration attempts. Try again later.' });
    }
    await registerHandler(sql, req, res);
  } catch (e) {
    next(e);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const sql = getSql();
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    // Rate limit by email (10 attempts / 15 min) and by IP (30 attempts / 15 min)
    if (
      (email && await checkRateLimit(sql, `login:email:${email}`, 10, 15 * 60 * 1000)) ||
      await checkRateLimit(sql, `login:ip:${ip}`, 30, 15 * 60 * 1000)
    ) {
      return res.status(429).json({ error: 'too_many_attempts', message: 'Too many login attempts. Try again in 15 minutes.' });
    }
    await loginHandler(sql, req, res);
    // Clear rate limit on successful login (loginHandler sets the response)
    if (res.headersSent && res.statusCode === 200 && email) {
      clearRateLimit(sql, `login:email:${email}`).catch(() => {});
    }
  } catch (e) {
    next(e);
  }
});

app.post('/api/auth/apple', async (req, res, next) => {
  try {
    await appleAuthHandler(getSql(), req, res);
  } catch (e) {
    next(e);
  }
});

app.post('/api/push/register', async (req, res, next) => {
  try {
    const token = typeof (req.body || {}).token === 'string' ? req.body.token.trim() : '';
    if (!token || !push.isExpoPushToken(token)) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    await sql`
      INSERT INTO push_tokens (staff_id, expo_token)
      VALUES (${req.auth.userId}, ${token})
      ON CONFLICT (staff_id, expo_token) DO UPDATE SET updated_at = now()
    `;
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

function sanitizeStaffDisplayName(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(/\s+/g, ' ');
  return t.slice(0, 160);
}

function staffEmailLooksValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.get('/api/me', async (req, res, next) => {
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT
        s.id,
        s.email,
        s.display_name,
        s.avatar_url,
        s.role,
        (s.password_hash IS NOT NULL)::boolean AS has_password,
        (s.apple_sub IS NOT NULL)::boolean AS has_apple,
        sal.name AS salon_name
      FROM staff s
      JOIN salons sal ON sal.id = s.salon_id
      WHERE s.id = ${req.auth.userId} AND s.salon_id = ${req.auth.salonId}
      LIMIT 1
    `;
    if (!rows.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

app.patch('/api/me', async (req, res, next) => {
  try {
    const b = req.body || {};
    const wantsName = Object.prototype.hasOwnProperty.call(b, 'display_name');
    const wantsEmail = Object.prototype.hasOwnProperty.call(b, 'email');
    const wantsPassword = Object.prototype.hasOwnProperty.call(b, 'password');
    if (!wantsName && !wantsEmail && !wantsPassword) {
      return res.status(400).json({ error: 'bad_request' });
    }

    const sql = getSql();
    const currentRows = await sql`
      SELECT id, email, display_name, password_hash
      FROM staff
      WHERE id = ${req.auth.userId} AND salon_id = ${req.auth.salonId}
      LIMIT 1
    `;
    if (!currentRows.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const current = currentRows[0];

    let displayNamePayload = current.display_name;
    if (wantsName) {
      if (b.display_name === null) {
        displayNamePayload = null;
      } else {
        const sanitized = sanitizeStaffDisplayName(b.display_name);
        displayNamePayload = sanitized && sanitized.length ? sanitized : null;
      }
    }

    let emailPayload = current.email;
    if (wantsEmail) {
      emailPayload = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
      if (!emailPayload || !staffEmailLooksValid(emailPayload)) {
        return res.status(400).json({ error: 'bad_request' });
      }
      const dup = await sql`
        SELECT id FROM staff
        WHERE lower(email) = ${emailPayload} AND id <> ${req.auth.userId}
        LIMIT 1
      `;
      if (dup.length) {
        return res.status(409).json({ error: 'conflict' });
      }
    }

    let passwordHashPayload = current.password_hash;
    if (wantsPassword) {
      const nextPassword = typeof b.password === 'string' ? b.password : '';
      if (nextPassword.length < 8) {
        return res.status(400).json({ error: 'bad_request' });
      }
      if (current.password_hash) {
        const currentPassword = typeof b.current_password === 'string' ? b.current_password : '';
        const ok = await comparePassword(currentPassword, current.password_hash);
        if (!ok) {
          return res.status(401).json({ error: 'unauthorized' });
        }
      }
      passwordHashPayload = await hashPassword(nextPassword);
    }

    const rows = await sql`
      UPDATE staff
      SET
        display_name = ${displayNamePayload},
        email = ${emailPayload},
        password_hash = ${passwordHashPayload}
      WHERE id = ${req.auth.userId} AND salon_id = ${req.auth.salonId}
      RETURNING
        id,
        email,
        display_name,
        avatar_url,
        role,
        (password_hash IS NOT NULL)::boolean AS has_password,
        (apple_sub IS NOT NULL)::boolean AS has_apple,
        (SELECT name FROM salons WHERE id = staff.salon_id) AS salon_name
    `;
    if (!rows.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

app.post('/api/me/avatar/presign', async (req, res, next) => {
  try {
    if (!r2.r2Configured()) {
      return res.status(503).json({ error: 'unavailable' });
    }
    const uid = Number(req.auth.userId);
    if (!Number.isFinite(uid)) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const exists = await sql`
      SELECT id FROM staff WHERE id = ${uid} AND salon_id = ${req.auth.salonId} LIMIT 1
    `;
    if (!exists.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const b = req.body || {};
    const ct = r2.normalizeContentType(b.contentType ?? b.content_type);
    if (!ct) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const key = r2.buildStaffAvatarKey(uid, ct);
    if (!key) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const uploadUrl = await r2.presignPut(key, ct);
    res.json({ uploadUrl, key, contentType: ct });
  } catch (e) {
    next(e);
  }
});

app.post('/api/me/avatar/commit', async (req, res, next) => {
  try {
    if (!r2.r2Configured()) {
      return res.status(503).json({ error: 'unavailable' });
    }
    const uid = Number(req.auth.userId);
    if (!Number.isFinite(uid)) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const key = typeof (req.body || {}).key === 'string' ? req.body.key.trim() : '';
    if (!key || !r2.keyBelongsToStaffAvatar(uid, key)) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const b = req.body || {};
    const ct = r2.normalizeContentType(b.contentType ?? b.content_type);
    if (!ct) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const existing = await sql`
      SELECT id, avatar_url FROM staff WHERE id = ${uid} AND salon_id = ${req.auth.salonId} LIMIT 1
    `;
    if (!existing.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const prevUrl = existing[0].avatar_url;
    const avatarUrl = mediaUrlForKey(req, key);
    await sql`UPDATE staff SET avatar_url = ${avatarUrl} WHERE id = ${uid} AND salon_id = ${req.auth.salonId}`;
    const oldKey = extractR2KeyFromAvatarUrl(prevUrl);
    if (oldKey && oldKey !== key && r2.keyBelongsToStaffAvatar(uid, oldKey)) {
      try {
        await r2.deleteObject(oldKey);
      } catch (_) {
        /* ignore */
      }
    }
    res.json({ avatar_url: avatarUrl });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/me', async (req, res, next) => {
  try {
    const uid = Number(req.auth.userId);
    const sid = Number(req.auth.salonId);
    const role = String(req.auth.role || 'staff');
    if (!Number.isFinite(uid) || !Number.isFinite(sid)) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();

    const salonStaff = await sql`
      SELECT COUNT(*)::int AS n FROM staff WHERE salon_id = ${sid}
    `;
    if (Number(salonStaff[0]?.n || 0) <= 1) {
      return res.status(403).json({ error: 'last_staff' });
    }

    if (role === 'admin') {
      const otherAdmins = await sql`
        SELECT COUNT(*)::int AS n FROM staff
        WHERE salon_id = ${sid} AND role = 'admin' AND id <> ${uid}
      `;
      if (Number(otherAdmins[0]?.n || 0) < 1) {
        return res.status(403).json({ error: 'last_admin' });
      }
    }

    const selfRows = await sql`
      SELECT id, avatar_url FROM staff WHERE id = ${uid} AND salon_id = ${sid} LIMIT 1
    `;
    if (!selfRows.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const prevUrl = selfRows[0].avatar_url;
    if (prevUrl && r2.r2Configured()) {
      const oldKey = extractR2KeyFromAvatarUrl(prevUrl);
      if (oldKey && r2.keyBelongsToStaffAvatar(uid, oldKey)) {
        try {
          await r2.deleteObject(oldKey);
        } catch (_) {
          /* continue */
        }
      }
    }

    await sql`DELETE FROM staff WHERE id = ${uid} AND salon_id = ${sid}`;
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

function publicBaseUrl(req) {
  const env = process.env.API_PUBLIC_URL;
  if (env && String(env).trim()) {
    return String(env).replace(/\/$/, '');
  }
  return `${req.protocol}://${req.get('host')}`;
}

function mediaUrlForKey(req, key) {
  return `${publicBaseUrl(req)}/api/media/r2?key=${encodeURIComponent(key)}`;
}

function extractR2KeyFromAvatarUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/[?&]key=([^&]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

function isAllowedR2MediaKey(key) {
  if (typeof key !== 'string' || key.includes('..')) return false;
  const clientKey =
    /^clients\/\d+\/(avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$/i;
  const staffAvatar =
    /^staff\/\d+\/avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;
  return clientKey.test(key) || staffAvatar.test(key);
}

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    const err = new Error('DATABASE_URL is not set');
    err.statusCode = 503;
    err.code = 'missing_database_url';
    throw err;
  }
  return neon(url);
}

/**
 * DB-backed rate limiter — works across all Vercel serverless instances.
 * key: e.g. 'login:email@example.com' or 'login:ip:1.2.3.4'
 * maxAttempts: max hits allowed in windowMs
 * windowMs: sliding window in milliseconds
 * Returns true if limit exceeded (caller should return 429).
 */
async function checkRateLimit(sql, key, maxAttempts = 10, windowMs = 15 * 60 * 1000) {
  try {
    const windowStart = new Date(Date.now() - windowMs);
    const rows = await sql`
      INSERT INTO auth_rate_limit (key, attempts, window_start)
      VALUES (${key}, 1, NOW())
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE
          WHEN auth_rate_limit.window_start < ${windowStart}
          THEN 1
          ELSE auth_rate_limit.attempts + 1
        END,
        window_start = CASE
          WHEN auth_rate_limit.window_start < ${windowStart}
          THEN NOW()
          ELSE auth_rate_limit.window_start
        END
      RETURNING attempts
    `;
    return Number(rows[0]?.attempts) > maxAttempts;
  } catch {
    return false; // never block on rate-limit errors
  }
}

async function clearRateLimit(sql, key) {
  try { await sql`DELETE FROM auth_rate_limit WHERE key = ${key}`; } catch {}
}

app.get('/health', async (req, res, next) => {
  try {
    const sql = getSql();
    const rows = await sql`SELECT 1 AS ok`;
    res.json({ ok: true, db: rows[0]?.ok === 1 });
  } catch (e) {
    if (e.statusCode === 503) {
      return res.status(503).json({ ok: false, db: false, error: 'unavailable' });
    }
    next(e);
  }
});

/** Local calendar date for Europe/Sofia — matches typical salon day boundaries */
const TZ = 'Europe/Sofia';

const TIME_HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function normalizeHM(t) {
  if (typeof t !== 'string') return null;
  const s = t.trim();
  const m = s.match(TIME_HM);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}:00`;
}

async function buildDashboard(sql, dateYmd, salonId) {
  const appointments = await sql`
      SELECT
        a.id,
        a.title,
        a.procedure_name,
        a.chair_label,
        a.start_at,
        a.end_at,
        c.id AS client_id,
        c.full_name AS client_name,
        c.avatar_url AS client_avatar_url
      FROM appointments a
      LEFT JOIN clients c ON c.id = a.client_id
      WHERE (a.start_at AT TIME ZONE ${TZ})::date = ${dateYmd}::date
        AND a.salon_id = ${salonId}
      ORDER BY a.start_at
    `;

  const maxAvatars = 3;
  const avatars = [];
  for (const row of appointments) {
    if (row.client_avatar_url && !avatars.includes(row.client_avatar_url)) {
      avatars.push(row.client_avatar_url);
      if (avatars.length >= maxAvatars) break;
    }
  }

  const lowStock = await sql`
      SELECT id, name, brand, shade_code, unit, quantity, low_stock_threshold
      FROM inventory_items
      WHERE quantity <= low_stock_threshold
        AND salon_id = ${salonId}
      ORDER BY quantity ASC NULLS FIRST
      LIMIT 8
    `;

  const upcoming = appointments[0] || null;
  const extraClientCount = appointments.length > maxAvatars ? appointments.length - maxAvatars : 0;

  return {
    appointmentCount: appointments.length,
    bannerAvatars: avatars,
    extraClientCount,
    upcoming,
    lowStockPreview: lowStock[0] || null,
    lowStockCount: lowStock.length,
  };
}

app.get('/api/media/r2', async (req, res, next) => {
  try {
    if (!r2.r2Configured()) {
      return res.status(503).send('Storage not configured');
    }
    const key = typeof req.query.key === 'string' ? req.query.key.trim() : '';
    if (!key || !isAllowedR2MediaKey(key)) {
      return res.status(400).send('Bad key');
    }
    const url = await r2.presignGet(key);
    res.redirect(302, url);
  } catch (e) {
    next(e);
  }
});

app.get('/api/dashboard/today', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;
    const todayRow = await sql`
      SELECT to_char((now() AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS ymd
    `;
    const ymd = String(todayRow[0].ymd);
    const body = await buildDashboard(sql, ymd, sid);
    res.json({
      ...body,
      banner: {
        title: "Today's Schedule",
        subtitle: '',
      },
      dashboardDate: ymd,
    });
  } catch (e) {
    next(e);
  }
});

// Lightweight combined endpoint for HomeScreen — 1 round trip, 4 DB queries total.
// Replaces two separate calls: /api/dashboard/day + /api/finance/summary
app.get('/api/dashboard/home', async (req, res, next) => {
  try {
    const raw = req.query.date;
    if (!raw || typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const sid = req.auth.salonId;
    const [dash, svcIncome, productIncome, expenseTotal] = await Promise.all([
      buildDashboard(sql, raw, sid),
      sql`SELECT COALESCE(SUM(amount_paid_cents),0)::bigint AS s FROM visits
          WHERE salon_id = ${sid} AND visit_date = ${raw}::date`,
      sql`SELECT COALESCE(SUM(amount_cents),0)::bigint AS s FROM salon_product_sales
          WHERE salon_id = ${sid} AND sale_date = ${raw}::date`,
      sql`SELECT COALESCE(SUM(amount_cents),0)::bigint AS s FROM salon_expenses
          WHERE salon_id = ${sid} AND expense_date = ${raw}::date`,
    ]);
    res.json({
      ...dash,
      dashboardDate: raw,
      banner: { title: 'Schedule', subtitle: '' },
      income_cents: Number(svcIncome[0].s) + Number(productIncome[0].s),
      expense_cents: Number(expenseTotal[0].s),
    });
  } catch (e) {
    next(e);
  }
});

app.get('/api/dashboard/day', async (req, res, next) => {
  try {
    const raw = req.query.date;
    if (!raw || typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const body = await buildDashboard(sql, raw, req.auth.salonId);
    res.json({
      ...body,
      banner: {
        title: 'Schedule',
        subtitle: '',
      },
      dashboardDate: raw,
    });
  } catch (e) {
    next(e);
  }
});

app.get('/api/clients', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let rows;
    if (q.length > 0) {
      const pattern = `%${q}%`;
      rows = await sql`
      SELECT
        id,
        full_name,
        phone,
        email,
        avatar_url,
        last_patch_test_at,
        (last_patch_test_at IS NULL OR last_patch_test_at < (CURRENT_DATE - INTERVAL '6 months')) AS patch_overdue
      FROM clients
      WHERE salon_id = ${sid}
        AND (
        full_name ILIKE ${pattern}
        OR phone ILIKE ${pattern}
        OR COALESCE(email, '') ILIKE ${pattern})
      ORDER BY full_name
      LIMIT 80
    `;
    } else {
      rows = await sql`
      SELECT
        id,
        full_name,
        phone,
        email,
        avatar_url,
        last_patch_test_at,
        (last_patch_test_at IS NULL OR last_patch_test_at < (CURRENT_DATE - INTERVAL '6 months')) AS patch_overdue
      FROM clients
      WHERE salon_id = ${sid}
      ORDER BY full_name
    `;
    }
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

app.post('/api/clients', async (req, res, next) => {
  try {
    const sql = getSql();
    const b = req.body || {};
    const name = typeof b.full_name === 'string' ? b.full_name.trim() : '';
    if (!name) {
      return res.status(400).json({ error: 'bad_request' });
    }
    let patchDate = null;
    if (b.last_patch_test_at != null && b.last_patch_test_at !== '') {
      const s = String(b.last_patch_test_at);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return res.status(400).json({ error: 'bad_request' });
      }
      patchDate = s;
    }
    const rows = await sql`
      INSERT INTO clients (salon_id, full_name, phone, email, avatar_url, notes, last_patch_test_at)
      VALUES (
        ${req.auth.salonId},
        ${name},
        ${b.phone != null && b.phone !== '' ? String(b.phone) : null},
        ${b.email != null && b.email !== '' ? String(b.email) : null},
        ${b.avatar_url != null && b.avatar_url !== '' ? String(b.avatar_url) : null},
        ${b.notes != null && b.notes !== '' ? String(b.notes) : null},
        ${patchDate}
      )
      RETURNING id, full_name, phone, email, avatar_url, notes, last_patch_test_at, created_at
    `;
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});


app.get('/api/clients/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const sid = req.auth.salonId;
    const clients = await sql`
      SELECT
        id,
        full_name,
        phone,
        email,
        avatar_url,
        notes,
        last_patch_test_at,
        created_at,
        (last_patch_test_at IS NULL OR last_patch_test_at < (CURRENT_DATE - INTERVAL '6 months')) AS patch_overdue
      FROM clients
      WHERE id = ${id} AND salon_id = ${sid}
      LIMIT 1
    `;
    if (!clients.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const visits = await sql`
      SELECT id, visit_date, procedure_name, chair_label, notes, created_at,
        amount_paid_cents, device_calendar_event_id, source
      FROM visits
      WHERE client_id = ${id}
      ORDER BY visit_date ASC, id ASC
    `;
    const visitsWithFormula = await Promise.all(
      visits.map(async (v) => {
        const formula_lines = await sql`
          SELECT id, section, brand, shade_code, amount, inventory_item_id
          FROM formula_lines
          WHERE visit_id = ${v.id}
          ORDER BY id
        `;
        return { ...v, formula_lines };
      }),
    );
    let photos = [];
    if (r2.r2Configured()) {
      const photoRows = await sql`
        SELECT id, object_key, content_type, created_at
        FROM client_photos
        WHERE client_id = ${id}
        ORDER BY created_at DESC
        LIMIT 48
      `;
      photos = await Promise.all(
        photoRows.map(async (p) => ({
          id: p.id,
          content_type: p.content_type,
          created_at: p.created_at,
          url: await r2.presignGet(p.object_key),
        })),
      );
    }
    res.json({ ...clients[0], visits: visitsWithFormula, photos });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/clients/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const sid = req.auth.salonId;
    const existing = await sql`
      SELECT id, full_name, phone, email, avatar_url, notes, last_patch_test_at
      FROM clients
      WHERE id = ${id} AND salon_id = ${sid}
      LIMIT 1
    `;
    if (!existing.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const row = existing[0];
    const b = req.body || {};

    const full_name =
      typeof b.full_name === 'string'
        ? b.full_name.trim()
        : row.full_name;
    if (!full_name) {
      return res.status(400).json({ error: 'bad_request' });
    }

    const phone =
      b.phone !== undefined
        ? b.phone === null || b.phone === ''
          ? null
          : String(b.phone)
        : row.phone;
    const email =
      b.email !== undefined
        ? b.email === null || b.email === ''
          ? null
          : String(b.email)
        : row.email;
    const avatar_url =
      b.avatar_url !== undefined
        ? b.avatar_url === null || b.avatar_url === ''
          ? null
          : String(b.avatar_url)
        : row.avatar_url;
    const notes =
      b.notes !== undefined
        ? b.notes === null || b.notes === ''
          ? null
          : String(b.notes)
        : row.notes;

    let last_patch_test_at = row.last_patch_test_at;
    if (Object.prototype.hasOwnProperty.call(b, 'last_patch_test_at')) {
      if (b.last_patch_test_at === null || b.last_patch_test_at === '') {
        last_patch_test_at = null;
      } else {
        const s = String(b.last_patch_test_at);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          return res.status(400).json({ error: 'bad_request' });
        }
        last_patch_test_at = s;
      }
    }

    const updated = await sql`
      UPDATE clients
      SET
        full_name = ${full_name},
        phone = ${phone},
        email = ${email},
        avatar_url = ${avatar_url},
        notes = ${notes},
        last_patch_test_at = ${last_patch_test_at}
      WHERE id = ${id} AND salon_id = ${sid}
      RETURNING id, full_name, phone, email, avatar_url, notes, last_patch_test_at, created_at
    `;
    res.json(updated[0]);
  } catch (e) {
    next(e);
  }
});

app.post('/api/clients/:id/photos/presign', async (req, res, next) => {
  try {
    if (!r2.r2Configured()) {
      return res.status(503).json({ error: 'unavailable' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const sid = req.auth.salonId;
    const exists = await sql`SELECT id FROM clients WHERE id = ${id} AND salon_id = ${sid} LIMIT 1`;
    if (!exists.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const b = req.body || {};

    const ct = r2.normalizeContentType(b.contentType ?? b.content_type);
    if (!ct) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const key = r2.buildObjectKey(id, ct);
    if (!key) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const uploadUrl = await r2.presignPut(key, ct);
    res.json({ uploadUrl, key, contentType: ct });
  } catch (e) {
    next(e);
  }
});

app.post('/api/clients/:id/photos/commit', async (req, res, next) => {
  try {
    if (!r2.r2Configured()) {
      return res.status(503).json({ error: 'unavailable' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const key = typeof (req.body || {}).key === 'string' ? req.body.key.trim() : '';
    if (!key || !r2.keyBelongsToClient(id, key)) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const b = req.body || {};
    const ct = r2.normalizeContentType(b.contentType ?? b.content_type);
    if (!ct) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const exists = await sql`
      SELECT id FROM clients WHERE id = ${id} AND salon_id = ${req.auth.salonId} LIMIT 1
    `;
    if (!exists.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    try {
      const inserted = await sql`
        INSERT INTO client_photos (client_id, object_key, content_type)
        VALUES (${id}, ${key}, ${ct})
        RETURNING id, client_id, object_key, content_type, created_at
      `;
      const row = inserted[0];
      const url = await r2.presignGet(row.object_key);
      res.status(201).json({ id: row.id, content_type: row.content_type, created_at: row.created_at, url });
    } catch (insErr) {
      const code = insErr && (insErr.code ?? insErr.cause?.code);
      const msg = insErr && insErr.message ? String(insErr.message) : '';
      if (String(code) === '23505' || /duplicate key/i.test(msg)) {
        return res.status(409).json({ error: 'conflict' });
      }
      throw insErr;
    }
  } catch (e) {
    next(e);
  }
});

app.delete('/api/clients/:id/photos/:photoId', async (req, res, next) => {
  try {
    if (!r2.r2Configured()) {
      return res.status(503).json({ error: 'unavailable' });
    }
    const clientId = Number(req.params.id);
    const photoId = Number(req.params.photoId);
    if (!Number.isFinite(clientId) || clientId < 1 || !Number.isFinite(photoId) || photoId < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const rows = await sql`
      SELECT cp.id, cp.object_key FROM client_photos cp
      INNER JOIN clients c ON c.id = cp.client_id
      WHERE cp.id = ${photoId} AND cp.client_id = ${clientId} AND c.salon_id = ${req.auth.salonId}
      LIMIT 1
    `;
    if (!rows.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const objectKey = rows[0].object_key;
    try {
      await r2.deleteObject(objectKey);
    } catch (_) {
      /* continue */
    }
    await sql`DELETE FROM client_photos WHERE id = ${photoId} AND client_id = ${clientId}`;
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

app.post('/api/clients/:id/avatar/presign', async (req, res, next) => {
  try {
    if (!r2.r2Configured()) {
      return res.status(503).json({ error: 'unavailable' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const exists = await sql`SELECT id FROM clients WHERE id = ${id} AND salon_id = ${req.auth.salonId} LIMIT 1`;
    if (!exists.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const b = req.body || {};
    const ct = r2.normalizeContentType(b.contentType ?? b.content_type);
    if (!ct) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const key = r2.buildAvatarKey(id, ct);
    if (!key) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const uploadUrl = await r2.presignPut(key, ct);
    res.json({ uploadUrl, key, contentType: ct });
  } catch (e) {
    next(e);
  }
});

app.post('/api/clients/:id/avatar/commit', async (req, res, next) => {
  try {
    if (!r2.r2Configured()) {
      return res.status(503).json({ error: 'unavailable' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const key = typeof (req.body || {}).key === 'string' ? req.body.key.trim() : '';
    if (!key || !r2.keyBelongsToClientAvatar(id, key)) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const b = req.body || {};
    const ct = r2.normalizeContentType(b.contentType ?? b.content_type);
    if (!ct) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const existing = await sql`
      SELECT id, avatar_url FROM clients WHERE id = ${id} AND salon_id = ${req.auth.salonId} LIMIT 1
    `;
    if (!existing.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const prevUrl = existing[0].avatar_url;
    const avatarUrl = mediaUrlForKey(req, key);
    await sql`UPDATE clients SET avatar_url = ${avatarUrl} WHERE id = ${id} AND salon_id = ${req.auth.salonId}`;
    const oldKey = extractR2KeyFromAvatarUrl(prevUrl);
    if (oldKey && oldKey !== key && r2.keyBelongsToClientAvatar(id, oldKey)) {
      try {
        await r2.deleteObject(oldKey);
      } catch (_) {
        /* ignore */
      }
    }
    res.json({ avatar_url: avatarUrl });
  } catch (e) {
    next(e);
  }
});

// GET /api/products/search?q=koleston&brand=Wella
// Returns global crowdsourced products (confirmed_count >= 3) ordered by popularity.
// No auth required — data is fully anonymous (no user info stored).
app.get('/api/products/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const brandRaw = String(req.query.brand || '').trim().slice(0, 100);
    if (!q && !brandRaw) return res.json([]);
    const sql = getSql();
    const brand = brandRaw ? normalizeBrand(brandRaw) || brandRaw : null;
    // Use LIKE for short queries (tsquery needs ≥2 meaningful tokens)
    const useTsQuery = q.length >= 3;
    let rows;
    if (brand && q) {
      rows = useTsQuery
        ? await sql`
            SELECT brand, product_name, unit, confirmed_count
            FROM global_products
            WHERE confirmed_count >= 3
              AND lower(brand) = lower(${brand})
              AND (lower(product_name) LIKE ${'%' + q.toLowerCase() + '%'}
                   OR to_tsvector('english', product_name) @@ plainto_tsquery('english', ${q}))
            ORDER BY confirmed_count DESC LIMIT 25`
        : await sql`
            SELECT brand, product_name, unit, confirmed_count
            FROM global_products
            WHERE confirmed_count >= 3
              AND lower(brand) = lower(${brand})
              AND lower(product_name) LIKE ${'%' + q.toLowerCase() + '%'}
            ORDER BY confirmed_count DESC LIMIT 25`;
    } else if (brand) {
      rows = await sql`
        SELECT brand, product_name, unit, confirmed_count
        FROM global_products
        WHERE confirmed_count >= 3
          AND lower(brand) = lower(${brand})
        ORDER BY confirmed_count DESC LIMIT 25`;
    } else {
      rows = useTsQuery
        ? await sql`
            SELECT brand, product_name, unit, confirmed_count
            FROM global_products
            WHERE confirmed_count >= 3
              AND (lower(product_name) LIKE ${'%' + q.toLowerCase() + '%'}
                   OR lower(brand) LIKE ${'%' + q.toLowerCase() + '%'}
                   OR to_tsvector('english', product_name) @@ plainto_tsquery('english', ${q}))
            ORDER BY confirmed_count DESC LIMIT 25`
        : await sql`
            SELECT brand, product_name, unit, confirmed_count
            FROM global_products
            WHERE confirmed_count >= 3
              AND (lower(product_name) LIKE ${'%' + q.toLowerCase() + '%'}
                   OR lower(brand) LIKE ${'%' + q.toLowerCase() + '%'})
            ORDER BY confirmed_count DESC LIMIT 25`;
    }
    res.json(Array.isArray(rows) ? rows : []);
  } catch (e) {
    next(e);
  }
});

app.get('/api/inventory', async (req, res, next) => {
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT
        id,
        name,
        category,
        custom_subcategory,
        brand,
        shade_code,
        package_size,
        unit,
        quantity,
        low_stock_threshold,
        price_per_unit_cents,
        supplier_hint,
        sell_price_cents,
        (quantity <= low_stock_threshold) AS is_low_stock
      FROM inventory_items
      WHERE salon_id = ${req.auth.salonId}
      ORDER BY category, custom_subcategory NULLS LAST, brand NULLS LAST, name
    `;
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

const INVENTORY_UNITS = new Set(['g', 'ml', 'pcs', 'oz']);
const INVENTORY_CATEGORY_MAX = 80;
const INVENTORY_CATEGORIES = new Set(['dye', 'oxidant', 'mixtone', 'toner', 'retail', 'consumable']);

/** Route :id → int (trim; rejects floats / junk so GET/DELETE/PATCH stay aligned). */
function parseInventoryItemIdParam(raw) {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,12}$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1 || n > Number.MAX_SAFE_INTEGER) return null;
  return n;
}

function sanitizeInventoryText(raw, max = 200) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(/\s+/g, ' ').slice(0, max);
  return t || null;
}

// ── Global product database helpers ─────────────────────────────────────────

const BRAND_ALIASES = new Map(Object.entries({
  'alfaparf': 'Alfaparf', 'alfaparf milano': 'Alfaparf',
  'wella': 'Wella', 'wella professionals': 'Wella', 'wella professional': 'Wella',
  "l'oreal": "L'Oréal", 'loreal': "L'Oréal", "l'oreal professionnel": "L'Oréal",
  "l'oréal": "L'Oréal", "l'oréal professionnel": "L'Oréal", "loreal professionnel": "L'Oréal",
  'schwarzkopf': 'Schwarzkopf', 'schwarzkopf professional': 'Schwarzkopf',
  'schwarzkopf prof': 'Schwarzkopf', 'schwarzkopf prof.': 'Schwarzkopf',
  'redken': 'Redken',
  'matrix': 'Matrix',
  'kerastase': 'Kérastase', 'kérastase': 'Kérastase',
  'olaplex': 'Olaplex',
  'goldwell': 'Goldwell',
  'joico': 'Joico',
  'paul mitchell': 'Paul Mitchell',
  'revlon': 'Revlon', 'revlon professional': 'Revlon Professional',
  'fanola': 'Fanola',
  'pravana': 'Pravana',
  'kenra': 'Kenra',
  'ion': 'Ion',
  'igora': 'Igora',
}));

function normalizeBrand(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 2 || cleaned.length > 100) return cleaned.length >= 2 ? cleaned.slice(0, 100) : null;
  const alias = BRAND_ALIASES.get(cleaned.toLowerCase());
  if (alias) return alias;
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Privacy: stores ONLY brand + product_name + unit. No user_id, no price, no location.
// Contributions are fully anonymous — never call this with any user-identifying data.
async function upsertGlobalProduct(sql, brand, productName, unit) {
  try {
    const b = normalizeBrand(brand);
    const p = typeof productName === 'string'
      ? productName.trim().replace(/\s+/g, ' ').replace(/[<>'";&]/g, '').slice(0, 200)
      : null;
    if (!b || !p || p.length < 2) return;
    const validUnits = new Set(['g', 'ml', 'oz', 'l', 'kg', 'pcs', 'pc', 'pack']);
    const u = validUnits.has(String(unit || '').trim().toLowerCase())
      ? String(unit).trim().toLowerCase()
      : 'g';
    await sql`
      INSERT INTO global_products (brand, product_name, unit)
      VALUES (${b}, ${p}, ${u})
      ON CONFLICT (brand, product_name)
      DO UPDATE SET confirmed_count = global_products.confirmed_count + 1
    `;
  } catch {
    // fire-and-forget — never surface global DB errors to the user
  }
}

function normalizeInventoryCategory(raw) {
  const original = sanitizeInventoryText(raw, INVENTORY_CATEGORY_MAX);
  const c = typeof original === 'string' ? original.trim().toLowerCase() : '';
  if (INVENTORY_CATEGORIES.has(c)) return c;
  if (c === 'developer' || c === 'oxidants') return 'oxidant';
  if (c === 'color' || c === 'colour' || c === 'dyes') return 'dye';
  if (c === 'mixtones') return 'mixtone';
  if (c === 'toners') return 'toner';
  if (c === 'consumables') return 'consumable';
  return original || 'consumable';
}

function normalizeInventoryUnit(raw) {
  const u = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (INVENTORY_UNITS.has(u)) return u;
  if (u === 'piece' || u === 'pieces' || u === 'pc' || u === 'бр' || u === 'брой' || u === 'броя') return 'pcs';
  if (u === 'gram' || u === 'grams' || u === 'гр') return 'g';
  if (u === 'milliliter' || u === 'milliliters') return 'ml';
  return 'pcs';
}

function firstLooseNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = String(raw).replace(',', '.');
  const m = text.match(/(?:x\s*)?(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function quantityFromLoose(raw) {
  const n = firstLooseNumber(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizeInventoryImportCandidate(row) {
  if (!row || typeof row !== 'object') return null;
  const name = sanitizeInventoryText(
    row.name || row.product || row.product_name || row.item || row.item_name || row.description,
    200,
  );
  if (!name) return null;
  const quantity = quantityFromLoose(row.quantity ?? row.qty ?? row.count ?? row.amount ?? row.pack_count);
  if (!quantity) return null;
  const unit = normalizeInventoryUnit(row.unit || row.quantity_unit || row.uom);
  const pricePerUnitCents = centsFromLoosePrice(
    row.price_per_unit_cents != null
      ? Number(row.price_per_unit_cents) / 100
      : row.price_per_unit ?? row.unit_price ?? row.unitPrice ?? row.each ?? row.price_each,
  );
  const lineTotalCents = centsFromLoosePrice(
    row.line_total_cents != null ? Number(row.line_total_cents) / 100 : row.line_total ?? row.total ?? row.total_price,
  );
  const computedTotalCents =
    lineTotalCents == null && pricePerUnitCents != null ? Math.round(pricePerUnitCents * quantity) : lineTotalCents;
  return {
    name,
    category: normalizeInventoryCategory(row.category),
    brand: sanitizeInventoryText(row.brand || row.manufacturer, 200),
    shade_code: sanitizeInventoryText(row.shade_code || row.shade || row.code || row.sku || row.volume, 80),
    package_size: sanitizeInventoryText(row.package_size || row.size || row.product_size, 80),
    unit,
    quantity,
    price_per_unit_cents: pricePerUnitCents == null ? null : Math.min(pricePerUnitCents, 1000000000),
    line_total_cents: computedTotalCents == null ? null : Math.min(computedTotalCents, 1000000000),
    supplier_hint: sanitizeInventoryText(row.supplier || row.supplier_hint, 200),
  };
}

app.post('/api/inventory', async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const category = typeof b.category === 'string' ? b.category.trim() : '';
    if (!category || category.length > INVENTORY_CATEGORY_MAX) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const unit = typeof b.unit === 'string' ? b.unit.trim() : '';
    if (!INVENTORY_UNITS.has(unit)) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const quantity = Number(b.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const low_stock_threshold = Number(b.low_stock_threshold);
    if (!Number.isFinite(low_stock_threshold) || low_stock_threshold < 0) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const brand =
      typeof b.brand === 'string' && b.brand.trim() ? String(b.brand).trim().slice(0, 200) : null;
    const shade_code =
      typeof b.shade_code === 'string' && b.shade_code.trim()
        ? String(b.shade_code).trim().slice(0, 80)
        : null;
    const package_size =
      typeof b.package_size === 'string' && b.package_size.trim() ? String(b.package_size).trim().slice(0, 80) : null;
    const supplier_hint =
      typeof b.supplier_hint === 'string' && b.supplier_hint.trim()
        ? String(b.supplier_hint).trim().slice(0, 200)
        : null;
    const custom_subcategory =
      typeof b.custom_subcategory === 'string' && b.custom_subcategory.trim()
        ? String(b.custom_subcategory).trim().slice(0, 100)
        : null;
    let price_per_unit_cents = null;
    if (b.price_per_unit_cents !== undefined && b.price_per_unit_cents !== null && b.price_per_unit_cents !== '') {
      const cents = Math.round(Number(b.price_per_unit_cents));
      if (!Number.isFinite(cents) || cents < 0) return res.status(400).json({ error: 'bad_request' });
      price_per_unit_cents = Math.min(cents, 1000000000);
    }
    let sell_price_cents = null;
    if (b.sell_price_cents !== undefined && b.sell_price_cents !== null && b.sell_price_cents !== '') {
      const cents = Math.round(Number(b.sell_price_cents));
      if (Number.isFinite(cents) && cents >= 0) sell_price_cents = Math.min(cents, 1000000000);
    }

    const sql = getSql();
    const rows = await sql`
      INSERT INTO inventory_items (
        salon_id,
        name,
        category,
        custom_subcategory,
        brand,
        shade_code,
        package_size,
        unit,
        quantity,
        low_stock_threshold,
        price_per_unit_cents,
        supplier_hint,
        sell_price_cents
      )
      VALUES (
        ${req.auth.salonId},
        ${name},
        ${category},
        ${custom_subcategory},
        ${brand},
        ${shade_code},
        ${package_size},
        ${unit},
        ${quantity},
        ${low_stock_threshold},
        ${price_per_unit_cents},
        ${supplier_hint},
        ${sell_price_cents}
      )
      RETURNING
        id,
        name,
        category,
        custom_subcategory,
        brand,
        shade_code,
        package_size,
        unit,
        quantity,
        low_stock_threshold,
        price_per_unit_cents,
        supplier_hint,
        sell_price_cents,
        (quantity <= low_stock_threshold) AS is_low_stock
    `;
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// Must be before /:id to avoid 'subcategories' being matched as an id
app.get('/api/inventory/subcategories', async (req, res, next) => {
  try {
    const sql = getSql();
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : null;
    const rows = category
      ? await sql`
          SELECT DISTINCT custom_subcategory
          FROM inventory_items
          WHERE salon_id = ${req.auth.salonId}
            AND custom_subcategory IS NOT NULL
            AND custom_subcategory <> ''
            AND category = ${category}
          ORDER BY custom_subcategory`
      : await sql`
          SELECT DISTINCT custom_subcategory
          FROM inventory_items
          WHERE salon_id = ${req.auth.salonId}
            AND custom_subcategory IS NOT NULL
            AND custom_subcategory <> ''
          ORDER BY custom_subcategory`;
    res.json(rows.map((r) => r.custom_subcategory));
  } catch (e) {
    next(e);
  }
});

/** Clear custom_subcategory on all salon items matching label (case-insensitive trim). Optional body.category limits to that inventory category (e.g. dye vs oxidant). */
app.post('/api/inventory/clear-subcategory', async (req, res, next) => {
  try {
    const b = req.body || {};
    const raw = typeof b.subcategory === 'string' ? b.subcategory.trim() : '';
    if (!raw || raw.length > 100) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const catFilter =
      typeof b.category === 'string' && b.category.trim()
        ? String(b.category).trim().slice(0, 80)
        : null;
    const sql = getSql();
    const norm = raw.toLowerCase();
    const updated = catFilter
      ? await sql`
          UPDATE inventory_items
          SET custom_subcategory = NULL
          WHERE salon_id = ${req.auth.salonId}
            AND lower(trim(custom_subcategory)) = ${norm}
            AND category = ${catFilter}
          RETURNING id
        `
      : await sql`
          UPDATE inventory_items
          SET custom_subcategory = NULL
          WHERE salon_id = ${req.auth.salonId}
            AND lower(trim(custom_subcategory)) = ${norm}
          RETURNING id
        `;
    res.json({ count: updated.length });
  } catch (e) {
    next(e);
  }
});

app.get('/api/inventory/:id/movements', async (req, res, next) => {
  try {
    const id = parseInventoryItemIdParam(req.params.id);
    if (id == null) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const item = await sql`
      SELECT id FROM inventory_items WHERE id = ${id} AND salon_id = ${req.auth.salonId} LIMIT 1
    `;
    if (!item.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const rows = await sql`
      SELECT id, delta, reason, visit_id, created_at
      FROM inventory_movements
      WHERE inventory_item_id = ${id}
      ORDER BY created_at DESC
      LIMIT 40
    `;
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

app.get('/api/inventory/:id', async (req, res, next) => {
  try {
    const id = parseInventoryItemIdParam(req.params.id);
    if (id == null) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const rows = await sql`
      SELECT
        id,
        name,
        category,
        custom_subcategory,
        brand,
        shade_code,
        package_size,
        unit,
        quantity,
        low_stock_threshold,
        price_per_unit_cents,
        supplier_hint,
        sell_price_cents,
        (quantity <= low_stock_threshold) AS is_low_stock
      FROM inventory_items
      WHERE id = ${id} AND salon_id = ${req.auth.salonId}
      LIMIT 1
    `;
    if (!rows.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

app.patch('/api/inventory/:id', async (req, res, next) => {
  try {
    const id = parseInventoryItemIdParam(req.params.id);
    if (id == null) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const existing = await sql`
      SELECT
        id,
        name,
        brand,
        shade_code,
        package_size,
        supplier_hint,
        price_per_unit_cents,
        sell_price_cents,
        quantity,
        low_stock_threshold,
        unit,
        category,
        custom_subcategory
      FROM inventory_items
      WHERE id = ${id} AND salon_id = ${req.auth.salonId}
      LIMIT 1
    `;
    if (!existing.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const cur = existing[0];
    const b = req.body || {};

    let newQty = Number(cur.quantity);
    if (b.quantity !== undefined && b.quantity !== null) {
      const q = Number(b.quantity);
      if (!Number.isFinite(q) || q < 0) {
        return res.status(400).json({ error: 'bad_request' });
      }
      newQty = q;
    }

    let newThresh = Number(cur.low_stock_threshold);
    if (b.low_stock_threshold !== undefined && b.low_stock_threshold !== null) {
      const t = Number(b.low_stock_threshold);
      if (!Number.isFinite(t) || t < 0) {
        return res.status(400).json({ error: 'bad_request' });
      }
      newThresh = t;
    }

    let newUnit = cur.unit;
    if (b.unit !== undefined && b.unit !== null) {
      newUnit = typeof b.unit === 'string' ? b.unit.trim() : '';
      if (!INVENTORY_UNITS.has(newUnit)) {
        return res.status(400).json({ error: 'bad_request' });
      }
    }

    let newCategory = cur.category;
    if (b.category !== undefined && b.category !== null) {
      newCategory = typeof b.category === 'string' ? b.category.trim() : '';
      if (!newCategory || newCategory.length > INVENTORY_CATEGORY_MAX) {
        return res.status(400).json({ error: 'bad_request' });
      }
    }

    const newName = typeof b.name === 'string' && b.name.trim() ? String(b.name).trim().slice(0, 200) : cur.name;
    const newBrand =
      b.brand !== undefined
        ? typeof b.brand === 'string' && b.brand.trim()
          ? String(b.brand).trim().slice(0, 200)
          : null
        : cur.brand;
    const newShade =
      b.shade_code !== undefined
        ? typeof b.shade_code === 'string' && b.shade_code.trim()
          ? String(b.shade_code).trim().slice(0, 80)
          : null
        : cur.shade_code;
    const newPackageSize =
      b.package_size !== undefined
        ? typeof b.package_size === 'string' && b.package_size.trim()
          ? String(b.package_size).trim().slice(0, 80)
          : null
        : cur.package_size;
    const newSupplier =
      b.supplier_hint !== undefined
        ? typeof b.supplier_hint === 'string' && b.supplier_hint.trim()
          ? String(b.supplier_hint).trim().slice(0, 200)
          : null
        : cur.supplier_hint;
    const newSubcategory =
      b.custom_subcategory !== undefined
        ? typeof b.custom_subcategory === 'string' && b.custom_subcategory.trim()
          ? String(b.custom_subcategory).trim().slice(0, 100)
          : null
        : cur.custom_subcategory;
    let newPrice = cur.price_per_unit_cents;
    if (b.price_per_unit_cents !== undefined) {
      if (b.price_per_unit_cents === null || b.price_per_unit_cents === '') {
        newPrice = null;
      } else {
        const cents = Math.round(Number(b.price_per_unit_cents));
        if (!Number.isFinite(cents) || cents < 0) return res.status(400).json({ error: 'bad_request' });
        newPrice = Math.min(cents, 1000000000);
      }
    }
    let newSellPrice = cur.sell_price_cents ?? null;
    if (b.sell_price_cents !== undefined) {
      if (b.sell_price_cents === null || b.sell_price_cents === '') {
        newSellPrice = null;
      } else {
        const cents = Math.round(Number(b.sell_price_cents));
        if (Number.isFinite(cents) && cents >= 0) newSellPrice = Math.min(cents, 1000000000);
      }
    }

    const oldQty = Number(cur.quantity);
    const delta = newQty - oldQty;
    const reasonText =
      typeof b.reason === 'string' && b.reason.trim() ? String(b.reason).trim().slice(0, 128) : 'adjust';

    if (delta !== 0) {
      await sql`
        INSERT INTO inventory_movements (inventory_item_id, delta, reason, visit_id)
        VALUES (${id}, ${delta}, ${reasonText}, NULL)
      `;
    }

    const updated = await sql`
      UPDATE inventory_items
      SET
        name = ${newName},
        brand = ${newBrand},
        shade_code = ${newShade},
        package_size = ${newPackageSize},
        supplier_hint = ${newSupplier},
        custom_subcategory = ${newSubcategory},
        price_per_unit_cents = ${newPrice},
        quantity = ${newQty},
        low_stock_threshold = ${newThresh},
        unit = ${newUnit},
        category = ${newCategory},
        sell_price_cents = ${newSellPrice}
      WHERE id = ${id} AND salon_id = ${req.auth.salonId}
      RETURNING
        id,
        name,
        category,
        custom_subcategory,
        brand,
        shade_code,
        package_size,
        unit,
        quantity,
        low_stock_threshold,
        price_per_unit_cents,
        supplier_hint,
        sell_price_cents,
        (quantity <= low_stock_threshold) AS is_low_stock
    `;
    res.json(updated[0]);
  } catch (e) {
    next(e);
  }
});

app.delete('/api/inventory/:id', async (req, res, next) => {
  try {
    const id = parseInventoryItemIdParam(req.params.id);
    if (id == null) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const del = await sql`
      DELETE FROM inventory_items
      WHERE id = ${id} AND salon_id = ${req.auth.salonId}
      RETURNING id
    `;
    if (!del.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

async function applyInventoryInvoiceItem(sql, salonId, item) {
  const match = await sql`
    SELECT id, quantity, price_per_unit_cents
    FROM inventory_items
    WHERE salon_id = ${salonId}
      AND lower(name) = ${item.name.toLowerCase()}
      AND COALESCE(lower(brand), '') = ${String(item.brand || '').toLowerCase()}
      AND COALESCE(lower(shade_code), '') = ${String(item.shade_code || '').toLowerCase()}
      AND unit = ${item.unit}
    LIMIT 1
  `;
  if (match.length) {
    const nextPrice =
      item.price_per_unit_cents != null ? item.price_per_unit_cents : match[0].price_per_unit_cents;
    const rows = await sql`
      UPDATE inventory_items
      SET
        quantity = quantity + ${item.quantity},
        price_per_unit_cents = ${nextPrice},
        package_size = COALESCE(${item.package_size}, package_size),
        supplier_hint = COALESCE(${item.supplier_hint}, supplier_hint)
      WHERE id = ${match[0].id} AND salon_id = ${salonId}
      RETURNING id, name, category, brand, shade_code, package_size, unit, quantity, low_stock_threshold,
        price_per_unit_cents, supplier_hint, (quantity <= low_stock_threshold) AS is_low_stock
    `;
    await sql`
      INSERT INTO inventory_movements (inventory_item_id, delta, reason, visit_id)
      VALUES (${match[0].id}, ${item.quantity}, ${'invoice'}, NULL)
    `;
    await upsertGlobalProduct(sql, item.brand, item.name, item.unit);
    return { ...rows[0], import_action: 'updated' };
  }

  const rows = await sql`
    INSERT INTO inventory_items (
      salon_id, name, category, brand, shade_code, package_size, unit, quantity, low_stock_threshold,
      price_per_unit_cents, supplier_hint
    )
    VALUES (
      ${salonId}, ${item.name}, ${item.category}, ${item.brand}, ${item.shade_code}, ${item.package_size}, ${item.unit},
      ${item.quantity}, ${0}, ${item.price_per_unit_cents}, ${item.supplier_hint}
    )
    RETURNING id, name, category, brand, shade_code, package_size, unit, quantity, low_stock_threshold,
      price_per_unit_cents, supplier_hint, (quantity <= low_stock_threshold) AS is_low_stock
  `;
  await sql`
    INSERT INTO inventory_movements (inventory_item_id, delta, reason, visit_id)
    VALUES (${rows[0].id}, ${item.quantity}, ${'invoice'}, NULL)
  `;
  await upsertGlobalProduct(sql, item.brand, item.name, item.unit);
  return { ...rows[0], import_action: 'created' };
}

function invoiceVisionPromptBase() {
  return [
    'Extract purchased salon inventory items from this invoice image.',
    'The invoice may be in English, Bulgarian, or mixed language. Read table rows and line items even if labels are abbreviated.',
    'Return only JSON with an "items" array. Do not return markdown.',
    'Each item: {"name": string, "category": "dye|oxidant|mixtone|toner|retail|consumable", "brand": string|null, "shade_code": string|null, "package_size": string|null, "unit": "g|ml|pcs|oz", "quantity": number, "price_per_unit": number|null, "line_total": number|null, "supplier": string|null}.',
    'For hair color like Wella Koleston 9.12 60 ml x 15 pieces, set shade_code 9.12, package_size 60 ml, quantity 15 and unit pcs.',
    'Quantity words can appear as qty, count, бр, брой, бройки, x, pcs, pieces. Convert them to a number.',
    'If the invoice shows 15 pcs at 10 each total 150, return quantity 15, price_per_unit 10, line_total 150.',
    'Skip taxes, discounts, subtotals, shipping, addresses, and non-product rows.',
  ].join(' ');
}

function invoiceTextPromptBase() {
  return [
    'Extract purchased salon inventory items from this invoice text (extracted from a PDF). Use only the lines that describe products.',
    'The invoice may be in English, Bulgarian, or mixed language. Read table rows and line items even if labels are abbreviated.',
    'Return only JSON with an "items" array. Do not return markdown.',
    'Each item: {"name": string, "category": "dye|oxidant|mixtone|toner|retail|consumable", "brand": string|null, "shade_code": string|null, "package_size": string|null, "unit": "g|ml|pcs|oz", "quantity": number, "price_per_unit": number|null, "line_total": number|null, "supplier": string|null}.',
    'For hair color like Wella Koleston 9.12 60 ml x 15 pieces, set shade_code 9.12, package_size 60 ml, quantity 15 and unit pcs.',
    'Quantity words can appear as qty, count, бр, брой, бройки, x, pcs, pieces. Convert them to a number.',
    'If the invoice shows 15 pcs at 10 each total 150, return quantity 15, price_per_unit 10, line_total 150.',
    'Skip taxes, discounts, subtotals, shipping, addresses, and non-product rows.',
  ].join(' ');
}

function effectiveInvoiceMime(contentTypeHint, buffer, objectKeyHint) {
  let ct =
    typeof contentTypeHint === 'string' ? contentTypeHint.split(';')[0].trim().toLowerCase() : '';
  if (ct === 'image/jpg') ct = 'image/jpeg';
  const kh = typeof objectKeyHint === 'string' ? objectKeyHint.toLowerCase() : '';
  if ((!ct || ct === 'binary/octet-stream' || ct === 'application/octet-stream') && kh.endsWith('.pdf'))
    ct = 'application/pdf';
  if ((!ct || ct === 'binary/octet-stream' || ct === 'application/octet-stream') && kh.endsWith('.png'))
    ct = 'image/png';
  if ((!ct || ct === 'binary/octet-stream' || ct === 'application/octet-stream') &&
    kh.endsWith('.webp'))
    ct = 'image/webp';
  if ((!ct || ct === 'binary/octet-stream' || ct === 'application/octet-stream') &&
    (kh.endsWith('.jpg') || kh.endsWith('.jpeg')))
    ct = 'image/jpeg';
  if (
    buffer &&
    buffer.length > 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    ct = ct || 'application/pdf';
  }
  if (/^image\/(jpeg|jpg|png|webp)$/i.test(ct || ''))
    return (ct === 'image/jpg' ? 'image/jpeg' : ct).toLowerCase();
  if (ct === 'application/pdf') return 'application/pdf';
  return ct || null;
}

function effectiveServicesOcrMime(contentTypeHint, objectKeyHint) {
  let ct =
    typeof contentTypeHint === 'string' ? contentTypeHint.split(';')[0].trim().toLowerCase() : '';
  if (ct === 'image/jpg') ct = 'image/jpeg';
  const kh = typeof objectKeyHint === 'string' ? objectKeyHint.toLowerCase() : '';
  if ((!ct || ct === 'binary/octet-stream' || ct === 'application/octet-stream') && kh.endsWith('.png'))
    ct = 'image/png';
  if ((!ct || ct === 'binary/octet-stream' || ct === 'application/octet-stream') &&
    kh.endsWith('.webp'))
    ct = 'image/webp';
  if ((!ct || ct === 'binary/octet-stream' || ct === 'application/octet-stream') &&
    (kh.endsWith('.jpg') || kh.endsWith('.jpeg')))
    ct = 'image/jpeg';
  if (/^image\/(jpeg|jpg|png|webp)$/i.test(ct || ''))
    return (ct === 'image/jpg' ? 'image/jpeg' : ct).toLowerCase();
  return 'image/jpeg';
}

async function invoiceLlmJsonItems(apiKey, usingOpenRouter, model, payloadBody) {
  const ocrRes = await fetch(
    usingOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(usingOpenRouter
          ? {
              'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://colortrack.vercel.app',
              'X-Title': 'ColorTrack',
            }
          : {}),
      },
      body: JSON.stringify(payloadBody),
    },
  );
  const text = await ocrRes.text();
  if (!ocrRes.ok) {
    throw new Error('ocr_http');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('ocr_parse');
  }
  const rawContent = data?.choices?.[0]?.message?.content;
  const assistantText = Array.isArray(rawContent)
    ? rawContent.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
    : rawContent;
  const parsed = parseJsonObjectFromText(assistantText);
  const rows = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
  const items = [];
  for (const row of rows) {
    const item = normalizeInventoryImportCandidate(row);
    if (!item) continue;
    items.push(item);
    if (items.length >= 120) break;
  }
  return items;
}

async function extractInvoiceItemsFromBuffer(buffer, meta) {
  const openRouterKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  const openAiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const usingOpenRouter = Boolean(openRouterKey);
  const apiKey = openRouterKey || openAiKey;
  if (!apiKey) throw new Error('missing_ocr_key');
  const model = usingOpenRouter
    ? String(process.env.OPENROUTER_OCR_MODEL || 'google/gemini-2.0-flash-001').trim()
    : String(process.env.OPENAI_OCR_MODEL || 'gpt-4o-mini').trim();

  const mimeRaw = typeof meta.mime === 'string' ? meta.mime : '';
  const keyHint = typeof meta.importKeyHint === 'string' ? meta.importKeyHint : '';
  const mime = effectiveInvoiceMime(mimeRaw, buffer, keyHint);
  if (!buffer || buffer.length < 24) throw new Error('empty_buffer');

  if (mime === 'application/pdf') {
    let parsedPdf;
    try {
      parsedPdf = await pdfParse(buffer);
    } catch {
      throw new Error('pdf_invalid');
    }
    const invoiceText = String(parsedPdf.text || '').trim();
    if (invoiceText.length < 28) throw new Error('pdf_no_extractable_text');
    const prompt = invoiceTextPromptBase();
    const textBody = `${prompt}\n\n---\n${invoiceText.slice(0, 100000)}`;
    const payloadBody = {
      model,
      temperature: 0,
      messages: [{ role: 'user', content: textBody }],
    };
    if (!usingOpenRouter) {
      payloadBody.response_format = { type: 'json_object' };
    }
    return await invoiceLlmJsonItems(apiKey, usingOpenRouter, model, payloadBody);
  }

  let imgMime = mime;
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(imgMime || '')) {
    imgMime = 'image/jpeg';
  }
  if (imgMime === 'image/jpg') imgMime = 'image/jpeg';
  const imageBase64 = buffer.toString('base64');
  const prompt = invoiceVisionPromptBase();
  const payloadBody = {
    model,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${imgMime};base64,${imageBase64}` } },
        ],
      },
    ],
  };
  if (!usingOpenRouter) {
    payloadBody.response_format = { type: 'json_object' };
  }
  return await invoiceLlmJsonItems(apiKey, usingOpenRouter, model, payloadBody);
}

app.post('/api/inventory/import/invoice/presign', async (req, res, next) => {
  try {
    if (!r2.r2Configured()) {
      return res.status(503).json({ error: 'r2_unconfigured' });
    }
    const b = req.body || {};
    const ct = r2.normalizeInvoiceImportContentType(b.contentType ?? b.content_type);
    if (!ct) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const key = r2.buildInvoiceImportKey(req.auth.salonId, ct);
    if (!key) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const uploadUrl = await r2.presignPut(key, ct);
    res.json({ uploadUrl, key, contentType: ct });
  } catch (e) {
    next(e);
  }
});

app.post('/api/inventory/import/bulk', async (req, res, next) => {
  try {
    const input = Array.isArray((req.body || {}).items) ? req.body.items : [];
    const clean = [];
    for (const row of input) {
      const item = normalizeInventoryImportCandidate(row);
      if (!item) continue;
      clean.push(item);
      if (clean.length >= 120) break;
    }
    if (!clean.length) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const saved = [];
    for (const item of clean) {
      saved.push(await applyInventoryInvoiceItem(sql, req.auth.salonId, item));
    }
    res.status(201).json(saved);
  } catch (e) {
    next(e);
  }
});

app.post('/api/inventory/import/invoice', async (req, res, next) => {
  const openRouterKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  const openAiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const apiKey = openRouterKey || openAiKey;
  if (!apiKey) {
    return res.status(503).json({ error: 'missing_ocr_key' });
  }

  const b = req.body || {};
  const importKeyRaw =
    typeof (b.import_key ?? b.importKey) === 'string' ? String(b.import_key ?? b.importKey).trim() : '';
  if (!importKeyRaw) {
    return res.status(400).json({ error: 'import_key_required' });
  }
  if (!r2.r2Configured()) {
    return res.status(503).json({ error: 'r2_unconfigured' });
  }
  if (!r2.keyBelongsToSalonInvoiceImport(req.auth.salonId, importKeyRaw)) {
    return res.status(400).json({ error: 'bad_import_key' });
  }
  let buffer;
  let mimeFromObject = '';
  const keyToDelete = importKeyRaw;
  try {
    const got = await r2.getObjectBuffer(importKeyRaw);
    buffer = got.buffer;
    mimeFromObject = got.contentType;
  } catch {
    return res.status(400).json({ error: 'import_not_found' });
  }

  try {
    const items = await extractInvoiceItemsFromBuffer(buffer, {
      mime: mimeFromObject,
      importKeyHint: importKeyRaw || null,
    });
    res.json({ items });
  } catch (e) {
    const code = e && typeof e.message === 'string' ? e.message : '';
    if (code === 'missing_ocr_key') {
      res.status(503).json({ error: 'missing_ocr_key' });
    } else if (code === 'pdf_no_extractable_text') {
      res.status(422).json({ error: 'pdf_no_extractable_text' });
    } else if (code === 'pdf_invalid') {
      res.status(400).json({ error: 'pdf_invalid' });
    } else if (code === 'empty_buffer') {
      res.status(400).json({ error: 'bad_request' });
    } else if (code === 'ocr_http' || code === 'ocr_parse') {
      res.status(502).json({ error: 'ocr_failed' });
    } else {
      next(e);
    }
  } finally {
    if (keyToDelete && r2.r2Configured()) {
      try {
        await r2.deleteObject(keyToDelete);
      } catch {
        /* best-effort temp cleanup */
      }
    }
  }
});

function sanitizeServiceName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ').slice(0, 160);
}

function normalizeCurrencyCode(raw) {
  const c = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(c) ? c : 'BGN';
}

function centsFromLoosePrice(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return null;
    return Math.round(raw * 100);
  }
  const text = String(raw).replace(/\s/g, '').replace(',', '.');
  const m = text.match(/\d+(?:\.\d{1,2})?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function normalizeServiceCandidate(row) {
  if (!row || typeof row !== 'object') return null;
  const name = sanitizeServiceName(row.name || row.service || row.title);
  if (!name) return null;
  let priceCents = null;
  if (row.price_cents !== undefined && row.price_cents !== null && row.price_cents !== '') {
    const cents = Math.round(Number(row.price_cents));
    priceCents = Number.isFinite(cents) && cents >= 0 ? Math.min(cents, 1000000000) : null;
  } else {
    priceCents = centsFromLoosePrice(row.price ?? row.amount ?? row.value);
  }
  return {
    name,
    price_cents: priceCents == null ? null : Math.min(priceCents, 1000000000),
    currency_code: normalizeCurrencyCode(row.currency_code || row.currency),
  };
}

function parseJsonObjectFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function extractSalonServicesOcrFromBuffer(buffer, meta) {
  const openRouterKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  const openAiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const usingOpenRouter = Boolean(openRouterKey);
  const apiKey = openRouterKey || openAiKey;
  if (!apiKey) throw new Error('missing_ocr_key');
  const model = usingOpenRouter
    ? String(process.env.OPENROUTER_OCR_MODEL || 'google/gemini-2.0-flash-001').trim()
    : String(process.env.OPENAI_OCR_MODEL || 'gpt-4o-mini').trim();

  const mimeRaw = typeof meta.mime === 'string' ? meta.mime : '';
  const keyHint = typeof meta.importKeyHint === 'string' ? meta.importKeyHint : '';
  let imgMime = effectiveServicesOcrMime(mimeRaw, keyHint);
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(imgMime || '')) {
    imgMime = 'image/jpeg';
  }
  if (imgMime === 'image/jpg') imgMime = 'image/jpeg';
  if (!buffer || buffer.length < 24) throw new Error('empty_buffer');

  const imageBase64 = buffer.toString('base64');
  const prompt = [
    'Extract salon service names and prices from this price list image.',
    'Return only JSON with a "services" array.',
    'Each item: {"name": string, "price": number|null, "currency_code": "BGN" unless another currency is visible}.',
    'Skip headers, categories, phone numbers, addresses, discounts, and non-service rows.',
    'If a price is a range, use the lowest visible price.',
  ].join(' ');
  const body = {
    model,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${imgMime};base64,${imageBase64}` } },
        ],
      },
    ],
  };
  if (!usingOpenRouter) {
    body.response_format = { type: 'json_object' };
  }
  const ocrRes = await fetch(
    usingOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(usingOpenRouter
          ? {
              'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://colortrack.vercel.app',
              'X-Title': 'ColorTrack',
            }
          : {}),
      },
      body: JSON.stringify(body),
    },
  );
  const text = await ocrRes.text();
  if (!ocrRes.ok) {
    throw new Error('ocr_http');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('ocr_parse');
  }
  const rawContent = data?.choices?.[0]?.message?.content;
  const assistantText = Array.isArray(rawContent)
    ? rawContent.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
    : rawContent;
  const parsed = parseJsonObjectFromText(assistantText);
  const rows = Array.isArray(parsed?.services) ? parsed.services : [];
  const services = [];
  for (const row of rows) {
    const service = normalizeServiceCandidate(row);
    if (!service) continue;
    if (!services.some((s) => s.name.toLowerCase() === service.name.toLowerCase())) {
      services.push(service);
    }
    if (services.length >= 80) break;
  }
  return services;
}

async function upsertSalonService(sql, salonId, service) {
  const existing = await sql`
    SELECT id
    FROM salon_services
    WHERE salon_id = ${salonId} AND lower(name) = ${service.name.toLowerCase()}
    LIMIT 1
  `;
  if (existing.length) {
    const rows = await sql`
      UPDATE salon_services
      SET
        name = ${service.name},
        price_cents = ${service.price_cents},
        currency_code = ${service.currency_code},
        is_active = TRUE,
        updated_at = NOW()
      WHERE id = ${existing[0].id} AND salon_id = ${salonId}
      RETURNING id, name, price_cents, currency_code, is_active
    `;
    return rows[0];
  }
  const rows = await sql`
    INSERT INTO salon_services (salon_id, name, price_cents, currency_code)
    VALUES (${salonId}, ${service.name}, ${service.price_cents}, ${service.currency_code})
    RETURNING id, name, price_cents, currency_code, is_active
  `;
  return rows[0];
}

app.get('/api/services', async (req, res, next) => {
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT id, name, price_cents, currency_code, is_active
      FROM salon_services
      WHERE salon_id = ${req.auth.salonId} AND is_active = TRUE
      ORDER BY name
    `;
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

app.post('/api/services/bulk', async (req, res, next) => {
  try {
    const input = Array.isArray((req.body || {}).services) ? req.body.services : [];
    const clean = [];
    for (const row of input) {
      const service = normalizeServiceCandidate(row);
      if (!service) continue;
      if (!clean.some((s) => s.name.toLowerCase() === service.name.toLowerCase())) {
        clean.push(service);
      }
      if (clean.length >= 80) break;
    }
    if (!clean.length) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const saved = [];
    for (const service of clean) {
      saved.push(await upsertSalonService(sql, req.auth.salonId, service));
    }
    res.status(201).json(saved);
  } catch (e) {
    next(e);
  }
});

app.patch('/api/services/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const service = normalizeServiceCandidate(req.body || {});
    if (!service) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const dup = await sql`
      SELECT id
      FROM salon_services
      WHERE salon_id = ${req.auth.salonId}
        AND lower(name) = ${service.name.toLowerCase()}
        AND id <> ${id}
      LIMIT 1
    `;
    if (dup.length) {
      return res.status(409).json({ error: 'conflict' });
    }
    const rows = await sql`
      UPDATE salon_services
      SET
        name = ${service.name},
        price_cents = ${service.price_cents},
        currency_code = ${service.currency_code},
        updated_at = NOW()
      WHERE id = ${id} AND salon_id = ${req.auth.salonId}
      RETURNING id, name, price_cents, currency_code, is_active
    `;
    if (!rows.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

app.post('/api/services/import/ocr/presign', async (req, res, next) => {
  try {
    if (!r2.r2Configured()) {
      return res.status(503).json({ error: 'r2_unconfigured' });
    }
    const b = req.body || {};
    const ct = r2.normalizeContentType(b.contentType ?? b.content_type);
    if (!ct) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const key = r2.buildServiceImportKey(req.auth.salonId, ct);
    if (!key) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const uploadUrl = await r2.presignPut(key, ct);
    res.json({ uploadUrl, key, contentType: ct });
  } catch (e) {
    next(e);
  }
});

app.post('/api/services/import/ocr', async (req, res, next) => {
  const openRouterKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  const openAiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const apiKey = openRouterKey || openAiKey;
  if (!apiKey) {
    return res.status(503).json({ error: 'missing_ocr_key' });
  }
  const b = req.body || {};
  const importKeyRaw =
    typeof (b.import_key ?? b.importKey) === 'string' ? String(b.import_key ?? b.importKey).trim() : '';
  if (!importKeyRaw) {
    return res.status(400).json({ error: 'import_key_required' });
  }
  if (!r2.r2Configured()) {
    return res.status(503).json({ error: 'r2_unconfigured' });
  }
  if (!r2.keyBelongsToSalonServiceImport(req.auth.salonId, importKeyRaw)) {
    return res.status(400).json({ error: 'bad_import_key' });
  }
  const keyToDelete = importKeyRaw;
  let buffer;
  let mimeFromObject = '';
  try {
    const got = await r2.getObjectBuffer(importKeyRaw);
    buffer = got.buffer;
    mimeFromObject = got.contentType;
  } catch {
    return res.status(400).json({ error: 'import_not_found' });
  }

  try {
    const services = await extractSalonServicesOcrFromBuffer(buffer, {
      mime: mimeFromObject,
      importKeyHint: importKeyRaw,
    });
    res.json({ services });
  } catch (e) {
    const code = e && typeof e.message === 'string' ? e.message : '';
    if (code === 'missing_ocr_key') {
      res.status(503).json({ error: 'missing_ocr_key' });
    } else if (code === 'empty_buffer') {
      res.status(400).json({ error: 'bad_request' });
    } else if (code === 'ocr_http' || code === 'ocr_parse') {
      res.status(502).json({ error: 'ocr_failed' });
    } else {
      next(e);
    }
  } finally {
    if (keyToDelete && r2.r2Configured()) {
      try {
        await r2.deleteObject(keyToDelete);
      } catch {
        /* best-effort temp cleanup */
      }
    }
  }
});

app.get('/api/appointments', async (req, res, next) => {
  try {
    const raw = req.query.date;
    const sql = getSql();
    if (!raw || typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const rows = await sql`
      SELECT
        a.id,
        a.client_id,
        a.title,
        a.procedure_name,
        a.start_at,
        a.end_at,
        a.chair_label,
        a.notes,
        a.source,
        c.full_name AS client_name,
        v.id AS visit_id,
        to_char((a.start_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS day_local,
        to_char((a.start_at AT TIME ZONE ${TZ}), 'HH24:MI') AS start_local,
        to_char((a.end_at AT TIME ZONE ${TZ}), 'HH24:MI') AS end_local
      FROM appointments a
      LEFT JOIN clients c ON c.id = a.client_id
      LEFT JOIN visits v ON v.appointment_id = a.id
      WHERE (a.start_at AT TIME ZONE ${TZ})::date = ${raw}::date
        AND a.salon_id = ${req.auth.salonId}
      ORDER BY a.start_at
    `;
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

app.post('/api/appointments', async (req, res, next) => {
  try {
    const sql = getSql();
    const b = req.body || {};
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const dateStr = typeof b.date === 'string' ? b.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const startNorm = normalizeHM(b.start_time);
    const endNorm = normalizeHM(b.end_time);
    if (!startNorm || !endNorm) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const startT = startNorm.slice(0, 5);
    const endT = endNorm.slice(0, 5);
    if (endT <= startT) {
      return res.status(400).json({ error: 'bad_request' });
    }

    const sid = req.auth.salonId;
    let clientId = null;
    if (b.client_id != null && b.client_id !== '') {
      const cid = Number(b.client_id);
      if (!Number.isFinite(cid) || cid < 1) {
        return res.status(400).json({ error: 'bad_request' });
      }
      const ck = await sql`SELECT id FROM clients WHERE id = ${cid} AND salon_id = ${sid} LIMIT 1`;
      if (!ck.length) {
        return res.status(400).json({ error: 'bad_request' });
      }
      clientId = cid;
    }

    const procedureName =
      typeof b.procedure_name === 'string' && b.procedure_name.trim() ? b.procedure_name.trim() : null;
    const chairLabel =
      typeof b.chair_label === 'string' && b.chair_label.trim() ? b.chair_label.trim() : null;
    const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null;
    const source =
      typeof b.source === 'string' && b.source.trim() ? b.source.trim().slice(0, 64) : 'manual';

    const rows = await sql`
      INSERT INTO appointments (
        salon_id,
        client_id,
        title,
        procedure_name,
        start_at,
        end_at,
        chair_label,
        notes,
        source
      )
      VALUES (
        ${sid},
        ${clientId},
        ${title},
        ${procedureName},
        (${dateStr}::date + ${startT}::time) AT TIME ZONE ${TZ},
        (${dateStr}::date + ${endT}::time) AT TIME ZONE ${TZ},
        ${chairLabel},
        ${notes},
        ${source}
      )
      RETURNING id, client_id, title, procedure_name, start_at, end_at, chair_label, notes, source
    `;
    try {
      await push.notifySalon(sql, sid, 'Schedule', title, { a: rows[0].id });
    } catch (_) {
      /* noop */
    }
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

app.patch('/api/appointments/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const sid = req.auth.salonId;
    const existing = await sql`
      SELECT id, client_id, title, procedure_name, start_at, end_at, chair_label, notes, source
      FROM appointments
      WHERE id = ${id} AND salon_id = ${sid}
      LIMIT 1
    `;
    if (!existing.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const row = existing[0];
    const b = req.body || {};

    const title =
      typeof b.title === 'string' ? b.title.trim() : row.title;
    if (!title) {
      return res.status(400).json({ error: 'bad_request' });
    }

    let clientId = row.client_id;
    if (Object.prototype.hasOwnProperty.call(b, 'client_id')) {
      if (b.client_id === null || b.client_id === '') {
        clientId = null;
      } else {
        const cid = Number(b.client_id);
        if (!Number.isFinite(cid) || cid < 1) {
          return res.status(400).json({ error: 'bad_request' });
        }
        const ck = await sql`SELECT id FROM clients WHERE id = ${cid} AND salon_id = ${sid} LIMIT 1`;
        if (!ck.length) {
          return res.status(400).json({ error: 'bad_request' });
        }
        clientId = cid;
      }
    }

    const procedure_name =
      b.procedure_name !== undefined
        ? typeof b.procedure_name === 'string' && b.procedure_name.trim()
          ? b.procedure_name.trim()
          : null
        : row.procedure_name;
    const chair_label =
      b.chair_label !== undefined
        ? b.chair_label === null || b.chair_label === ''
          ? null
          : String(b.chair_label)
        : row.chair_label;
    const notes =
      b.notes !== undefined
        ? b.notes === null || b.notes === ''
          ? null
          : String(b.notes)
        : row.notes;
    const source =
      b.source !== undefined && typeof b.source === 'string' && b.source.trim()
        ? b.source.trim().slice(0, 64)
        : row.source;

    const meta = await sql`
      SELECT
        to_char((start_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS d,
        to_char((start_at AT TIME ZONE ${TZ}), 'HH24:MI') AS st,
        to_char((end_at AT TIME ZONE ${TZ}), 'HH24:MI') AS en
      FROM appointments
      WHERE id = ${id} AND salon_id = ${sid}
      LIMIT 1
    `;
    let dateStr = meta[0].d;
    let startT = meta[0].st;
    let endT = meta[0].en;

    if (b.date !== undefined) {
      const ds = typeof b.date === 'string' ? b.date.trim() : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
        return res.status(400).json({ error: 'bad_request' });
      }
      dateStr = ds;
    }
    if (b.start_time !== undefined) {
      const sn = normalizeHM(b.start_time);
      if (!sn) {
        return res.status(400).json({ error: 'bad_request' });
      }
      startT = sn.slice(0, 5);
    }
    if (b.end_time !== undefined) {
      const en = normalizeHM(b.end_time);
      if (!en) {
        return res.status(400).json({ error: 'bad_request' });
      }
      endT = en.slice(0, 5);
    }
    if (endT <= startT) {
      return res.status(400).json({ error: 'bad_request' });
    }

    const updated = await sql`
      UPDATE appointments
      SET
        client_id = ${clientId},
        title = ${title},
        procedure_name = ${procedure_name},
        start_at = (${dateStr}::date + ${startT}::time) AT TIME ZONE ${TZ},
        end_at = (${dateStr}::date + ${endT}::time) AT TIME ZONE ${TZ},
        chair_label = ${chair_label},
        notes = ${notes},
        source = ${source}
      WHERE id = ${id} AND salon_id = ${sid}
      RETURNING id, client_id, title, procedure_name, start_at, end_at, chair_label, notes, source
    `;
    res.json(updated[0]);
  } catch (e) {
    next(e);
  }
});

app.delete('/api/appointments/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const del = await sql`
      DELETE FROM appointments
      WHERE id = ${id} AND salon_id = ${req.auth.salonId}
      RETURNING id
    `;
    if (!del.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

app.get('/api/appointments/days', async (req, res, next) => {
  try {
    const from = req.query.from;
    const to = req.query.to;
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const rows = await sql`
      SELECT DISTINCT to_char((start_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS d
      FROM appointments
      WHERE (start_at AT TIME ZONE ${TZ})::date >= ${from}::date
        AND (start_at AT TIME ZONE ${TZ})::date <= ${to}::date
        AND salon_id = ${req.auth.salonId}
    `;
    const days = rows.map((r) => String(r.d));
    res.json(days);
  } catch (e) {
    next(e);
  }
});

const FORMULA_SECTIONS = new Set(['roots', 'lengths', 'toner', 'other', 'developer']);

app.post('/api/visits', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;
    const b = req.body || {};
    const { client_id, visit_date, procedure_name, chair_label, notes, lines, appointment_id } = b;

    const cid = Number(client_id);
    if (!Number.isFinite(cid) || cid < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const clientRow = await sql`
      SELECT id FROM clients WHERE id = ${cid} AND salon_id = ${sid} LIMIT 1
    `;
    if (!clientRow.length) {
      return res.status(400).json({ error: 'bad_request' });
    }
    if (!procedure_name || typeof procedure_name !== 'string') {
      return res.status(400).json({ error: 'bad_request' });
    }
    if (!Array.isArray(lines)) {
      return res.status(400).json({ error: 'bad_request' });
    }

    let apptId = null;
    if (appointment_id != null && appointment_id !== '') {
      const aid = Number(appointment_id);
      if (!Number.isFinite(aid) || aid < 1) {
        return res.status(400).json({ error: 'bad_request' });
      }
      const apptRows = await sql`
        SELECT id, client_id FROM appointments WHERE id = ${aid} AND salon_id = ${sid} LIMIT 1
      `;
      if (!apptRows.length) {
        return res.status(404).json({ error: 'not_found' });
      }
      if (apptRows[0].client_id == null || Number(apptRows[0].client_id) !== cid) {
        return res.status(400).json({ error: 'bad_request' });
      }
      const taken = await sql`
        SELECT id FROM visits WHERE appointment_id = ${aid} LIMIT 1
      `;
      if (taken.length) {
        return res.status(400).json({ error: 'conflict' });
      }
      apptId = aid;
    }

    for (const line of lines) {
      if (!line || typeof line.section !== 'string' || !FORMULA_SECTIONS.has(line.section)) {
        return res.status(400).json({ error: 'bad_request' });
      }
      if (!line.brand || line.amount == null) {
        return res.status(400).json({ error: 'bad_request' });
      }
    }

    const vd =
      typeof visit_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(visit_date)
        ? visit_date
        : null;

    let paidVal = null;
    if (b.amount_paid_cents != null && b.amount_paid_cents !== '') {
      const n = Math.round(Number(b.amount_paid_cents));
      if (Number.isFinite(n) && n >= 0) paidVal = n;
      else return res.status(400).json({ error: 'bad_request' });
    } else if (b.amount_usd != null && b.amount_usd !== '') {
      const u = Number(b.amount_usd);
      if (Number.isFinite(u) && u >= 0) paidVal = Math.round(u * 100);
      else return res.status(400).json({ error: 'bad_request' });
    }

    const devCal =
      typeof b.device_calendar_event_id === 'string' && b.device_calendar_event_id.trim()
        ? String(b.device_calendar_event_id).trim().slice(0, 256)
        : null;

    let src = 'manual';
    if (typeof b.source === 'string' && ['manual', 'device_calendar', 'appointment'].includes(b.source)) {
      src = b.source;
    } else if (devCal) {
      src = 'device_calendar';
    } else if (apptId) {
      src = 'appointment';
    }

    let visitRows;
    if (vd && apptId) {
      visitRows = await sql`
        INSERT INTO visits (
          salon_id, client_id, visit_date, procedure_name, chair_label, notes, appointment_id,
          amount_paid_cents, device_calendar_event_id, source
        )
        VALUES (
          ${sid}, ${cid}, ${vd}::date, ${procedure_name}, ${chair_label || null}, ${notes || null}, ${apptId},
          ${paidVal}, ${devCal}, ${src}
        )
        RETURNING id
      `;
    } else if (vd) {
      visitRows = await sql`
        INSERT INTO visits (
          salon_id, client_id, visit_date, procedure_name, chair_label, notes,
          amount_paid_cents, device_calendar_event_id, source
        )
        VALUES (
          ${sid}, ${cid}, ${vd}::date, ${procedure_name}, ${chair_label || null}, ${notes || null},
          ${paidVal}, ${devCal}, ${src}
        )
        RETURNING id
      `;
    } else if (apptId) {
      visitRows = await sql`
        INSERT INTO visits (
          salon_id, client_id, procedure_name, chair_label, notes, appointment_id,
          amount_paid_cents, device_calendar_event_id, source
        )
        VALUES (
          ${sid}, ${cid}, ${procedure_name}, ${chair_label || null}, ${notes || null}, ${apptId},
          ${paidVal}, ${devCal}, ${src}
        )
        RETURNING id
      `;
    } else {
      visitRows = await sql`
        INSERT INTO visits (
          salon_id, client_id, procedure_name, chair_label, notes,
          amount_paid_cents, device_calendar_event_id, source
        )
        VALUES (
          ${sid}, ${cid}, ${procedure_name}, ${chair_label || null}, ${notes || null},
          ${paidVal}, ${devCal}, ${src}
        )
        RETURNING id
      `;
    }

    const visitId = visitRows[0].id;

    for (const line of lines) {
      const amount = Number(line.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'bad_request' });
      }
      const invId = line.inventory_item_id != null ? Number(line.inventory_item_id) : null;

      await sql`
        INSERT INTO formula_lines (visit_id, section, brand, shade_code, amount, inventory_item_id)
        VALUES (
          ${visitId},
          ${line.section}::formula_section,
          ${String(line.brand)},
          ${String(line.shade_code || '-')},
          ${amount},
          ${invId && invId > 0 ? invId : null}
        )
      `;

      if (invId && invId > 0) {
        const itemExists = await sql`
          SELECT id FROM inventory_items WHERE id = ${invId} AND salon_id = ${sid} LIMIT 1
        `;
        if (itemExists.length) {
          await sql`
            UPDATE inventory_items
            SET quantity = quantity - ${amount}
            WHERE id = ${invId} AND salon_id = ${sid}
          `;
          await sql`
            INSERT INTO inventory_movements (inventory_item_id, delta, reason, visit_id)
            VALUES (${invId}, ${-amount}, ${'visit_formula'}, ${visitId})
          `;
        }
      }
    }

    res.status(201).json({ id: visitId });
  } catch (e) {
    next(e);
  }
});

app.get('/api/visits/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const rows = await sql`
      SELECT
        v.id,
        v.client_id,
        v.visit_date,
        v.procedure_name,
        v.chair_label,
        v.notes,
        v.appointment_id,
        v.amount_paid_cents,
        v.device_calendar_event_id,
        v.source,
        v.created_at,
        c.full_name AS client_full_name
      FROM visits v
      JOIN clients c ON c.id = v.client_id
      WHERE v.id = ${id} AND c.salon_id = ${req.auth.salonId}
    `;
    if (!rows.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const v = rows[0];
    const formula_lines = await sql`
      SELECT
        fl.id,
        fl.section,
        fl.brand,
        CASE
          WHEN fl.shade_code IS NOT NULL
            AND fl.shade_code NOT IN ('', '-', 'g', 'oz', 'ml')
          THEN fl.shade_code
          WHEN ii.shade_code IS NOT NULL AND TRIM(ii.shade_code) <> ''
          THEN ii.shade_code
          ELSE fl.shade_code
        END AS shade_code,
        fl.amount,
        fl.inventory_item_id
      FROM formula_lines fl
      LEFT JOIN inventory_items ii ON ii.id = fl.inventory_item_id
      WHERE fl.visit_id = ${id}
      ORDER BY fl.id
    `;
    const photoRows = await sql`
      SELECT id, object_key, content_type, photo_type
      FROM visit_photos
      WHERE visit_id = ${id} AND salon_id = ${req.auth.salonId}
      ORDER BY photo_type, id
    `;
    const photos = r2.r2Configured()
      ? await Promise.all(photoRows.map(async (p) => ({
          id: p.id,
          photo_type: p.photo_type,
          url: await r2.presignGet(p.object_key).catch(() => null),
        })))
      : [];

    res.json({
      id: v.id,
      client_id: v.client_id,
      visit_date: v.visit_date,
      procedure_name: v.procedure_name,
      chair_label: v.chair_label,
      notes: v.notes,
      appointment_id: v.appointment_id,
      amount_paid_cents: v.amount_paid_cents,
      device_calendar_event_id: v.device_calendar_event_id,
      source: v.source,
      created_at: v.created_at,
      client: { id: v.client_id, full_name: v.client_full_name },
      formula_lines,
      photos,
    });
  } catch (e) {
    next(e);
  }
});

app.post('/api/visits/:id/photos/presign', async (req, res, next) => {
  try {
    if (!r2.r2Configured()) return res.status(503).json({ error: 'unavailable' });
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: 'bad_request' });
    const sql = getSql();
    const sid = req.auth.salonId;
    const exists = await sql`SELECT id FROM visits v JOIN clients c ON c.id = v.client_id WHERE v.id = ${id} AND c.salon_id = ${sid} LIMIT 1`;
    if (!exists.length) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const ct = r2.normalizeContentType(b.contentType ?? b.content_type);
    if (!ct) return res.status(400).json({ error: 'bad_request' });
    const photoType = b.photo_type === 'before' ? 'before' : 'after';
    const key = r2.buildVisitPhotoKey(id, photoType, ct);
    if (!key) return res.status(400).json({ error: 'bad_request' });
    const uploadUrl = await r2.presignPut(key, ct);
    res.json({ uploadUrl, key, contentType: ct });
  } catch (e) { next(e); }
});

app.post('/api/visits/:id/photos/commit', async (req, res, next) => {
  try {
    if (!r2.r2Configured()) return res.status(503).json({ error: 'unavailable' });
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: 'bad_request' });
    const b = req.body || {};
    const key = typeof b.key === 'string' ? b.key.trim() : '';
    if (!key || !r2.keyBelongsToVisit(id, key)) return res.status(400).json({ error: 'bad_request' });
    const ct = r2.normalizeContentType(b.contentType ?? b.content_type);
    if (!ct) return res.status(400).json({ error: 'bad_request' });
    const photoType = b.photo_type === 'before' ? 'before' : 'after';
    const sql = getSql();
    const sid = req.auth.salonId;
    const rows = await sql`
      INSERT INTO visit_photos (visit_id, salon_id, object_key, content_type, photo_type)
      VALUES (${id}, ${sid}, ${key}, ${ct}, ${photoType})
      RETURNING id
    `;
    res.status(201).json({ id: rows[0].id });
  } catch (e) { next(e); }
});

function initialsFromFullName(name) {
  const s = String(name ?? '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = (parts[0][0] || '').toUpperCase();
    const b = (parts[parts.length - 1][0] || '').toUpperCase();
    const out = `${a}${b}`.trim();
    return out || '?';
  }
  const w = parts[0];
  if (w.length >= 2) return w.slice(0, 2).toUpperCase();
  return (w[0] || '?').toUpperCase();
}

app.get('/api/lab/stats', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;

    const [cntRows, recentRows] = await Promise.all([
      sql`
      WITH bounds AS (
        SELECT
          (date_trunc('month', (now() AT TIME ZONE ${TZ})::timestamp))::date AS start_m,
          ((date_trunc('month', (now() AT TIME ZONE ${TZ})::timestamp) + interval '1 month'))::date AS end_m
      )
      SELECT COUNT(DISTINCT v.id)::int AS visits_with_formula_this_month
      FROM visits v
      JOIN formula_lines fl ON fl.visit_id = v.id
      JOIN clients c ON c.id = v.client_id AND c.salon_id = ${sid}
      CROSS JOIN bounds b
      WHERE v.salon_id = ${sid}
        AND v.visit_date >= b.start_m
        AND v.visit_date < b.end_m
    `,
      sql`
      WITH bounds AS (
        SELECT
          (date_trunc('month', (now() AT TIME ZONE ${TZ})::timestamp))::date AS start_m,
          ((date_trunc('month', (now() AT TIME ZONE ${TZ})::timestamp) + interval '1 month'))::date AS end_m
      ),
      per_client AS (
        SELECT DISTINCT ON (v.client_id)
          c.full_name,
          v.visit_date,
          v.created_at
        FROM visits v
        JOIN formula_lines fl ON fl.visit_id = v.id
        JOIN clients c ON c.id = v.client_id AND c.salon_id = ${sid}
        CROSS JOIN bounds b
        WHERE v.salon_id = ${sid}
          AND v.visit_date >= b.start_m
          AND v.visit_date < b.end_m
        ORDER BY v.client_id, v.visit_date DESC, v.created_at DESC
      )
      SELECT full_name
      FROM per_client
      ORDER BY visit_date DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 3
    `,
    ]);

    const visits_with_formula_this_month = cntRows[0]?.visits_with_formula_this_month ?? 0;
    const formula_client_initials_last3 = recentRows.map((r) => initialsFromFullName(r.full_name));
    res.json({ visits_with_formula_this_month, formula_client_initials_last3 });
  } catch (e) {
    next(e);
  }
});

app.get('/api/lab/visits', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;
    let limit = Number(req.query.limit);
    if (!Number.isFinite(limit) || limit < 1) limit = 30;
    if (limit > 100) limit = 100;
    const from =
      typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
    const to =
      typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
    const qraw = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pat = qraw.length > 0 ? `%${qraw}%` : null;

    const rows = await sql`
      SELECT
        v.id,
        v.visit_date,
        v.procedure_name,
        v.client_id,
        c.full_name AS client_name,
        COUNT(fl.id)::int AS formula_line_count,
        BOOL_OR(fl.inventory_item_id IS NOT NULL) AS has_inventory_link,
        (
          SELECT string_agg(sub.p, ' · ' ORDER BY sub.ord)
          FROM (
            SELECT fl3.id AS ord,
              LEFT(BTRIM(fl3.brand::text) || ' ' || BTRIM(fl3.shade_code::text), 40) AS p
            FROM formula_lines fl3
            WHERE fl3.visit_id = v.id
            ORDER BY fl3.id
            LIMIT 4
          ) sub
        ) AS preview_text
      FROM visits v
      JOIN clients c ON c.id = v.client_id AND c.salon_id = ${sid}
      JOIN formula_lines fl ON fl.visit_id = v.id
      WHERE v.salon_id = ${sid}
        AND (${from}::text IS NULL OR v.visit_date >= ${from}::date)
        AND (${to}::text IS NULL OR v.visit_date <= ${to}::date)
        AND (
          ${pat}::text IS NULL
          OR v.procedure_name ILIKE ${pat}
          OR c.full_name ILIKE ${pat}
          OR EXISTS (
            SELECT 1 FROM formula_lines fls
            WHERE fls.visit_id = v.id
              AND (fls.brand ILIKE ${pat} OR fls.shade_code ILIKE ${pat})
          )
        )
      GROUP BY v.id, v.visit_date, v.procedure_name, v.client_id, c.full_name
      ORDER BY v.visit_date DESC, v.id DESC
      LIMIT ${limit}
    `;

    res.json(
      rows.map((r) => ({
        id: r.id,
        visit_date: r.visit_date,
        procedure_name: r.procedure_name,
        client_id: r.client_id,
        client_name: r.client_name,
        formula_line_count: r.formula_line_count,
        has_inventory_link: Boolean(r.has_inventory_link),
        preview_text: r.preview_text || '',
      })),
    );
  } catch (e) {
    next(e);
  }
});

app.post('/api/lab/duplicate-visit', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;
    const b = req.body || {};
    const srcId = Number(b.source_visit_id);
    const cid = Number(b.client_id);
    if (!Number.isFinite(srcId) || srcId < 1 || !Number.isFinite(cid) || cid < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }

    const srcRows = await sql`
      SELECT v.procedure_name, v.chair_label, v.notes
      FROM visits v
      JOIN clients c ON c.id = v.client_id AND c.salon_id = ${sid}
      WHERE v.id = ${srcId} AND v.salon_id = ${sid}
      LIMIT 1
    `;
    if (!srcRows.length) {
      return res.status(404).json({ error: 'not_found' });
    }

    const lines = await sql`
      SELECT section, brand, shade_code, amount
      FROM formula_lines
      WHERE visit_id = ${srcId}
      ORDER BY id
    `;
    if (!lines.length) {
      return res.status(400).json({ error: 'bad_request' });
    }

    const clientRow = await sql`
      SELECT id FROM clients WHERE id = ${cid} AND salon_id = ${sid} LIMIT 1
    `;
    if (!clientRow.length) {
      return res.status(400).json({ error: 'bad_request' });
    }

    let vd;
    if (typeof b.visit_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.visit_date)) {
      vd = b.visit_date;
    } else {
      const todayRow = await sql`
        SELECT to_char((now() AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS y
      `;
      vd = String(todayRow[0].y);
    }

    const proc =
      typeof b.procedure_name === 'string' && b.procedure_name.trim()
        ? b.procedure_name.trim()
        : srcRows[0].procedure_name;
    if (!proc || typeof proc !== 'string') {
      return res.status(400).json({ error: 'bad_request' });
    }

    const visitRows = await sql`
      INSERT INTO visits (
        salon_id, client_id, visit_date, procedure_name, chair_label, notes, source
      )
      VALUES (
        ${sid},
        ${cid},
        ${vd}::date,
        ${proc},
        ${srcRows[0].chair_label || null},
        ${srcRows[0].notes || null},
        ${'manual'}
      )
      RETURNING id
    `;
    const visitId = visitRows[0].id;

    for (const line of lines) {
      const amount = Number(line.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'bad_request' });
      }
      await sql`
        INSERT INTO formula_lines (visit_id, section, brand, shade_code, amount, inventory_item_id)
        VALUES (
          ${visitId},
          ${line.section}::formula_section,
          ${String(line.brand)},
          ${String(line.shade_code || '-')},
          ${amount},
          NULL
        )
      `;
    }

    res.status(201).json({ id: visitId });
  } catch (e) {
    next(e);
  }
});

app.get('/api/lab/templates', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;
    const rows = await sql`
      SELECT
        id,
        name,
        created_at,
        jsonb_array_length(lines)::int AS line_count
      FROM lab_formula_templates
      WHERE salon_id = ${sid}
      ORDER BY created_at DESC
      LIMIT 80
    `;
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        line_count: r.line_count,
        created_at: r.created_at,
      })),
    );
  } catch (e) {
    next(e);
  }
});

app.post('/api/lab/templates', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;
    const uid = req.auth.userId;
    const b = req.body || {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const linesIn = b.lines;
    if (!name || !Array.isArray(linesIn) || linesIn.length === 0) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const clean = [];
    for (const line of linesIn) {
      if (!line || typeof line.section !== 'string' || !FORMULA_SECTIONS.has(line.section)) {
        return res.status(400).json({ error: 'bad_request' });
      }
      if (!line.brand || line.amount == null) {
        return res.status(400).json({ error: 'bad_request' });
      }
      const amount = Number(line.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'bad_request' });
      }
      clean.push({
        section: line.section,
        brand: String(line.brand),
        shade_code: line.shade_code != null && line.shade_code !== '' ? String(line.shade_code) : '-',
        amount,
      });
    }

    const ins = await sql`
      INSERT INTO lab_formula_templates (salon_id, staff_id, name, lines)
      VALUES (${sid}, ${uid}, ${name}, ${JSON.stringify(clean)}::jsonb)
      RETURNING id
    `;
    res.status(201).json({ id: ins[0].id });
  } catch (e) {
    next(e);
  }
});

app.post('/api/lab/templates/from-visit', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;
    const uid = req.auth.userId;
    const b = req.body || {};
    const vid = Number(b.visit_id);
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!Number.isFinite(vid) || vid < 1 || !name) {
      return res.status(400).json({ error: 'bad_request' });
    }

    const ok = await sql`
      SELECT v.id
      FROM visits v
      JOIN clients c ON c.id = v.client_id AND c.salon_id = ${sid}
      WHERE v.id = ${vid} AND v.salon_id = ${sid}
      LIMIT 1
    `;
    if (!ok.length) {
      return res.status(404).json({ error: 'not_found' });
    }

    const lines = await sql`
      SELECT section, brand, shade_code, amount
      FROM formula_lines
      WHERE visit_id = ${vid}
      ORDER BY id
    `;
    if (!lines.length) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const clean = lines.map((line) => ({
      section: String(line.section),
      brand: String(line.brand),
      shade_code: line.shade_code != null ? String(line.shade_code) : '-',
      amount: Number(line.amount),
    }));

    const ins = await sql`
      INSERT INTO lab_formula_templates (salon_id, staff_id, name, lines)
      VALUES (${sid}, ${uid}, ${name}, ${JSON.stringify(clean)}::jsonb)
      RETURNING id
    `;
    res.status(201).json({ id: ins[0].id });
  } catch (e) {
    next(e);
  }
});

app.post('/api/lab/templates/:id/apply', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;
    const tid = Number(req.params.id);
    const b = req.body || {};
    const cid = Number(b.client_id);
    if (!Number.isFinite(tid) || tid < 1 || !Number.isFinite(cid) || cid < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }

    const tpl = await sql`
      SELECT lines FROM lab_formula_templates
      WHERE id = ${tid} AND salon_id = ${sid}
      LIMIT 1
    `;
    if (!tpl.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const linesIn = tpl[0].lines;
    if (!Array.isArray(linesIn) || linesIn.length === 0) {
      return res.status(400).json({ error: 'bad_request' });
    }

    const clientRow = await sql`
      SELECT id FROM clients WHERE id = ${cid} AND salon_id = ${sid} LIMIT 1
    `;
    if (!clientRow.length) {
      return res.status(400).json({ error: 'bad_request' });
    }

    let vd;
    if (typeof b.visit_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.visit_date)) {
      vd = b.visit_date;
    } else {
      const todayRow = await sql`
        SELECT to_char((now() AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS y
      `;
      vd = String(todayRow[0].y);
    }

    const proc =
      typeof b.procedure_name === 'string' && b.procedure_name.trim() ? b.procedure_name.trim() : 'Formula';
    if (!proc) {
      return res.status(400).json({ error: 'bad_request' });
    }

    const visitRows = await sql`
      INSERT INTO visits (
        salon_id, client_id, visit_date, procedure_name, chair_label, notes, source
      )
      VALUES (${sid}, ${cid}, ${vd}::date, ${proc}, ${null}, ${null}, ${'manual'})
      RETURNING id
    `;
    const visitId = visitRows[0].id;

    for (const line of linesIn) {
      if (
        !line ||
        typeof line.section !== 'string' ||
        !FORMULA_SECTIONS.has(line.section) ||
        !line.brand ||
        line.amount == null
      ) {
        return res.status(400).json({ error: 'bad_request' });
      }
      const amount = Number(line.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'bad_request' });
      }
      await sql`
        INSERT INTO formula_lines (visit_id, section, brand, shade_code, amount, inventory_item_id)
        VALUES (
          ${visitId},
          ${line.section}::formula_section,
          ${String(line.brand)},
          ${String(line.shade_code || '-')},
          ${amount},
          NULL
        )
      `;
    }

    res.status(201).json({ id: visitId });
  } catch (e) {
    next(e);
  }
});

const FINANCE_EXPENSE_CATEGORIES = new Set([
  'rent',
  'utilities',
  'salary',
  'supplies',
  'inventory',
  'equipment',
  'marketing',
  'taxes',
  'other',
]);

const FINANCE_EXPENSE_ALLOCATIONS = new Set(['one_time', 'fixed_monthly']);

function parseFinanceDate(q) {
  const raw = typeof q === 'string' ? q.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function parsePositiveCents(v) {
  if (v == null || v === '') return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) return null;
  return n;
}

function daysInCalendarMonthYmd(dateYmd) {
  const [y, m] = dateYmd.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return 30;
  return new Date(y, m, 0).getDate();
}

function parseExpenseAllocation(raw) {
  if (raw == null || raw === '') return 'one_time';
  const s = String(raw).trim();
  return FINANCE_EXPENSE_ALLOCATIONS.has(s) ? s : null;
}

app.get('/api/finance/summary', async (req, res, next) => {
  try {
    const dateYmd = parseFinanceDate(req.query.date);
    if (!dateYmd) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const sid = req.auth.salonId;
    const dim = daysInCalendarMonthYmd(dateYmd);
    const [svc, retail, oneTimeExp, fixedMonth, svcSplit, retailCount, expCountOne, expCountFixed] =
      await Promise.all([
      sql`
        SELECT COALESCE(SUM(amount_paid_cents), 0)::bigint AS s
        FROM visits
        WHERE salon_id = ${sid} AND visit_date = ${dateYmd}::date
      `,
      sql`
        SELECT COALESCE(SUM(amount_cents), 0)::bigint AS s
        FROM salon_product_sales
        WHERE salon_id = ${sid} AND sale_date = ${dateYmd}::date
      `,
      sql`
        SELECT COALESCE(SUM(amount_cents), 0)::bigint AS s
        FROM salon_expenses
        WHERE salon_id = ${sid}
          AND expense_date = ${dateYmd}::date
          AND COALESCE(allocation, 'one_time') = 'one_time'
      `,
      sql`
        SELECT COALESCE(SUM(amount_cents), 0)::bigint AS s
        FROM salon_expenses
        WHERE salon_id = ${sid}
          AND COALESCE(allocation, 'one_time') = 'fixed_monthly'
          AND date_trunc('month', expense_date) = date_trunc('month', ${dateYmd}::date)
      `,
      sql`
        SELECT
          COUNT(*) FILTER (
            WHERE COALESCE(amount_paid_cents, 0) > 0 AND appointment_id IS NOT NULL
          )::int AS from_bookings,
          COUNT(*) FILTER (
            WHERE COALESCE(amount_paid_cents, 0) > 0 AND appointment_id IS NULL
          )::int AS from_walkins
        FROM visits
        WHERE salon_id = ${sid} AND visit_date = ${dateYmd}::date
      `,
      sql`
        SELECT COUNT(*)::int AS c
        FROM salon_product_sales
        WHERE salon_id = ${sid} AND sale_date = ${dateYmd}::date
      `,
      sql`
        SELECT COUNT(*)::int AS c
        FROM salon_expenses
        WHERE salon_id = ${sid}
          AND expense_date = ${dateYmd}::date
          AND COALESCE(allocation, 'one_time') = 'one_time'
      `,
      sql`
        SELECT COUNT(*)::int AS c
        FROM salon_expenses
        WHERE salon_id = ${sid}
          AND COALESCE(allocation, 'one_time') = 'fixed_monthly'
          AND date_trunc('month', expense_date) = date_trunc('month', ${dateYmd}::date)
      `,
    ]);
    const service_income_cents = Number(svc[0]?.s || 0);
    const product_sales_cents = Number(retail[0]?.s || 0);
    const oneTimeCents = Number(oneTimeExp[0]?.s || 0);
    const fixedMonthCents = Number(fixedMonth[0]?.s || 0);
    const fixedDailyCents = dim > 0 ? Math.round(fixedMonthCents / dim) : 0;
    const expenses_cents = oneTimeCents + fixedDailyCents;
    const net_cents = service_income_cents + product_sales_cents - expenses_cents;
    const service_income_booking_count = Number(svcSplit[0]?.from_bookings ?? 0);
    const service_income_walkin_count = Number(svcSplit[0]?.from_walkins ?? 0);
    const product_sales_line_count = Number(retailCount[0]?.c ?? 0);
    const expense_line_count = Number(expCountOne[0]?.c ?? 0) + Number(expCountFixed[0]?.c ?? 0);
    res.json({
      date: dateYmd,
      service_income_cents,
      product_sales_cents,
      expenses_cents,
      net_cents,
      service_income_booking_count,
      service_income_walkin_count,
      product_sales_line_count,
      expense_line_count,
    });
  } catch (e) {
    next(e);
  }
});

app.get('/api/finance/lines', async (req, res, next) => {
  try {
    const dateYmd = parseFinanceDate(req.query.date);
    if (!dateYmd) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const sid = req.auth.salonId;
    const [expenses, product_sales] = await Promise.all([
      sql`
        SELECT id, category, title, amount_cents, notes, created_at, COALESCE(allocation, 'one_time') AS allocation
        FROM salon_expenses
        WHERE salon_id = ${sid}
          AND (
            (expense_date = ${dateYmd}::date AND COALESCE(allocation, 'one_time') = 'one_time')
            OR (
              COALESCE(allocation, 'one_time') = 'fixed_monthly'
              AND date_trunc('month', expense_date) = date_trunc('month', ${dateYmd}::date)
            )
          )
        ORDER BY id DESC
      `,
      sql`
        SELECT
          ps.id, ps.description, ps.quantity, ps.amount_cents,
          ps.inventory_item_id, ps.client_id, ps.client_name_snapshot, ps.created_at,
          c.full_name AS client_full_name,
          ii.name AS item_name
        FROM salon_product_sales ps
        LEFT JOIN clients c ON c.id = ps.client_id
        LEFT JOIN inventory_items ii ON ii.id = ps.inventory_item_id
        WHERE ps.salon_id = ${sid} AND ps.sale_date = ${dateYmd}::date
        ORDER BY ps.id DESC
      `,
    ]);
    res.json({ expenses, product_sales });
  } catch (e) {
    next(e);
  }
});

app.post('/api/finance/expenses', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;
    const b = req.body || {};
    const dateYmd =
      typeof b.expense_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.expense_date.trim())
        ? b.expense_date.trim()
        : null;
    const category = typeof b.category === 'string' ? b.category.trim() : '';
    if (!dateYmd || !FINANCE_EXPENSE_CATEGORIES.has(category)) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const amount_cents = parsePositiveCents(b.amount_cents);
    if (amount_cents == null) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 240) : '';
    const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 500) || null : null;
    const allocation = parseExpenseAllocation(b.allocation);
    if (allocation == null) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const rows = await sql`
      INSERT INTO salon_expenses (salon_id, expense_date, category, title, amount_cents, allocation, notes)
      VALUES (${sid}, ${dateYmd}::date, ${category}, ${title}, ${amount_cents}, ${allocation}, ${notes})
      RETURNING id
    `;
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    next(e);
  }
});

app.post('/api/finance/product-sales', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;
    const b = req.body || {};
    const dateYmd =
      typeof b.sale_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.sale_date.trim())
        ? b.sale_date.trim()
        : null;
    if (!dateYmd) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const amount_cents = parsePositiveCents(b.amount_cents);
    if (amount_cents == null) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const description = typeof b.description === 'string' ? b.description.trim().slice(0, 240) : '';
    let qty = 1;
    if (b.quantity != null && b.quantity !== '') {
      const qn = Number(b.quantity);
      if (Number.isFinite(qn) && qn > 0 && qn <= 1e6) {
        qty = qn;
      }
    }
    let invId = null;
    if (b.inventory_item_id != null && b.inventory_item_id !== '') {
      const iid = Math.round(Number(b.inventory_item_id));
      if (!Number.isFinite(iid) || iid < 1) {
        return res.status(400).json({ error: 'bad_request' });
      }
      const inv = await sql`
        SELECT id FROM inventory_items WHERE id = ${iid} AND salon_id = ${sid} LIMIT 1
      `;
      if (!inv.length) {
        return res.status(400).json({ error: 'bad_request' });
      }
      invId = iid;
    }
    let clientId = null;
    let clientNameSnapshot = null;
    if (b.client_id != null && b.client_id !== '') {
      const cid = Math.round(Number(b.client_id));
      if (Number.isFinite(cid) && cid > 0) {
        const cl = await sql`SELECT id, full_name FROM clients WHERE id = ${cid} AND salon_id = ${sid} LIMIT 1`;
        if (cl.length) { clientId = cid; clientNameSnapshot = cl[0].full_name; }
      }
    }
    const rows = await sql`
      INSERT INTO salon_product_sales (salon_id, sale_date, inventory_item_id, description, quantity, amount_cents, client_id, client_name_snapshot)
      VALUES (${sid}, ${dateYmd}::date, ${invId}, ${description}, ${qty}, ${amount_cents}, ${clientId}, ${clientNameSnapshot})
      RETURNING id
    `;
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/finance/expenses/:id', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;
    const id = Math.round(Number(req.params.id));
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const del = await sql`
      DELETE FROM salon_expenses WHERE id = ${id} AND salon_id = ${sid} RETURNING id
    `;
    if (!del.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

app.delete('/api/finance/product-sales/:id', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;
    const id = Math.round(Number(req.params.id));
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const del = await sql`
      DELETE FROM salon_product_sales WHERE id = ${id} AND salon_id = ${sid} RETURNING id
    `;
    if (!del.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ─── Affiliate system ────────────────────────────────────────────────────────

const AFFILIATE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function generateUniqueAffiliateCode(sql) {
  for (let i = 0; i < 10; i++) {
    let code = '';
    for (let j = 0; j < 8; j++) {
      code += AFFILIATE_CODE_CHARS[Math.floor(Math.random() * AFFILIATE_CODE_CHARS.length)];
    }
    const existing = await sql`SELECT id FROM affiliates WHERE affiliate_code = ${code}`;
    if (!existing.length) return code;
  }
  throw new Error('Could not generate unique affiliate code after 10 attempts');
}

// GET /api/affiliates — list all affiliate codes for the salon (admin only)
app.get('/api/affiliates', async (req, res, next) => {
  try {
    if (req.auth.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const sql = getSql();
    const rows = await sql`
      SELECT
        a.*,
        COUNT(r.id)::int                                                AS total_referrals,
        COUNT(r.id) FILTER (WHERE r.status = 'active_subscriber')::int  AS active_referrals
      FROM affiliates a
      LEFT JOIN referrals r ON r.affiliate_id = a.id
      WHERE a.salon_id = ${req.auth.salonId}
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `;
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// POST /api/affiliates — create affiliate code for an influencer (admin only)
app.post('/api/affiliates', async (req, res, next) => {
  try {
    if (req.auth.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const influencerName = String((req.body || {}).influencer_name || '').trim();
    if (!influencerName) return res.status(400).json({ error: 'influencer_name is required' });
    const sql = getSql();
    const code = await generateUniqueAffiliateCode(sql);
    const [affiliate] = await sql`
      INSERT INTO affiliates (affiliate_code, salon_id, owner_staff_id, influencer_name, commission_rate)
      VALUES (${code}, ${req.auth.salonId}, ${req.auth.userId}, ${influencerName}, 0.20)
      RETURNING *
    `;
    res.status(201).json(affiliate);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/affiliates/:id — remove an affiliate code (admin only)
app.delete('/api/affiliates/:id', async (req, res, next) => {
  try {
    if (req.auth.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const sql = getSql();
    const del = await sql`
      DELETE FROM affiliates WHERE id = ${req.params.id} AND salon_id = ${req.auth.salonId} RETURNING id
    `;
    if (!del.length) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// GET /api/affiliates/report?from=YYYY-MM-DD&to=YYYY-MM-DD — weekly earnings report (admin only)
app.get('/api/affiliates/report', async (req, res, next) => {
  try {
    if (req.auth.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const sql = getSql();

    const toDate = req.query.to
      ? new Date(String(req.query.to))
      : new Date();
    const fromDate = req.query.from
      ? new Date(String(req.query.from))
      : new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ error: 'invalid date range' });
    }

    const rows = await sql`
      SELECT
        a.id,
        a.affiliate_code,
        a.influencer_name,
        a.commission_rate,
        a.total_earnings_cents,
        COUNT(r.id) FILTER (WHERE r.status = 'active_subscriber')::int          AS total_active,
        COUNT(r.id) FILTER (WHERE r.created_at >= ${fromDate} AND r.created_at <= ${toDate})::int
                                                                                 AS week_new_referrals,
        COUNT(r.id) FILTER (
          WHERE r.credited_at >= ${fromDate} AND r.credited_at <= ${toDate}
        )::int                                                                   AS week_new_subscribers,
        COALESCE(SUM(r.credited_cents) FILTER (
          WHERE r.credited_at >= ${fromDate} AND r.credited_at <= ${toDate}
        ), 0)::bigint                                                            AS week_earnings_cents
      FROM affiliates a
      LEFT JOIN referrals r ON r.affiliate_id = a.id
      WHERE a.salon_id = ${req.auth.salonId}
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `;
    res.json({ from: fromDate.toISOString(), to: toDate.toISOString(), affiliates: rows });
  } catch (e) {
    next(e);
  }
});

// POST /api/webhooks/revenuecat — RevenueCat purchase webhook (no auth, verified by secret)
app.post('/api/webhooks/revenuecat', async (req, res, next) => {
  try {
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (secret) {
      const authHeader = req.headers['authorization'] || '';
      if (authHeader !== secret) {
        return res.status(401).json({ error: 'unauthorized' });
      }
    }

    const event = req.body && req.body.event;
    if (!event) return res.status(400).json({ error: 'missing_event' });

    // Only credit on initial purchases — renewals can be added later
    if (event.type !== 'INITIAL_PURCHASE') {
      return res.status(200).json({ received: true, skipped: true });
    }

    const affiliateCode = event.subscriber_attributes?.affiliate_id?.value
      ?? event.subscriber_attributes?.affiliate_id?.$value;
    if (!affiliateCode) return res.status(200).json({ received: true, skipped: true });

    const appUserId = String(event.app_user_id || '').trim();
    if (!appUserId) return res.status(400).json({ error: 'missing_app_user_id' });

    const sql = getSql();
    const [affiliate] = await sql`
      SELECT id, commission_rate FROM affiliates WHERE affiliate_code = ${String(affiliateCode).trim().toUpperCase()}
    `;
    if (!affiliate) return res.status(200).json({ received: true, skipped: true });

    const priceInCents = Math.round((Number(event.price_in_purchased_currency) || 0) * 100);
    const commissionCents = Math.round(priceInCents * Number(affiliate.commission_rate));

    // Atomic CTE: insert/update referral AND increment affiliate earnings in one statement.
    // The DO UPDATE WHERE referrals.credited_cents = 0 ensures earnings are credited only once:
    // - New referral  → INSERT succeeds, CTE returns affiliate_id → affiliate updated.
    // - Retry/dup     → conflict but credited_cents > 0 → DO NOTHING → CTE returns nothing → no double-credit.
    await sql`
      WITH credit AS (
        INSERT INTO referrals (affiliate_id, revenuecat_user_id, status, credited_cents, credited_at)
        VALUES (${affiliate.id}, ${appUserId}, 'active_subscriber', ${commissionCents}, NOW())
        ON CONFLICT (revenuecat_user_id) DO UPDATE
          SET status         = 'active_subscriber',
              credited_cents = EXCLUDED.credited_cents,
              credited_at    = NOW()
          WHERE referrals.credited_cents = 0
        RETURNING affiliate_id
      )
      UPDATE affiliates
         SET total_earnings_cents = total_earnings_cents + ${commissionCents}
        FROM credit
       WHERE affiliates.id = credit.affiliate_id
    `;

    res.status(200).json({ received: true });
  } catch (e) {
    next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────

app.use((req, res) => {
  const orig = String(req.originalUrl || req.url || '');
  if (!orig.startsWith('/api')) {
    res.status(404).type('text/plain').send('Not found');
    return;
  }
  res.status(404).json({
    error: 'not_found',
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    url: req.url,
  });
});

app.use((err, req, res, next) => {
  const method = req.method;
  const url = req.originalUrl || req.url;
  console.error(
    '[ColorTrack API error]',
    JSON.stringify({
      method,
      url,
      message: err && err.message,
      code: err && err.code,
      name: err && err.name,
    }),
  );
  if (err && err.stack) {
    console.error(err.stack);
  } else {
    console.error(err);
  }
  if (res.headersSent) {
    return next(err);
  }
  const { status, body } = jsonForError(err);
  res.status(status).json(body);
});

let initPromise = null;

function ensureInitialized() {
  if (!initPromise) {
    initPromise = (async () => {
      if (!process.env.DATABASE_URL) {
        const err = new Error('DATABASE_URL is not set');
        err.statusCode = 503;
        err.code = 'missing_database_url';
        err.expose = true;
        throw err;
      }
      await ensureSchema(getSql());
      await ensureBootstrapStaff(getSql());
    })().catch((e) => {
      // Reset so the next request retries init instead of permanently failing
      initPromise = null;
      throw e;
    });
  }
  return initPromise;
}

if (require.main === module) {
  ensureInitialized()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`ColorTrack API listening on http://localhost:${PORT}`);
      });
    })
    .catch((e) => {
      console.error('Failed to ensure database schema:', e.message || e);
      process.exit(1);
    });
}

module.exports = { app, ensureInitialized };
