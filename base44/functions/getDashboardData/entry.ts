import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { dateFrom, dateTo, customerId, brand, salesRep } = body || {};

    // Fetch monthly summaries
    let monthly = await base44.asServiceRole.entities.MonthlySalesSummary.list('-month', 2000);
    let daily = await base44.asServiceRole.entities.DailySalesSummary.list('-summary_date', 5000);

    // Apply filters
    if (dateFrom) {
      const fromMonth = dateFrom.substring(0, 7);
      monthly = monthly.filter(m => m.month >= fromMonth);
      daily = daily.filter(d => d.summary_date >= dateFrom);
    }
    if (dateTo) {
      const toMonth = dateTo.substring(0, 7);
      monthly = monthly.filter(m => m.month <= toMonth);
      daily = daily.filter(d => d.summary_date <= dateTo);
    }
    if (customerId) {
      monthly = monthly.filter(m => m.customer_id === customerId);
      daily = daily.filter(d => d.customer_id === customerId);
    }
    if (brand) {
      monthly = monthly.filter(m => m.brand === brand);
      daily = daily.filter(d => d.brand === brand);
    }
    if (salesRep) {
      monthly = monthly.filter(m => m.sales_representative === salesRep);
      daily = daily.filter(d => d.sales_representative === salesRep);
    }

    // KPIs
    const kpis = {
      totalSales: daily.reduce((s, d) => s + (d.total_sales || 0), 0),
      totalQuantity: daily.reduce((s, d) => s + (d.total_quantity || 0), 0),
      totalDiscount: daily.reduce((s, d) => s + (d.total_discount || 0), 0),
      totalTax: daily.reduce((s, d) => s + (d.total_tax || 0), 0),
      totalOrders: new Set(daily.map(d => `${d.summary_date}|${d.customer_id}|${d.sales_representative}`)).size
    };

    // Sales by month
    const byMonth = new Map();
    for (const m of monthly) {
      const key = m.month;
      if (!byMonth.has(key)) byMonth.set(key, { month: key, total_sales: 0, orders_count: 0, total_quantity: 0 });
      const entry = byMonth.get(key);
      entry.total_sales += (m.total_sales || 0);
      entry.orders_count += (m.orders_count || 0);
      entry.total_quantity += (m.total_quantity || 0);
    }

    // Sales by customer
    const byCustomer = new Map();
    for (const m of monthly) {
      const key = m.customer_id || 'Unknown';
      if (!byCustomer.has(key)) byCustomer.set(key, { customer_id: key, customer_name: m.customer_name || key, total_sales: 0 });
      byCustomer.get(key).total_sales += (m.total_sales || 0);
    }

    // Sales by brand
    const byBrand = new Map();
    for (const m of monthly) {
      const key = m.brand || 'Unknown';
      if (!byBrand.has(key)) byBrand.set(key, { brand: key, total_sales: 0 });
      byBrand.get(key).total_sales += (m.total_sales || 0);
    }

    // Sales by rep
    const byRep = new Map();
    for (const m of monthly) {
      const key = m.sales_representative || 'Unknown';
      if (!byRep.has(key)) byRep.set(key, { sales_representative: key, total_sales: 0, orders_count: 0 });
      const entry = byRep.get(key);
      entry.total_sales += (m.total_sales || 0);
      entry.orders_count += (m.orders_count || 0);
    }

    // Top products from daily
    const byProduct = new Map();
    const orderLinesForProducts = await base44.asServiceRole.entities.OrderLine.list('-created_date', 5000);
    for (const ol of orderLinesForProducts) {
      const key = ol.sku;
      if (!byProduct.has(key)) byProduct.set(key, { sku: key, product_name: ol.product_name || key, brand: ol.brand || '', total_sales: 0, total_quantity: 0 });
      byProduct.get(key).total_sales += (ol.line_total || 0);
      byProduct.get(key).total_quantity += (ol.quantity || 0);
    }

    const topProducts = Array.from(byProduct.values())
      .sort((a, b) => b.total_sales - a.total_sales)
      .slice(0, 10);

    // Filter options
    const customers = await base44.asServiceRole.entities.Customer.list('-created_date', 500);
    const brands = [...new Set(orderLinesForProducts.map(ol => ol.brand).filter(Boolean))];
    const salesReps = [...new Set((await base44.asServiceRole.entities.Order.list('-created_date', 2000)).map(o => o.sales_representative).filter(Boolean))];

    return Response.json({
      kpis,
      salesByMonth: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)),
      salesByCustomer: Array.from(byCustomer.values()).sort((a, b) => b.total_sales - a.total_sales).slice(0, 10),
      salesByBrand: Array.from(byBrand.values()).sort((a, b) => b.total_sales - a.total_sales),
      salesByRep: Array.from(byRep.values()).sort((a, b) => b.total_sales - a.total_sales),
      topProducts,
      filterOptions: { customers, brands, salesReps }
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});