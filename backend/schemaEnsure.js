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
