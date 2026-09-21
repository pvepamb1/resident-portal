---
title: 'Landlord setup'
type: 'feature'
created: '2026-09-21'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'eeb28a89e2763b0472c81c4562a59612001b3146'
context: [
  '{project-root}/_bmad-output/specs/spec-tenant-portal/SPEC.md',
  '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-resident-portal-2026-09-11/ARCHITECTURE-SPINE.md',
  '{project-root}/_bmad-output/specs/spec-tenant-portal/tenant-auth-onboarding.md'
]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repository has no application code yet. Nothing exists for the landlord to log in with, and no way to add a tenant/unit/lease record — every later capability (tenant invitation, payments, reminders) assumes a landlord and a tenant record already exist.

**Approach:** Bootstrap the Next.js project per the architecture spine's stack and source tree; wire Better Auth (Google OAuth, phone+OTP, email magic link) behind an allowlist check restricted to one pre-configured landlord identity; build the domain logic and a minimal UI for the landlord to add, update, and manage tenant/unit/lease records, including generating and resending the tenant activation invitation (the invitation *email* itself — token, expiry, delivery — is built here; the tenant-facing *activation* page and login is CAP-6/Story 3's job).

## Boundaries & Constraints

**Always:** Landlord identity is checked against a specific allowlisted value — no path may create a second landlord account (SPEC.md non-goal). Every identifier (email, phone) is normalized before comparison or storage (AD-5). All three sign-in methods (Google OAuth, phone+OTP, email magic link) share one `Auth` port implementation for both landlord and future tenant use (AD-1, AD-5) — do not build a landlord-only auth path that CAP-6 would have to duplicate or replace later. Invitation tokens are one-time and expire after a few days (tenant-auth-onboarding.md).

**Never:** No password-based login (SPEC.md non-goal). No open landlord self-registration UI or endpoint. No tenant-facing activation/login page — that is Story 3. No payment, reminder, or Autopay code — those are later stories and must not be scaffolded here beyond the port interfaces AD-1 already names.

**Decisions (resolved from Open Questions):**
- Allowlisted landlord identity: `prasennavenkatesh@gmail.com`.
- Email adapter (Notifier port): Resend.
- Phone+OTP ships in this story (not deferred): SMS sender is MSG91, wired through Better Auth's native phone-number plugin — chosen over Twilio (India-specific pricing advantage) and over a Firebase-based bridge (Firebase Auth's tokens aren't checked for revocation by default, which conflicts with AD-6's immediate-revocation requirement; Firebase phone SMS also stopped being free in Sept 2024 and isn't cheaper than MSG91 for India anyway).
- Database: a new Neon project is being created for this story; connection string to be supplied via environment variable before migrations run.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Landlord login, allowlisted identity | Sign-in via any of the 3 methods, identity matches the allowlist | Session created, redirected to dashboard | N/A |
| Landlord login, non-allowlisted identity | Sign-in succeeds at the provider (e.g. a real Google account) but identity isn't on the allowlist | No session/dashboard access granted | Reject with a generic "not authorized" message — do not reveal whether the identity was almost recognized |
| Add tenant | Name, phone, email, unit, lease term, rent amount | Tenant/unit/lease records created; one-time invitation token generated and emailed | Reject if phone/email fails normalization or basic format validation |
| Resend invitation, tenant not yet activated | Landlord triggers resend on a pending tenant | New token issued (old one invalidated), invitation re-sent | N/A |
| Resend invitation, tenant already activated | Landlord triggers resend on an already-active tenant | No-op | Surface a clear message that this tenant is already active, not a silent no-op |
| Update tenant contact info | Landlord edits an existing tenant's phone/email | Record updated | If the tenant already activated their account, the *login* identifier they actually authenticate with is unchanged by this edit — only the on-file record for future identity-resolution matching updates (do not silently break an already-activated tenant's login) |

</frozen-after-approval>

## Code Map

