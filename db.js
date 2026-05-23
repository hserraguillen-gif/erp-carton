require('dotenv').config();
const { Pool } = require('pg');

const isLocal = !process.env.DATABASE_URL || process.env.DATABASE_URL.includes('localhost');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  // pgbouncer=true deshabilita prepared statements incompatibles con el pooler de Supabase
  ...(process.env.DATABASE_URL?.includes('pooler.supabase.com') && {
    max: 10,
  }),
});

const q = (text, params) => pool.query(text, params);

async function init() {
  await q(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      tax_id TEXT,
      commercial_name TEXT,
      address TEXT,
      city TEXT,
      province TEXT,
      country TEXT,
      email TEXT,
      phone TEXT,
      payment_terms TEXT,
      tax_condition TEXT,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS quotations (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      quote_code TEXT NOT NULL UNIQUE,
      description TEXT,
      notes TEXT,
      total_amount NUMERIC(14,2) DEFAULT 0,
      status TEXT DEFAULT 'draft',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS quotation_lines (
      id SERIAL PRIMARY KEY,
      quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
      unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
      subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS production_orders (
      id SERIAL PRIMARY KEY,
      quotation_id INTEGER NOT NULL REFERENCES quotations(id),
      order_code TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_customers_tax_id ON customers(tax_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_quotations_customer_id ON quotations(customer_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_quotation_lines_quotation_id ON quotation_lines(quotation_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_production_orders_quotation_id ON production_orders(quotation_id)`);
}

// ── Clientes ────────────────────────────────────────────────────────────────

async function listCustomers() {
  const { rows } = await q('SELECT * FROM customers ORDER BY id DESC');
  return rows;
}

async function getCustomer(id) {
  const { rows } = await q('SELECT * FROM customers WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createCustomer(data) {
  const { rows } = await q(`
    INSERT INTO customers (
      name, tax_id, commercial_name, address, city, province, country,
      email, phone, payment_terms, tax_condition,
      contact_name, contact_email, contact_phone
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *
  `, [
    data.name, data.tax_id, data.commercial_name, data.address,
    data.city, data.province, data.country, data.email, data.phone,
    data.payment_terms, data.tax_condition,
    data.contact_name, data.contact_email, data.contact_phone,
  ]);
  return rows[0];
}

async function updateCustomer(id, data) {
  const { rows } = await q(`
    UPDATE customers SET
      name=$1, tax_id=$2, commercial_name=$3, address=$4,
      city=$5, province=$6, country=$7, email=$8, phone=$9,
      payment_terms=$10, tax_condition=$11,
      contact_name=$12, contact_email=$13, contact_phone=$14,
      updated_at=NOW()
    WHERE id=$15
    RETURNING *
  `, [
    data.name, data.tax_id, data.commercial_name, data.address,
    data.city, data.province, data.country, data.email, data.phone,
    data.payment_terms, data.tax_condition,
    data.contact_name, data.contact_email, data.contact_phone,
    id,
  ]);
  return rows[0];
}

async function deleteCustomer(id) {
  await q('DELETE FROM customers WHERE id = $1', [id]);
}

// ── Cotizaciones ─────────────────────────────────────────────────────────────

async function listQuotations() {
  const { rows } = await q(`
    SELECT q.*, c.name AS customer_name
    FROM quotations q
    JOIN customers c ON c.id = q.customer_id
    ORDER BY q.id DESC
  `);
  return rows;
}

async function getQuotation(id) {
  const { rows } = await q(`
    SELECT q.*, c.name AS customer_name
    FROM quotations q
    JOIN customers c ON c.id = q.customer_id
    WHERE q.id = $1
  `, [id]);
  return rows[0] || null;
}

async function _nextQuoteCode() {
  const year = new Date().getFullYear();
  const { rows } = await q(
    `SELECT COUNT(*) AS cnt FROM quotations WHERE quote_code LIKE $1`,
    [`COT-${year}-%`]
  );
  const seq = String(Number(rows[0].cnt) + 1).padStart(4, '0');
  return `COT-${year}-${seq}`;
}

async function createQuotation(data) {
  const quote_code = await _nextQuoteCode();
  const { rows } = await q(`
    INSERT INTO quotations (customer_id, quote_code, description, notes, status)
    VALUES ($1, $2, $3, $4, 'draft')
    RETURNING *
  `, [data.customer_id, quote_code, data.description, data.notes]);
  return rows[0];
}

async function updateQuotation(id, data) {
  const { rows } = await q(`
    UPDATE quotations SET
      customer_id=$1, description=$2, notes=$3, updated_at=NOW()
    WHERE id=$4 AND status='draft'
    RETURNING *
  `, [data.customer_id, data.description, data.notes, id]);
  return rows[0] || null;
}

async function deleteQuotation(id) {
  const { rowCount } = await q(
    `DELETE FROM quotations WHERE id=$1 AND status='draft'`, [id]
  );
  return rowCount > 0;
}

async function approveQuotation(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: qRows } = await client.query(
      `UPDATE quotations SET status='approved', updated_at=NOW() WHERE id=$1 AND status='draft' RETURNING *`,
      [id]
    );
    if (!qRows[0]) { await client.query('ROLLBACK'); return null; }

    const year = new Date().getFullYear();
    const { rows: cnt } = await client.query(
      `SELECT COUNT(*) AS cnt FROM production_orders WHERE order_code LIKE $1`,
      [`OP-${year}-%`]
    );
    const seq = String(Number(cnt[0].cnt) + 1).padStart(4, '0');
    const order_code = `OP-${year}-${seq}`;

    const { rows: oRows } = await client.query(
      `INSERT INTO production_orders (quotation_id, order_code, status)
       VALUES ($1, $2, 'pending') RETURNING *`,
      [id, order_code]
    );
    await client.query('COMMIT');
    return { quotation: qRows[0], order: oRows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function rejectQuotation(id) {
  const { rows } = await q(
    `UPDATE quotations SET status='rejected', updated_at=NOW() WHERE id=$1 AND status='draft' RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

// ── Líneas de cotización ──────────────────────────────────────────────────────

async function listQuotationLines(quotationId) {
  const { rows } = await q(
    `SELECT * FROM quotation_lines WHERE quotation_id=$1 ORDER BY id`,
    [quotationId]
  );
  return rows;
}

async function _recalcTotal(client, quotationId) {
  await client.query(
    `UPDATE quotations SET total_amount=(
       SELECT COALESCE(SUM(subtotal),0) FROM quotation_lines WHERE quotation_id=$1
     ), updated_at=NOW() WHERE id=$1`,
    [quotationId]
  );
}

async function createQuotationLine(quotationId, data) {
  const subtotal = (Number(data.quantity) || 0) * (Number(data.unit_price) || 0);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO quotation_lines (quotation_id, description, quantity, unit_price, subtotal)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [quotationId, data.description, data.quantity, data.unit_price, subtotal]
    );
    await _recalcTotal(client, quotationId);
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateQuotationLine(lineId, data) {
  const subtotal = (Number(data.quantity) || 0) * (Number(data.unit_price) || 0);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE quotation_lines SET description=$1, quantity=$2, unit_price=$3, subtotal=$4
       WHERE id=$5 RETURNING *`,
      [data.description, data.quantity, data.unit_price, subtotal, lineId]
    );
    if (rows[0]) await _recalcTotal(client, rows[0].quotation_id);
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteQuotationLine(lineId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `DELETE FROM quotation_lines WHERE id=$1 RETURNING *`, [lineId]
    );
    if (rows[0]) await _recalcTotal(client, rows[0].quotation_id);
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Órdenes de producción ────────────────────────────────────────────────────

async function listProductionOrders() {
  const { rows } = await q(`
    SELECT o.*, q.quote_code, q.description AS quote_description,
           c.name AS customer_name
    FROM production_orders o
    JOIN quotations q ON q.id = o.quotation_id
    JOIN customers c ON c.id = q.customer_id
    ORDER BY o.id DESC
  `);
  return rows;
}

async function getProductionOrder(id) {
  const { rows } = await q(`
    SELECT o.*, q.quote_code, q.description AS quote_description,
           q.total_amount, c.name AS customer_name
    FROM production_orders o
    JOIN quotations q ON q.id = o.quotation_id
    JOIN customers c ON c.id = q.customer_id
    WHERE o.id=$1
  `, [id]);
  return rows[0] || null;
}

async function updateProductionOrderStatus(id, status, notes) {
  const { rows } = await q(
    `UPDATE production_orders SET status=$1, notes=COALESCE($2, notes), updated_at=NOW()
     WHERE id=$3 RETURNING *`,
    [status, notes, id]
  );
  return rows[0] || null;
}

init().catch(err => { console.error('DB init error:', err); process.exit(1); });

module.exports = {
  listCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer,
  listQuotations, getQuotation, createQuotation, updateQuotation, deleteQuotation,
  approveQuotation, rejectQuotation,
  listQuotationLines, createQuotationLine, updateQuotationLine, deleteQuotationLine,
  listProductionOrders, getProductionOrder, updateProductionOrderStatus,
};
