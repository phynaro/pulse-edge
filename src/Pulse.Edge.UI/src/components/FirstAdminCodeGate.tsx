import type { ReactNode } from 'react';
import { Activity } from 'lucide-react';
import { useAuth } from '../context/auth';
import RecoveryCodeDisplay from './RecoveryCodeDisplay';

// Shows the first admin's recovery code above the whole app until it is acknowledged. It lives
// above the onboarding wizard because the wizard unmounts the moment setup becomes Operational.
export default function FirstAdminCodeGate({ children }: { children: ReactNode }) {
  const { pendingRecoveryCode, acknowledgeRecoveryCode } = useAuth();
  if (!pendingRecoveryCode) return <>{children}</>;
  return <div className="auth-shell">
    <div className="auth-grid" aria-hidden="true" />
    <section className="auth-card">
      <div className="auth-brand"><Activity size={24} /><span>PULSE <b>EDGE</b></span></div>
      <RecoveryCodeDisplay code={pendingRecoveryCode} onDone={acknowledgeRecoveryCode} />
    </section>
  </div>;
}