No existing application code — this is the initial bootstrap. Nothing to reuse; nothing to avoid breaking. Follow `ARCHITECTURE-SPINE.md`'s Structural Seed source tree exactly for directory layout (`app/`, `core/`, `ports/`, `adapters/`, `db/`); do not invent a different structure.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `tsconfig.json`, `next.config.ts` -- bootstrap Next.js 16 (App Router) + TypeScript per the Stack table -- pinned versions must match ARCHITECTURE-SPINE.md exactly, not "latest"
- [x] `db/schema.ts` -- Drizzle schema for `landlords`, `tenants`, `units`, `leases` tables per the core-entity ERD -- foundation every later story's schema additions build on
- [x] `ports/auth.ts`, `ports/repository.ts`, `ports/notifier.ts` -- port interfaces, one shared `Result<T, PortError>` error contract (AD-1) -- do not let any adapter throw across these boundaries
- [x] `adapters/auth/` -- Better Auth wiring: Google OAuth, phone+OTP, email magic link plugins; identifier normalization on every method (AD-5); landlord allowlist check gating dashboard access
- [x] `adapters/db/` -- Drizzle-backed implementation of the repository port
- [x] `adapters/notify/` -- Resend email adapter and MSG91 SMS adapter, both implementing the `Notifier` port
- [x] `core/identity/` -- landlord allowlist check; tenant/unit/lease create + update; invitation token generation, expiry, and resend logic
- [x] `app/(landlord)/dashboard/` -- minimal UI: login, tenant list, add/edit tenant form, resend-invitation action
- [x] Unit tests for identifier normalization (AD-5) and the I/O matrix's edge cases above -- baseline test-first per AD-3, no heavy gate needed (this story touches no payment code)

**Acceptance Criteria:**
- Given the allowlisted identity, when signing in via any enabled method, then a session is created and the dashboard loads.
- Given a non-allowlisted identity, when attempting sign-in, then no session/dashboard access is granted and no distinguishing error reveals why.
- Given a new tenant's details, when the landlord submits the add-tenant form, then tenant/unit/lease records exist and an invitation email has been sent.
- Given an already-activated tenant, when the landlord triggers resend, then no new token is issued and a clear message explains why.

## Implementation Notes

**Stack version deviations (all upgrades, none downgrades of intent):**
- Next.js pinned to `16.3.5` instead of the spine's literal `16.3.0` -- `16.3.0`-`16.3.2` carry a critical unauthenticated-RCE advisory (GHSA-p293-qw3h-jr36); `16.3.5` is the patched release in the same minor line.
- `better-auth` / `@better-auth/drizzle-adapter` pinned to `1.7.5` rather than `1.6.0` -- the spine's constraint is "1.6+", and `1.6.0`'s own internal `@better-auth/core`/`@better-auth/utils` versions conflict under npm's resolver; `1.7.5` is the latest patch satisfying "1.6+" with no such conflict.
- `drizzle-kit` pinned to `0.31.11` (the spine only pins `drizzle-orm`, at `0.45.2`, which is installed exactly as specified). `drizzle-kit`'s own version line topped out at `0.31.x` before jumping to `1.0.0-rc.*`; `0.31.11` has no peer dependency on a specific `drizzle-orm` version and works cleanly against `0.45.2`.
- `vitest` (not in the spine's Stack table -- chosen here as the test runner `npm test` needs) pinned to `5.0.1` rather than an earlier `3.x`/`4.x`, both to get a released fix for a moderate `@vitest/mocker` path-traversal advisory and because `better-auth@1.7.5`'s optional peer range now include `^5.0.0`.
- Remaining `npm audit` finding: a moderate esbuild dev-server advisory transitively pulled in by `drizzle-kit`'s bundled `@esbuild-kit/esm-loader`. Dev-tooling-only (CLI `generate`/`migrate`/`push`, never runs in the deployed app), and the only suggested fix is a downgrade to a much older, less capable `drizzle-kit`. Left as an accepted risk.

**Linting could not use `eslint-config-next` as written.** `typescript-eslint` (which `eslint-config-next` depends on) throws at import time on any TypeScript >= 7.0 -- there's no released version supporting TS 7 yet (tracked upstream: typescript-eslint#10940), and this is a hard crash, not a peer-dependency warning. Since TS `7.0.2` is a pinned, deliberate spine requirement, `eslint.config.mjs` uses `@babel/eslint-parser` + `@babel/preset-typescript` (which only parse -- no dependency on the `typescript` package's version) for syntax, combined with `eslint-plugin-react`, `eslint-plugin-react-hooks`, and `@next/eslint-plugin-next` for the same rule coverage `eslint-config-next` would otherwise provide. Type-checking itself is unaffected -- `tsc --noEmit` and `next build`'s own TypeScript pass both run against the real TS 7.0.2 compiler and are clean.

