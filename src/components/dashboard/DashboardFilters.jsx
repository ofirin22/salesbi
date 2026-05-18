import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Filter, X } from 'lucide-react';

export default function DashboardFilters({ filterOptions, onFilter }) {
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', customerId: '', brand: '', salesRep: '' });

  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const clear = () => {
    const empty = { dateFrom: '', dateTo: '', customerId: '', brand: '', salesRep: '' };
    setFilters(empty);
    onFilter(empty);
  };

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="bg-card border border-border rounded-2xl p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Filters</span>
        {hasFilters && (
          <button onClick={clear} className="ml-auto text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors">
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Input type="date" value={filters.dateFrom} onChange={e => set('dateFrom', e.target.value)}
          className="text-sm" placeholder="From date" />
        <Input type="date" value={filters.dateTo} onChange={e => set('dateTo', e.target.value)}
          className="text-sm" placeholder="To date" />

        <Select value={filters.customerId} onValueChange={v => set('customerId', v === '_all' ? '' : v)}>
          <SelectTrigger className="text-sm"><SelectValue placeholder="All Customers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Customers</SelectItem>
            {(filterOptions?.customers || []).map(c => (
              <SelectItem key={c.customer_id} value={c.customer_id}>{c.customer_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.brand} onValueChange={v => set('brand', v === '_all' ? '' : v)}>
          <SelectTrigger className="text-sm"><SelectValue placeholder="All Brands" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Brands</SelectItem>
            {(filterOptions?.brands || []).map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filters.salesRep} onValueChange={v => set('salesRep', v === '_all' ? '' : v)}>
          <SelectTrigger className="text-sm"><SelectValue placeholder="All Sales Reps" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Reps</SelectItem>
            {(filterOptions?.salesReps || []).map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={() => onFilter(filters)} className="px-6">Apply Filters</Button>
      </div>
    </div>
  );
}