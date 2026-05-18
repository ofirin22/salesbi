import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, retries = 5, baseDelay = 1000) {
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

// Split array into batches of given size
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function bulkCreateWithRetry(base44, entityName, records, batchSize = 100) {
  for (const batch of chunk(records, batchSize)) {
    await withRetry(() => base44.asServiceRole.entities[entityName].bulkCreate(batch));
    await sleep(600);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const importJobId = body.importJobId || body.event?.entity_id;

    const job = await withRetry(() => base44.asServiceRole.entities.ImportJob.get(importJobId));
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });
    if (job.status !== 'pending') return Response.json({ message: 'Already processed' });

    await withRetry(() => base44.asServiceRole.entities.ImportJob.update(importJobId, { status: 'processing' }));

    // Fetch rows from uploaded file URL
    const rowsResp = await fetch(job.rows_data_url);
    if (!rowsResp.ok) throw new Error(`Failed to fetch chunk data: HTTP ${rowsResp.status}`);
    const rows = await rowsResp.json();

    // Dedup within this chunk
    const newCustomers = new Map();
    const newProducts = new Map();
    const newOrders = new Map();
    const seenLineKeys = new Set();
    const newLines = [];
    let rowsSkipped = 0, rowsFailed = 0;

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

    const rowsImported = newLines.length;

    // Insert in batches with retry and delays between entity types
    if (newCustomers.size > 0) await bulkCreateWithRetry(base44, 'Customer', [...newCustomers.values()]);
    if (newProducts.size > 0) await bulkCreateWithRetry(base44, 'Product', [...newProducts.values()]);
    if (newOrders.size > 0) await bulkCreateWithRetry(base44, 'Order', [...newOrders.values()]);
    if (newLines.length > 0) await bulkCreateWithRetry(base44, 'OrderLine', newLines);

    await withRetry(() => base44.asServiceRole.entities.ImportJob.update(importJobId, {
      status: 'done', rows_imported: rowsImported, rows_skipped: rowsSkipped, rows_failed: rowsFailed
    }));

    // Check if all chunks for this log are done, then finalize
    const allJobs = await withRetry(() => base44.asServiceRole.entities.ImportJob.filter({ import_log_id: job.import_log_id }));
    const allDone = allJobs.every(j => j.status === 'done' || j.status === 'failed');

    if (allDone) {
      const totalImported = allJobs.reduce((s, j) => s + (j.rows_imported || 0), 0);
      const totalSkipped = allJobs.reduce((s, j) => s + (j.rows_skipped || 0), 0);
      const totalFailed = allJobs.reduce((s, j) => s + (j.rows_failed || 0), 0);
      const anyFailed = allJobs.some(j => j.status === 'failed');

      await withRetry(() => base44.asServiceRole.entities.ImportLog.update(job.import_log_id, {
        status: anyFailed ? 'partial_success' : 'success',
        upload_finished_at: new Date().toISOString(),
        rows_imported: totalImported, rows_skipped: totalSkipped, rows_failed: totalFailed,
        summary_rebuild_status: 'triggered'
      }));

      base44.asServiceRole.functions.invoke('rebuildSummaries', {}).catch(() => {});
    }

    return Response.json({ success: true, rowsImported, rowsSkipped });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});