**Money storage.** Rent is stored as `rentAmountPaise` (integer paise) on `leases`, per the Consistency Conventions' money-correctness discipline, even though this story never moves money -- avoids a schema migration later just to fix a float.

**IDs.** All domain table primary keys use Postgres 18's native `uuidv7()` as the column default (confirmed available on the provisioned Neon project, Postgres 18.6). The `neon-http` driver has no interactive (BEGIN/COMMIT-across-round-trips) transaction support, so `createTenantWithUnitAndLease` pre-generates its three rows' ids via one `select uuidv7() from generate_series(1,3)` call, then writes unit+tenant+lease together in one `db.batch(...)`, which Neon executes as a single atomic server-side transaction over one HTTP round trip.

**Better Auth's own tables** (`user`, `session`, `account`, `verification`, plus the phone-number plugin's `phoneNumber`/`phoneNumberVerified` fields on `user`) are hand-written in `db/auth-schema.ts` rather than CLI-generated -- no `@better-auth/cli` release exists compatible with `better-auth@1.7.5` (the standalone CLI package tops out at a much older `1.5.0-beta`). Verified instead by calling `@better-auth/core`'s internal `getAuthTables(options)` directly against this story's actual plugin config and diffing field-by-field against the hand-written schema -- exact match. `tenants.authUserId` references this `user.id` as a plain text column, not a DB foreign key, so this file can evolve independently in Story 3 without a migration coupling.

**Invitation token TTL** resolved to 3 days -- tenant-auth-onboarding.md only specifies "a few days."

**MSG91 integration** uses their transactional SMS v2 API (`route=4`, delivering an already-generated OTP code) rather than MSG91's own OTP-widget product, since Better Auth's phone-number plugin owns OTP generation/verification itself. This could not be tested against a real MSG91 account (no credentials provisioned) -- `MSG91_AUTH_KEY`/`MSG91_SENDER_ID` are empty placeholders in `.env.local`; the adapter returns a typed `NOTIFY_SMS_FAILED` error rather than throwing if the request fails, so this is safe to leave unconfigured until a real account exists. Google OAuth (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) and Resend (`RESEND_API_KEY`) are similarly unconfigured placeholders -- see `.env.example` for the full list and what each blocks until filled in.

