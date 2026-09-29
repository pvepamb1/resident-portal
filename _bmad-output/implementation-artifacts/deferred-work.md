- source_spec: `_bmad-output/specs/spec-tenant-portal/stories/2-end-tenancy-and-revoke-access.md`
  summary: Re-adding a former tenant (same email) for a new tenancy fails on `tenants_email_unique` once their tenancy has ended.
  evidence: The unique index still covers ended tenants' rows; the frozen Story 2 intent excludes changing it (open SPEC question on identifier reuse). CAP-10 renewals will hit this.
- source_spec: `_bmad-output/specs/spec-tenant-portal/stories/2-end-tenancy-and-revoke-access.md`
  summary: R2 adapter `put`/`get` (PutObjectCommand/GetObjectCommand, NoSuchKey mapping) has no automated test.
  evidence: Only the unconfigured path is tested; swapping Bucket/Key or dropping ContentType fails no test. Cheap fix later: assert commands sent to a mocked `S3Client.send`.
- source_spec: `_bmad-output/specs/spec-tenant-portal/stories/2-end-tenancy-and-revoke-access.md`
  summary: Dashboard current/past tenancy split has no rendering test.
  evidence: vitest includes only `*.test.ts`; server-side guards already refuse writes on ended tenancies, so the gap is display-only.
