/**
 * The invitation *email* content -- token, expiry framing, delivery -- is
 * this story's job. The /invite/[token] activation page it links to does
 * not exist yet; that route and its handling are Story 3 / CAP-6.
 */
export function buildInvitationEmail(input: {
  tenant: { name: string };
  token: string;
  appBaseUrl: string;
}): { subject: string; html: string; text: string } {
  const activationUrl = `${input.appBaseUrl.replace(/\/+$/, '')}/invite/${input.token}`;
  const subject = "You're invited to your landlord's tenant portal";
  const text = [
    `Hi ${input.tenant.name},`,
    '',
    'Your landlord has added you to the Resident Portal. Activate your account using the link below:',
    activationUrl,
    '',
    'This link expires in a few days and can only be used once.',
  ].join('\n');
  const html = `
    <p>Hi ${escapeHtml(input.tenant.name)},</p>
    <p>Your landlord has added you to the Resident Portal. Activate your account using the link below:</p>
    <p><a href="${activationUrl}">${escapeHtml(activationUrl)}</a></p>
    <p>This link expires in a few days and can only be used once.</p>
  `.trim();
  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
