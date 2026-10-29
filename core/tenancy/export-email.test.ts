import { describe, expect, it } from 'vitest';
import { buildTenancyExportEmail } from './export-email';

describe('buildTenancyExportEmail', () => {
  it('HTML-escapes tenant-supplied text in the body', () => {
    const email = buildTenancyExportEmail({ tenantName: '<script>x</script>', unitLabel: 'A & "B"', invitationStatus: 'active' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(email.html).toContain('A &amp; &quot;B&quot;');
  });

  it('contains no link to the export', () => {
    const email = buildTenancyExportEmail({ tenantName: 'T', unitLabel: 'U', invitationStatus: 'active' });
    expect(email.html).not.toMatch(/<a\s|href=|https?:\/\//i);
    expect(email.text).not.toMatch(/https?:\/\//i);
  });

  it('tells an activated tenant their access has been closed', () => {
    const email = buildTenancyExportEmail({ tenantName: 'T', unitLabel: 'U', invitationStatus: 'active' });
    expect(email.text).toContain('your access to the Resident Portal has been closed');
    expect(email.html).toContain('your access to the Resident Portal has been closed');
    expect(email.text).not.toContain('invitation');
  });

  it('tells a never-activated tenant their invitation is no longer valid (not that access was closed)', () => {
    const email = buildTenancyExportEmail({ tenantName: 'T', unitLabel: 'U', invitationStatus: 'pending' });
    expect(email.text).toContain('your invitation to the Resident Portal is no longer valid');
    expect(email.html).toContain('your invitation to the Resident Portal is no longer valid');
    expect(email.text).not.toContain('access');
    expect(email.html).not.toContain('access');
  });
});
