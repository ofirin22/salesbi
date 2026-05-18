import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  LayoutDashboard, ShoppingCart, Upload, Users, LogOut,
  Menu, X, BarChart3, ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Layout() {
  const [user, setUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    base44.auth.me().then(u => {
      if (!u) { base44.auth.redirectToLogin(); return; }
      if (u.status === 'not_active') { navigate('/access-denied'); return; }
      setUser(u);
    }).catch(() => base44.auth.redirectToLogin());
  }, []);

  const handleLogout = () => base44.auth.logout('/');

  const adminLinks = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/orders', label: 'Orders', icon: ShoppingCart },
    { path: '/upload', label: 'Upload Data', icon: Upload },
    { path: '/users', label: 'User Management', icon: Users },
  ];
  const userLinks = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/orders', label: 'Orders', icon: ShoppingCart },
  ];

  const navLinks = user?.role === 'admin' ? adminLinks : userLinks;

  if (!user) return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-16'} transition-all duration-300 flex flex-col bg-sidebar border-r border-sidebar-border flex-shrink-0`}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
            <BarChart3 className="w-4 h-4 text-white" />
          </div>
          {sidebarOpen && <span className="font-bold text-white text-base tracking-tight">SalesBi</span>}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
          {navLinks.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path;
            return (
              <Link key={path} to={path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 group
                  ${active
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  }`}>
                <Icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && <span className="text-sm font-medium">{label}</span>}
                {sidebarOpen && active && <ChevronRight className="w-3 h-3 ml-auto" />}
              </Link>
            );
          })}
        </nav>

        {/* User + Logout */}
        <div className="p-3 border-t border-sidebar-border">
          {sidebarOpen && (
            <div className="mb-2 px-2">
              <p className="text-xs font-semibold text-white truncate">{user.full_name}</p>
              <p className="text-xs text-sidebar-foreground truncate">{user.email}</p>
              <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-sidebar-accent text-sidebar-accent-foreground capitalize">
                {user.role}
              </span>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={handleLogout}
            className="w-full justify-start text-sidebar-foreground hover:text-white hover:bg-sidebar-accent gap-2">
            <LogOut className="w-4 h-4" />
            {sidebarOpen && <span className="text-sm">Logout</span>}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-14 border-b border-border flex items-center gap-4 px-6 bg-card">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-muted-foreground hover:text-foreground transition-colors">
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex-1" />
          <span className="text-sm text-muted-foreground">
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet context={{ user }} />
        </main>
      </div>
    </div>
  );
}