import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

function splitBatches(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function bulkUpsert(base44, entityName, records, batchSize = 25) {
  for (const batch of splitBatches(records, batchSize)) {
    await withRetry(() => base44.asServiceRole.entities[entityName].bulkCreate(batch));
    await sleep(3000);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { importLogId } = await req.json();
    if (!importLogId) return Response.json({ error: 'importLogId required' }, { status: 400 });

    // Find the next pending chunk for this import
    const allJobs = await withRetry(() =>
      base44.asServiceRole.entities.ImportJob.filter({ import_log_id: importLogId })
    );

    // Pick next pending chunk, or a stuck "processing" job (older than 5 min)
    const stuckThreshold = Date.now() - 5 * 60 * 1000;
    const pendingJob = allJobs
      .filter(j => j.status === 'pending' ||
        (j.status === 'processing' && new Date(j.updated_date).getTime() < stuckThreshold))
      .sort((a, b) => a.chunk_index - b.chunk_index)[0];

    if (!pendingJob) {
      // No pending chunks — check if all done or still uploading
      const importLog = await withRetry(() =>
        base44.asServiceRole.entities.ImportLog.get(importLogId)
      );
      const expectedTotal = importLog?.total_rows_in_file
        ? Math.ceil(importLog.total_rows_in_file / 2000)
        : null;

      // If total_rows_in_file is 0, background is still parsing — signal "not ready"
      if (!importLog?.total_rows_in_file || importLog.total_rows_in_file === 0) {
        return Response.json({ done: false, waiting: true, message: 'File still being parsed, retry soon' });
      }

      // If not all chunks have been created yet, signal "not ready"
      if (expectedTotal && allJobs.length < expectedTotal) {
        return Response.json({ done: false, waiting: true, message: 'Chunks still uploading, retry soon' });
      }

      const allDone = allJobs.every(j => j.status === 'done' || j.status === 'failed');
      if (allDone) {
        const totalImported = allJobs.reduce((s, j) => s + (j.rows_imported || 0), 0);
        const totalSkipped = allJobs.reduce((s, j) => s + (j.rows_skipped || 0), 0);
        const totalFailed = allJobs.reduce((s, j) => s + (j.rows_failed || 0), 0);
        const anyFailed = allJobs.some(j => j.status === 'failed');

        await withRetry(() => base44.asServiceRole.entities.ImportLog.update(importLogId, {
          status: anyFailed ? 'partial_success' : 'success',
          upload_finished_at: new Date().toISOString(),
          rows_imported: totalImported,
          rows_skipped: totalSkipped,
          rows_failed: totalFailed,
          summary_rebuild_status: 'triggered'
        }));

        // Trigger summary rebuild
        base44.asServiceRole.functions.invoke('rebuildSummaries', {}).catch(() => {});

        return Response.json({ done: true, totalImported, totalSkipped, totalFailed });
      }
      return Response.json({ done: false, message: 'All chunks processing or already done' });
    }

    // Mark as processing
    await withRetry(() =>
      base44.asServiceRole.entities.ImportJob.update(pendingJob.id, { status: 'processing' })
    );

    // Fetch rows from uploaded JSON
    const rowsResp = await fetch(pendingJob.rows_data_url);
    if (!rowsResp.ok) throw new Error(`Failed to fetch chunk data: HTTP ${rowsResp.status}`);
    const rows = await rowsResp.json();

    // Process rows: dedup, normalize, upsert
    const newCustomers = new Map();
    const newProducts = new Map();
    const newOrders = new Map();
    const seenLineKeys = new Set();
    const newLines = [];
    let rowsSkipped = 0, rowsFailed = 0;

    for (const row of rows) {
      const lineKey = `${row.order_number}__${row.sku}`;
      if (seenLineKeys.has(lineKey)) { rowsSkipped++; continue; }
      if (!row.order_number || !row.sku) { rowsFailed++; continue; }
      seenLineKeys.add(lineKey);

      if (row.customer_id && !newCustomers.has(row.customer_id)) {
        newCustomers.set(row.customer_id, { customer_id: row.customer_id, customer_name: row.customer_name });
      }
      if (row.sku && !newProducts.has(row.sku)) {
        newProducts.set(row.sku, { sku: row.sku, product_name: row.product_name, brand: row.brand });
      }
      if (!newOrders.has(row.order_number)) {
        newOrders.set(row.order_number, {
          order_number: row.order_number,
          customer_id: row.customer_id,
          customer_name: row.customer_name,
          sales_representative: row.sales_rep,
          order_date: row.order_date,
          order_total: row.line_total,
          order_discount: row.discount,
          order_tax: row.tax,
        });
      }
      newLines.push({
        order_number: row.order_number, sku: row.sku, product_name: row.product_name,
        brand: row.brand, quantity: row.quantity, line_total: row.line_total,
        discount: row.discount, tax: row.tax, line_key: lineKey,
      });
    }

    if (newCustomers.size > 0) await bulkUpsert(base44, 'Customer', [...newCustomers.values()]);
    if (newProducts.size > 0) await bulkUpsert(base44, 'Product', [...newProducts.values()]);
    if (newOrders.size > 0) await bulkUpsert(base44, 'Order', [...newOrders.values()]);
    if (newLines.length > 0) await bulkUpsert(base44, 'OrderLine', newLines);

    const rowsImported = newLines.length;

    // Mark job done
    await withRetry(() =>
      base44.asServiceRole.entities.ImportJob.update(pendingJob.id, {
        status: 'done',
        rows_imported: rowsImported,
        rows_skipped: rowsSkipped,
        rows_failed: rowsFailed,
      })
    );

    // Update ImportLog progress
    const updatedJobs = await withRetry(() =>
      base44.asServiceRole.entities.ImportJob.filter({ import_log_id: importLogId })
    );
    const totalImportedSoFar = updatedJobs.reduce((s, j) => s + (j.rows_imported || 0), 0);
    const totalSkippedSoFar = updatedJobs.reduce((s, j) => s + (j.rows_skipped || 0), 0);
    const totalFailedSoFar = updatedJobs.reduce((s, j) => s + (j.rows_failed || 0), 0);
    const doneCount = updatedJobs.filter(j => j.status === 'done' || j.status === 'failed').length;
    const totalChunks = pendingJob.total_chunks;

    await withRetry(() =>
      base44.asServiceRole.entities.ImportLog.update(importLogId, {
        rows_imported: totalImportedSoFar,
        rows_skipped: totalSkippedSoFar,
        rows_failed: totalFailedSoFar,
      })
    );

    const remainingPending = updatedJobs.filter(j => j.status === 'pending').length;

    return Response.json({
      done: false,
      chunkProcessed: pendingJob.chunk_index,
      chunksRemaining: remainingPending,
      chunksTotal: totalChunks,
      chunksDone: doneCount,
      rowsImported,
      rowsSkipped,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});