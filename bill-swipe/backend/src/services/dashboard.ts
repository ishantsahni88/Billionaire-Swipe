/**
 * Payer dashboard — PRD Feature 7.
 * Pure aggregation over the payment ledger so it is unit-testable without a DB.
 * AC: dashboard updates within 5 minutes of payment confirmation (the route
 * reads from a ledger replica refreshed on that cadence); receipts generate
 * in under 3 seconds (renderReceiptPdf is synchronous string assembly).
 */

import type { PaymentStatus } from '@bill-swipe/shared';
import type { PaymentLedgerRow } from './payments.js';

export interface DashboardSummary {
  totalFundedCents: number;
  totalFeesCents: number;
  billsFunded: number; // distinct bills with >=1 confirmed payment
  categories: Record<string, number>; // category -> count of confirmed payments
  lastPaymentAt?: string;
}

/** Only money that actually reached a biller counts toward impact. */
const COUNTED_STATUSES: ReadonlySet<PaymentStatus> = new Set(['sent_to_biller', 'confirmed']);

export function buildDashboard(rows: PaymentLedgerRow[], billCategory: (billId: string) => string | undefined): DashboardSummary {
  const summary: DashboardSummary = { totalFundedCents: 0, totalFeesCents: 0, billsFunded: 0, categories: {} };
  const fundedBillIds = new Set<string>();
  for (const r of rows) {
    if (!COUNTED_STATUSES.has(r.status)) continue;
    summary.totalFundedCents += r.amountCents;
    summary.totalFeesCents += r.feeCents;
    fundedBillIds.add(r.billId);
    const cat = billCategory(r.billId) ?? 'other';
    summary.categories[cat] = (summary.categories[cat] ?? 0) + 1;
    if (!summary.lastPaymentAt || r.createdAt > summary.lastPaymentAt) summary.lastPaymentAt = r.createdAt;
  }
  summary.billsFunded = fundedBillIds.size;
  return summary;
}

export interface ReceiptData {
  payerHandle: string; // generated handle only — never legal name (Feature 5)
  billerLabel: string; // pilot: category label, never biller name
  amountCents: number;
  feeCents: number;
  totalCents: number;
  confirmationNumber: string; // partner txn id or biller confirmation
  paidAt: string;
}

/**
 * Minimal single-page PDF generator (no deps) for "receipts downloadable as PDF".
 * Deterministic output so tests can assert content. Real app may swap in a
 * typeset renderer; this keeps the byte format honest (%%EOF, xref table).
 */
export function renderReceiptPdf(d: ReceiptData): Uint8Array {
  const lines = [
    'BILL SWIPE - PAYMENT RECEIPT',
    '',
    `Donor:        ${d.payerHandle}`,
    `Biller:       ${d.billerLabel}`,
    `Amount paid:  $${(d.amountCents / 100).toFixed(2)}`,
    `Platform fee: $${(d.feeCents / 100).toFixed(2)}`,
    `Total charged:$${(d.totalCents / 100).toFixed(2)}`,
    `Confirmation: ${d.confirmationNumber}`,
    `Date:         ${d.paidAt}`,
    '',
    'This payment was sent directly to the biller through our',
    'licensed payment partner. Bill Swipe did not hold these funds.',
    'Not a tax receipt. (Tax receipts are out of scope for MVP.)',
  ];
  const stream = lines.map((l) => `BT /F1 11 Tf 50 ${760 - lines.length * 4 + 760 * 0} Td (${escapePdf(l)}) Tj ET`).join('\n');
  // Simpler: place each line individually.
  const content = lines
    .map((l, i) => `BT /F1 11 Tf 1 0 0 1 50 ${760 - i * 18} Tm (${escapePdf(l)}) Tj ET`)
    .join('\n');

  const objs: string[] = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  void stream;
  return new TextEncoder().encode(pdf);
}

function escapePdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7E]/g, '');
}
