import type { AuthPort } from '@/ports/auth';
import type { Notifier } from '@/ports/notifier';
import type { ObjectStorage } from '@/ports/object-storage';
import type { PaymentHistoryReader } from '@/ports/payment-history';
import type { RepositoryPort } from '@/ports/repository';
import { err, ok, type PortError, type Result } from '@/ports/result';
import type { Logger } from '@/core/shared/logger';
import type { TenantWithLease } from '@/core/identity/types';
import { buildTenancyExportCsv, EXPORT_CONTENT_TYPE, EXPORT_FILENAME, formatIstDate } from './export-csv';
import { buildTenancyExportEmail } from './export-email';

/**
 * CAP-8 / AD-6: landlord ends a tenancy.
 *
 * Ordering (spec Design Notes):
 *   ownership -> refuse self-revoke -> endLease (one atomic batch: lease
 *   ended + pending invitation tokens invalidated + auth sessions deleted)
 *   -> ensure snapshot -> email with attachment -> markExportSent.
 *
 * Access removal is never rolled back by a later failure: once `endLease`
 * commits, an export/storage/email error is reported but the lease stays
 * ended and sessions stay deleted. The email fires only after the ended
 * state has committed (AD-1). `resolveTenantAccess` (./access.ts) is the
 * access guarantee; session deletion is the fast path.
 */

export interface TenancyDeps {
  repository: RepositoryPort;
  auth: Pick<AuthPort, 'revokeAllSessionsForUser'>;
  storage: ObjectStorage;
  paymentHistory: PaymentHistoryReader;
  notifier: Notifier;
  logger: Logger;
  /** Injected clock for move-out date validation; defaults to `new Date()`. */
  now?: () => Date;
}

export interface EndDateValidationError {
  code: 'VALIDATION';
  field: 'endDate';
  message: string;
}

export type EndTenancyOutcome = { kind: 'ended' } | { kind: 'already_ended' };

export const ALREADY_ENDED_MESSAGE =
  "Tenancy already ended — use Send export if the tenant didn't receive it.";

const NOT_FOUND: PortError = { code: 'NOT_FOUND', message: 'Tenant not found.' };

/**
 * Parses the landlord-picked move-out date (`YYYY-MM-DD`, an IST calendar
 * date). Empty means today (IST). Past dates allowed; future dates
 * rejected. Returned as UTC midnight of that calendar date, which renders
 * back as the same date in IST.
 */
export function parseMoveOutDate(raw: string | null | undefined, now: Date): Result<Date, EndDateValidationError> {
  const todayIst = formatIstDate(now);
  const value = (raw ?? '').trim() || todayIst;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const invalid = err<EndDateValidationError>({
    code: 'VALIDATION',
    field: 'endDate',
    message: 'Enter a valid move-out date.',
  });
  if (!match) return invalid;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return invalid;
  }
  if (value > todayIst) {
    return err({ code: 'VALIDATION', field: 'endDate', message: 'Move-out date cannot be in the future.' });
  }
  return ok(date);
}

async function loadOwnedTenancy(
  repository: RepositoryPort,
  tenantId: string,
  landlordId: string,
): Promise<Result<TenantWithLease>> {
  const found = await repository.getTenantById(tenantId);
  if (!found.ok) return found;
  // Same error for "missing" and "someone else's" -- don't reveal which.
  if (!found.value || found.value.tenant.landlordId !== landlordId) return err(NOT_FOUND);
  return ok(found.value);
}

function refuseSelfRevoke(tenancy: TenantWithLease, actingUserId: string): Result<void> {
  if (tenancy.tenant.authUserId && tenancy.tenant.authUserId === actingUserId) {
    return err({
      code: 'SELF_REVOKE_REFUSED',
      message:
        'This tenant is linked to your own landlord login. Ending it would sign you out, so it was not ended.',
    });
  }
  return ok(undefined);
}

async function rerunRevoke(deps: TenancyDeps, tenancy: TenantWithLease): Promise<Result<void>> {
  if (!tenancy.tenant.authUserId) return ok(undefined);
  return deps.auth.revokeAllSessionsForUser(tenancy.tenant.authUserId);
}

export async function endTenancy(
  deps: TenancyDeps,
  input: { tenantId: string; landlordId: string; actingUserId: string; endDate?: string | null },
): Promise<Result<EndTenancyOutcome, PortError | EndDateValidationError>> {
  const endDate = parseMoveOutDate(input.endDate, (deps.now ?? (() => new Date()))());
  if (!endDate.ok) return endDate;

  const tenancy = await loadOwnedTenancy(deps.repository, input.tenantId, input.landlordId);
  if (!tenancy.ok) return tenancy;

  const self = refuseSelfRevoke(tenancy.value, input.actingUserId);
  if (!self.ok) return self;

  // Compare IST calendar dates: the snapshot must never show end < start.
  if (tenancy.value.lease.status === 'active' && formatIstDate(endDate.value) < formatIstDate(tenancy.value.lease.startDate)) {
    return err({
      code: 'VALIDATION',
      field: 'endDate',
      message: 'Move-out date cannot be before the lease start date.',
    });
  }

  const ended = await deps.repository.endLease({
    leaseId: tenancy.value.lease.id,
    endDate: endDate.value,
    endedBy: input.landlordId,
  });
  if (!ended.ok) return ended;

  if (ended.value.outcome === 'already_ended') {
    // Idempotent re-run of the revoke; no second transition, no email.
    const revoked = await rerunRevoke(deps, tenancy.value);
    if (!revoked.ok) return revoked;
    return ok({ kind: 'already_ended' });
  }

  const delivered = await deliverSnapshot(deps, { ...tenancy.value, lease: ended.value.lease });
  if (!delivered.ok) {
    logDeliveryFailure(deps, ended.value.lease.id, delivered.error);
    return err({
      code: 'EXPORT_DELIVERY_FAILED',
      message:
        'Tenancy ended and access revoked, but the payment-history export could not be sent. Use Send export to retry.',
      cause: delivered.error,
    });
  }
  return ok({ kind: 'ended' });
}

