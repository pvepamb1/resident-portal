# Tenant Auth & Onboarding

Reference for CAP-6. The tenant portal is full-weight, same as the landlord's — this is how a tenant gets from "the landlord added me" to a working account, and how repeat logins resolve to the right one.

## Two separate problems, often conflated

1. **Discoverability** — a tenant has no reason to know the portal exists or where to find it. Solved by the invitation (below), regardless of which sign-in method they'll end up using.
2. **Identity resolution** — does a given login attempt map to the correct, already-existing tenant record? Solved differently per method (below). Only one of the three methods needs an extra step here.

## Invitation flow (onboarding)

1. Landlord adds a tenant record: name, phone, email, lease/unit — before the tenant has ever touched the app.
2. The system sends a one-time activation code/link to the tenant's email, expiring after a few days.
3. Tenant uses it to activate their account, then picks a sign-in method for future visits.

This anchors identity once, up front, addressed by the landlord to a specific pre-existing record — a tenant can't land on the wrong account, because there's no self-service claim step to get wrong.

## The three sign-in methods, and how each resolves identity

- **Phone number + OTP.** The phone number *is* the identifier. If it matches the number on the tenant's record, this is a direct match — no extra step. (Password login was considered and excluded — see SPEC.md Non-goals; it adds hashing/reset-flow surface with no gap the three passwordless methods below don't already cover.)
- **Email magic link.** Same as phone: if the email used matches what the landlord has on file, direct match, no extra step.
- **Google OAuth.** Proves *who* someone is, but not *which tenant* — the email tied to a Google account may not match anything on file (or the landlord may only have a phone number). If it doesn't match, a one-time confirmation of an identifier already on file (phone OTP, or the on-file email) links the Google identity to the existing record instead of creating a new one.

The general rule: **any identifier already on file for a tenant — phone, email, or both — can serve as the linking check.** It isn't specific to phone; it's specific to "does this match something the landlord already recorded."

## Why this avoids account fragmentation

Better Auth's built-in cross-provider account linking is documented as weak — it can't reliably tell that two different login methods belong to the same person unless told so explicitly, and by default creates a second, disconnected account instead. This design doesn't lean on that feature at all: resolution is always anchored to the landlord-verified phone/email on the tenant record, done by the application itself, not inferred by the auth library. A tenant who signs in with a second method later (e.g. Google, having originally activated via phone+OTP) re-runs the same on-file-identifier check and attaches to the *existing* record rather than creating a new one.
