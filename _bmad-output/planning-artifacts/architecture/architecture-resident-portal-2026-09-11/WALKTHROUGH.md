# Tenant Portal — Architecture Walkthrough

A plain-language guide to what got decided, why, and what got seriously considered and ruled out. This is the full picture after two passes — the original architecture session, and a big correction once it became clear the tenant needed a real portal account, not just a payment link. Both are folded in here as one coherent document, not a diff.

## The shape of the app, in one paragraph

A Next.js website — not a native app — where **both** the landlord and each tenant log into their own persistent portal account. There is no no-login shortcut anywhere in this system. The landlord (just you, for now — no open sign-up) manages tenants, units, and leases. Each tenant, invited by the landlord, logs in to pay rent, see their payment history, view lease documents, and manage an optional UPI Autopay mandate. Money moves through Razorpay, a licensed gateway — the app never touches or holds funds directly. Data lives in Postgres.

## Why hexagonal architecture

The core idea: your business logic (tracking rent, leases, payments, tenancies) doesn't know or care *how* money moves, *how* someone proves who they are, or *how* a message gets delivered — it talks to those things through defined interfaces ("ports"). The actual connections to Razorpay, the database, the auth provider, and email/SMS each live in a separate, swappable piece ("adapters").

**Why this matters concretely:** add a second gateway, switch databases, or change how sessions are revoked — you rewrite *that one piece*, not the whole app. This traces back to something decided before this session even started: the payment module needed to stay isolated so productizing later doesn't mean rewriting everything. It's paid off since — the tenant-portal correction added a whole new identity-resolution mechanism and a tenancy-lifecycle module without touching the payment core at all.

## The stack, and everything that didn't make the cut

**Locked: TypeScript + Next.js.** The deciding factor wasn't "best language" — it was that Next.js gives you *one codebase* for the tenant-facing pages, the landlord dashboard, and the code that talks to Razorpay. For someone building this solo, not maintaining two separate projects mattered more than any other single factor.

**Considered: Java or Kotlin + Spring Boot.** Your actual professional depth, and Spring's security/database tooling is genuinely excellent. Ruled out because scale-to-zero hosting means a plain JVM app takes ~5-6 seconds to wake from cold — a real, noticeable delay every time someone opens the portal. Fixing that needs GraalVM Native Image, genuinely fiddly to set up with Spring specifically. AI writing most of the code also weakens "you'd be fastest in Java" as an argument.

**Considered: Python (Django or FastAPI).** No cold-start problem, Django's free admin panel a nice perk. Ruled out because it still needs a *separate* frontend project — the exact two-codebase situation Next.js avoids.

**Considered: Go.** Fast, lean, no cold-start issue — but no built-in security/ORM/admin toolkit the way Spring or Django have, same two-codebase issue as Python. No distinct edge over Next.js.

**Considered, genuinely tempting: Rust.** Fastest cold-start of anything on the list, and a real personal learning goal. Ruled out for one concrete reason: Razorpay has no official Rust SDK — only a handful of unofficial, mostly stale community packages. Given "money-correctness must be non-negotiable," hand-rolling payment-webhook verification against an unmaintained package was too much risk. Verdict: learn Rust on a different, lower-stakes project.

**Considered: React Native, for a native mobile app.** The pitch was "we could have both, it's still React." In practice it shares almost nothing with a Next.js codebase — different UI primitives, styling, separate app-store release processes. It would have undone the one-codebase advantage, and nothing in the product needs it: the one place a native app would matter (approving a recurring payment) already happens inside the tenant's own banking app.

## Hosting: Vercel

Don't pay for infrastructure you don't need yet — that pointed at scale-to-zero hosting, where the app spins down when nobody's using it. Vercel was picked over Cloudflare Pages and Netlify because it supports every Next.js feature natively with zero extra config, meaningful while learning the framework at the same time as building on it. Cloudflare's free tier is bigger but needs adapter layers for full Next.js support — a real risk of a confusing compatibility gap mid-build. Reconsider Cloudflare later, specifically if cost becomes real at meaningfully higher scale.

## Payment gateway: Razorpay over Cashfree