**Landlord allowlist** is read from `LANDLORD_ALLOWLIST_EMAIL` (defaulted to `prasennavenkatesh@gmail.com` in `.env.local`, matching the frozen Decisions) and optional `LANDLORD_ALLOWLIST_PHONE` (left empty -- phone+OTP sign-in can never resolve to the landlord until a phone number is deliberately configured, which is the safe default per AD-5's "no ambiguity, exactly one identity permitted").

**Database.** Migrations were generated with `drizzle-kit generate` and applied with `drizzle-kit migrate` against the real Neon project already referenced by `DATABASE_URL` in `.env.local` -- all 9 tables (5 domain + 4 Better Auth) exist there now.

## Spec Change Log

No changes to the frozen Intent/Boundaries/I-O-matrix were needed -- the ambiguities called out above (invitation TTL, MSG91 API shape, exact patch versions) were implementation-level decisions within the frozen intent, not renegotiations of it.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `db/schema.ts` tenants table has no unique constraint on email/phone; `addTenant` doesn't check for existing duplicates before insert | medium | patch | Verified reachable today: submitting the add-tenant form twice with the same email/phone succeeds both times, creating two ambiguous tenant rows. Directly threatens AD-5/Story 3's identity-resolution model, which assumes exactly one on-file match per identifier. Fix mirrors the already-built, already-tested landlord unique-violation pattern (`isUniqueViolation`/`ALREADY_EXISTS` in `adapters/db/repository.ts`) rather than inventing a new mechanism. |
| 2 | `resendInvitationAction`/`updateTenantContactAction` don't verify `tenant.landlordId === landlord.id` before acting on a supplied `tenantId` | false | — | The frozen `<frozen-after-approval>` "Always" constraint guarantees exactly one landlord row can ever exist (enforced by `landlords_email_unique` plus the race-safe create-or-fetch in `resolveLandlordAccess`), so every tenant row necessarily belongs to that one landlord. The check would always evaluate true today and changes no observable behavior within this story's frozen single-landlord scope. |
| 3 | `addTenant` never validates `leaseStartDate` | low | patch | Traced: a malformed value (reachable via a direct POST to the server action, bypassing the HTML date input) produces an `Invalid Date` that reaches the `leases` insert and surfaces only as a generic `DB_ERROR`, unlike every other field in the same function which is validated first. |
| 4 | `requireLandlord()` runs once in `dashboard/layout.tsx` and again in `dashboard/page.tsx`, no request-level memoization | low | patch | Confirmed both call sites execute independently per request, doubling the session+DB round trip on every dashboard load. Trivial fix: wrap in React `cache()`. |
| 5 | No unit tests for `adapters/*` or the dashboard boundary (`require-landlord.ts`, `actions.ts`) | false | — | The story's own (non-frozen) Tasks & Acceptance directive scopes required coverage to identifier normalization + I/O-matrix edge cases ("no heavy gate needed... touches no payment code"), satisfied by 40 passing tests over `core/identity/*`. No specific untested defect was demonstrated beyond the two concrete gaps filed separately (rows 19–20), which are handled on their own. |
| 6 | Resend "from" address defaults to the shared `onboarding@resend.dev` sandbox domain | low | patch | Confirmed in `.env.example` and `adapters/notify/index.ts`. Resend's sandbox domain only delivers to the account owner's own verified address — real tenant invitations will silently fail to deliver until a verified custom domain is configured. Add a comment/warning flagging this operational gotcha. |
| 7 | `.env.example` hardcodes the real landlord email instead of a placeholder | false | — | Matches the frozen Intent's own resolved Decision ("Allowlisted landlord identity: `prasennavenkatesh@gmail.com`") for this single-landlord personal app — not an accidental PII leak into a shareable multi-tenant template. |
| 8 | No startup validation for `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`/notifier API keys, unlike `LANDLORD_ALLOWLIST_EMAIL` | low | patch | Confirmed `adapters/auth/index.ts` and `adapters/notify/index.ts` pass these through with no presence check, unlike `loadLandlordAllowlistFromEnv`'s explicit fail-fast throw. Misconfiguration surfaces later as a confusing runtime error instead of a clear boot-time one. |
| 9 | MSG91 adapter treats an unparseable/ambiguous response body as success | medium | patch | Confirmed in `adapters/notify/msg91-sms-notifier.ts`: `body?.type === 'error'` is the only failure check, so a 200 with an unparseable or unexpected-shape body falls through to `ok(undefined)`, silently reporting OTP delivery as successful when it may not have been. |
| 10 | No per-endpoint rate-limit override for MSG91 phone-OTP sending | low | patch | Checked Better Auth's actual defaults (`node_modules/better-auth/dist/context/create-context.mjs`): rate limiting is enabled by default in production, with a tight 3-per-10s rule for `/sign-in*` paths (already covers magic-link) but only the generic 100-per-10s ceiling for the phone-number OTP path — too loose for a cost-bearing SMS endpoint. Reviewer overstated "no rate limiting exists"; the real, narrower gap is worth a custom rule. |
| 11 | `GoogleSignIn` (`app/login/page.tsx`) has no error handling | medium | patch | Confirmed: unlike `PhoneSignIn`/`MagicLinkSignIn`, it never checks for a rejected/erroring `signIn.social` call nor resets `pending`. Directly reachable today — the build's own warning confirms `GOOGLE_CLIENT_ID`/`SECRET` are currently unconfigured, so clicking the button now leaves it stuck on "Redirecting…" with no recovery short of a page reload. |
| 12 | `uuidv7()` requires Postgres 18 with no runtime guard | false | — | The actual provisioned Neon project was live-verified as Postgres 18.6 during implementation (9 tables confirmed present via real migration run). This story's frozen scope pins to exactly one pre-provisioned Neon project; no code path here can point at an incompatible Postgres version. |
| 13 | `normalizePhone` doubles the country code for a "00"-prefixed international format (e.g. "0091...") | low | patch | Traced: the trunk-prefix branch strips *all* leading zeros (`replace(/^0+/, '')`) before prepending the default country code, so "00919876543210" becomes "+91919876543210" instead of "+919876543210". |
| 14 | `normalizePhone` accepts a "+"-prefixed number with a leading zero after the "+" (e.g. "+0987654321") as valid | medium | patch | Traced: when `hadPlus` is true, the function never checks for a post-"+" leading zero, so an invalid E.164 shape passes through unchanged — contradicts the I/O matrix's "reject if phone fails normalization or basic format validation" requirement. |
| 15 | Concurrent resend/add-tenant calls can race and invalidate a just-issued invitation token | low | rejected | Real in principle (traced the invalidate-then-create sequence in `issueInvitationToken`), but requires an unlikely double-submission (the resend button is already disabled while pending) in a single-landlord, low-traffic app, and the fix (per-tenant serialization) is more than a direct correction — rejected per the low-finding rule. |
| 16 | `updateTenantContact` with an all-undefined patch reports success without changing anything meaningful | low | patch | Traced: only reachable via a raw request bypassing the form's `required` fields; when reached, `normalized` stays `{}` and the repository call only bumps `updatedAt`, yet the action reports "Tenant contact info updated." Add a check for an empty patch. |
| 17 | MSG91 `fetch` call has no timeout | medium | patch | Confirmed no `AbortSignal`/timeout option in `adapters/notify/msg91-sms-notifier.ts`. A slow/unreachable MSG91 endpoint would hang the sign-in request indefinitely. |
| 18 | `loadLandlordAllowlistFromEnv` only trims, never case-folds/E.164-normalizes the allowlist email/phone before `createLandlord` persists it | low | patch | Traced: contradicts the "normalized before storage" invariant documented on `Landlord`/`db/schema.ts`. Dormant today only because the configured `.env.local` value happens to already be lowercase. |
| 19 | `addTenant`'s notifier-ordering guarantee (write commits before the invitation email sends) isn't asserted by any test | low | patch | Verified: `core/identity/tenant.test.ts`'s "addTenant success path" checks return value and call args but never `invocationCallOrder`, unlike the identical guarantee's test in `core/identity/invitation.test.ts:73-79`. A future reordering regression wouldn't fail any test. |
| 20 | `buildInvitationEmail`'s actual output (activation URL, token, HTML-escaping) is never asserted by any test | low | patch | Verified: no `invitation-email.test.ts` exists; both call sites' tests check only that `sendEmail` was called, never its `html`/`text`/`subject`. A broken link or reintroduced HTML-injection in the tenant name wouldn't fail any test. |

## Design Notes

Identity resolution here only covers the *landlord* side (matching a sign-in against the one allowlisted value). The fuller cross-method resolution logic in AD-5 (matching an unrecognized identity against an on-file record, with a one-time linking confirmation) is CAP-6/Story 3's concern for tenants — this story's `core/identity/` should expose that logic through a shape Story 3 can extend, not duplicate it later.

## Verification

**Commands:**
- `npm run build` -- ran clean: TypeScript compiles with zero errors, all 5 routes build (`/`, `/login`, `/dashboard`, `/api/auth/[...all]`, `/_not-found`).
- `npm test` -- 40/40 unit tests pass across 5 files (`core/identity/normalize.test.ts`, `landlord-allowlist.test.ts`, `landlord.test.ts`, `invitation.test.ts`, `tenant.test.ts`), covering identifier normalization, allowlist matching/rejection, the landlord-row-creation race, and every I/O-matrix edge case (add-tenant validation, resend on pending vs. already-active, update-contact never touching auth state).
- `npm run lint` -- zero errors, zero warnings.

**Also verified:**
- Migrations generated (`drizzle-kit generate`) and applied (`drizzle-kit migrate`) against the real Neon project in `.env.local`'s `DATABASE_URL`; confirmed all 9 tables exist afterward.
- Booted the production server (`next start`) and confirmed routing/gating behavior end-to-end: `/` redirects to `/login`; `/dashboard` with no session redirects to `/login?error=not_authorized` (the I/O matrix's generic-rejection path, exercised for real, not just unit-tested).

**Not verified (no credentials provisioned in this environment):**
- A real end-to-end sign-in via Google OAuth, phone+OTP (MSG91), or email magic link (Resend) -- `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `MSG91_AUTH_KEY`/`MSG91_SENDER_ID`, and `RESEND_API_KEY` are all empty placeholders (see `.env.example`). The plumbing is in place and type-checked (Better Auth wiring, MSG91/Resend adapters, the allowlist gate in `app/(landlord)/dashboard/require-landlord.ts`), and the allowlist-rejection path was verified for real via the redirect check above, but the "allowlisted identity reaches the dashboard" half of the acceptance criteria needs a human with real Google/MSG91/Resend credentials to confirm end-to-end. This is the main risk left open by this story.
