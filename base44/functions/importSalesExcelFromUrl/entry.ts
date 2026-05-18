import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import * as XLSX from 'npm:xlsx@0.18.5';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, retries = 5, baseDelay = 1500) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err?.status === 429 || err?.message?.includes('Rate limit') || err?.message?.includes('429');
      if (is429 && attempt < retries) {
        await sleep(baseDelay * Math.pow(2, attempt));
      } else {
        throw err;
      }
    }
  }
}

function splitChunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function bulkCreateWithRetry(base44, entityName, records, batchSize = 50) {
  for (const batch of splitChunks(records, batchSize)) {
    await withRetry(() => base44.asServiceRole.entities[entityName].bulkCreate(batch));
    await sleep(2000);
  }
}

async function processRows(base44, rows) {
  const newCustomers = new Map();
  const newProducts = new Map();
  const newOrders = new Map();
  const seenLineKeys = new Set();
  const newLines = [];
  let rowsSkipped = 0;

  for (const row of rows) {
    const lineKey = `${row.order_number}__${row.sku}`;
    if (seenLineKeys.has(lineKey)) { rowsSkipped++; continue; }
    seenLineKeys.add(lineKey);
    if (row.customer_id && !newCustomers.has(row.customer_id)) {
      newCustomers.set(row.customer_id, { customer_id: row.customer_id, customer_name: row.customer_name });
    }
    if (row.sku && !newProducts.has(row.sku)) {
      newProducts.set(row.sku, { sku: row.sku, product_name: row.product_name, brand: row.brand });
    }
    if (!newOrders.has(row.order_number)) {
      newOrders.set(row.order_number, {
        order_number: row.order_number, customer_id: row.customer_id, customer_name: row.customer_name,
        sales_representative: row.sales_rep, order_date: row.order_date,
        order_total: row.line_total, order_discount: row.discount, order_tax: row.tax
      });
    }
    newLines.push({
      order_number: row.order_number, sku: row.sku, product_name: row.product_name,
      brand: row.brand, quantity: row.quantity, line_total: row.line_total,
      discount: row.discount, tax: row.tax, line_key: lineKey
    });
  }

  if (newCustomers.size > 0) await bulkCreateWithRetry(base44, 'Customer', [...newCustomers.values()]);
  if (newProducts.size > 0) await bulkCreateWithRetry(base44, 'Product', [...newProducts.values()]);
  if (newOrders.size > 0) await bulkCreateWithRetry(base44, 'Order', [...newOrders.values()]);
  if (newLines.length > 0) await bulkCreateWithRetry(base44, 'OrderLine', newLines);

  return { rowsImported: newLines.length, rowsSkipped };
}

const COL_ALIASES = {
  'order number': 'Order Number', 'ordernumber': 'Order Number', 'order no': 'Order Number',
  'order #': 'Order Number', 'order_number': 'Order Number', 'order#': 'Order Number', '#': 'Order Number',
  'customer id': 'Customer ID', 'customerid': 'Customer ID', 'customer_id': 'Customer ID',
  'cust id': 'Customer ID', 'cust_id': 'Customer ID',
  'customer name': 'Customer Name', 'customername': 'Customer Name', 'customer_name': 'Customer Name',
  'client name': 'Customer Name', 'client': 'Customer Name',
  'order date': 'Order Date', 'orderdate': 'Order Date', 'order_date': 'Order Date',
  'date': 'Order Date', 'order dt': 'Order Date',
  'sales representative': 'Sales Representative', 'salesrepresentative': 'Sales Representative',
  'sales rep': 'Sales Representative', 'sales_rep': 'Sales Representative', 'rep': 'Sales Representative',
  'salesperson': 'Sales Representative', 'sales person': 'Sales Representative',
  'sku': 'SKU', 'item code': 'SKU', 'item_code': 'SKU', 'product code': 'SKU',
  'product_code': 'SKU', 'part number': 'SKU',
  'product name': 'Product Name', 'productname': 'Product Name', 'product_name': 'Product Name',
  'item name': 'Product Name', 'item': 'Product Name', 'description': 'Product Name', 'product': 'Product Name',
  'brand': 'Brand', 'brand name': 'Brand', 'manufacturer': 'Brand',
  'quantity': 'Quantity', 'qty': 'Quantity', 'units': 'Quantity', 'amount': 'Quantity',
  'line total': 'Line Total', 'linetotal': 'Line Total', 'line_total': 'Line Total',
  'total': 'Line Total', 'subtotal': 'Line Total', 'sub total': 'Line Total',
  'line amount': 'Line Total', 'net amount': 'Line Total', 'net': 'Line Total',
  'discount': 'Discount', 'disc': 'Discount', 'disc amount': 'Discount', 'discount amount': 'Discount',
  'tax': 'Tax', 'vat': 'Tax', 'tax amount': 'Tax', 'vat amount': 'Tax',
};

const REQUIRED_CANONICAL = [
  'Order Number', 'Customer ID', 'Customer Name', 'Order Date',
  'Sales Representative', 'SKU', 'Product Name', 'Brand',
  'Quantity', 'Line Total', 'Discount', 'Tax'
];

