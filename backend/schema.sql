-- ColorTrack — salon schema. Run this ENTIRE file in Neon SQL Editor (empty DB or after backup).
-- Tables are also created automatically on backend `npm start` if they are missing (see schemaEnsure.js).
-- If you see "relation inventory_items does not exist", you only ran the migration at the bottom:
-- execute the full script from the top — do not run ALTER on an empty database.
-- Removes legacy fitness demo tables if present.

DROP TABLE IF EXISTS exercises CASCADE;
DROP TABLE IF EXISTS workouts CASCADE;
DROP TABLE IF EXISTS daily_challenges CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TABLE IF EXISTS push_tokens CASCADE;
DROP TABLE IF EXISTS staff CASCADE;

DROP TABLE IF EXISTS inventory_movements CASCADE;
DROP TABLE IF EXISTS formula_lines CASCADE;
DROP TABLE IF EXISTS visits CASCADE;
DROP TABLE IF EXISTS appointments CASCADE;
DROP TABLE IF EXISTS inventory_items CASCADE;
DROP TABLE IF EXISTS client_photos CASCADE;
DROP TABLE IF EXISTS clients CASCADE;

DROP TABLE IF EXISTS salons CASCADE;

DROP TYPE IF EXISTS formula_section CASCADE;
DROP TYPE IF EXISTS inventory_category CASCADE;

CREATE TYPE formula_section AS ENUM ('roots', 'lengths', 'toner', 'other', 'developer');

