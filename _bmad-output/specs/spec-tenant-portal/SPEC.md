---
id: SPEC-tenant-portal
companions: [compliance-references.md, tenant-auth-onboarding.md, ../planning-artifacts/architecture/architecture-resident-portal-2026-09-11/ARCHITECTURE-SPINE.md]
sources: [_bmad-output/forge/tenant-portal/forged-idea.md]
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Tenant Portal

## Why

A vision to realize, not a pain to solve: Prasenna's own rent situation (one tenant, direct bank transfer, occasional late payment) is already solvable with a spreadsheet in an afternoon. The real force behind this spec is a product-building and learning goal — ship a real, two-sided rent-payment portal for India's 1–5 unit landlords, using his own tenancy as the first dogfood case rather than the target problem. He has explicitly chosen to build and learn rather than validate demand first.

## Capabilities

- **CAP-1**
  - **intent:** Landlord and tenant can move real rent money through the app — actual funds changing hands, not just a record of what's owed.
  - **success:** A real UPI transaction completes end-to-end through the gateway and appears correctly in payment history.

- **CAP-2**
  - **intent:** Tenant logs into their own persistent portal account to see rent-due reminders and pay rent — everything happens inside the logged-in portal, no separate no-login payment path.
  - **success:** A logged-in tenant sees an accurate rent-due reminder and completes payment from within the portal.

- **CAP-3**
  - **intent:** Landlord sees a running payment history per tenant/unit and an aggregate view across all their units, and each tenant sees their own payment history through their own portal account.
  - **success:** Both views reflect every completed transaction accurately, matching the gateway's settlement record, and distinguish pending/processing payments from completed ones so a tenant isn't left wondering whether a payment went through. The aggregate view reflects the sum of all units' completed transactions accurately for a given period.

- **CAP-4**
  - **intent:** Landlord and tenant can store and view lease documents in-app, tenant accessing them through their own logged-in portal account.
  - **success:** A document the landlord uploads is viewable by the tenant in their portal.

- **CAP-5**
  - **intent:** Tenant can set up a recurring UPI Autopay mandate so rent auto-debits monthly without manual action each cycle, and can cancel an active mandate.
  - **success:** A mandate created once continues to auto-debit on schedule, with tap-to-confirm handled inside the tenant's own UPI app via NPCI push; cancelling it stops future auto-debits with no orphaned mandate left active on Razorpay's side. See `compliance-references.md` for mandate mechanics.

- **CAP-6**
  - **intent:** Tenant can be invited by the landlord to activate a persistent portal account, then authenticate via Google OAuth, phone+OTP, or email magic link on future visits. Whichever method is used, identity resolves to the correct tenant record by matching the phone number or email the landlord already has on file; an identifier that doesn't match anything on file (e.g. a Google sign-in email not on record) triggers a one-time confirmation of an on-file identifier instead of creating a duplicate account. See `tenant-auth-onboarding.md`.
  - **success:** A tenant invited by the landlord activates an account via any of the three methods, and using a second method later (e.g. Google after phone+OTP) lands on the same account, never a duplicate.

- **CAP-7**
  - **intent:** The one pre-configured landlord (Prasenna) can log in via Google OAuth, phone+OTP, or email magic link — no open self-service landlord registration, access limited to a specific allowlisted landlord for the POC — and once logged in, add, update, and manage tenant records, units, and lease details, including changes after initial creation.
  - **success:** Prasenna logs in via any of the three methods and adds a tenant with unit/lease/rent details; an unauthorized identity cannot create a landlord account. Prasenna can also update a tenant's on-file phone/email, change the rent amount on an existing lease, and resend an expired invitation.

- **CAP-8**
  - **intent:** Landlord can end a tenancy, which revokes that tenant's portal access.
  - **success:** Landlord ends a lease; the former tenant's active sessions are invalidated immediately (not just future logins blocked) and they can no longer log in or see new data for that unit. A point-in-time export/snapshot of their own payment history for that tenancy is generated at the moment of offboarding and made available to them — not ongoing login access, since that would reopen a risk if the same phone/email is later reassigned to someone else. The landlord's own historical payment records for that tenancy remain intact (CAP-3 unaffected).

- **CAP-9**
  - **intent:** Landlord can refund a payment, in part or in full, back to the tenant via the gateway.
  - **success:** A refund initiated by the landlord completes through Razorpay and is reflected accurately in payment history for both landlord and tenant views.

- **CAP-10**
  - **intent:** Landlord can renew an existing tenant's lease for a new term without creating a duplicate tenant record.
  - **success:** A renewed lease continues under the same tenant account, preserving payment-history continuity, with an updated term and rent amount if changed. If the rent amount changes, any active Autopay mandate (CAP-5) is updated or recreated to match — never left silently pointing at the old amount.

- **CAP-11**
  - **intent:** Landlord receives notifications for payment received, autopay failure, and tenant activation — without needing to actively check the portal.
  - **success:** Landlord is notified (email or SMS, consistent with the no-WhatsApp constraint) for each of those three events.

