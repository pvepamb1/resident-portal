# Forged Idea: Rental/Tenant Portal (India)

## What it is
A landlord-tenant payment management app for individual landlords in India — not a
gated-community/society management tool (explicitly ruled out).

## Core scope
- Two-sided: landlord side (tenant info, payment tracking) + tenant side (pay rent, reminders).
- Real payment collection through the app (not just record-keeping).
- POC built for single-landlord (self) use first. Payment module kept isolated/modular so
  productizing later means rewriting the payment layer only, not the whole app.
- **Real driver: this is a product-building/learning goal, not urgent personal pain relief.**
  Own tenancy (1 unit) is the dogfood case, not the target problem. Design centers on value
  for *other* landlords.
- Target segment: **1–5 unit landlords**. Large multi-unit portfolios/property managers are an
  explicit stretch goal, not a design target — if scaling up needs expensive redesign, build a
  separate app later rather than reshape this one.

## Payment architecture
- Pure orchestration on a licensed gateway (Razorpay/Cashfree/etc.) — app never custodies
  funds, so no RBI Payment Aggregator license burden.
- Auto-pay is in v1 (tenant-side UPI Autopay mandate). Tap-to-confirm for above-threshold debits
  happens in the tenant's own UPI app via NPCI push, not in this product — a website is
  sufficient, no native app needed.
- Reminders, payment history, and lease documents need **no** tenant install/enrollment (ride a
  one-tap UPI payment link). Auto-pay is the only tenant-facing feature requiring active
  enrollment (mandate setup).
- **Pre-build task:** verify the current UPI Autopay AFA threshold and mandate rules against the
  chosen gateway's actual docs before implementing — not yet done.

## Tax (TDS, Sec 194-IB) handling
- Deduction, when it applies, is a **once-a-year (or once-per-tenancy-end) lump deduction** on
  the final payment — not a monthly reconciliation problem.
- **Tier A** (calculate the deduction, adjust that one payment, show gross-vs-net in payment
  history) — roadmapped for **post-MVP/POC**, not immediate. Needs landlord PAN capture +
  PAN-Aadhaar-link validation (inoperative PAN → 20% rate instead of the normal rate).
- **Tier B** (app files Form 26QC / issues Form 16C on the tenant's behalf) — **not a committed
  feature**. Downgraded to a backlog research task: check whether e-filing can even be automated
  (likely needs tenant OTP auth per filing) and re-litigate the beneficiary mismatch (this
  benefits the *tenant*, who isn't the paying customer) before ever building it.
- Applies only to tenancies where per-unit rent exceeds ₹50k/month — confirmed uncommon in the
  target segment right now; hence low near-term priority.

## Monetization
- **Explicitly undecided/deferred.** POC proceeds without a validated revenue model.
- Rejected: monetizing via a free hobbyist base as a "credibility signal" to larger landlords
  (different buyers, different trust signals — didn't hold up).
- Open, untested claim (consciously left open): a large free user base could function as general
  publicity for a future "Plus" tier.
- **Guardrail locked:** free tier is grandfathered for whoever is already using the product when
  a paid tier launches — no retroactive paywalling. Initial users are framed as beta testers;
  paid tier design, if any, will be shaped by their feedback.

## Known accepted risks (deliberately not resolved before building)
- No evidence yet that landlords *other than the user* feel this problem enough to adopt it —
  the user's own stated pain was small enough to solve with a spreadsheet. Accepted as something
  to learn by building and shipping, not something to prove first.
- "Free base → publicity for a paid tier" is unproven.
- UPI Autopay AFA threshold not yet verified against real gateway docs.

## Rejected / superseded
- Gated-community/society management scope.
- Selling to large multi-unit landlords as the primary design target.
- Free-base-as-credibility-signal monetization story.
- TDS auto-filing (Tier B) as a near-term differentiator.
