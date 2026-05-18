import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CHUNK_SIZE = 2000;

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
  'quantity': 'Quantity', 'qty': 'Quantity', 'units': 'Quantity',
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

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = [];
    let cur = '', inQuote = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { values.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    values.push(cur.trim());
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }
  return { headers, rows };
}

function buildColumnMap(headers) {
  const map = {};
  for (const h of headers) {
    const normalized = h.toString().trim().toLowerCase();
    const canonical = COL_ALIASES[normalized];
    if (canonical && !map[canonical]) map[canonical] = h;
  }
  const customerCol = headers.find(h => h.toString().trim().toLowerCase() === 'customer');
  if (customerCol) {
    if (!map['Customer ID']) map['Customer ID'] = customerCol;
    if (!map['Customer Name']) map['Customer Name'] = customerCol;
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: Admin only' }, { status: 403 });

    const { fileUrl, fileName } = await req.json();
    if (!fileUrl) return Response.json({ error: 'No fileUrl provided' }, { status: 400 });

    // Create ImportLog immediately so frontend gets a log ID to poll
    const importLog = await base44.asServiceRole.entities.ImportLog.create({
      file_name: fileName || 'upload.csv',
      uploaded_by: user.email,
      upload_started_at: new Date().toISOString(),
      status: 'processing',
      total_rows_in_file: 0,
      rows_imported: 0, rows_updated: 0, rows_skipped: 0, rows_failed: 0,
      duplicate_rows_detected: 0, validation_errors_count: 0,
      error_details: '', summary_rebuild_status: 'pending'
    });

    // Do ALL heavy work in background: fetch, parse, normalize, chunk, upload
    const doAllInBackground = async () => {
      // Fetch CSV
      const fileResp = await fetch(fileUrl);
      if (!fileResp.ok) {
        await base44.asServiceRole.entities.ImportLog.update(importLog.id, {
          status: 'failed',
          error_details: `Failed to fetch file: HTTP ${fileResp.status}`
        });
        return;
      }
      const text = await fileResp.text();

      // Parse
      const { headers, rows } = parseCSV(text);
      if (!rows || rows.length === 0) {
        await base44.asServiceRole.entities.ImportLog.update(importLog.id, {
          status: 'failed', error_details: 'File is empty or could not be parsed'
        });
        return;
      }

      // Validate columns
      const colMap = buildColumnMap(headers);
      const missing = REQUIRED_CANONICAL.filter(c => !colMap[c]);
      if (missing.length > 0) {
        await base44.asServiceRole.entities.ImportLog.update(importLog.id, {
          status: 'failed',
          error_details: `Missing columns: ${missing.join(', ')}`
        });
        return;
      }

      // Normalize rows
      const normalizedRows = [];
      for (const raw of rows) {
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

      // Update log with actual row count
      await base44.asServiceRole.entities.ImportLog.update(importLog.id, {
        total_rows_in_file: totalRows
      });

      // Upload each chunk as a JSON file and create an ImportJob
      for (let c = 0; c < totalChunks; c++) {
        const chunkRows = normalizedRows.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
        const chunkFile = new File([JSON.stringify(chunkRows)], `chunk_${c}.json`, { type: 'application/json' });
        const uploadRes = await base44.asServiceRole.integrations.Core.UploadFile({ file: chunkFile });

        await base44.asServiceRole.entities.ImportJob.create({
          import_log_id: importLog.id,
          chunk_index: c,
          total_chunks: totalChunks,
          status: 'pending',
          rows_data_url: uploadRes.file_url,
          rows_imported: 0, rows_skipped: 0, rows_failed: 0, error_details: ''
        });
      }
    };

    doAllInBackground().catch(async (err) => {
      await base44.asServiceRole.entities.ImportLog.update(importLog.id, {
        status: 'failed',
        error_details: err.message
      }).catch(() => {});
    });

    // Return immediately — frontend polls processNextChunk for progress
    return Response.json({
      success: true,
      importLogId: importLog.id,
      // totalChunks unknown yet — frontend will get it from processNextChunk
      totalChunks: null,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});