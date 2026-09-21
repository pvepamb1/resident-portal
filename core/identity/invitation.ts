import { createHash, randomBytes } from 'node:crypto';
import type { RepositoryPort } from '@/ports/repository';
import type { Notifier } from '@/ports/notifier';
import { ok, type Result } from '@/ports/result';
import type { InvitationToken, Tenant } from './types';
import { buildInvitationEmail } from './invitation-email';

/**
 * "A few days" per tenant-auth-onboarding.md -- 3 days chosen as the
 * concrete value (Implementation Notes documents this as a resolved
 * ambiguity, not left open).
 */
export const INVITATION_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 3;

export interface GeneratedInvitation {
  /** Raw, one-time token -- only ever held in memory long enough to email it. Never persisted raw. */
  token: string;
  record: InvitationToken;
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateRawInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Invalidates any still-pending token for the tenant and issues a fresh
 * one. Used both by "add tenant" (first invitation) and "resend invitation"
 * (I/O matrix: "New token issued (old one invalidated)").
 */
export async function issueInvitationToken(
  repository: RepositoryPort,
  tenantId: string,
): Promise<Result<GeneratedInvitation>> {
  const invalidated = await repository.invalidatePendingInvitationTokens(tenantId);
  if (!invalidated.ok) return invalidated;

  const token = generateRawInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TOKEN_TTL_MS);
  const created = await repository.createInvitationToken({
    tenantId,
    tokenHash: hashInvitationToken(token),
    expiresAt,
  });
  if (!created.ok) return created;

  return ok({ token, record: created.value });
}

export type ResendInvitationOutcome = { kind: 'sent' } | { kind: 'already_active' };

/**
 * Resend logic per the I/O matrix:
 * - pending tenant: new token issued (old invalidated), invitation re-sent.
 * - already-activated tenant: no-op, with a clear reason surfaced to the
 *   caller -- not a silent no-op.
 */
export async function resendInvitation(
  deps: { repository: RepositoryPort; notifier: Notifier; appBaseUrl: string },
  tenant: Tenant,
): Promise<Result<ResendInvitationOutcome>> {
  if (tenant.invitationStatus === 'active') {
    return ok({ kind: 'already_active' });
  }

  const issued = await issueInvitationToken(deps.repository, tenant.id);
  if (!issued.ok) return issued;

  const email = buildInvitationEmail({ tenant, token: issued.value.token, appBaseUrl: deps.appBaseUrl });
  const sent = await deps.notifier.sendEmail({ to: tenant.email, ...email });
  if (!sent.ok) return sent;

  return ok({ kind: 'sent' });
}
