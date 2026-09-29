import type { PaymentHistoryEntry } from './types';

/**
 * CAP-8 payment-history snapshot as CSV. Pure and deterministic: the same
 * inputs (including `generatedAt`, taken from the reserved export row)
 * always produce byte-identical output, which is what lets racing writers
 * safely put to the same object key.
 */

export const EXPORT_FILENAME = 'tenancy-payment-history.csv';
export const EXPORT_CONTENT_TYPE = 'text/csv';

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export interface TenancyExportCsvInput {
  tenantName: string;
  unitLabel: string;
  leaseStartDate: Date;
  leaseEndDate: Date | null;
  rentAmountPaise: number;
  generatedAt: Date;
  payments: PaymentHistoryEntry[];
}

export function buildTenancyExportCsv(input: TenancyExportCsvInput): string {
  const rows: string[][] = [
    ['Tenant name', text(input.tenantName)],
    ['Unit', text(input.unitLabel)],
    ['Lease start', formatIstDate(input.leaseStartDate)],
    ['Lease end', input.leaseEndDate ? formatIstDate(input.leaseEndDate) : ''],
    ['Monthly rent (INR)', formatRupees(input.rentAmountPaise)],
    ['Generated at', formatIstTimestamp(input.generatedAt)],
    [],
    ['Date', 'Amount (INR)', 'Status', 'Reference'],
    ...input.payments.map((payment) => [
      formatIstDate(payment.paidAt),
      formatRupees(payment.amountPaise),
      text(payment.status),
      text(payment.reference),
    ]),
  ];
  return rows.map((row) => row.map(quoteCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * Formula-injection guard for free-text cells only (tenant name, unit
 * label, status, reference). Values the code formats itself -- numbers and
 * dates -- never pass through here, so a negative amount stays `-500.00`.
 */
export function text(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** RFC 4180: quote when the cell contains a quote, comma, CR or LF; double inner quotes. */
export function quoteCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Paise -> rupees with Indian digit grouping, e.g. 1250000 -> "12,500.00". */
export function formatRupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${sign}${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(rupees)}.${fraction}`;
}

function toIstParts(date: Date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`,
  };
}

/** IST calendar date, `YYYY-MM-DD`. */
export function formatIstDate(date: Date): string {
  return toIstParts(date).date;
}

/** IST timestamp with explicit offset, e.g. `2026-09-28T23:35:59+05:30`. */
export function formatIstTimestamp(date: Date): string {
  const parts = toIstParts(date);
  return `${parts.date}T${parts.time}+05:30`;
}