## Constraints

- App is pure orchestration on a licensed payment gateway (Razorpay/Cashfree-class) and never custodies funds — keeps it out of RBI Payment Aggregator licensing.
- POC is built for single-landlord (Prasenna's own) use first; the payment module must stay isolated/modular so productizing later means rewriting that layer only, not the app.
- Design for 1–5 unit landlords; do not optimize for large multi-unit portfolios or property managers.
- Auto-pay's tap-to-confirm step must happen inside the tenant's own UPI app via NPCI push — a website is sufficient, no native mobile app required.
- UPI Autopay AFA threshold confirmed at ~₹15,000 — any subsequent debit above this requires tenant approval via UPI PIN in their own UPI app.
- If a paid tier ever launches, whoever is already using the product at that point stays free — no retroactive paywalling of existing users.
- Reminders are delivered via email or SMS only — never WhatsApp.
- Reminders must be suppressed only when this cycle's Autopay auto-debit has actually succeeded — not merely because a mandate exists. A tenant whose autopay fails for a cycle (insufficient balance, lapsed mandate) must still get the reminder, otherwise the one month it fails is exactly the month they'd get no nudge that rent wasn't paid.
- A refund (CAP-9) can never exceed the amount originally paid for that transaction — extends the money-correctness discipline to the refund path.

## Non-goals

- Gated-community/society management — different problem, different buyer.
- Large multi-unit portfolios/property managers as a primary target — explicit stretch goal only; a separate app gets built later if scaling ever demands it.
- TDS (Sec 194-IB) calculation or withholding in this build — deferred post-MVP; see `compliance-references.md` for what that future work involves.
- Auto-filing Form 26QC or issuing Form 16C on the tenant's behalf — downgraded to a backlog research question, not built here.
- Deciding or building a monetization/paid-tier model now — deferred by design; only the free-tier grandfather guardrail (Constraints) is locked.
- Password-based login for landlord or tenant — three passwordless methods (Google OAuth, phone+OTP, email magic link) already cover every realistic case; password only adds hashing/reset-flow security surface with no gap it fills.
- Open self-service landlord registration — anyone signing up and becoming a landlord contradicts the single-landlord-POC-first constraint above. Deferred until productizing beyond single-landlord use, consistent with the payment module's own isolated-for-later-productization design.
- Non-UPI payment methods (cards, netbanking, etc.) — not designed for in v1; CAP-1/CAP-5 assume UPI throughout even though Razorpay supports other methods. Revisit if a real tenant population without UPI access shows up.

## Success signal

Prasenna's own tenancy runs a full rent cycle entirely on the app: a real UPI payment is collected through the gateway from within the tenant's logged-in portal account, the Autopay mandate fires on schedule, and the tenant reaches payment history and the lease document through that same account. "Zero install" still holds — it's a responsive website, no native app — but the tenant has a full persistent account, same weight as the landlord's, not a no-login shortcut. Broader landlord adoption is deliberately not claimed as a success criterion yet — see Open Questions.

## Assumptions

- Assumed landlords beyond Prasenna will feel this pain enough to adopt it — an unvalidated market-fit bet, consciously accepted as something to learn by shipping rather than prove first.
- Assumed a free user base can later function as publicity for a paid tier — unproven mechanism, knowingly left unvalidated.

## Open Questions

- What defines success beyond the dogfood POC (e.g., N other landlords onboarded and active for a full rent cycle)? Not addressed by the source input.
- What KYC/onboarding does the chosen payment gateway require of the landlord as payee, and does that block or delay onboarding? A recognized implication of moving real money that the source left unaddressed.
- The app will hold PAN numbers, lease documents, and payment records — personal/financial data under India's DPDP Act, 2023. No data-handling, consent, or retention posture has been decided (the architecture spine sets a technical floor only — encryption and signed URLs — not the fuller posture). This is no longer purely abstract: CAP-8 now promises both parties a durable record after offboarding (the landlord's history, the tenant's export/snapshot), which is in active tension with a future DPDP-based deletion request from either party. Needs resolving before this is more than a POC.
- PAN capture and PAN–Aadhaar-link validation UX (needed before the future TDS work, since an inoperative PAN changes the withholding rate) is noted but not designed — deferred along with that work itself.
- Whether one lease can have multiple tenants (e.g. roommates sharing a unit) is unaddressed either way — SPEC.md and the architecture ERD both assume one tenant per lease without ever deciding it. May simply not apply given the 1-5 unit individual-flat target segment, but noted rather than silently assumed.
- Whether a phone number or email freed by a CAP-8 offboarding can be validly reused for a different (or renewing) tenant's RECORD later is unresolved — a data-model question. (The security risk of someone impersonating the former tenant via a reassigned number is closed: CAP-8 no longer grants ongoing login, only a one-time export.)