Both support UPI Autopay. Razorpay has no annual fee; Cashfree charges ₹4,999/year on top of similar transaction fees, and Razorpay is specifically the stronger option industry-wide for subscription/recurring-billing products — exactly what rent collection is.

## Database: Postgres + Drizzle, hosted on Neon

**Postgres over the alternatives:** MySQL is comparable, but Postgres has a native extension (`pgcrypto`) that directly serves the PAN-encryption rule below. SQLite doesn't suit a real hosted multi-user product. MongoDB was the real contender to rule out — this app's data is inherently relational (payments belong to leases belong to units belong to landlords, and now refunds belong to payments), and the money-correctness rule leans directly on relational transactions and unique constraints — much harder to hold onto safely in a document store.

**Drizzle over Prisma:** both turn code into SQL; Prisma routes every call through a separate engine that has to boot up fresh on every cold start, Drizzle doesn't have that layer. Given how much this hosting setup depends on fast wake-ups, Drizzle stays consistent; Prisma would quietly reintroduce the same cold-start problem that ruled out Java.

**Neon over Supabase, for hosting Postgres itself:** Vercel Postgres isn't even a separate product anymore — it was retired and migrated to Neon in December 2024, making Neon the de facto standard for this exact stack. Supabase's free tier fully *pauses* after 7 days idle, taking 10–30 seconds to wake — worse than the Java cold start that got ruled out — and its bundled extras (auth, storage) go unused since auth and object storage were already decided separately.

## Login: the part that changed the most

**Both the landlord and every tenant have a full, persistent portal account — same weight, no exceptions.** This wasn't the original plan. Early on, "no tenant enrollment" (meaning no forced signup step) got misread as "no tenant login at all" — a real correction, since the whole point was always a tenant *portal*, where they can see anything, anytime.

**Three sign-in methods, no password, for both landlord and tenant:** Google OAuth, phone+OTP, or email magic link. Password was considered and excluded — the three passwordless methods already cover every realistic case, and a password adds hashing and reset-flow security surface (a classic attack vector) for no gap it fills.

**How a tenant gets in the first place:** the landlord adds a tenant record (name, phone, email, lease) before the tenant ever touches the app, and the system sends a one-time activation invite by email, expiring after a few days. That invite is what makes the whole thing safe — a tenant can't land on the wrong account, because there's no self-service claim step to get wrong.

**How login actually resolves to the right account (the trickiest part):** phone+OTP and email magic link are direct matches — if the number or address matches what the landlord has on file, that's it, no ambiguity. Google is different: it proves who someone is, but the email tied to a Google account might not match anything on file. In that case, a one-time confirmation of an identifier already on file (phone or email) links the Google identity to the existing record. Every identifier gets normalized first (email lowercased, phone numbers reduced to one standard format) so a formatting difference alone — capital letters, a missing country code — can't cause a legitimate match to silently fail. Crucially, this resolution logic is built by the app itself, not left to the auth library's own account-linking feature — Better Auth's built-in cross-provider linking is documented as unreliable, and by default would create a second, disconnected account if the same person used a different method than before.

**The landlord's own login got the same treatment, for a fair reason.** It was originally locked as Google-only, back when the mental model was "tenant never logs in, landlord is the only account that matters." Once tenants got three flexible options because not everyone has or wants Google, the same logic applied to the landlord — there was no principled reason to treat them differently, and extending the same three methods was nearly free since the plumbing already had to exist for tenants.

**One important boundary: there's no open landlord sign-up.** Access is allowlisted to one specific, pre-configured identity (you) — anyone being able to register and become a landlord would contradict the already-locked "single-landlord POC first" scope. Open registration is a real, later feature, not something this build needs yet.

**A correction made mid-session:** the library first proposed for auth, Auth.js (NextAuth), turned out to be in maintenance mode since early 2026 — its team merged into a newer project, Better Auth, in September 2025, now the standard recommendation for new projects. The decision (lean on a mature library, not hand-rolled security) didn't change, only the library name.

## Ending a tenancy — and the security hole a first attempt would have opened

