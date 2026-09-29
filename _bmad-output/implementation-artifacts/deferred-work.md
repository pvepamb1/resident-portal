- source_spec: `_bmad-output/specs/spec-tenant-portal/stories/2-end-tenancy-and-revoke-access.md`
  summary: Re-adding a former tenant (same email) for a new tenancy fails on `tenants_email_unique` once their tenancy has ended.
  evidence: The unique index still covers ended tenants' rows; the frozen Story 2 intent excludes changing it (open SPEC question on identifier reuse). CAP-10 renewals will hit this.
- source_spec: `_bmad-output/specs/spec-tenant-portal/stories/2-end-tenancy-and-revoke-access.md`
  summary: R2 adapter `put`/`get` (PutObjectCommand/GetObjectCommand, NoSuchKey mapping) has no automated test.
  evidence: Only the unconfigured path is tested; swapping Bucket/Key or dropping ContentType fails no test. Cheap fix later: assert commands sent to a mocked `S3Client.send`.
- source_spec: `_bmad-output/specs/spec-tenant-portal/stories/2-end-tenancy-and-revoke-access.md`
  summary: Dashboard current/past tenancy split has no rendering test.
  evidence: vitest includes only `*.test.ts`; server-side guards already refuse writes on ended tenancies, so the gap is display-only.
- source_spec: none
  summary: Phone+OTP sign-in via MSG91 is deferred until TRAI DLT registration (sender ID + OTP template) is done, after which the adapter must switch from free-text SMS to MSG91's DLT template API.
  evidence: Indian carriers drop business SMS not sent from a DLT-registered sender and template; DLT registration needs business-entity documents and days of approval. The current adapter (adapters/notify/msg91-sms-notifier.ts) sends free text via route=4. Google OAuth and email magic link cover landlord and tenant sign-in meanwhile. Decided 2026-09-29.
