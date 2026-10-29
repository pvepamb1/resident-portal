import { describe, expect, it } from 'vitest';
import { buildTenancyExportCsv, formatIstDate, formatIstTimestamp, formatRupees, quoteCell, text } from './export-csv';

const base = {
  tenantName: 'Tenant One',
  unitLabel: 'Flat 3B',
  leaseStartDate: new Date(Date.UTC(2025, 0, 1)),
  leaseEndDate: new Date(Date.UTC(2026, 8, 28)),
  rentAmountPaise: 1_250_000,
  generatedAt: new Date('2026-09-28T18:05:09Z'),
  payments: [],
};

describe('buildTenancyExportCsv', () => {
  it('renders the key/value block, a blank line, then the payment table (CRLF, RFC 4180)', () => {
    const csv = buildTenancyExportCsv({
      ...base,
      payments: [{ paidAt: new Date('2026-02-01T20:00:00Z'), amountPaise: 1_250_000, status: 'captured', reference: 'UTR123' }],
    });
    expect(csv).toBe(
      [
        'Tenant name,Tenant One',
        'Unit,Flat 3B',
        'Lease start,2025-01-01',
        'Lease end,2026-09-28',
        'Monthly rent (INR),"12,500.00"',
        'Generated at,2026-09-28T23:35:09+05:30',
        '',
        'Date,Amount (INR),Status,Reference',
        // 20:00Z on Feb 1 is already Feb 2 in IST.
        '2026-02-02,"12,500.00",captured,UTR123',
        '',
      ].join('\r\n'),
    );
  });

  it('is deterministic for identical inputs (racing writers produce byte-identical objects)', () => {
    expect(buildTenancyExportCsv(base)).toBe(buildTenancyExportCsv({ ...base }));
  });

  it('leaves the lease end blank when there is none', () => {
    expect(buildTenancyExportCsv({ ...base, leaseEndDate: null })).toContain('Lease end,\r\n');
  });

  it('prefixes formula-like free-text cells but never code-formatted numbers', () => {
    const csv = buildTenancyExportCsv({
      ...base,
      tenantName: '=HYPERLINK("http://evil")',
      unitLabel: '+cmd',
      payments: [{ paidAt: new Date(Date.UTC(2026, 0, 5)), amountPaise: -50_000, status: '@status', reference: '-ref' }],
    });
    expect(csv).toContain(`Tenant name,"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain("Unit,'+cmd");
    expect(csv).toContain("2026-01-05,-500.00,'@status,'-ref");
  });
});

describe('text (free-text sanitization)', () => {
  it.each(['=1', '+1', '-1', '@a', '\tx', '\rx'])('prefixes %j', (value) => {
    expect(text(value)).toBe(`'${value}`);
  });
  it('leaves ordinary text alone', () => {
    expect(text('Flat 3B')).toBe('Flat 3B');
  });
});

describe('quoteCell', () => {
  it('quotes commas, quotes and newlines and doubles inner quotes', () => {
    expect(quoteCell('a,b')).toBe('"a,b"');
    expect(quoteCell('say "hi"')).toBe('"say ""hi"""');
    expect(quoteCell('line1\nline2')).toBe('"line1\nline2"');
    expect(quoteCell('plain')).toBe('plain');
  });
});

describe('formatting', () => {
  it('formats paise as rupees with Indian grouping', () => {
    expect(formatRupees(1_250_000)).toBe('12,500.00');
    expect(formatRupees(12_345_605)).toBe('1,23,456.05');
    expect(formatRupees(5)).toBe('0.05');
    expect(formatRupees(-50_000)).toBe('-500.00');
  });
  it('formats IST dates and timestamps', () => {
    expect(formatIstDate(new Date('2026-09-28T18:29:59Z'))).toBe('2026-09-28');
    expect(formatIstDate(new Date('2026-09-28T18:30:00Z'))).toBe('2026-09-29');
    expect(formatIstTimestamp(new Date('2026-09-28T00:00:00Z'))).toBe('2026-09-28T05:30:00+05:30');
  });
});
