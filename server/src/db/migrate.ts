import { getDb } from './index.js';

export async function runMigrations(): Promise<void> {
  const db = getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      image_fit TEXT NOT NULL DEFAULT 'contain',
      is_featured BOOLEAN NOT NULL DEFAULT FALSE,
      badge TEXT NOT NULL DEFAULT '',
      drink_type TEXT NOT NULL DEFAULT 'iced_or_hot',
      variants JSONB NOT NULL DEFAULT '[]'::jsonb,
      allow_size BOOLEAN NOT NULL DEFAULT TRUE,
      allow_sugar BOOLEAN NOT NULL DEFAULT TRUE,
      allow_ice BOOLEAN NOT NULL DEFAULT TRUE,
      allow_toppings BOOLEAN NOT NULL DEFAULT TRUE,
      is_available BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS toppings (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 8000,
      is_available BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS shop_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_code TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_address TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      items JSONB NOT NULL,
      subtotal INTEGER NOT NULL,
      total_amount INTEGER NOT NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('cod', 'bank_transfer')),
      payment_status TEXT NOT NULL CHECK (payment_status IN ('unpaid', 'paid', 'cod')),
      payment_confirmed_at TIMESTAMPTZ,
      payment_confirmed_by TEXT,
      payment_tx_ref TEXT,
      status TEXT NOT NULL CHECK (status IN ('awaiting_payment', 'pending_shop', 'accepted', 'completed', 'cancelled')),
      print_status TEXT NOT NULL DEFAULT 'not_queued' CHECK (print_status IN ('not_queued', 'pending', 'printed')),
      printed_at TIMESTAMPTZ,
      print_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
    CREATE INDEX IF NOT EXISTS idx_orders_print_status ON orders (print_status);

    CREATE TABLE IF NOT EXISTS print_jobs (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      order_code TEXT NOT NULL,
      job_type TEXT NOT NULL CHECK (job_type IN ('initial', 'reprint', 'test')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'printed', 'failed')),
      payload JSONB NOT NULL,
      idempotency_key TEXT UNIQUE NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      printed_at TIMESTAMPTZ,
      printed_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_print_jobs_pending ON print_jobs (status, created_at ASC);
  `);

  console.log('[DB] Migrations applied');
}
