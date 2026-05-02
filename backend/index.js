const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const { neon } = require('@neondatabase/serverless');
const { ensureSchema } = require('./schemaEnsure');
const r2 = require('./r2');
const { authMiddleware, ensureBootstrapStaff, loginHandler, registerHandler, appleAuthHandler } = require('./auth');
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
  if (req.path.startsWith('/api')) return authMiddleware(req, res, next);
  return next();
}

app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));
app.use(authGate);

app.post('/api/auth/register', async (req, res, next) => {
  try {
    await registerHandler(getSql(), req, res);
  } catch (e) {
    next(e);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    await loginHandler(getSql(), req, res);
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
    if (!Object.prototype.hasOwnProperty.call(b, 'display_name')) {
      return res.status(400).json({ error: 'bad_request' });
    }
    let displayNamePayload;
    if (b.display_name === null) {
      displayNamePayload = null;
    } else {
      const sanitized = sanitizeStaffDisplayName(b.display_name);
      displayNamePayload = sanitized && sanitized.length ? sanitized : null;
    }
    const sql = getSql();
    const rows = await sql`
      UPDATE staff
      SET display_name = ${displayNamePayload}
      WHERE id = ${req.auth.userId} AND salon_id = ${req.auth.salonId}
      RETURNING id, email, display_name, avatar_url, role
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

app.get('/api/inventory', async (req, res, next) => {
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT
        id,
        name,
        category,
        brand,
        shade_code,
        unit,
        quantity,
        low_stock_threshold,
        price_per_unit_cents,
        supplier_hint,
        (quantity <= low_stock_threshold) AS is_low_stock
      FROM inventory_items
      WHERE salon_id = ${req.auth.salonId}
      ORDER BY category, brand NULLS LAST, name
    `;
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

const INVENTORY_UNITS = new Set(['g', 'ml', 'pcs']);
const INVENTORY_CATEGORY_MAX = 80;

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
    const supplier_hint =
      typeof b.supplier_hint === 'string' && b.supplier_hint.trim()
        ? String(b.supplier_hint).trim().slice(0, 200)
        : null;

    const sql = getSql();
    const rows = await sql`
      INSERT INTO inventory_items (
        salon_id,
        name,
        category,
        brand,
        shade_code,
        unit,
        quantity,
        low_stock_threshold,
        supplier_hint
      )
      VALUES (
        ${req.auth.salonId},
        ${name},
        ${category},
        ${brand},
        ${shade_code},
        ${unit},
        ${quantity},
        ${low_stock_threshold},
        ${supplier_hint}
      )
      RETURNING
        id,
        name,
        category,
        brand,
        shade_code,
        unit,
        quantity,
        low_stock_threshold,
        price_per_unit_cents,
        supplier_hint,
        (quantity <= low_stock_threshold) AS is_low_stock
    `;
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

app.get('/api/inventory/:id/movements', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
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
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const rows = await sql`
      SELECT
        id,
        name,
        category,
        brand,
        shade_code,
        unit,
        quantity,
        low_stock_threshold,
        price_per_unit_cents,
        supplier_hint,
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
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const existing = await sql`
      SELECT id, quantity, low_stock_threshold
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
      SET quantity = ${newQty}, low_stock_threshold = ${newThresh}
      WHERE id = ${id} AND salon_id = ${req.auth.salonId}
      RETURNING
        id,
        name,
        category,
        brand,
        shade_code,
        unit,
        quantity,
        low_stock_threshold,
        price_per_unit_cents,
        supplier_hint,
        (quantity <= low_stock_threshold) AS is_low_stock
    `;
    res.json(updated[0]);
  } catch (e) {
    next(e);
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
      SELECT id, section, brand, shade_code, amount, inventory_item_id
      FROM formula_lines
      WHERE visit_id = ${id}
      ORDER BY id
    `;
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
    });
  } catch (e) {
    next(e);
  }
});

app.get('/api/lab/stats', async (req, res, next) => {
  try {
    const sql = getSql();
    const sid = req.auth.salonId;
    const row = await sql`
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
    `;
    res.json({ visits_with_formula_this_month: row[0]?.visits_with_formula_this_month ?? 0 });
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

app.get('/api/finance/summary', async (req, res, next) => {
  try {
    const dateYmd = parseFinanceDate(req.query.date);
    if (!dateYmd) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const sql = getSql();
    const sid = req.auth.salonId;
    const [svc, retail, exp] = await Promise.all([
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
        WHERE salon_id = ${sid} AND expense_date = ${dateYmd}::date
      `,
    ]);
    const service_income_cents = Number(svc[0]?.s || 0);
    const product_sales_cents = Number(retail[0]?.s || 0);
    const expenses_cents = Number(exp[0]?.s || 0);
    const net_cents = service_income_cents + product_sales_cents - expenses_cents;
    res.json({
      date: dateYmd,
      service_income_cents,
      product_sales_cents,
      expenses_cents,
      net_cents,
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
        SELECT id, category, title, amount_cents, notes, created_at
        FROM salon_expenses
        WHERE salon_id = ${sid} AND expense_date = ${dateYmd}::date
        ORDER BY id DESC
      `,
      sql`
        SELECT id, description, quantity, amount_cents, inventory_item_id, created_at
        FROM salon_product_sales
        WHERE salon_id = ${sid} AND sale_date = ${dateYmd}::date
        ORDER BY id DESC
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
    const rows = await sql`
      INSERT INTO salon_expenses (salon_id, expense_date, category, title, amount_cents, notes)
      VALUES (${sid}, ${dateYmd}::date, ${category}, ${title}, ${amount_cents}, ${notes})
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
    const rows = await sql`
      INSERT INTO salon_product_sales (salon_id, sale_date, inventory_item_id, description, quantity, amount_cents)
      VALUES (${sid}, ${dateYmd}::date, ${invId}, ${description}, ${qty}, ${amount_cents})
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
    })();
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
