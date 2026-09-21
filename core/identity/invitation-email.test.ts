import { describe, expect, it } from 'vitest';
import { buildInvitationEmail } from './invitation-email';

describe('buildInvitationEmail', () => {
  it('builds the activation URL from the base URL and token, placed in both html and text', () => {
    const result = buildInvitationEmail({
      tenant: { name: 'Tenant One' },
      token: 'abc123',
      appBaseUrl: 'https://example.com',
    });

    const expectedUrl = 'https://example.com/invite/abc123';
    expect(result.html).toContain(`href="${expectedUrl}"`);
    expect(result.html).toContain(`>${expectedUrl}<`);
    expect(result.text).toContain(expectedUrl);
  });

  it('strips a trailing slash from the base URL before appending the token path', () => {
    const result = buildInvitationEmail({
      tenant: { name: 'Tenant One' },
      token: 'abc123',
      appBaseUrl: 'https://example.com/',
    });

    expect(result.html).toContain('https://example.com/invite/abc123');
    expect(result.html).not.toContain('https://example.com//invite/abc123');
  });

  it('escapes HTML-special characters in the tenant name in html, but not in text', () => {
    const result = buildInvitationEmail({
      tenant: { name: '<Tenant> & "Co" \'s' },
      token: 'abc123',
      appBaseUrl: 'https://example.com',
    });

    expect(result.html).toContain('&lt;Tenant&gt; &amp; &quot;Co&quot; &#39;s');
    expect(result.html).not.toContain('<Tenant>');
    // text is plain text, not HTML -- the raw name is not (double-)escaped.
    expect(result.text).toContain('<Tenant> & "Co" \'s');
    expect(result.text).not.toContain('&lt;');
  });
});
