/**
 * Idempotent DDL for an empty Neon/Postgres database.
 * Runs once when the API starts so routes like /api/inventory do not hit missing tables.
 */
async function ensureSchema(sql) {
  await sql`
    DO $ct$ BEGIN
      CREATE TYPE formula_section AS ENUM ('roots', 'lengths', 'toner', 'other');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $ct$
  `;

  try {
    await sql`ALTER TYPE formula_section ADD VALUE IF NOT EXISTS 'developer'`;
  } catch {
    try {
      await sql`ALTER TYPE formula_section ADD VALUE 'developer'`;
    } catch {
      /* value may already exist on older Postgres without IF NOT EXISTS */
    }
  }

  await sql`
    CREATE TABLE IF NOT EXISTS salons (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS staff (
      id SERIAL PRIMARY KEY,
      salon_id INT NOT NULL REFERENCES salons (id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (salon_id, email)
    )
  `;

  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS apple_sub TEXT`;
  await sql`ALTER TABLE staff ALTER COLUMN password_hash DROP NOT NULL`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_apple_sub
    ON staff (apple_sub) WHERE apple_sub IS NOT NULL
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS push_tokens (
      id SERIAL PRIMARY KEY,
      staff_id INT NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
      expo_token TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (staff_id, expo_token)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_push_tokens_staff ON push_tokens (staff_id)`;

  await sql`
    INSERT INTO salons (name)
    SELECT 'Default'
    WHERE NOT EXISTS (SELECT 1 FROM salons LIMIT 1)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      avatar_url TEXT,
      notes TEXT,
      last_patch_test_at DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS salon_id INT REFERENCES salons (id)`;
  await sql`
    UPDATE clients
    SET salon_id = (SELECT id FROM salons ORDER BY id LIMIT 1)
    WHERE salon_id IS NULL
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS client_photos (
      id SERIAL PRIMARY KEY,
      client_id INT NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
      object_key TEXT NOT NULL UNIQUE,
      content_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_client_photos_client ON client_photos (client_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS inventory_items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (char_length(trim(category)) >= 1 AND char_length(category) <= 80),
      brand TEXT,
      shade_code TEXT,
      unit TEXT NOT NULL CHECK (unit IN ('g', 'ml', 'pcs')),
      quantity NUMERIC(12, 2) NOT NULL DEFAULT 0,
      low_stock_threshold NUMERIC(12, 2) NOT NULL DEFAULT 0,
      price_per_unit_cents INT,
      supplier_hint TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS salon_id INT REFERENCES salons (id)`;
  await sql`
    UPDATE inventory_items
    SET salon_id = (SELECT id FROM salons ORDER BY id LIMIT 1)
    WHERE salon_id IS NULL
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      client_id INT REFERENCES clients (id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      procedure_name TEXT,
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      chair_label TEXT,
      notes TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS salon_id INT REFERENCES salons (id)`;
  await sql`
    UPDATE appointments
    SET salon_id = (SELECT id FROM salons ORDER BY id LIMIT 1)
    WHERE salon_id IS NULL
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments (start_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS visits (
      id SERIAL PRIMARY KEY,
      client_id INT NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
      visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
      procedure_name TEXT NOT NULL,
      chair_label TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE visits ADD COLUMN IF NOT EXISTS salon_id INT REFERENCES salons (id)`;
  await sql`
    UPDATE visits v
    SET salon_id = c.salon_id
    FROM clients c
    WHERE v.client_id = c.id AND v.salon_id IS NULL
  `;
  await sql`
    UPDATE visits
    SET salon_id = (SELECT id FROM salons ORDER BY id LIMIT 1)
    WHERE salon_id IS NULL
  `;

  await sql`
    ALTER TABLE visits
    ADD COLUMN IF NOT EXISTS appointment_id INT REFERENCES appointments (id) ON DELETE SET NULL
  `;
  await sql`ALTER TABLE visits ADD COLUMN IF NOT EXISTS amount_paid_cents INT`;
  await sql`ALTER TABLE visits ADD COLUMN IF NOT EXISTS device_calendar_event_id TEXT`;
  await sql`
    ALTER TABLE visits ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_appointment_unique ON visits (appointment_id)
    WHERE appointment_id IS NOT NULL
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS formula_lines (
      id SERIAL PRIMARY KEY,
      visit_id INT NOT NULL REFERENCES visits (id) ON DELETE CASCADE,
      section formula_section NOT NULL,
      brand TEXT NOT NULL,
      shade_code TEXT NOT NULL,
      amount NUMERIC(12, 2) NOT NULL,
      inventory_item_id INT REFERENCES inventory_items (id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id SERIAL PRIMARY KEY,
      inventory_item_id INT NOT NULL REFERENCES inventory_items (id) ON DELETE CASCADE,
      delta NUMERIC(12, 2) NOT NULL,
      reason TEXT NOT NULL,
      visit_id INT REFERENCES visits (id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

module.exports = { ensureSchema };
