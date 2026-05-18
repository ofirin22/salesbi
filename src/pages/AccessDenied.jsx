import { ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';

export default function AccessDenied() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="text-center max-w-md px-6">
        <div className="w-20 h-20 rounded-3xl bg-destructive/10 flex items-center justify-center mx-auto mb-6">
          <ShieldX className="w-10 h-10 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Access Denied</h1>
        <p className="text-muted-foreground mb-8 text-sm leading-relaxed">
          Your account has been deactivated. Please contact your system administrator to regain access.
        </p>
        <Button variant="outline" onClick={() => base44.auth.logout('/')}>Back to Login</Button>
      </div>
    </div>
  );
}