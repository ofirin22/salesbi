import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Search, UserPlus, Edit, ShieldAlert } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const RoleBadge = ({ role }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${role === 'admin' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
    {role}
  </span>
);

const StatusBadge = ({ status }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
    {status}
  </span>
);

export default function UserManagement() {
  const { user: currentUser } = useOutletContext();
  const [users, setUsers] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editUser, setEditUser] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('user');
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const loadUsers = () => {
    base44.entities.User.list('-created_date', 200).then(u => {
      setUsers(u);
      setLoading(false);
    });
  };

  useEffect(() => { loadUsers(); }, []);

  useEffect(() => {
    let res = [...users];
    if (search) res = res.filter(u => u.full_name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase()));
    if (roleFilter) res = res.filter(u => u.role === roleFilter);
    if (statusFilter) res = res.filter(u => u.status === statusFilter);
    setFiltered(res);
  }, [users, search, roleFilter, statusFilter]);

  const handleSaveUser = async () => {
    if (!editUser) return;

    // Prevent last admin from being deactivated
    if (editUser.status === 'not_active' && editUser.role === 'admin') {
      const adminCount = users.filter(u => u.role === 'admin' && u.status === 'active' && u.id !== editUser.id).length;
      if (adminCount === 0) {
        toast({ title: 'Cannot deactivate last admin', variant: 'destructive' });
        return;
      }
    }

    // Prevent regular user from changing their own role
    if (editUser.id === currentUser.id && currentUser.role !== 'admin') {
      toast({ title: 'Cannot change your own role', variant: 'destructive' });
      return;
    }

    try {
      await base44.entities.User.update(editUser.id, {
        role: editUser.role,
        status: editUser.status
      });
      toast({ title: 'User updated successfully' });
      setEditUser(null);
      loadUsers();
    } catch (e) {
      toast({ title: 'Update failed', description: e.message, variant: 'destructive' });
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail) return;
    try {
      await base44.users.inviteUser(inviteEmail, inviteRole);
      toast({ title: `Invitation sent to ${inviteEmail}` });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('user');
      setTimeout(loadUsers, 1500);
    } catch (e) {
      toast({ title: 'Invite failed', description: e.message, variant: 'destructive' });
    }
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <ShieldAlert className="w-12 h-12 text-destructive mx-auto mb-3" />
          <p className="text-muted-foreground">Access denied. Admin only.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">User Management</h1>
          <p className="text-sm text-muted-foreground mt-1">{users.length} users in the system</p>
        </div>
        <Button onClick={() => setInviteOpen(true)} className="gap-2">
          <UserPlus className="w-4 h-4" /> Invite User
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-2xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9 text-sm" placeholder="Search by name or email..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={roleFilter} onValueChange={v => setRoleFilter(v === '_all' ? '' : v)}>
            <SelectTrigger className="text-sm"><SelectValue placeholder="All Roles" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Roles</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="user">User</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v === '_all' ? '' : v)}>
            <SelectTrigger className="text-sm"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="not_active">Not Active</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['User', 'Email', 'Role', 'Status', 'Joined', 'Actions'].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i} className="border-t border-border">
                    {Array(6).fill(0).map((__, j) => <td key={j} className="py-3 px-4"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}
                  </tr>
                ))
              ) : filtered.map(u => (
                <tr key={u.id} className="border-t border-border hover:bg-muted/40 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                        {(u.full_name || u.email || '?')[0].toUpperCase()}
                      </div>
                      <span className="font-medium">{u.full_name || '—'}</span>
                      {u.id === currentUser.id && <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">You</span>}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">{u.email}</td>
                  <td className="py-3 px-4"><RoleBadge role={u.role || 'user'} /></td>
                  <td className="py-3 px-4"><StatusBadge status={u.status || 'active'} /></td>
                  <td className="py-3 px-4 text-muted-foreground text-xs">{u.created_date ? new Date(u.created_date).toLocaleDateString() : '—'}</td>
                  <td className="py-3 px-4">
                    <Button variant="ghost" size="sm" onClick={() => setEditUser({ ...u })} className="gap-1 text-xs">
                      <Edit className="w-3.5 h-3.5" /> Edit
                    </Button>
                  </td>
                </tr>
              ))}
              {!loading && !filtered.length && (
                <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={() => setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {editUser && (
            <div className="space-y-4 py-2">
              <div>
                <p className="text-sm font-medium">{editUser.full_name}</p>
                <p className="text-xs text-muted-foreground">{editUser.email}</p>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={editUser.role || 'user'}
                  onValueChange={v => setEditUser(u => ({ ...u, role: v }))}
                  disabled={editUser.id === currentUser.id}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
                {editUser.id === currentUser.id && <p className="text-xs text-muted-foreground">You cannot change your own role.</p>}
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editUser.status || 'active'}
                  onValueChange={v => setEditUser(u => ({ ...u, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="not_active">Not Active</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={handleSaveUser}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite User Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Email Address</Label>
              <Input type="email" placeholder="user@example.com" value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={handleInvite} disabled={!inviteEmail}>Send Invitation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}