function buildColumnMap(headers) {
  const map = {};
  for (const h of headers) {
    const normalized = h.toString().trim().toLowerCase();
    const canonical = COL_ALIASES[normalized];
    if (canonical && !map[canonical]) map[canonical] = h;
  }
  return map;
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(v.toString().replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function toDateStr(v) {
  if (!v) return null;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const s = v.toString().trim();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return s;
}

function get(row, colMap, canonical) {
  const actualCol = colMap[canonical];
  if (!actualCol) return '';
  return row[actualCol] ?? '';
}

const CHUNK_SIZE = 200;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: Admin only' }, { status: 403 });

    const { fileUrl, fileName } = await req.json();
    if (!fileUrl) return Response.json({ error: 'No fileUrl provided' }, { status: 400 });

    const startedAt = new Date().toISOString();

    // Fetch and parse file
    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok) return Response.json({ error: `Failed to fetch file: HTTP ${fileResp.status}` }, { status: 400 });

    const arrayBuffer = await fileResp.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rawRows.length === 0) return Response.json({ error: 'File is empty' }, { status: 400 });

    // Build column map
    const headers = Object.keys(rawRows[0]);
    const colMap = buildColumnMap(headers);

    // Handle single 'Customer' column
    const customerCol = headers.find(h => h.toString().trim().toLowerCase() === 'customer');
    if (customerCol) {
      if (!colMap['Customer ID']) colMap['Customer ID'] = customerCol;
      if (!colMap['Customer Name']) colMap['Customer Name'] = customerCol;
    }

    const missing = REQUIRED_CANONICAL.filter(c => !colMap[c]);
    if (missing.length > 0) {
      return Response.json({
        error: `Missing columns: ${missing.join(', ')}`,
        detectedHeaders: headers,
        columnMapping: colMap,
        missingColumns: missing
      }, { status: 400 });
    }

    // Normalize all rows
    const normalizedRows = [];
    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i];
      const orderNumber = get(raw, colMap, 'Order Number')?.toString().trim();
      const sku = get(raw, colMap, 'SKU')?.toString().trim();
      if (!orderNumber || !sku) continue;
      normalizedRows.push({
        order_number: orderNumber,
        customer_id: get(raw, colMap, 'Customer ID')?.toString().trim(),
        customer_name: get(raw, colMap, 'Customer Name')?.toString().trim(),
        order_date: toDateStr(get(raw, colMap, 'Order Date')),
        sales_rep: get(raw, colMap, 'Sales Representative')?.toString().trim(),
        sku,
        product_name: get(raw, colMap, 'Product Name')?.toString().trim(),
        brand: get(raw, colMap, 'Brand')?.toString().trim(),
        quantity: toNum(get(raw, colMap, 'Quantity')),
        line_total: toNum(get(raw, colMap, 'Line Total')),
        discount: toNum(get(raw, colMap, 'Discount')),
        tax: toNum(get(raw, colMap, 'Tax')),
      });
    }

    const totalRows = normalizedRows.length;
    const totalChunks = Math.ceil(totalRows / CHUNK_SIZE);

    // Create ImportLog
    const logRecord = await base44.asServiceRole.entities.ImportLog.create({
      file_name: fileName || 'upload.xlsx',
      uploaded_by: user.email,
      upload_started_at: startedAt,
      status: 'processing',
      total_rows_in_file: totalRows,
      rows_imported: 0, rows_updated: 0, rows_skipped: 0, rows_failed: 0,
      duplicate_rows_detected: 0, validation_errors_count: 0,
      error_details: '', summary_rebuild_status: 'pending'
    });

    // Return immediately — process in background to avoid HTTP timeout
    const processInBackground = async () => {
      let totalImported = 0, totalSkipped = 0, totalFailed = 0;
      try {
        for (let c = 0; c < totalChunks; c++) {
          const chunkRows = normalizedRows.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
          const result = await processRows(base44, chunkRows);
          totalImported += result.rowsImported;
          totalSkipped += result.rowsSkipped;
          await withRetry(() => base44.asServiceRole.entities.ImportLog.update(logRecord.id, {
            rows_imported: totalImported,
            rows_skipped: totalSkipped,
          }));
          if (c < totalChunks - 1) await sleep(3000);
        }
        await withRetry(() => base44.asServiceRole.entities.ImportLog.update(logRecord.id, {
          status: 'success',
          upload_finished_at: new Date().toISOString(),
          rows_imported: totalImported,
          rows_skipped: totalSkipped,
          rows_failed: totalFailed,
          summary_rebuild_status: 'triggered'
        }));
        base44.asServiceRole.functions.invoke('rebuildSummaries', {}).catch(() => {});
      } catch (bgErr) {
        await base44.asServiceRole.entities.ImportLog.update(logRecord.id, {
          status: 'failed',
          upload_finished_at: new Date().toISOString(),
          error_details: bgErr.message
        }).catch(() => {});
      }
    };

    // Fire and forget — don't await
    processInBackground();

    return Response.json({
      success: true,
      status: 'processing',
      importLogId: logRecord.id,
      totalRows,
      totalChunks,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});