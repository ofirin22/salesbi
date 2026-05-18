import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Load all orders and order lines
    const orders = await base44.asServiceRole.entities.Order.list('-order_date', 10000);
    const orderLines = await base44.asServiceRole.entities.OrderLine.list('-created_date', 50000);

    const orderMap = new Map(orders.map(o => [o.order_number, o]));

    // Build daily summaries map: key = date|customer_id|brand|sales_rep
    const dailyMap = new Map();
    const monthlyMap = new Map();

    for (const line of orderLines) {
      const order = orderMap.get(line.order_number);
      if (!order || !order.order_date) continue;

      const dateStr = order.order_date.split('T')[0];
      const month = dateStr.substring(0, 7);
      const customerId = order.customer_id || '';
      const customerName = order.customer_name || '';
      const brand = line.brand || '';
      const salesRep = order.sales_representative || '';

      const dailyKey = `${dateStr}|${customerId}|${brand}|${salesRep}`;
      const monthlyKey = `${month}|${customerId}|${brand}|${salesRep}`;

      if (!dailyMap.has(dailyKey)) {
        dailyMap.set(dailyKey, {
          summary_date: dateStr, customer_id: customerId, customer_name: customerName,
          brand, sales_representative: salesRep, summary_key: dailyKey,
          total_quantity: 0, total_sales: 0, total_discount: 0, total_tax: 0,
          orders_count: 0, order_lines_count: 0, order_numbers: new Set()
        });
      }
      const d = dailyMap.get(dailyKey);
      d.total_quantity += (line.quantity || 0);
      d.total_sales += (line.line_total || 0);
      d.total_discount += (line.discount || 0);
      d.total_tax += (line.tax || 0);
      d.order_lines_count += 1;
      d.order_numbers.add(line.order_number);

      if (!monthlyMap.has(monthlyKey)) {
        monthlyMap.set(monthlyKey, {
          month, customer_id: customerId, customer_name: customerName,
          brand, sales_representative: salesRep, summary_key: monthlyKey,
          total_quantity: 0, total_sales: 0, total_discount: 0, total_tax: 0,
          orders_count: 0, order_numbers: new Set()
        });
      }
      const m = monthlyMap.get(monthlyKey);
      m.total_quantity += (line.quantity || 0);
      m.total_sales += (line.line_total || 0);
      m.total_discount += (line.discount || 0);
      m.total_tax += (line.tax || 0);
      m.order_numbers.add(line.order_number);
    }

    // Finalize counts
    for (const [, d] of dailyMap) {
      d.orders_count = d.order_numbers.size;
      delete d.order_numbers;
    }
    for (const [, m] of monthlyMap) {
      m.orders_count = m.order_numbers.size;
      delete m.order_numbers;
    }

    // Clear existing summaries
    const existingDaily = await base44.asServiceRole.entities.DailySalesSummary.list('-created_date', 50000);
    for (const d of existingDaily) {
      await base44.asServiceRole.entities.DailySalesSummary.delete(d.id);
    }
    const existingMonthly = await base44.asServiceRole.entities.MonthlySalesSummary.list('-created_date', 10000);
    for (const m of existingMonthly) {
      await base44.asServiceRole.entities.MonthlySalesSummary.delete(m.id);
    }

    // Insert new summaries in batches
    const dailyArr = Array.from(dailyMap.values());
    const monthlyArr = Array.from(monthlyMap.values());

    for (let i = 0; i < dailyArr.length; i += 100) {
      const batch = dailyArr.slice(i, i + 100);
      for (const item of batch) {
        await base44.asServiceRole.entities.DailySalesSummary.create(item);
      }
    }
    for (let i = 0; i < monthlyArr.length; i += 100) {
      const batch = monthlyArr.slice(i, i + 100);
      for (const item of batch) {
        await base44.asServiceRole.entities.MonthlySalesSummary.create(item);
      }
    }

    return Response.json({
      success: true,
      dailySummariesCreated: dailyArr.length,
      monthlySummariesCreated: monthlyArr.length
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});