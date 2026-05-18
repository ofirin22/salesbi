import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, ChevronRight, ChevronLeft, ExternalLink } from 'lucide-react';

const PAGE_SIZE = 20;

const fmt = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState([]);
  const [customerFilter, setCustomerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      base44.entities.Order.list('-order_date', 2000),
      base44.entities.Customer.list('-created_date', 500)
    ]).then(([o, c]) => {
      setOrders(o);
      setFiltered(o);
      setCustomers(c);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    let res = [...orders];
    if (search) res = res.filter(o => o.order_number?.toLowerCase().includes(search.toLowerCase()));
    if (customerFilter) res = res.filter(o => o.customer_id === customerFilter);
    if (dateFrom) res = res.filter(o => o.order_date >= dateFrom);
    if (dateTo) res = res.filter(o => o.order_date <= dateTo);
    setFiltered(res);
    setPage(0);
  }, [search, customerFilter, dateFrom, dateTo, orders]);

  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Orders</h1>
        <p className="text-sm text-muted-foreground mt-1">{filtered.length.toLocaleString()} orders found</p>
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-2xl p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9 text-sm" placeholder="Search order number..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={customerFilter} onValueChange={v => setCustomerFilter(v === '_all' ? '' : v)}>
            <SelectTrigger className="text-sm"><SelectValue placeholder="All Customers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Customers</SelectItem>
              {customers.map(c => <SelectItem key={c.customer_id} value={c.customer_id}>{c.customer_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" className="text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <Input type="date" className="text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Order #', 'Customer', 'Date', 'Sales Rep', 'Total', 'Discount', 'Tax', ''].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(8).fill(0).map((_, i) => (
                  <tr key={i} className="border-t border-border">
                    {Array(8).fill(0).map((__, j) => (
                      <td key={j} className="py-3 px-4"><div className="h-4 bg-muted rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : pageData.map(o => (
                <tr key={o.id} className="border-t border-border hover:bg-muted/40 cursor-pointer transition-colors"
                  onClick={() => navigate(`/orders/${o.order_number}`)}>
                  <td className="py-3 px-4 font-mono text-xs font-semibold text-primary">{o.order_number}</td>
                  <td className="py-3 px-4 font-medium">{o.customer_name}</td>
                  <td className="py-3 px-4 text-muted-foreground">{o.order_date}</td>
                  <td className="py-3 px-4">{o.sales_representative}</td>
                  <td className="py-3 px-4 font-semibold">{fmt(o.order_total)}</td>
                  <td className="py-3 px-4 text-orange-600">{fmt(o.order_discount)}</td>
                  <td className="py-3 px-4 text-muted-foreground">{fmt(o.order_tax)}</td>
                  <td className="py-3 px-4">
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </td>
                </tr>
              ))}
              {!loading && !pageData.length && (
                <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">No orders found.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-muted-foreground">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setPage(p => p - 1)} disabled={page === 0}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm px-3 py-1 rounded bg-muted">{page + 1} / {totalPages}</span>
              <Button size="sm" variant="outline" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}