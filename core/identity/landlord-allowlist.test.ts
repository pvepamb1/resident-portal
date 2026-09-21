import { describe, expect, it } from 'vitest';
import { matchesLandlordAllowlist } from './landlord-allowlist';

const allowlist = { email: 'prasennavenkatesh@gmail.com', phone: '+919876543210' };

describe('matchesLandlordAllowlist', () => {
  it('matches the allowlisted email regardless of case/whitespace', () => {
    expect(matchesLandlordAllowlist({ email: '  PrasennaVenkatesh@Gmail.com  ', phone: null }, allowlist)).toBe(
      true,
    );
  });

  it('matches the allowlisted phone in a different format', () => {
    expect(matchesLandlordAllowlist({ email: null, phone: '9876543210' }, allowlist)).toBe(true);
  });

  it('rejects a real but non-allowlisted email (I/O matrix: non-allowlisted identity)', () => {
    expect(matchesLandlordAllowlist({ email: 'someoneelse@gmail.com', phone: null }, allowlist)).toBe(false);
  });

  it('rejects an email that is close to, but not exactly, the allowlisted one', () => {
    expect(matchesLandlordAllowlist({ email: 'prasennavenkatesh@gmail.co', phone: null }, allowlist)).toBe(false);
  });

  it('rejects a non-allowlisted phone number', () => {
    expect(matchesLandlordAllowlist({ email: null, phone: '+911111111111' }, allowlist)).toBe(false);
  });

  it('rejects phone match when no phone is configured on the allowlist', () => {
    expect(
      matchesLandlordAllowlist({ email: null, phone: '9876543210' }, { email: allowlist.email, phone: null }),
    ).toBe(false);
  });

  it('rejects when neither identifier is present', () => {
    expect(matchesLandlordAllowlist({ email: null, phone: null }, allowlist)).toBe(false);
  });
});
