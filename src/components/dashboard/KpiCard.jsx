import { TrendingUp } from 'lucide-react';

export default function KpiCard({ title, value, icon: Icon, color, subtitle }) {
  return (
    <div className="kpi-card group">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{title}</p>
          <p className="text-2xl font-bold text-foreground truncate">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ml-3 ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}