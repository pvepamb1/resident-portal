---
title: 'End tenancy and revoke access'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '2a082acbf5d6fcc2ded33f91a485548069da7115'
context: [
  '{project-root}/_bmad-output/specs/spec-tenant-portal/SPEC.md',
  '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-resident-portal-2026-09-11/ARCHITECTURE-SPINE.md'
]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The landlord has no way to end a tenancy (CAP-8). A former tenant's session or pending invitation would keep working indefinitely, and they get no durable payment-history record after leaving.

**Approach:** A landlord "End tenancy" action that atomically ends the lease, invalidates pending invitation tokens and deletes all live sessions of the tenant's auth user (AD-6), then generates a point-in-time payment-history snapshot stored privately (AD-4) and emailed to the tenant as an attachment. Plus one core access check that Story 3's tenant gate must use, so an ended tenancy can never regain access.

## Boundaries & Constraints

**Always:** Revocation = deleting the user's DB session rows (verified: Better Auth 1.7.5 with a DB adapter reads the session from the DB on every request; `cookieCache` stays off). Session deletion is the fast path; `resolveTenantAccess` (Story 3 gate) is the guarantee. Access removal is never rolled back by a later failure. The snapshot is generated once per lease and never regenerated. Lease/tenant/unit rows are kept (CAP-3). Email fires only after the ended state commits (AD-1). New dependencies sit behind ports returning `Result<T, PortError>` (AD-1). The R2 API token is scoped to the one bucket with Object Read & Write only. Tenant-supplied text is HTML-escaped in email bodies.

**Never:** No ongoing login or read access for an ended tenancy — only the export. No tenant-initiated ending. No public bucket, no signed or unsigned download URL — the snapshot leaves storage only as an email attachment. No change to `tenants_email_unique` or identifier reuse (open SPEC question). No tenant portal/activation page (Story 3), no payment tables (Stories 4/6). Never revoke the acting landlord's own login. Never log CSV contents or attachment buffers.