CREATE TABLE salons (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE staff (
  id SERIAL PRIMARY KEY,
  salon_id INT NOT NULL REFERENCES salons (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT,
  apple_sub TEXT,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (salon_id, email)
);

CREATE UNIQUE INDEX idx_staff_apple_sub ON staff (apple_sub) WHERE apple_sub IS NOT NULL;

CREATE TABLE push_tokens (
  id SERIAL PRIMARY KEY,
  staff_id INT NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  expo_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, expo_token)
);

CREATE INDEX idx_push_tokens_staff ON push_tokens (staff_id);

CREATE TABLE clients (
  id SERIAL PRIMARY KEY,
  salon_id INT NOT NULL REFERENCES salons (id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  avatar_url TEXT,
  notes TEXT,
  last_patch_test_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE client_photos (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_client_photos_client ON client_photos (client_id);

CREATE TABLE inventory_items (
  id SERIAL PRIMARY KEY,
  salon_id INT NOT NULL REFERENCES salons (id) ON DELETE CASCADE,
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
);

CREATE TABLE appointments (
  id SERIAL PRIMARY KEY,
  salon_id INT NOT NULL REFERENCES salons (id) ON DELETE CASCADE,
  client_id INT REFERENCES clients (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  procedure_name TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  chair_label TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_appointments_start ON appointments (start_at);

CREATE TABLE visits (
  id SERIAL PRIMARY KEY,
  salon_id INT NOT NULL REFERENCES salons (id) ON DELETE CASCADE,
  client_id INT NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  appointment_id INT REFERENCES appointments (id) ON DELETE SET NULL,
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  procedure_name TEXT NOT NULL,
  chair_label TEXT,
  notes TEXT,
  amount_paid_cents INT,
  device_calendar_event_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT visits_appointment_unique UNIQUE (appointment_id)
);

CREATE TABLE formula_lines (
  id SERIAL PRIMARY KEY,
  visit_id INT NOT NULL REFERENCES visits (id) ON DELETE CASCADE,
  section formula_section NOT NULL,
  brand TEXT NOT NULL,
  shade_code TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  inventory_item_id INT REFERENCES inventory_items (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE inventory_movements (
  id SERIAL PRIMARY KEY,
  inventory_item_id INT NOT NULL REFERENCES inventory_items (id) ON DELETE CASCADE,
  delta NUMERIC(12, 2) NOT NULL,
  reason TEXT NOT NULL,
  visit_id INT REFERENCES visits (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed (demo)
INSERT INTO salons (name)
SELECT 'Default Salon'
WHERE NOT EXISTS (SELECT 1 FROM salons LIMIT 1);

INSERT INTO clients (salon_id, full_name, phone, avatar_url, last_patch_test_at)
SELECT * FROM (
  VALUES
    (
      1,
      'Jennifer S.',
      '+359888111222',
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=200&auto=format&fit=crop',
      (CURRENT_DATE - INTERVAL '8 months')::date
    ),
    (
      1,
      'Alex M.',
      '+359888333444',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=200&auto=format&fit=crop',
      (CURRENT_DATE - INTERVAL '2 months')::date
    ),
    (
      1,
      'Maria K.',
      NULL::text,
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=200&auto=format&fit=crop',
      NULL::date
    )
) AS t(salon_id, full_name, phone, avatar_url, last_patch_test_at)
WHERE NOT EXISTS (SELECT 1 FROM clients LIMIT 1);

INSERT INTO inventory_items (salon_id, name, category, brand, shade_code, unit, quantity, low_stock_threshold, supplier_hint)
SELECT * FROM (
  VALUES
    (1, 'Koleston Perfect', 'dye', 'Wella', '7.21', 'g', 45::numeric, 80::numeric, 'Wella'),
    (1, 'Color Touch', 'dye', 'Wella', '8/3', 'g', 120::numeric, 50::numeric, 'Wella'),
    (1, 'Cream Oxidant 6%', 'oxidant', 'Wella', NULL::text, 'ml', 400::numeric, 150::numeric, 'Wella'),
    (1, 'Metal Detox', 'retail', 'L''Oréal', NULL::text, 'ml', 12::numeric, 5::numeric, 'L''Oréal'),
    (1, 'Foil roll', 'consumable', NULL::text, NULL::text, 'pcs', 2::numeric, 3::numeric, NULL::text)
) AS v(salon_id, name, category, brand, shade_code, unit, quantity, low_stock_threshold, supplier_hint)
WHERE NOT EXISTS (SELECT 1 FROM inventory_items LIMIT 1);

INSERT INTO appointments (salon_id, client_id, title, procedure_name, start_at, end_at, chair_label, source)
SELECT c.salon_id, c.id, 'Balayage — Jennifer', 'Balayage', date_trunc('day', now()) + interval '14 hours', date_trunc('day', now()) + interval '16 hours 30 minutes', 'Chair 1', 'manual'
FROM clients c
WHERE c.full_name = 'Jennifer S.'
  AND NOT EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.client_id = c.id AND a.procedure_name = 'Balayage' AND (a.start_at::date = CURRENT_DATE)
  );

INSERT INTO visits (salon_id, client_id, visit_date, procedure_name, chair_label, notes)
SELECT c.salon_id, c.id, CURRENT_DATE - 21, 'Root touch-up', 'Chair 2', 'Demo history row'
FROM clients c
WHERE c.full_name = 'Alex M.'
  AND NOT EXISTS (
    SELECT 1 FROM visits v WHERE v.client_id = c.id AND v.visit_date = CURRENT_DATE - 21
  );

INSERT INTO visits (salon_id, client_id, visit_date, procedure_name, chair_label)
SELECT c.salon_id, c.id, CURRENT_DATE - 40, 'Full color', 'Chair 1'
FROM clients c
WHERE c.full_name = 'Jennifer S.'
  AND NOT EXISTS (
    SELECT 1 FROM visits v WHERE v.client_id = c.id AND v.procedure_name = 'Full color'
  );

INSERT INTO formula_lines (visit_id, section, brand, shade_code, amount, inventory_item_id)
SELECT v.id, 'roots'::formula_section, 'Wella', '7.21', 30,
  (SELECT id FROM inventory_items WHERE brand = 'Wella' AND shade_code = '7.21' LIMIT 1)
FROM visits v
JOIN clients c ON c.id = v.client_id
WHERE c.full_name = 'Jennifer S.' AND v.procedure_name = 'Full color'
  AND NOT EXISTS (SELECT 1 FROM formula_lines fl WHERE fl.visit_id = v.id);

-- ---------------------------------------------------------------------------
-- OPTIONAL migration (older DBs only): run ONLY if inventory_items already exists
-- with category type inventory_category enum. Skip on fresh / empty databases.
-- ---------------------------------------------------------------------------
-- ALTER TABLE inventory_items ALTER COLUMN category TYPE TEXT USING category::text;
-- DROP TYPE IF EXISTS inventory_category;
