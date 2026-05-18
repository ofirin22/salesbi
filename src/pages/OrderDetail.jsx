import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Package, Calendar, User, Hash } from 'lucide-react';

const fmt = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function OrderDetail() {
  const { orderNumber } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      base44.entities.Order.filter({ order_number: orderNumber }),
      base44.entities.OrderLine.filter({ order_number: orderNumber })
    ]).then(([orders, orderLines]) => {
      setOrder(orders[0] || null);
      setLines(orderLines);
      setLoading(false);
    });
  }, [orderNumber]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  if (!order) return (
    <div className="text-center py-20 text-muted-foreground">Order not found.</div>
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/orders')} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Back to Orders
        </Button>
      </div>

      {/* Order Header */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Order #{order.order_number}</h1>
            <p className="text-sm text-muted-foreground mt-1">{order.order_date}</p>
          </div>
          <span className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
            {lines.length} line{lines.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
              <User className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Customer</p>
              <p className="text-sm font-semibold">{order.customer_name}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
              <Hash className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Sales Rep</p>
              <p className="text-sm font-semibold">{order.sales_representative}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Order Date</p>
              <p className="text-sm font-semibold">{order.order_date}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center">
              <Package className="w-4 h-4 text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Order Total</p>
              <p className="text-sm font-bold text-foreground">{fmt(order.order_total)}</p>
            </div>
          </div>
        </div>

        {/* Totals */}
        <div className="mt-6 pt-6 border-t border-border flex flex-wrap gap-8">
          <div>
            <p className="text-xs text-muted-foreground">Subtotal</p>
            <p className="text-lg font-bold">{fmt(order.order_total)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Discount</p>
            <p className="text-lg font-bold text-orange-500">-{fmt(order.order_discount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Tax</p>
            <p className="text-lg font-bold text-muted-foreground">{fmt(order.order_tax)}</p>
          </div>
        </div>
      </div>

      {/* Order Lines */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Order Lines</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['SKU', 'Product Name', 'Brand', 'Quantity', 'Line Total', 'Discount', 'Tax'].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map(line => (
                <tr key={line.id} className="border-t border-border hover:bg-muted/40 transition-colors">
                  <td className="py-3 px-4 font-mono text-xs text-primary font-semibold">{line.sku}</td>
                  <td className="py-3 px-4 font-medium">{line.product_name}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-xs">{line.brand}</span>
                  </td>
                  <td className="py-3 px-4">{line.quantity?.toLocaleString()}</td>
                  <td className="py-3 px-4 font-semibold">{fmt(line.line_total)}</td>
                  <td className="py-3 px-4 text-orange-500">-{fmt(line.discount)}</td>
                  <td className="py-3 px-4 text-muted-foreground">{fmt(line.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}