/**
 * Identifier normalization (AD-5): the single shared place every identifier
 * (email, phone) passes through before comparison or storage, so two
 * independently-built resolution paths (landlord allowlist here, tenant
 * identity resolution in Story 3) can't silently fail to match the same
 * real identifier over a formatting difference.
 */

/**
 * Case-folds and trims an email address. Returns null if the input isn't a
 * plausible email at all (basic shape check only -- deep RFC validation is
 * not the point here).
 */
export function normalizeEmail(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  // Basic shape check: one "@", something on each side, a dot in the domain.
  const match = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.exec(trimmed);
  if (!match) return null;
  return trimmed;
}

/**
 * Reduces a phone number to E.164 (e.g. "+919876543210") regardless of how
 * a country code was supplied (leading 0, "91", "+91", spaces, hyphens).
 * Defaults to India (+91) when no country code is present, since this POC
 * targets Indian landlords/tenants (SPEC.md). Returns null if the input
 * doesn't reduce to a plausible E.164 number.
 */
export function normalizePhone(input: string, defaultCountryCode = '91'): string | null {
  let digits = input.trim().replace(/[\s\-().]/g, '');

  const hadPlus = digits.startsWith('+');
  digits = digits.replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) return null;

  // A "+" already claims E.164 shape -- a leading zero right after it
  // (e.g. "+0987654321") is not a valid E.164 number (no country code
  // starts with 0), not a trunk prefix to strip.
  if (hadPlus && digits.startsWith('0')) return null;

  if (!hadPlus) {
    if (digits.startsWith('00')) {
      // Explicit international prefix, e.g. "0091 98765 43210" -> "91...".
      // The remainder already carries a country code -- do not also
      // prepend the default one.
      digits = digits.slice(2);
    } else if (digits.startsWith('0')) {
      // Trunk prefix, e.g. "09876543210" -> "9876543210"
      digits = digits.replace(/^0+/, '');
      digits = defaultCountryCode + digits;
    } else if (digits.length === 10) {
      // Bare 10-digit local number, e.g. "9876543210"
      digits = defaultCountryCode + digits;
    }
    // else: assume the caller already included a country code without "+".
  }

  // E.164: up to 15 digits total, no leading zero after the country code.
  if (digits.length < 8 || digits.length > 15) return null;

  return `+${digits}`;
}

/**
 * Compares two identifiers of the same kind after normalizing both. This is
 * the shape both the landlord allowlist check (this story) and tenant
 * identity resolution (Story 3 / CAP-6) build on -- one matching primitive,
 * not duplicated per resolution path.
 */
export function normalizedIdentifierEquals(
  kind: 'email' | 'phone',
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const normalize = kind === 'email' ? normalizeEmail : normalizePhone;
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb;
}
