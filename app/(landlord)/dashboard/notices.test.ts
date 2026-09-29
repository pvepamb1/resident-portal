import { describe, expect, it } from 'vitest';
import { lookupNotice } from './notices';

describe('lookupNotice', () => {
  it('maps allowlisted codes', () => {
    expect(lookupNotice('tenancy_ended')?.tone).toBe('success');
    expect(lookupNotice('export_delivery_failed')?.message).toContain('Send export');
    expect(lookupNotice('tenancy_already_ended')?.message).toContain('Send export');
  });
  it.each(['<script>', 'toString', '__proto__', undefined, ['tenancy_ended']])('renders nothing for %j', (code) => {
    expect(lookupNotice(code)).toBeNull();
  });
});
