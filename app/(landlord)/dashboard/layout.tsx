import type { ReactNode } from 'react';
import { requireLandlord } from './require-landlord';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireLandlord();
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '2rem 1rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1>Resident Portal -- Landlord dashboard</h1>
      </header>
      {children}
    </div>
  );
}
