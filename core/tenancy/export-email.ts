import { escapeHtml } from '@/core/shared/escape-html';
import type { InvitationStatus } from '@/core/identity/types';

/**
 * Email that carries the CAP-8 snapshot. The CSV travels as an attachment
 * only -- this body deliberately contains no link to the export (a
 * forwarded link would be a bearer credential for financial data).
 * Tenant-supplied text is HTML-escaped.
 */
export function buildTenancyExportEmail(input: {
  tenantName: string;
  unitLabel: string;
  /** A never-activated (`pending`) tenant never had access -- only an invitation. */
  invitationStatus: InvitationStatus;
}): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'Your rent payment history';
  const closing =
    input.invitationStatus === 'pending'
      ? 'your invitation to the Resident Portal is no longer valid'
      : 'your access to the Resident Portal has been closed';
  const text = [
    `Hi ${input.tenantName},`,
    '',
    `Your tenancy at ${input.unitLabel} has ended and ${closing}.`,
    'Your payment history for this tenancy is attached as a CSV file. Please keep it for your records.',
  ].join('\n');
  const html = `
    <p>Hi ${escapeHtml(input.tenantName)},</p>
    <p>Your tenancy at ${escapeHtml(input.unitLabel)} has ended and ${closing}.</p>
    <p>Your payment history for this tenancy is attached as a CSV file. Please keep it for your records.</p>
  `.trim();
  return { subject, html, text };
}
