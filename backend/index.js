const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const { neon } = require('@neondatabase/serverless');
const { ensureSchema } = require('./schemaEnsure');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    const err = new Error('DATABASE_URL is not set');
    err.statusCode = 503;
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
      return res.status(503).json({ ok: false, db: false, message: e.message });
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

async function buildDashboard(sql, dateYmd) {
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
      ORDER BY quantity ASC NULLS FIRST
      LIMIT 8
    `;

  const upcoming = appointments[0] || null;
  const extraClientCount = appointments.length > maxAvatars ? appointments.length - maxAvatars : 0;

  return {
    bannerAvatars: avatars,
    extraClientCount,
    upcoming,
    lowStockPreview: lowStock[0] || null,
    lowStockCount: lowStock.length,
  };
}

app.get('/api/dashboard/today', async (req, res, next) => {
  try {
    const sql = getSql();
    const todayRow = await sql`
      SELECT to_char((now() AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS ymd
    `;
    const ymd = String(todayRow[0].ymd);
    const body = await buildDashboard(sql, ymd);
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
      return res.status(400).json({ message: 'Query ?date=YYYY-MM-DD is required' });
    }
    const sql = getSql();
    const body = await buildDashboard(sql, raw);
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
      WHERE
        full_name ILIKE ${pattern}
        OR phone ILIKE ${pattern}
        OR COALESCE(email, '') ILIKE ${pattern}
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
      return res.status(400).json({ message: 'full_name is required' });
    }
    let patchDate = null;
    if (b.last_patch_test_at != null && b.last_patch_test_at !== '') {
      const s = String(b.last_patch_test_at);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return res.status(400).json({ message: 'last_patch_test_at must be YYYY-MM-DD' });
      }
      patchDate = s;
    }
    const rows = await sql`
      INSERT INTO clients (full_name, phone, email, avatar_url, notes, last_patch_test_at)
      VALUES (
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
      return res.status(400).json({ message: 'Invalid client id' });
    }
    const sql = getSql();
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
      WHERE id = ${id}
      LIMIT 1
    `;
    if (!clients.length) {
      return res.status(404).json({ message: 'Client not found' });
    }
    const visits = await sql`
      SELECT id, visit_date, procedure_name, chair_label, notes, created_at
      FROM visits
      WHERE client_id = ${id}
      ORDER BY visit_date DESC, id DESC
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
    res.json({ ...clients[0], visits: visitsWithFormula });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/clients/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'Invalid client id' });
    }
    const sql = getSql();
    const existing = await sql`
      SELECT id, full_name, phone, email, avatar_url, notes, last_patch_test_at
      FROM clients
      WHERE id = ${id}
      LIMIT 1
    `;
    if (!existing.length) {
      return res.status(404).json({ message: 'Client not found' });
    }
    const row = existing[0];
    const b = req.body || {};

    const full_name =
      typeof b.full_name === 'string'
        ? b.full_name.trim()
        : row.full_name;
    if (!full_name) {
      return res.status(400).json({ message: 'full_name cannot be empty' });
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
          return res.status(400).json({ message: 'last_patch_test_at must be YYYY-MM-DD or empty' });
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
      WHERE id = ${id}
      RETURNING id, full_name, phone, email, avatar_url, notes, last_patch_test_at, created_at
    `;
    res.json(updated[0]);
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
      return res.status(400).json({ message: 'name is required' });
    }
    const category = typeof b.category === 'string' ? b.category.trim() : '';
    if (!category || category.length > INVENTORY_CATEGORY_MAX) {
      return res.status(400).json({
        message: `category is required (max ${INVENTORY_CATEGORY_MAX} characters)`,
      });
    }
    const unit = typeof b.unit === 'string' ? b.unit.trim() : '';
    if (!INVENTORY_UNITS.has(unit)) {
      return res.status(400).json({ message: 'unit must be g, ml, or pcs' });
    }
    const quantity = Number(b.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      return res.status(400).json({ message: 'quantity must be a non-negative number' });
    }
    const low_stock_threshold = Number(b.low_stock_threshold);
    if (!Number.isFinite(low_stock_threshold) || low_stock_threshold < 0) {
      return res.status(400).json({ message: 'low_stock_threshold must be a non-negative number' });
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
      return res.status(400).json({ message: 'Invalid inventory id' });
    }
    const sql = getSql();
    const item = await sql`SELECT id FROM inventory_items WHERE id = ${id} LIMIT 1`;
    if (!item.length) {
      return res.status(404).json({ message: 'Item not found' });
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
      return res.status(400).json({ message: 'Invalid inventory id' });
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
      WHERE id = ${id}
      LIMIT 1
    `;
    if (!rows.length) {
      return res.status(404).json({ message: 'Item not found' });
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
      return res.status(400).json({ message: 'Invalid inventory id' });
    }
    const sql = getSql();
    const existing = await sql`
      SELECT id, quantity, low_stock_threshold
      FROM inventory_items
      WHERE id = ${id}
      LIMIT 1
    `;
    if (!existing.length) {
      return res.status(404).json({ message: 'Item not found' });
    }
    const cur = existing[0];
    const b = req.body || {};

    let newQty = Number(cur.quantity);
    if (b.quantity !== undefined && b.quantity !== null) {
      const q = Number(b.quantity);
      if (!Number.isFinite(q) || q < 0) {
        return res.status(400).json({ message: 'quantity must be a non-negative number' });
      }
      newQty = q;
    }

    let newThresh = Number(cur.low_stock_threshold);
    if (b.low_stock_threshold !== undefined && b.low_stock_threshold !== null) {
      const t = Number(b.low_stock_threshold);
      if (!Number.isFinite(t) || t < 0) {
        return res.status(400).json({ message: 'low_stock_threshold must be a non-negative number' });
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
      WHERE id = ${id}
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
      return res.status(400).json({ message: 'Query ?date=YYYY-MM-DD is required' });
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
        to_char((a.start_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS day_local,
        to_char((a.start_at AT TIME ZONE ${TZ}), 'HH24:MI') AS start_local,
        to_char((a.end_at AT TIME ZONE ${TZ}), 'HH24:MI') AS end_local
      FROM appointments a
      LEFT JOIN clients c ON c.id = a.client_id
      WHERE (a.start_at AT TIME ZONE ${TZ})::date = ${raw}::date
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
      return res.status(400).json({ message: 'title is required' });
    }
    const dateStr = typeof b.date === 'string' ? b.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ message: 'date must be YYYY-MM-DD' });
    }
    const startNorm = normalizeHM(b.start_time);
    const endNorm = normalizeHM(b.end_time);
    if (!startNorm || !endNorm) {
      return res.status(400).json({ message: 'start_time and end_time must be HH:MM' });
    }
    const startT = startNorm.slice(0, 5);
    const endT = endNorm.slice(0, 5);
    if (endT <= startT) {
      return res.status(400).json({ message: 'end_time must be after start_time' });
    }

    let clientId = null;
    if (b.client_id != null && b.client_id !== '') {
      const cid = Number(b.client_id);
      if (!Number.isFinite(cid) || cid < 1) {
        return res.status(400).json({ message: 'Invalid client_id' });
      }
      const ck = await sql`SELECT id FROM clients WHERE id = ${cid} LIMIT 1`;
      if (!ck.length) {
        return res.status(400).json({ message: 'Client not found' });
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
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

app.patch('/api/appointments/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: 'Invalid appointment id' });
    }
    const sql = getSql();
    const existing = await sql`
      SELECT id, client_id, title, procedure_name, start_at, end_at, chair_label, notes, source
      FROM appointments
      WHERE id = ${id}
      LIMIT 1
    `;
    if (!existing.length) {
      return res.status(404).json({ message: 'Appointment not found' });
    }
    const row = existing[0];
    const b = req.body || {};

    const title =
      typeof b.title === 'string' ? b.title.trim() : row.title;
    if (!title) {
      return res.status(400).json({ message: 'title cannot be empty' });
    }

    let clientId = row.client_id;
    if (Object.prototype.hasOwnProperty.call(b, 'client_id')) {
      if (b.client_id === null || b.client_id === '') {
        clientId = null;
      } else {
        const cid = Number(b.client_id);
        if (!Number.isFinite(cid) || cid < 1) {
          return res.status(400).json({ message: 'Invalid client_id' });
        }
        const ck = await sql`SELECT id FROM clients WHERE id = ${cid} LIMIT 1`;
        if (!ck.length) {
          return res.status(400).json({ message: 'Client not found' });
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
      WHERE id = ${id}
      LIMIT 1
    `;
    let dateStr = meta[0].d;
    let startT = meta[0].st;
    let endT = meta[0].en;

    if (b.date !== undefined) {
      const ds = typeof b.date === 'string' ? b.date.trim() : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
        return res.status(400).json({ message: 'date must be YYYY-MM-DD' });
      }
      dateStr = ds;
    }
    if (b.start_time !== undefined) {
      const sn = normalizeHM(b.start_time);
      if (!sn) {
        return res.status(400).json({ message: 'start_time must be HH:MM' });
      }
      startT = sn.slice(0, 5);
    }
    if (b.end_time !== undefined) {
      const en = normalizeHM(b.end_time);
      if (!en) {
        return res.status(400).json({ message: 'end_time must be HH:MM' });
      }
      endT = en.slice(0, 5);
    }
    if (endT <= startT) {
      return res.status(400).json({ message: 'end_time must be after start_time' });
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
      WHERE id = ${id}
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
      return res.status(400).json({ message: 'Invalid appointment id' });
    }
    const sql = getSql();
    const del = await sql`
      DELETE FROM appointments
      WHERE id = ${id}
      RETURNING id
    `;
    if (!del.length) {
      return res.status(404).json({ message: 'Appointment not found' });
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
      return res.status(400).json({ message: 'from and to YYYY-MM-DD required' });
    }
    const sql = getSql();
    const rows = await sql`
      SELECT DISTINCT to_char((start_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS d
      FROM appointments
      WHERE (start_at AT TIME ZONE ${TZ})::date >= ${from}::date
        AND (start_at AT TIME ZONE ${TZ})::date <= ${to}::date
      ORDER BY 1
    `;
    const days = rows.map((r) => String(r.d));
    res.json(days);
  } catch (e) {
    next(e);
  }
});

const FORMULA_SECTIONS = new Set(['roots', 'lengths', 'toner', 'other']);

app.post('/api/visits', async (req, res, next) => {
  try {
    const sql = getSql();
    const { client_id, visit_date, procedure_name, chair_label, notes, lines } = req.body || {};

    const cid = Number(client_id);
    if (!Number.isFinite(cid) || cid < 1) {
      return res.status(400).json({ message: 'client_id is required' });
    }
    if (!procedure_name || typeof procedure_name !== 'string') {
      return res.status(400).json({ message: 'procedure_name is required' });
    }
    if (!Array.isArray(lines)) {
      return res.status(400).json({ message: 'lines must be an array (can be empty)' });
    }

    for (const line of lines) {
      if (!line || typeof line.section !== 'string' || !FORMULA_SECTIONS.has(line.section)) {
        return res.status(400).json({ message: 'Each line needs section: roots | lengths | toner | other' });
      }
      if (!line.brand || line.amount == null) {
        return res.status(400).json({ message: 'Each line needs brand, shade_code (or use "-"), amount' });
      }
    }

    const vd =
      typeof visit_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(visit_date)
        ? visit_date
        : null;

    const visitRows = vd
      ? await sql`
          INSERT INTO visits (client_id, visit_date, procedure_name, chair_label, notes)
          VALUES (${cid}, ${vd}::date, ${procedure_name}, ${chair_label || null}, ${notes || null})
          RETURNING id
        `
      : await sql`
          INSERT INTO visits (client_id, procedure_name, chair_label, notes)
          VALUES (${cid}, ${procedure_name}, ${chair_label || null}, ${notes || null})
          RETURNING id
        `;

    const visitId = visitRows[0].id;

    for (const line of lines) {
      const amount = Number(line.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ message: 'amount must be a positive number' });
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
        const upd = await sql`
          UPDATE inventory_items
          SET quantity = quantity - ${amount}
          WHERE id = ${invId} AND quantity >= ${amount}
          RETURNING id
        `;
        if (!upd.length) {
          return res.status(400).json({ message: `Insufficient stock for inventory item ${invId}` });
        }
        await sql`
          INSERT INTO inventory_movements (inventory_item_id, delta, reason, visit_id)
          VALUES (${invId}, ${-amount}, ${'visit_formula'}, ${visitId})
        `;
      }
    }

    res.status(201).json({ id: visitId });
  } catch (e) {
    next(e);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: err.message || 'Server error' });
});

(async () => {
  try {
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL is not set');
      process.exit(1);
    }
    await ensureSchema(getSql());
  } catch (e) {
    console.error('Failed to ensure database schema:', e.message || e);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`ColorTrack API listening on http://localhost:${PORT}`);
  });
})();