/**
 * "Send export": re-sends the one stored snapshot (generating it first if a
 * previous attempt never finished). Requires an already-ended lease and
 * re-runs the session revoke first.
 */
export async function sendTenancyExport(
  deps: TenancyDeps,
  input: { tenantId: string; landlordId: string; actingUserId: string },
): Promise<Result<{ kind: 'sent' }>> {
  const tenancy = await loadOwnedTenancy(deps.repository, input.tenantId, input.landlordId);
  if (!tenancy.ok) return tenancy;
  if (tenancy.value.lease.status !== 'ended') {
    return err({ code: 'NOT_ENDED', message: 'This tenancy has not ended.' });
  }

  const self = refuseSelfRevoke(tenancy.value, input.actingUserId);
  if (!self.ok) return self;

  const revoked = await rerunRevoke(deps, tenancy.value);
  if (!revoked.ok) return revoked;

  const delivered = await deliverSnapshot(deps, tenancy.value);
  if (!delivered.ok) {
    logDeliveryFailure(deps, tenancy.value.lease.id, delivered.error);
    return delivered;
  }
  return ok({ kind: 'sent' });
}

/** Lease id and error code only -- never CSV content or attachment bytes. */
function logDeliveryFailure(deps: TenancyDeps, leaseId: string, error: PortError): void {
  deps.logger.error('tenancy_export.delivery_failed', { leaseId, code: error.code });
}

/**
 * Reserve-first snapshot: every caller converges on the one reserved row
 * (key + generatedAt). If not yet uploaded, build the CSV from the row's
 * `generatedAt` and put it at the row's key -- racing writers produce
 * byte-identical content at the same key, so no orphans. If uploaded, read
 * the stored bytes back. Never regenerated once uploaded.
 */
async function ensureSnapshot(
  deps: TenancyDeps,
  tenancy: TenantWithLease,
): Promise<Result<{ exportId: string; content: Uint8Array }>> {
  const reserved = await deps.repository.reserveExport(tenancy.lease.id);
  if (!reserved.ok) return reserved;
  const row = reserved.value;

  if (row.uploadedAt) {
    const stored = await deps.storage.get(row.objectKey);
    if (!stored.ok) return stored;
    return ok({ exportId: row.id, content: stored.value });
  }

  const payments = await deps.paymentHistory.listForLease(tenancy.lease.id);
  if (!payments.ok) return payments;

  const csv = buildTenancyExportCsv({
    tenantName: tenancy.tenant.name,
    unitLabel: tenancy.unit.label,
    leaseStartDate: tenancy.lease.startDate,
    leaseEndDate: tenancy.lease.endDate,
    rentAmountPaise: tenancy.lease.rentAmountPaise,
    generatedAt: row.generatedAt,
    payments: payments.value,
  });
  const content = new Uint8Array(Buffer.from(csv, 'utf8'));

  const put = await deps.storage.put({ key: row.objectKey, body: content, contentType: EXPORT_CONTENT_TYPE });
  if (!put.ok) return put;

  const marked = await deps.repository.markExportUploaded(row.id);
  if (!marked.ok) return marked;

  return ok({ exportId: row.id, content });
}

async function deliverSnapshot(deps: TenancyDeps, tenancy: TenantWithLease): Promise<Result<void>> {
  const snapshot = await ensureSnapshot(deps, tenancy);
  if (!snapshot.ok) return snapshot;

  const email = buildTenancyExportEmail({
    tenantName: tenancy.tenant.name,
    unitLabel: tenancy.unit.label,
    invitationStatus: tenancy.tenant.invitationStatus,
  });
  const sent = await deps.notifier.sendEmail({
    to: tenancy.tenant.email,
    ...email,
    attachments: [
      { filename: EXPORT_FILENAME, content: Buffer.from(snapshot.value.content), contentType: EXPORT_CONTENT_TYPE },
    ],
  });
  if (!sent.ok) return sent;

  // The email is already accepted by the provider: report success. A
  // failed bookkeeping write is logged only, so nobody is prompted into
  // sending a duplicate email.
  const marked = await deps.repository.markExportSent(snapshot.value.exportId);
  if (!marked.ok) {
    deps.logger.error('tenancy_export.mark_sent_failed', {
      exportId: snapshot.value.exportId,
      leaseId: tenancy.lease.id,
      code: marked.error.code,
    });
  }
  return ok(undefined);
}
