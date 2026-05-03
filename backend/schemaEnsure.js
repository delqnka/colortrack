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
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS display_name TEXT`;
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS avatar_url TEXT`;
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
      unit TEXT NOT NULL CHECK (unit IN ('g', 'ml', 'pcs', 'oz')),
      quantity NUMERIC(12, 2) NOT NULL DEFAULT 0,
      low_stock_threshold NUMERIC(12, 2) NOT NULL DEFAULT 0,
      price_per_unit_cents INT,
      supplier_hint TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS salon_id INT REFERENCES salons (id)`;
  await sql`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS package_size TEXT`;
  await sql`
    ALTER TABLE inventory_items
    DROP CONSTRAINT IF EXISTS inventory_items_unit_check
  `;
  await sql`
    ALTER TABLE inventory_items
    ADD CONSTRAINT inventory_items_unit_check CHECK (unit IN ('g', 'ml', 'pcs', 'oz'))
  `;
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
    CREATE TABLE IF NOT EXISTS salon_services (
      id SERIAL PRIMARY KEY,
      salon_id INT NOT NULL REFERENCES salons (id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (char_length(trim(name)) >= 1 AND char_length(name) <= 160),
      price_cents INT CHECK (price_cents IS NULL OR (price_cents >= 0 AND price_cents <= 1000000000)),
      currency_code TEXT NOT NULL DEFAULT 'BGN',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_salon_services_salon_active ON salon_services (salon_id, is_active, name)`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_salon_services_salon_name_lower
    ON salon_services (salon_id, lower(name))
  `;

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

  await sql`
    CREATE TABLE IF NOT EXISTS salon_expenses (
      id SERIAL PRIMARY KEY,
      salon_id INT NOT NULL REFERENCES salons (id) ON DELETE CASCADE,
      expense_date DATE NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('rent', 'utilities', 'salary', 'supplies', 'inventory', 'equipment', 'marketing', 'taxes', 'other')),
      title TEXT NOT NULL DEFAULT '',
      amount_cents INT NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= 1000000000),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_salon_expenses_salon_date ON salon_expenses (salon_id, expense_date DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS salon_product_sales (
      id SERIAL PRIMARY KEY,
      salon_id INT NOT NULL REFERENCES salons (id) ON DELETE CASCADE,
      sale_date DATE NOT NULL,
      inventory_item_id INT REFERENCES inventory_items (id) ON DELETE SET NULL,
      description TEXT NOT NULL DEFAULT '',
      quantity NUMERIC(12, 2) DEFAULT 1,
      amount_cents INT NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= 1000000000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_salon_product_sales_salon_date ON salon_product_sales (salon_id, sale_date DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS lab_formula_templates (
      id SERIAL PRIMARY KEY,
      salon_id INT NOT NULL REFERENCES salons (id) ON DELETE CASCADE,
      staff_id INT REFERENCES staff (id) ON DELETE SET NULL,
      name TEXT NOT NULL CHECK (char_length(trim(name)) >= 1),
      lines JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_lab_templates_salon ON lab_formula_templates (salon_id)`;

  // Global crowdsourced product database.
  // Privacy: stores ONLY brand + product_name + unit. No user_id, no price, no location.
  // Contributions from invoice scans are fully anonymous.
  await sql`
    CREATE TABLE IF NOT EXISTS global_products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      brand VARCHAR(100) NOT NULL,
      product_name VARCHAR(200) NOT NULL,
      unit VARCHAR(10) NOT NULL DEFAULT 'g',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confirmed_count INTEGER NOT NULL DEFAULT 1,
      UNIQUE(brand, product_name)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_global_products_brand ON global_products(brand)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_global_products_count ON global_products(confirmed_count DESC)`;
}

module.exports = { ensureSchema };
