import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import * as XLSX from 'npm:xlsx@0.18.5';

const REQUIRED_COLUMNS = [
  'Order Number', 'Customer ID', 'Customer Name', 'Order Date',
  'Sales Representative', 'SKU', 'Product Name', 'Brand',
  'Quantity', 'Line Total', 'Discount', 'Tax'
];

function normalizeHeader(h) {
  return h?.toString().trim();
}

function toNum(v) {
  const n = parseFloat(v);
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: Admin only' }, { status: 403 });

    const formData = await req.formData();
    const file = formData.get('file');
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 });

    const fileName = file.name || 'upload.xlsx';
    const startedAt = new Date().toISOString();

    // Create initial log
    const logRecord = await base44.asServiceRole.entities.ImportLog.create({
      file_name: fileName,
      uploaded_by: user.email,
      upload_started_at: startedAt,
      status: 'processing',
      total_rows_in_file: 0,
      rows_imported: 0,
      rows_updated: 0,
      rows_skipped: 0,
      rows_failed: 0,
      duplicate_rows_detected: 0,
      validation_errors_count: 0,
      error_details: '',
      summary_rebuild_status: 'pending'
    });

    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rawRows.length === 0) {
      await base44.asServiceRole.entities.ImportLog.update(logRecord.id, {
        status: 'failed', upload_finished_at: new Date().toISOString(),
        error_details: 'File is empty or has no data rows'
      });
      return Response.json({ error: 'File is empty' }, { status: 400 });
    }

    // Validate columns
    const headers = Object.keys(rawRows[0]).map(normalizeHeader);
    const missing = REQUIRED_COLUMNS.filter(c => !headers.includes(c));
    if (missing.length > 0) {
      await base44.asServiceRole.entities.ImportLog.update(logRecord.id, {
        status: 'failed', upload_finished_at: new Date().toISOString(),
        error_details: `Missing required columns: ${missing.join(', ')}`
      });
      return Response.json({ error: `Missing columns: ${missing.join(', ')}` }, { status: 400 });
    }

    const totalRows = rawRows.length;
    let rowsImported = 0, rowsUpdated = 0, rowsSkipped = 0, rowsFailed = 0;
    let duplicates = 0, validationErrors = 0;
    const errors = [];

    // Load existing data for deduplication
    const existingOrderLines = await base44.asServiceRole.entities.OrderLine.list('-created_date', 5000);
    const existingLineKeys = new Set(existingOrderLines.map(l => l.line_key));
    const existingOrders = await base44.asServiceRole.entities.Order.list('-created_date', 5000);
    const existingOrderNums = new Map(existingOrders.map(o => [o.order_number, o.id]));
    const existingCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 2000);
    const existingCustomerIds = new Map(existingCustomers.map(c => [c.customer_id, c.id]));
    const existingProducts = await base44.asServiceRole.entities.Product.list('-created_date', 5000);
    const existingSkus = new Map(existingProducts.map(p => [p.sku, p.id]));

    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i];
      try {
        const orderNumber = raw['Order Number']?.toString().trim();
        const customerId = raw['Customer ID']?.toString().trim();
        const customerName = raw['Customer Name']?.toString().trim();
        const orderDate = toDateStr(raw['Order Date']);
        const salesRep = raw['Sales Representative']?.toString().trim();
        const sku = raw['SKU']?.toString().trim();
        const productName = raw['Product Name']?.toString().trim();
        const brand = raw['Brand']?.toString().trim();
        const quantity = toNum(raw['Quantity']);
        const lineTotal = toNum(raw['Line Total']);
        const discount = toNum(raw['Discount']);
        const tax = toNum(raw['Tax']);

        if (!orderNumber || !sku) {
          validationErrors++;
          errors.push(`Row ${i + 2}: Missing order_number or sku`);
          rowsFailed++;
          continue;
        }

        const lineKey = `${orderNumber}__${sku}`;

        // Check duplicate
        if (existingLineKeys.has(lineKey)) {
          duplicates++;
          rowsSkipped++;
          continue;
        }

        // Upsert customer
        if (!existingCustomerIds.has(customerId) && customerId) {
          const newC = await base44.asServiceRole.entities.Customer.create({ customer_id: customerId, customer_name: customerName });
          existingCustomerIds.set(customerId, newC.id);
        }

        // Upsert product
        if (!existingSkus.has(sku)) {
          const newP = await base44.asServiceRole.entities.Product.create({ sku, product_name: productName, brand });
          existingSkus.set(sku, newP.id);
        }

        // Upsert order
        const orderTotal = toNum(raw['Order Total'] || lineTotal);
        const orderDiscount = toNum(raw['Order Discount'] || discount);
        const orderTax = toNum(raw['Order Tax'] || tax);

        if (!existingOrderNums.has(orderNumber)) {
          const newO = await base44.asServiceRole.entities.Order.create({
            order_number: orderNumber, customer_id: customerId, customer_name: customerName,
            sales_representative: salesRep, order_date: orderDate,
            order_total: orderTotal, order_discount: orderDiscount, order_tax: orderTax
          });
          existingOrderNums.set(orderNumber, newO.id);
        }

        // Create order line
        await base44.asServiceRole.entities.OrderLine.create({
          order_number: orderNumber, sku, product_name: productName, brand,
          quantity, line_total: lineTotal, discount, tax, line_key: lineKey
        });
        existingLineKeys.add(lineKey);
        rowsImported++;

      } catch (err) {
        rowsFailed++;
        errors.push(`Row ${i + 2}: ${err.message}`);
      }
    }

    // Rebuild summaries
    let summaryStatus = 'pending';
    try {
      await base44.asServiceRole.functions.invoke('rebuildSummaries', {});
      summaryStatus = 'success';
    } catch (e) {
      summaryStatus = `failed: ${e.message}`;
    }

    const status = rowsFailed === 0 ? 'success' : rowsImported > 0 ? 'partial_success' : 'failed';

    await base44.asServiceRole.entities.ImportLog.update(logRecord.id, {
      status,
      upload_finished_at: new Date().toISOString(),
      total_rows_in_file: totalRows,
      rows_imported: rowsImported,
      rows_updated: rowsUpdated,
      rows_skipped: rowsSkipped,
      rows_failed: rowsFailed,
      duplicate_rows_detected: duplicates,
      validation_errors_count: validationErrors,
      error_details: errors.slice(0, 50).join('\n'),
      summary_rebuild_status: summaryStatus
    });

    return Response.json({
      success: true, status, fileName,
      totalRows, rowsImported, rowsUpdated, rowsSkipped, rowsFailed,
      duplicates, validationErrors, summaryStatus,
      errors: errors.slice(0, 20)
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});