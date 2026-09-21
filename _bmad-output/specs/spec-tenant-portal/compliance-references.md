# Compliance References

Reference material for CAP-5 and the tax/payment non-goals in SPEC.md. Not build instructions — the facts a future implementer needs before touching these areas, and why Tier B was rejected outright.

## UPI Autopay mandate (CAP-5)

- Recurring debit is set up as a UPI Autopay mandate. Above a certain per-transaction amount, NPCI requires Additional Factor Authentication (AFA) — a tap-to-confirm push notification the tenant approves inside their own UPI app (GPay/PhonePe/etc.), the same pattern used by Netflix, gyms, and insurance auto-debits.
- Because that confirmation happens inside the tenant's own UPI app, the landlord-facing product does not need a native mobile app — a website is sufficient.
- **Unresolved before build:** the current AFA threshold and mandate rules must be checked against the chosen gateway's actual docs. This was recalled from memory during scoping, not verified — treat it as unconfirmed until checked.

## TDS — Section 194-IB (out of scope for this build)

Rent is "Income from House Property" for the landlord and is taxable at the landlord's own slab rate regardless of amount — that part is universal and unrelated to TDS. Section 194-IB is a separate, narrower mechanism layered on top:

- **Threshold:** applies only when a specific tenancy's rent exceeds ₹50,000/month, and only when the tenant is an individual/HUF not subject to tax audit. It is per-tenancy, not per-landlord-portfolio. Confirmed uncommon in the 1–5 unit segment as scoped today — the reason Tier A is sequenced post-MVP rather than urgent.
- **Timing:** unlike salary TDS, this is deducted **once**, not monthly — at the end of the financial year (from the last month's rent) or when the tenancy ends mid-year, whichever comes first. Eleven months of a normal tenancy run at full rent; only the final payment reflects a deduction.
- **Rate:** a flat percentage of gross rent for the period (recalled as having dropped from 5% to 2% effective Oct 2024 — **unverified, must be checked against current law before this becomes a locked design fact**). If the landlord's PAN is missing or not linked to Aadhaar ("inoperative"), the rate jumps to a flat 20% under Section 206AA instead.
- **Deposit/certificate:** the tenant deposits the deduction via Form 26QC within 30 days of the deduction month, and issues the landlord a Form 16C certificate within 15 days after that. No TAN is required — the tenant uses their own PAN.
- **Reconciliation:** TDS deducted is a credit against the landlord's actual annual tax liability (via Form 26AS/AIS), not a separate tax. If the landlord's total income falls below the taxable threshold, the full amount is refundable — but only by filing an ITR to claim it; skipping the filing forfeits it by default. Section 197 (Form 13) lets a payee apply in advance for a Nil/Lower TDS certificate to avoid this deduct-then-refund cycle, though this app does not currently help with that application.

### Tier A vs. Tier B (why the split exists)

- **Tier A — calculate and adjust (the only TDS work on any roadmap, and still post-MVP):** detect a tenancy above the ₹50k/month threshold, hold a configurable rate (it has changed before), capture and validate the landlord's PAN (and its Aadhaar-link status, since that changes the rate), and adjust the one relevant once-a-year payment so payment history shows gross rent vs. net received correctly.
- **Tier B — file Form 26QC / issue Form 16C on the tenant's behalf (rejected, backlog research only):** rejected for two reasons. First, feasibility is unverified — no known public API exists for third-party e-filing of this form, and government filings of this kind likely require the tenant's own OTP authentication per filing, which would gut a "hassle-free" pitch anyway. Second, a beneficiary mismatch: the compliance relief this would provide lands on the **tenant** (the legal filer), not the **landlord**, who is this product's actual paying customer — so the differentiator pitch doesn't hold up as landlord value. If ever revisited, both points need to be re-examined, not just the engineering effort.