When the landlord ends a tenancy, the former tenant's access needs to be revoked — but there was a real fairness question underneath: shouldn't a former tenant still be able to see their *own* payment history, for their own records? The first answer ("let them keep logging in, read-only") created a real security hole: if that tenant's phone number or email later gets reassigned to someone else (numbers do get recycled), that new person could authenticate as the "former tenant" and see someone else's private payment and lease history.

**The actual design:** ending a tenancy immediately invalidates every active session that tenant has — not just future logins, but sessions already in progress — and in that same moment, generates a one-time export of their payment history, delivered to them, instead of ongoing access. This requires the auth system to support real, immediate session revocation (a session record the server can actually kill), not a self-contained token that just expires naturally on its own schedule regardless of what the server wants.

## Refunds, renewals, and notifications — the rest of a tenancy's real lifecycle

Three more capabilities came out of a deliberate completeness check partway through this session, applying one pattern that kept showing up: nearly every capability described the forward action but not its reverse (invite-but-not-resend, add-but-not-remove, setup-but-not-cancel).

- **Refunds:** the landlord can refund a payment, in part or in full. A refund can never exceed what was actually paid — enforced as part of the same money-correctness discipline that governs regular payments, checked before the refund request is even sent, not just recorded after. Refund webhooks get redelivered exactly like payment webhooks, so the same duplicate-safe handling applies.
- **Renewals:** a lease can be renewed under the same tenant account rather than creating a duplicate — and if the rent changes, any active Autopay mandate gets updated or recreated to match, rather than silently continuing to charge the old amount.
- **Landlord notifications:** the landlord gets notified — email or SMS, never WhatsApp — when a payment comes in, when an autopay charge fails, and when an invited tenant activates their account. Before this, the landlord would have had to keep actively checking the portal to know any of that happened.

## The rules built specifically around handling real money

**Money-correctness and idempotency.** Razorpay is always the source of truth. If the same payment or refund notification arrives twice — which does happen with webhooks — the app recognizes it's a duplicate and does nothing the second time. A refund's amount is checked against the original payment *before* it's sent, not after. And reminders are suppressed only when this specific month's autopay charge actually *succeeded* — not just because a mandate exists — so a tenant whose autopay fails for a cycle still gets nudged that rent wasn't actually paid. (An earlier version of this rule checked only whether a mandate existed at all, which would have gone silent in exactly the month it mattered most — caught and fixed during a deliberate completeness review before it was built, not after.)

**Risk-proportional testing and review.** Every change needs passing tests before it ships — universal. Code touching payment collection, refunds, or the autopay mandate needs something extra: tests against Razorpay's real sandbox, plus a dedicated review pass, every time. Everything else just needs the baseline. A bug in a display page is annoying; a bug in payment logic is real money going wrong.

## Data protection floor (not the full picture yet)

PAN numbers are encrypted at rest, using one designated method — never a second, incompatible one added later by some future feature. Lease documents, and now a former tenant's payment-history export, live behind links that expire and require the right permission, never a public bucket. This is a floor, not the complete picture — India's DPDP Act has bigger questions around consent and how long data can be kept, and this floor is now in *active* tension with it: the export/history-retention design promises both landlord and tenant a durable record, which could conflict with a future request from either side to have their data deleted. That's flagged, not resolved.

## What's deliberately left open or for later

- **The fuller DPDP posture** (consent, retention/deletion rights) — bigger than architecture alone decides, and now sharper given the tenancy-end export design above.
- **Whether a freed phone/email can be reused for a new tenant's record** — a data-model question; the security risk of impersonation is already closed regardless (no ongoing login is ever granted to an ended tenancy).
- **Whether one lease can have multiple tenants** (roommates) — never addressed either way; may not apply to this segment.
- **A tenant-initiated way to end their own tenancy** — currently landlord-only; a weaker, optional finding, not yet decided.
- **The tax feature (TDS)** — both the simple version (adjusting one payment a year) and the ambitious version (auto-filing government forms, rejected earlier) stay off the roadmap for now.
- **What counts as "success" beyond you using it yourself** — genuinely not decided on purpose: the plan is to learn by building, not prove demand first.
- **Multiple servers / heavy-duty uptime infrastructure** — deliberately not built now. The money-correctness rule means even a brief outage doesn't lose or double-process anything — it just catches up.
