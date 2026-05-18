import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { DollarSign, ShoppingCart, Package, Tag, Receipt, TrendingUp } from 'lucide-react';
import KpiCard from '@/components/dashboard/KpiCard';
import DashboardFilters from '@/components/dashboard/DashboardFilters';

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#f59e0b', '#06b6d4', '#6366f1'];

const fmt = (n) => {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${(n || 0).toFixed(0)}`;
};

const fmtNum = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n || 0).toLocaleString()}`;
};

export default function Dashboard() {
  const { user } = useOutletContext();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({});

  const fetchData = async (f = {}) => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getDashboardData', f);
      setData(res.data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  const kpis = data?.kpis || {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Sales Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Business intelligence overview</p>
      </div>

      <DashboardFilters filterOptions={data?.filterOptions} onFilter={(f) => { setFilters(f); fetchData(f); }} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard title="Total Sales" value={fmt(kpis.totalSales)} icon={DollarSign} color="bg-blue-50 text-blue-600" />
        <KpiCard title="Total Orders" value={fmtNum(kpis.totalOrders)} icon={ShoppingCart} color="bg-violet-50 text-violet-600" />
        <KpiCard title="Total Quantity" value={fmtNum(kpis.totalQuantity)} icon={Package} color="bg-emerald-50 text-emerald-600" />
        <KpiCard title="Total Discount" value={fmt(kpis.totalDiscount)} icon={Tag} color="bg-orange-50 text-orange-600" />
        <KpiCard title="Total Tax" value={fmt(kpis.totalTax)} icon={Receipt} color="bg-pink-50 text-pink-600" />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales by Month */}
        <div className="chart-container">
          <h2 className="section-title mb-4">Sales by Month</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data?.salesByMonth || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}K`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [fmt(v), 'Sales']} />
              <Line type="monotone" dataKey="total_sales" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Sales by Brand */}
        <div className="chart-container">
          <h2 className="section-title mb-4">Sales by Brand</h2>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={data?.salesByBrand || []} dataKey="total_sales" nameKey="brand"
                cx="50%" cy="50%" outerRadius={90} label={({ brand, percent }) => `${brand} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}>
                {(data?.salesByBrand || []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => [fmt(v), 'Sales']} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales by Customer */}
        <div className="chart-container">
          <h2 className="section-title mb-4">Top Customers</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={(data?.salesByCustomer || []).slice(0,8)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}K`} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="customer_name" tick={{ fontSize: 10 }} width={100} />
              <Tooltip formatter={(v) => [fmt(v), 'Sales']} />
              <Bar dataKey="total_sales" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Sales by Rep */}
        <div className="chart-container">
          <h2 className="section-title mb-4">Sales by Representative</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data?.salesByRep || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="sales_representative" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}K`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [fmt(v), 'Sales']} />
              <Bar dataKey="total_sales" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Products */}
      <div className="chart-container">
        <h2 className="section-title mb-4">Top Products</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">SKU</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Product</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Brand</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quantity</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sales</th>
              </tr>
            </thead>
            <tbody>
              {(data?.topProducts || []).map((p, i) => (
                <tr key={p.sku} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 font-medium">{p.product_name}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-xs font-medium">{p.brand}</span>
                  </td>
                  <td className="py-3 px-4 text-right text-muted-foreground">{fmtNum(p.total_quantity)}</td>
                  <td className="py-3 px-4 text-right font-semibold text-foreground">{fmt(p.total_sales)}</td>
                </tr>
              ))}
              {!(data?.topProducts?.length) && (
                <tr><td colSpan={5} className="py-12 text-center text-muted-foreground text-sm">No data available. Upload an Excel file to get started.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}