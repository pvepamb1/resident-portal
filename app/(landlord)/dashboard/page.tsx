import { drizzleRepository } from '@/adapters/db/repository';
import { AddTenantForm } from './add-tenant-form';
import { EditTenantForm } from './edit-tenant-form';
import { ResendInvitationButton } from './resend-invitation-button';
import { requireLandlord } from './require-landlord';

export default async function DashboardPage() {
  const landlord = await requireLandlord();
  const tenantsResult = await drizzleRepository.listTenantsByLandlord(landlord.id);
  const tenants = tenantsResult.ok ? tenantsResult.value : [];

  return (
    <>
      <section style={{ marginBottom: '2rem' }}>
        <h2>Tenants</h2>
        {tenantsResult.ok === false && <p role="alert">Could not load tenants right now.</p>}
        {tenants.length === 0 ? (
          <p>No tenants yet -- add one below.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Name</th>
                <th align="left">Unit</th>
                <th align="left">Rent</th>
                <th align="left">Status</th>
                <th align="left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map(({ tenant, unit, lease }) => (
                <tr key={tenant.id} style={{ borderTop: '1px solid #ddd' }}>
                  <td>
                    {tenant.name}
                    <br />
                    <small>
                      {tenant.email} &middot; {tenant.phone}
                    </small>
                  </td>
                  <td>{unit.label}</td>
                  <td>₹{(lease.rentAmountPaise / 100).toLocaleString('en-IN')}</td>
                  <td>{tenant.invitationStatus}</td>
                  <td>
                    <ResendInvitationButton tenantId={tenant.id} />
                    <EditTenantForm tenant={tenant} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <AddTenantForm />
    </>
  );
}
