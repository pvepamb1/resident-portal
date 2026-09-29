import { drizzleRepository } from '@/adapters/db/repository';
import { formatIstDate, formatIstTimestamp } from '@/core/tenancy/export-csv';
import { AddTenantForm } from './add-tenant-form';
import { EditTenantForm } from './edit-tenant-form';
import { EndTenancyForm } from './end-tenancy-form';
import { ResendInvitationButton } from './resend-invitation-button';
import { SendExportButton } from './send-export-button';
import { requireLandlord } from './require-landlord';
import { lookupNotice } from './notices';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const landlord = await requireLandlord();
  const notice = lookupNotice((await searchParams).notice);
  const tenantsResult = await drizzleRepository.listTenantsByLandlord(landlord.id);
  const tenants = tenantsResult.ok ? tenantsResult.value : [];
  const current = tenants.filter(({ lease }) => lease.status === 'active');
  const past = tenants.filter(({ lease }) => lease.status === 'ended');
  const todayIst = formatIstDate(new Date());

  const endedByLabel = (endedBy: string | null) =>
    endedBy === null ? '—' : endedBy === landlord.id ? `${landlord.name} (${landlord.email})` : endedBy;

  return (
    <>
      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          style={{ color: notice.tone === 'error' ? '#a33' : '#2a6', marginBottom: '1rem' }}
        >
          {notice.message}
        </p>
      )}
      <section style={{ marginBottom: '2rem' }}>
        <h2>Tenants</h2>
        {tenantsResult.ok === false && <p role="alert">Could not load tenants right now.</p>}
        {current.length === 0 ? (
          <p>No current tenants -- add one below.</p>
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
              {current.map(({ tenant, unit, lease }) => (
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
                    <EndTenancyForm
                      tenantId={tenant.id}
                      tenantName={tenant.name}
                      todayIst={todayIst}
                      leaseStartIst={formatIstDate(lease.startDate)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {past.length > 0 && (
        <section style={{ marginBottom: '2rem' }}>
          <h2>Past tenancies</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Name</th>
                <th align="left">Unit</th>
                <th align="left">Rent</th>
                <th align="left">Lease</th>
                <th align="left">Ended</th>
                <th align="left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {past.map(({ tenant, unit, lease }) => (
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
                  <td>
                    {formatIstDate(lease.startDate)} – {lease.endDate ? formatIstDate(lease.endDate) : '—'}
                  </td>
                  <td>
                    {lease.endedAt ? formatIstTimestamp(lease.endedAt) : '—'}
                    <br />
                    <small>by {endedByLabel(lease.endedBy)}</small>
                  </td>
                  <td>
                    <SendExportButton tenantId={tenant.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <AddTenantForm />
    </>
  );
}
