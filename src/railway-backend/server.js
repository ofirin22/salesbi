/* global process, setImmediate */
import express from 'express';
import multer from 'multer';
import pg from 'pg';
import { parse } from 'csv-parse';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';

const { Pool } = pg;
const app = express();

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT            = process.env.PORT            || 3000;
const API_SECRET      = process.env.IMPORT_API_SECRET;
const DATABASE_URL    = process.env.DATABASE_URL;
const BASE44_API_URL  = process.env.BASE44_API_URL;   // e.g. https://api.base44.app/api/apps/APP_ID
const BASE44_TOKEN    = process.env.BASE44_SERVICE_TOKEN;

// ─── Database ─────────────────────────────────────────────────────────────────
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS import_jobs (
      id          TEXT PRIMARY KEY,
      file_name   TEXT,
      uploaded_by TEXT,
      status      TEXT DEFAULT 'pending',
      total_rows  INT  DEFAULT 0,
      imported    INT  DEFAULT 0,
      skipped     INT  DEFAULT 0,
      failed      INT  DEFAULT 0,
      error       TEXT,
      current_chunk INT DEFAULT 0,
      total_chunks  INT DEFAULT 0,
      phase         TEXT DEFAULT 'queued',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function updateJob(id, fields) {
  if (!pool) return;
  const keys = Object.keys(fields);
  const vals = Object.values(fields);
  const set  = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await pool.query(
    `UPDATE import_jobs SET ${set}, updated_at = NOW() WHERE id = $1`,
    [id, ...vals]
  );
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

function auth(req, res, next) {
  const secret = req.headers['x-import-secret'];
  if (!API_SECRET || secret !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── Column Mapping ───────────────────────────────────────────────────────────
const COL_ALIASES = {
  'order number': 'Order Number', 'ordernumber': 'Order Number', 'order no': 'Order Number',
  'order #': 'Order Number', 'order_number': 'Order Number', 'order#': 'Order Number',
  'customer id': 'Customer ID', 'customerid': 'Customer ID', 'customer_id': 'Customer ID',
  'cust id': 'Customer ID', 'cust_id': 'Customer ID',
  'customer name': 'Customer Name', 'customername': 'Customer Name', 'customer_name': 'Customer Name',
  'client name': 'Customer Name', 'client': 'Customer Name', 'customer': 'Customer Name',
  'order date': 'Order Date', 'orderdate': 'Order Date', 'order_date': 'Order Date', 'date': 'Order Date',
  'sales representative': 'Sales Representative', 'salesrepresentative': 'Sales Representative',
  'sales rep': 'Sales Representative', 'sales_rep': 'Sales Representative', 'rep': 'Sales Representative',
  'salesperson': 'Sales Representative', 'sales person': 'Sales Representative',
  'sku': 'SKU', 'item code': 'SKU', 'item_code': 'SKU', 'product code': 'SKU', 'product_code': 'SKU',
  'product name': 'Product Name', 'productname': 'Product Name', 'product_name': 'Product Name',
  'item name': 'Product Name', 'item': 'Product Name', 'description': 'Product Name', 'product': 'Product Name',
  'brand': 'Brand', 'brand name': 'Brand', 'manufacturer': 'Brand',
  'quantity': 'Quantity', 'qty': 'Quantity', 'units': 'Quantity',
  'line total': 'Line Total', 'linetotal': 'Line Total', 'line_total': 'Line Total',
  'total': 'Line Total', 'subtotal': 'Line Total', 'net amount': 'Line Total', 'net': 'Line Total',
  'discount': 'Discount', 'disc': 'Discount', 'discount amount': 'Discount',
  'tax': 'Tax', 'vat': 'Tax', 'tax amount': 'Tax',
};

const REQUIRED = [
  'Order Number', 'Customer ID', 'Customer Name', 'Order Date',
  'Sales Representative', 'SKU', 'Product Name', 'Brand',
  'Quantity', 'Line Total', 'Discount', 'Tax',
];

function buildColMap(headers) {
  const map = {};
  for (const h of headers) {
    const canonical = COL_ALIASES[h.trim().toLowerCase()];
    if (canonical && !map[canonical]) map[canonical] = h;
  }
  return map;
}

function toNum(v) {
  if (!v && v !== 0) return 0;
  const n = parseFloat(v.toString().replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(v.toString().trim());
  return isNaN(d.getTime()) ? v.toString().trim() : d.toISOString().split('T')[0];
}

// ─── Base44 Helpers ───────────────────────────────────────────────────────────
async function b44Fetch(path, method, body) {
  if (!BASE44_API_URL || !BASE44_TOKEN) throw new Error('BASE44_API_URL / BASE44_SERVICE_TOKEN not set');
  const res = await fetch(`${BASE44_API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BASE44_TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Base44 API ${res.status}: ${text}`);
  }
  return res.json();
}

const BATCH = 50;
function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function bulkCreate(entity, records) {
  for (const batch of chunks(records, BATCH)) {
    await b44Fetch(`/entities/${entity}/bulk`, 'POST', { records: batch });
    await sleep(500);
  }
}

// ─── CSV Parse Utility ────────────────────────────────────────────────────────
function parseCSVBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(buffer)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on('data', row => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

// ─── Core Import Logic ────────────────────────────────────────────────────────
async function processRows(rows) {
  const customers = new Map();
  const products  = new Map();
  const orders    = new Map();
  const lines     = [];
  const seenKeys  = new Set();
  let skipped = 0, failed = 0;

  for (const row of rows) {
    const orderNum = row.order_number?.trim();
    const sku      = row.sku?.trim();
    if (!orderNum || !sku) { failed++; continue; }

    const key = `${orderNum}__${sku}`;
    if (seenKeys.has(key)) { skipped++; continue; }
    seenKeys.add(key);

    if (row.customer_id && !customers.has(row.customer_id)) {
      customers.set(row.customer_id, { customer_id: row.customer_id, customer_name: row.customer_name });
    }
    if (!products.has(sku)) {
      products.set(sku, { sku, product_name: row.product_name, brand: row.brand });
    }
    if (!orders.has(orderNum)) {
      orders.set(orderNum, {
        order_number: orderNum, customer_id: row.customer_id, customer_name: row.customer_name,
        sales_representative: row.sales_rep, order_date: row.order_date,
        order_total: row.line_total, order_discount: row.discount, order_tax: row.tax,
      });
    }
    lines.push({
      order_number: orderNum, sku, product_name: row.product_name, brand: row.brand,
      quantity: row.quantity, line_total: row.line_total, discount: row.discount,
      tax: row.tax, line_key: key,
    });
  }

  if (customers.size) await bulkCreate('Customer', [...customers.values()]);
  if (products.size)  await bulkCreate('Product',  [...products.values()]);
  if (orders.size)    await bulkCreate('Order',     [...orders.values()]);
  if (lines.length)   await bulkCreate('OrderLine', lines);

  return { imported: lines.length, skipped, failed };
}

async function runImport(jobId, buffer, userEmail) {
  const CHUNK_SIZE = 2000;

  try {
    await updateJob(jobId, { status: 'processing', phase: 'Parsing CSV...' });

    const rawRows = await parseCSVBuffer(buffer);
    if (!rawRows.length) throw new Error('CSV is empty');

    const headers = Object.keys(rawRows[0]);
    const colMap  = buildColMap(headers);
    const missing = REQUIRED.filter(r => !colMap[r]);
    if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);

    // Normalize rows
    const normalizedRows = rawRows
      .map(raw => {
        const g = col => raw[colMap[col]] ?? '';
        const orderNumber = g('Order Number').trim();
        const sku         = g('SKU').trim();
        if (!orderNumber || !sku) return null;
        return {
          order_number: orderNumber,
          customer_id:  g('Customer ID').trim(),
          customer_name: g('Customer Name').trim(),
          order_date:   toDate(g('Order Date')),
          sales_rep:    g('Sales Representative').trim(),
          sku,
          product_name: g('Product Name').trim(),
          brand:        g('Brand').trim(),
          quantity:     toNum(g('Quantity')),
          line_total:   toNum(g('Line Total')),
          discount:     toNum(g('Discount')),
          tax:          toNum(g('Tax')),
        };
      })
      .filter(Boolean);

    const totalRows   = normalizedRows.length;
    const totalChunks = Math.ceil(totalRows / CHUNK_SIZE);

    await updateJob(jobId, {
      total_rows:    totalRows,
      total_chunks:  totalChunks,
      phase:        'Importing...',
    });

    // Create ImportLog in Base44
    let importLogId = null;
    if (BASE44_API_URL && BASE44_TOKEN) {
      const logRes = await b44Fetch('/entities/ImportLog', 'POST', {
        file_name: 'upload.csv', uploaded_by: userEmail,
        upload_started_at: new Date().toISOString(),
        status: 'processing', total_rows_in_file: totalRows,
        rows_imported: 0, rows_skipped: 0, rows_failed: 0,
        summary_rebuild_status: 'pending',
      });
      importLogId = logRes?.id;
    }

    let totalImported = 0, totalSkipped = 0, totalFailed = 0;

    for (let c = 0; c < totalChunks; c++) {
      const chunkRows = normalizedRows.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
      const result    = await processRows(chunkRows);

      totalImported += result.imported;
      totalSkipped  += result.skipped;
      totalFailed   += result.failed;

      await updateJob(jobId, {
        current_chunk: c + 1,
        imported:      totalImported,
        skipped:       totalSkipped,
        failed:        totalFailed,
        phase:         `Chunk ${c + 1}/${totalChunks}`,
      });

      if (importLogId) {
        await b44Fetch(`/entities/ImportLog/${importLogId}`, 'PATCH', {
          rows_imported: totalImported, rows_skipped: totalSkipped, rows_failed: totalFailed,
        }).catch(() => {});
      }

      if (c < totalChunks - 1) await sleep(300);
    }

    // Finalize
    await updateJob(jobId, {
      status:   'done',
      phase:    'Complete',
      imported: totalImported,
      skipped:  totalSkipped,
      failed:   totalFailed,
    });

    if (importLogId) {
      await b44Fetch(`/entities/ImportLog/${importLogId}`, 'PATCH', {
        status: totalFailed > 0 ? 'partial_success' : 'success',
        upload_finished_at: new Date().toISOString(),
        rows_imported: totalImported, rows_skipped: totalSkipped, rows_failed: totalFailed,
        summary_rebuild_status: 'triggered',
      }).catch(() => {});
    }

    // Trigger summary rebuild
    if (BASE44_API_URL && BASE44_TOKEN) {
      fetch(`${BASE44_API_URL}/functions/rebuildSummaries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BASE44_TOKEN}` },
        body: JSON.stringify({}),
      }).catch(() => {});
    }

  } catch (err) {
    await updateJob(jobId, { status: 'failed', phase: 'Failed', error: err.message });
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Public health check
app.get('/health', async (_req, res) => {
  let dbOk = false;
  if (pool) {
    try { await pool.query('SELECT 1'); dbOk = true; } catch (_e) { /* no-op */ }
  }
  res.json({
    status:    'ok',
    db:        pool ? (dbOk ? 'connected' : 'error') : 'not configured',
    base44:    BASE44_API_URL ? 'configured' : 'not configured',
    timestamp: new Date().toISOString(),
  });
});

// POST /import — upload CSV file, kick off background job
app.post('/import', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const jobId     = randomUUID();
  const userEmail = req.headers['x-user-email'] || 'unknown';
  const fileName  = req.file.originalname;

  // Insert job record
  if (pool) {
    await pool.query(
      `INSERT INTO import_jobs (id, file_name, uploaded_by, status, phase)
       VALUES ($1, $2, $3, 'pending', 'queued')`,
      [jobId, fileName, userEmail]
    );
  }

  // Kick off non-blocking background processing
  const buffer = req.file.buffer;
  setImmediate(() => runImport(jobId, buffer, userEmail));

  res.json({ jobId, status: 'processing', message: 'Import started' });
});

// GET /status/:jobId — poll import progress
app.get('/status/:jobId', auth, async (req, res) => {
  const { jobId } = req.params;

  if (!pool) {
    return res.json({ jobId, status: 'unknown', error: 'Database not configured' });
  }

  const result = await pool.query('SELECT * FROM import_jobs WHERE id = $1', [jobId]);
  if (!result.rows.length) return res.status(404).json({ error: 'Job not found' });

  const job = result.rows[0];
  res.json({
    jobId:         job.id,
    status:        job.status,
    phase:         job.phase,
    totalRows:     job.total_rows,
    rowsImported:  job.imported,
    rowsSkipped:   job.skipped,
    rowsFailed:    job.failed,
    currentChunk:  job.current_chunk,
    chunksTotal:   job.total_chunks,
    error:         job.error,
    createdAt:     job.created_at,
    updatedAt:     job.updated_at,
  });
});

// GET /jobs — list recent jobs
app.get('/jobs', auth, async (_req, res) => {
  if (!pool) return res.json({ jobs: [] });
  const result = await pool.query(
    'SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT 50'
  );
  res.json({ jobs: result.rows });
});

// ─── Start ────────────────────────────────────────────────────────────────────
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Sales import backend running on port ${PORT}`));
  })
  .catch(err => {
    console.error('DB init failed:', err.message);
    app.listen(PORT, () => console.log(`Sales import backend running on port ${PORT} (no DB)`));
  });