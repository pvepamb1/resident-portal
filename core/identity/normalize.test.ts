import { describe, expect, it } from 'vitest';
import { normalizeEmail, normalizedIdentifierEquals, normalizePhone } from './normalize';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Prasenna.V@Example.COM  ')).toBe('prasenna.v@example.com');
  });

  it('rejects empty input', () => {
    expect(normalizeEmail('   ')).toBeNull();
  });

  it('rejects a string with no @', () => {
    expect(normalizeEmail('not-an-email')).toBeNull();
  });

  it('rejects a string with no domain dot', () => {
    expect(normalizeEmail('a@b')).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('reduces a bare 10-digit Indian number to E.164', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
  });

  it('reduces a 0-prefixed trunk number to E.164', () => {
    expect(normalizePhone('09876543210')).toBe('+919876543210');
  });

  it('normalizes a number already carrying a country code without "+"', () => {
    expect(normalizePhone('919876543210')).toBe('+919876543210');
  });

  it('normalizes a number already in E.164', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
  });

  it('strips spaces, hyphens, dots, and parentheses', () => {
    expect(normalizePhone('+91-98765-43210')).toBe('+919876543210');
    expect(normalizePhone('(98765) 43210')).toBe('+919876543210');
  });

  it('rejects non-numeric input', () => {
    expect(normalizePhone('not a phone')).toBeNull();
  });

  it('rejects an implausibly short number', () => {
    expect(normalizePhone('123')).toBeNull();
  });
});

describe('normalizedIdentifierEquals', () => {
  it('matches two emails that differ only in case/whitespace', () => {
    expect(normalizedIdentifierEquals('email', 'Foo@Bar.com', ' foo@bar.com ')).toBe(true);
  });

  it('matches two phone numbers supplied in different formats', () => {
    expect(normalizedIdentifierEquals('phone', '9876543210', '+91 98765 43210')).toBe(true);
  });

  it('does not match different identifiers', () => {
    expect(normalizedIdentifierEquals('email', 'foo@bar.com', 'other@bar.com')).toBe(false);
  });

  it('does not match when either side is null/undefined', () => {
    expect(normalizedIdentifierEquals('email', null, 'foo@bar.com')).toBe(false);
    expect(normalizedIdentifierEquals('phone', '9876543210', undefined)).toBe(false);
  });

  it('does not match when either side fails to normalize', () => {
    expect(normalizedIdentifierEquals('email', 'not-an-email', 'not-an-email')).toBe(false);
  });
});