**Decisions (resolved from Open Questions):**
- Export content: full pipeline now. Payment rows come from a `PaymentHistoryReader` port whose only adapter returns `ok([])`; Stories 4/6 swap the adapter without touching `core/tenancy/`.
- Object storage: Cloudflare R2 private bucket via AWS SDK v3 S3 client, behind an `ObjectStorage` port (`put`, `get`) that Story 4 extends as needed. No India residency (accepted for POC; S3 Mumbai is the migration path).
- Export delivery: email with the CSV **attached only** — no download link (a forwarded link would be a bearer credential for the tenant's financial data). "Send export" re-sends the *same* stored snapshot as an attachment.
- End date: the landlord picks a move-out date (default today; past dates allowed; future dates rejected). It overwrites `leases.endDate`, stored as UTC. Access is revoked immediately regardless of the date. The moment of the action and the acting landlord are recorded separately (`leases.endedAt`, `leases.endedBy`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| End, activated tenant | Active lease; tenant has `authUserId` with live sessions | Lease ended, tokens invalidated, sessions deleted in one batch; snapshot stored; email sent | N/A |
| End, never-activated tenant | Tenant `pending`, no `authUserId` | Same, no session delete; invitation can no longer be activated | N/A |
| End twice / double-submit | Lease already ended, or two concurrent submits | Exactly one transition and one email; revoke re-run (idempotent) | "Tenancy already ended — use Send export if the tenant didn't receive it" |
| End batch fails | DB error during the end batch | Nothing changes (lease active, tokens and sessions untouched) | Error shown; End can be retried |
| Export/store/email fails | Ended + revoked, later step errors | Lease stays ended, access stays revoked | Error shown; Send export retries, reusing the reserved snapshot row |
| Email sent, `lastSentAt` update fails | Email accepted by provider | Reported as success | Failure logged only (no duplicate-email retry prompt) |
| Future or invalid move-out date | Date after today (IST) or unparseable | Nothing changes | Validation error on the date field |
| Tenant linked to landlord's own login | `authUserId` equals acting landlord's user id | Nothing changes | Refuse with explanatory error |
| Resend/edit on ended tenancy | Landlord clicks resend or edits contact | No token issued / no edit, even if racing End | "Tenancy has ended" message |

</frozen-after-approval>


## Code Map

- `adapters/auth/auth-port.ts:40-51` -- `revokeAllSessionsForUser` deletes `session` rows; used for idempotent re-runs (already-ended End, Send export). `adapters/auth/index.ts` -- add a comment forbidding `cookieCache`/JWT (AD-6).
- `db/schema.ts` -- `leaseStatus` already has `ended`; `leases.endDate` exists (may already hold the contracted end date). Add `leases.endedAt` (timestamptz) and `leases.endedBy` (FK `landlords.id`). Add `tenancy_exports` (id, leaseId **unique**, objectKey, generatedAt, uploadedAt nullable, lastSentAt).
- `db/auth-schema.ts` -- `session` table; the end batch deletes from it directly (same Neon DB), a deliberate repository→auth-table crossing documented in a comment.
- `adapters/db/repository.ts` -- follow `isUniqueViolation`/`toPortError`. neon-http has no interactive tx: use a single conditional statement or `db.batch`.
- `core/identity/invitation.ts:61-76` -- `resendInvitation` checks a tenant snapshot only; token creation must become conditional on an active lease.
- `adapters/notify/resend-email-notifier.ts:17-27` -- lazy client construction pattern; copy it for R2 (never fail at module load, since `next build` imports adapters).
- `app/(landlord)/dashboard/actions.ts:45-54` -- existing actions skip landlord ownership checks; new actions must check `tenant.landlordId === landlord.id`.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- add pinned `@aws-sdk/client-s3` (no presigner)
- [x] `db/schema.ts` + `npm run db:generate` -- `tenancy_exports` with unique `leaseId` and nullable `uploadedAt`; `leases.endedAt`, `leases.endedBy`
- [x] `ports/object-storage.ts`, `adapters/db/r2-object-storage.ts` -- `put`, `get`; `region: 'auto'`, endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`; config validated lazily on first call, returning a typed error (object storage lives under `adapters/db/` per spine)
- [x] `ports/payment-history.ts`, `adapters/db/empty-payment-history.ts` -- `listForLease(leaseId)` → `ok([])`
- [x] `ports/notifier.ts`, `adapters/notify/resend-email-notifier.ts` -- `attachments?: { filename; content: string | Buffer; contentType }[]` mapped to Resend's `attachments`; any failure fails the send
- [x] `ports/repository.ts`, `adapters/db/repository.ts` -- `endLease({leaseId, endDate, endedBy, authUserId})` = one `db.batch`: `UPDATE leases SET status='ended', end_date, ended_at=now(), ended_by WHERE id AND status='active' RETURNING`, token invalidation, and `DELETE FROM session WHERE user_id` (when `authUserId`) → `ended | already_ended`; `reserveExport(leaseId)` = `INSERT … ON CONFLICT (lease_id) DO NOTHING` then select the row; `markExportUploaded`, `markExportSent`; `createInvitationToken` = `INSERT … SELECT … FROM leases WHERE tenant_id=$1 AND status='active' FOR SHARE` (row lock waits for a concurrent End to commit, then re-checks), zero rows ⇒ `LEASE_ENDED`
- [x] `core/tenancy/export-csv.ts` -- see Design Notes
- [x] `core/tenancy/end-tenancy.ts` -- `endTenancy(deps, {tenantId, landlordId, actingUserId, endDate})` and `sendTenancyExport(...)`: see Design Notes for ordering
- [x] `core/tenancy/access.ts` -- `resolveTenantAccess(repository, authUserId)` → `allowed | revoked | unknown`; `allowed` only if the linked tenant has an active lease
- [x] `core/identity/invitation.ts`, `core/identity/tenant.ts` -- reject resend/edit when the lease is ended
- [x] `app/(landlord)/dashboard/*` -- End tenancy (confirm step) and Send export actions with ownership check; "Past tenancies" section without edit/resend; `.env.example` R2 vars (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) with a note that the token must be bucket-scoped, Object Read & Write only
- [x] Tests for every matrix row, ordering, CSV escaping (including numeric cells left unprefixed), email HTML escaping, and `resolveTenantAccess`
- [x] DB-backed race test (against a real Postgres/Neon branch, skipped when `TEST_DATABASE_URL` is unset, which points at the Neon `test` branch; no test-DB harness exists yet) -- concurrent `endLease` + `createInvitationToken`; concurrent `reserveExport`

**Acceptance Criteria:**
- Given a tenant with a live session, when the landlord ends the tenancy, then that session's next request resolves no session.
- Given an ended tenancy, when End or Send export runs again, then the revoke runs again and no second snapshot object is created.
- Given two concurrent End submits, when both complete, then exactly one email is sent.
- Given End and Send export racing on the same lease, when both complete, then exactly one object exists in storage and it is the one referenced by `tenancy_exports`.
- Given a stored snapshot, when Send export runs, then the email carries a CSV attachment byte-identical to the stored object and contains no download link.
- Given the email notifier fails, when End runs, then the lease is still ended and sessions are still revoked.
- Given an ended tenancy, when resend races End, then no valid token exists afterwards.
- Given an ended tenancy, when the landlord views the dashboard, then it is listed under past tenancies with its data intact, including when and by whom it was ended.

## Implementation Notes

- `endLease` returns `{ outcome, lease }` (the lease as stored after the batch) so the snapshot uses the persisted move-out date; the batch's token invalidation and session delete run even when the lease was already ended (idempotent revoke).
- `updateTenantContact` (repository) is conditional on an active lease (`EXISTS ... FOR SHARE`) and returns `LEASE_ENDED`; `resendInvitation` now takes `{ tenant, lease }` and returns `{ kind: 'lease_ended' }` (fast path on the snapshot, `createInvitationToken`'s `LEASE_ENDED` as the guard).
- Added `RepositoryPort.listTenanciesByAuthUserId` for `resolveTenantAccess` (`allowed` if any linked lease is active; repository errors propagate, never default to allowed).
- `markExportUploaded` failure is treated as fatal for that attempt (retry re-puts byte-identical content to the same key). `markExportSent` failure is logged only.
- Move-out date: empty input means today (IST); stored as UTC midnight of the chosen IST calendar date, matching how lease start dates are already stored.
- Resend/edit/end/send-export server actions all check `tenant.landlordId === landlord.id` (existing resend/edit actions were fixed too). `requireLandlordSession()` exposes the acting auth user id for the self-revoke refusal.
- `leases.ended_by` FK is NO ACTION: deleting a landlord that has ended leases now fails unless tenants are deleted first (no landlord-delete path exists; the race test cleans up tenants first).
- Story 3 obligations recorded as `invoke_dev_with` on story 3 in `stories.yaml` (its spec does not exist yet).
- Test branch (`TEST_DATABASE_URL`) already had migration 0002 applied with an identical hash; the dev database (`DATABASE_URL`) has not been migrated by this story.

## Spec Change Log

- 2026-09-28 -- Advanced elicitation (Cascading Failure Simulation + Security Audit Personas), all proposals applied; frozen block renegotiated by the human:
  - Session delete moved into the `endLease` batch; "Revoke fails" matrix row replaced by "End batch fails".
  - Signed download URL dropped: attachment-only delivery; presigner dependency and `getSignedUrl` removed; `ObjectStorage` is `put`/`get`.
  - Snapshot storage made reserve-first (`uploadedAt`) to remove orphaned objects under races or crashes.
  - `createInvitationToken` uses `FOR SHARE` to close the End/resend race under READ COMMITTED.
  - `lastSentAt` failure non-fatal; "already ended" message points to Send export.
  - Added `leases.endedAt`/`endedBy` audit columns; R2 token scoping, email HTML escaping, no-logging rule; CSV sanitization limited to free-text cells; `resolveTenantAccess` named as the guarantee in Story 3 obligations.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | End result (incl. `EXPORT_DELIVERY_FAILED` "use Send export") never shown: `revalidatePath` moves the row to Past tenancies, unmounting `EndTenancyForm` and its `useActionState` (blind) | medium | patch | Confirmed `page.tsx:55` renders the form only in the `current` table; once the lease ends the row leaves it, so the one message that drives the retry flow is lost. |
| 2 | Session delete uses `authUserId` read before the batch; a tenant activating in between keeps a session (blind, edge-case x2) | low | patch | Real in principle, but no activation path exists until Story 3, and `resolveTenantAccess` is the spec's stated guarantee. Fix is a direct correction (key the delete on `tenants.auth_user_id` inside the batch), so kept. |
| 3 | Pending magic-link/OTP `verification` rows not cleared by End (blind) | false | — | Frozen Story 3 obligations explicitly assign this to `resolveTenantAccess`; no tenant-facing surface exists in this story that a stray session could reach. |
| 4 | Re-run revoke on already-ended / Send export can log a user out of another active tenancy (blind) | false | — | Spec mandates the re-run and records the one-user-one-tenant assumption; no path in this codebase links one auth user to two tenants (`authUserId` is never set yet). |
| 5 | Move-out date before `lease.startDate` accepted; stored snapshot shows an impossible range (blind, edge-case) | medium | patch | Confirmed `parseMoveOutDate` has no lower bound; the permanent CSV would carry end < start. |
| 6 | Export-delivery failures never logged (blind) | medium | patch | Confirmed: the cause is attached to the returned error and dropped by the actions; `logger.error` runs only on the `markExportSent` path, so a misconfigured R2 leaves no trace. |
| 7 | Dashboard shows no export sent/not-sent status (blind) | low | rejected | Real, but row 1's fix restores the failure signal and Send export is always available; showing status needs new repository read surface. |
| 8 | Send export has no throttle (blind) | low | rejected | Single allowlisted landlord; a cooldown adds state and branches. |
| 9 | Send export shows errors in the same neutral style as success, no `role="alert"` (blind) | low | patch | Confirmed in `send-export-button.tsx`; direct correction. |
| 10 | Stored object missing (uploadedAt set, `get` → NOT_FOUND) can never be recovered (blind, edge-case) | low | rejected | Frozen block says the snapshot is never regenerated; the bucket has no lifecycle rules, so loss requires manual deletion. |
| 11 | Export email tells never-activated tenants their access "has been closed" (blind) | low | patch | Confirmed in `export-email.ts`; hit every time a pending tenant is ended. Small branch on invitation status. |
| 12 | Raw-SQL `toDate` may produce Invalid Date (blind) | false | — | Probed the test branch: neon-http returns `"2026-10-02 03:51:47.202323+00"`, which `new Date(...)` parses to the correct instant. |
| 13 | No real-DB race test for `updateTenantContact` vs End; no action tests (blind) | low | patch | Action-test part merged into rows 24–25; the `updateTenantContact` race uses the same `FOR SHARE` pattern already DB-tested for `createInvitationToken`, so no separate test. |
| 14 | No CHECK constraint tying `status='ended'` to `ended_at`/`ended_by` (blind) | low | rejected | Only `endLease` writes these, atomically; adding a constraint means another migration for a state no code path produces. |
| 15 | `package.json` dependencies reordered; storage/payment adapters under `adapters/db/` (blind) | false | — | The reorder is npm's own normalization on install (versions unchanged); `adapters/db/` placement follows the spine and the spec's Code Map. |
| 16 | Contact edit committing between End's read and `endLease` gives a stale name in the CSV; a racing Send export could write different bytes (edge-case) | low | rejected | Requires the single landlord to edit and end the same tenant concurrently; the fix needs a re-read and re-check path. |
| 17 | Landlord's other auth user (phone vs email) linked to a tenant bypasses the self-revoke refusal (edge-case) | low | rejected | Requires Story 3 to link a landlord identity to a tenant, which its recorded obligations forbid; `LANDLORD_ALLOWLIST_PHONE` is unset. |
| 18 | `endLease` with a nonexistent lease id still deletes sessions (edge-case) | false | — | Only called with a lease id loaded moments earlier; after row 2's fix the delete is keyed through the lease row itself, so a missing lease deletes nothing. |
| 19 | `createInvitationToken` returns LEASE_ENDED for a nonexistent tenant (edge-case) | low | rejected | Both callers pass a tenant they just loaded or created; message-only inaccuracy. |
| 20 | Send export button: a thrown action (network) is an unhandled rejection (edge-case) | low | rejected | Rare; adding try/catch is a new guard for an undemonstrated state. |
| 21 | Re-adding an ended tenant with the same email fails on `tenants_email_unique` (edge-case) | medium | defer | Real, but the frozen block excludes changing `tenants_email_unique`/identifier reuse (open SPEC question); relevant to CAP-10 renewals. |
| 22 | "Ended by" shows a raw UUID for another landlord (edge-case) | false | — | `page.tsx:18-20` resolves the current landlord; only one landlord row can exist (`landlords_email_unique` + allowlist). |
| 23 | Attachment could differ from the stored object between racing writers (edge-case claim) | low | rejected | Same trigger as row 16 (payments list is empty today). |
| 24 | Ownership checks in `resendInvitationAction`/`updateTenantContactAction` untested (verification-gap) | medium | patch | Pre-verified by that layer: no test executes `actions.ts`; removing `loadOwnedTenant` fails nothing. |
| 25 | `actingUserId` wiring from `requireLandlordSession` untested; passing `landlord.id` would silently disable the self-revoke refusal (verification-gap) | medium | patch | Pre-verified: the core test hard-codes `actingUserId`. |
| 26 | R2 adapter `put`/`get` never exercised (verification-gap) | medium | defer | Pre-verified; mitigated by the manual smoke test against the real bucket once keys are provisioned. |
| 27 | Dashboard current/past split untested (verification-gap) | low | defer | Pre-verified; display only, since server-side guards refuse writes on ended tenancies and are tested. |
| 28 | `resolveTenantAccess` has no production caller (verification-gap, other) | false | — | Expected by design: Story 3 obligation recorded in `stories.yaml`. |

## Design Notes

**Ordering.** `endTenancy`: ownership check → refuse if `authUserId === actingUserId` → `endLease` (batch: lease ended + tokens invalidated + sessions deleted) → ensure snapshot → email with attachment → `markExportSent` (failure logged, not returned). `already_ended` re-runs `revokeAllSessionsForUser` (if `authUserId`) and returns without emailing. `sendTenancyExport` requires an ended lease, re-runs the revoke, then continues from "ensure snapshot".

**Ensure snapshot (reserve-first).** `reserveExport(leaseId)` inserts `{objectKey: 'tenancy-exports/<random 32-hex>.csv', generatedAt: now(), uploadedAt: null}` on conflict do nothing, then reads the row back — every caller converges on one key and one `generatedAt`. If `uploadedAt` is null: build the CSV using the row's `generatedAt`, `put` at the row's `objectKey`, `markExportUploaded`. Racing writers produce byte-identical content at the same key, so no orphans. If `uploadedAt` is set: `get` the object for the attachment. The key carries no personal data. Keeping `objectKey` in the DB is what makes a future DPDP deletion request possible (SPEC open question on retention) — comment this so it isn't optimized away.

**CSV.** RFC 4180 quoting. Free-text cells (tenant name, unit label, reference, status) starting with `= + - @ \t \r` get a leading `'`; numbers and dates the code formats itself are never prefixed (a future negative refund must stay `-500.00`). Top block of key/value rows (tenant name, unit, lease start, end, rent, generated at), then a blank line and the payment table (date, amount, status, reference). Money in rupees from paise (`12,500.00`), dates in IST `YYYY-MM-DD`, generated-at in IST with offset. Attachment filename `tenancy-payment-history.csv`, content type `text/csv`.

**Email.** Tenant name and unit label are HTML-escaped in the body. No links to the export. Never log the attachment or CSV body.

**Story 3 obligations** (record in its spec): `resolveTenantAccess` is the access guarantee — session deletion only shortens the window. Call it both at identity resolution and on every tenant request; on `revoked`, delete the new session (this also covers magic links/OTPs issued before End, whose `verification` rows are not cleared). Consume invitation tokens with a statement that is conditional on an active lease; never link the allowlisted landlord's auth user to a tenant. Revoking one auth user logs them out of every tenancy linked to that user, which is acceptable because only one tenant maps to a user today.

## Verification

**Commands:**
- `npm test` -- all existing and new tests pass (DB race tests run only when `TEST_DATABASE_URL` is set)
- `npm run build` && `npm run lint` -- clean; build must succeed with R2 env vars empty
- `npm run db:generate` -- exactly one new migration, adding `tenancy_exports` and `leases.ended_at`/`ended_by` only
