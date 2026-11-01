/**
 * Bill upload & redaction workflow — PRD Feature 1 + User Flow 1.
 *
 * Lifecycle (Flow 1 steps 3–7):
 *   draft → redacted_preview → submitted → under_review → published | rejected
 *
 * Invariants encoded here (all CRITICAL acceptance criteria for Feature 1):
 *   1. ACCEPTED formats are JPEG, PNG, PDF only, max 10 MB. We sniff magic
 *      bytes rather than trusting the client-supplied content type.
 *   2. Auto-redaction runs BEFORE any preview is produced; the holder can
 *      adjust regions and resubmit, but a bill can never reach `submitted`
 *      while an unhandled high-confidence account-number region exists
 *      (`redactionComplete` from the redaction service — fail closed).
 *   3. The unredacted original lives ONLY in the encrypted store
 *      (`originalImageKey`). Nothing outside this module returns it, and
 *      `previewForHolder()` is the only function allowed to surface imagery
 *      before submission. Payer-facing code must use PublicBillCard, which
 *      carries `redactedImageUrl` exclusively.
 *   4. Duplicate detection happens at submit time via sha-256 of the raw
 *      bytes (bill_hash UNIQUE in schema.sql) — AC: exact re-uploads caught
 *      100% of the time.
 */

import { createHash } from 'crypto';
import { detectPii, redactionComplete, type OcrWord, type BarcodeHit, type RedactionRegion } from './redaction.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB per PRD Feature 1

export type UploadStage =
  | 'draft'
  | 'redacted_preview'
  | 'submitted'
  | 'under_review'
  | 'published'
  | 'rejected'
  | 'withdrawn';

export interface UploadedFile {
  bytes: Uint8Array;
  declaredContentType?: string; // client hint only — never trusted
}

export type DetectedFormat = 'image/jpeg' | 'image/png' | 'application/pdf';

/** Magic-byte sniffing: JPEG FFD8FF, PNG 89504E47, PDF %PDF. */
export function sniffFormat(bytes: Uint8Array): DetectedFormat | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  return null;
}

export interface ValidationOk { format: DetectedFormat; sizeBytes: number }
export interface ValidationFail { error: 'TOO_LARGE' | 'UNSUPPORTED_FORMAT' }

export function validateUpload(file: UploadedFile): ValidationOk | ValidationFail {
  if (file.bytes.length === 0 || file.bytes.length > MAX_UPLOAD_BYTES) return { error: 'TOO_LARGE' };
  const format = sniffFormat(file.bytes);
  if (!format) return { error: 'UNSUPPORTED_FORMAT' };
  return { format, sizeBytes: file.bytes.length };
}

/** sha-256 hex of raw bytes — stored as bills.bill_hash (UNIQUE). */
export function billHashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface UploadRecord {
  id: string;
  holderId: string;
  stage: UploadStage;
  format: DetectedFormat;
  sizeBytes: number;
  billHash: string;
  /** key into the ENCRYPTED object store — access restricted to Verification role with logging */
  originalImageKey: string;
  detectedRegions: RedactionRegion[];
  appliedRegions: RedactionRegion[];
  redactedImageUrl?: string;
  createdAt: number;
}

export class RedactionIncompleteError extends Error {}
export class DuplicateBillError extends Error {}

/**
 * Steps 3–4 of Flow 1: accept the file, run OCR, auto-detect PII, produce the
 * redacted preview the holder reviews. Detection failures default to MORE
 * redaction (fail closed), never less.
 */
export function createDraft(opts: {
  id: string;
  holderId: string;
  file: UploadedFile;
  ocrWords: OcrWord[];
  barcodes?: BarcodeHit[];
  nowMs: number;
}): UploadRecord {
  const v = validateUpload(opts.file);
  if ('error' in v) throw new Error(v.error);
  const detected = detectPii(opts.ocrWords, opts.barcodes ?? []);
  return {
    id: opts.id,
    holderId: opts.holderId,
    stage: 'redacted_preview',
    format: v.format,
    sizeBytes: v.sizeBytes,
    billHash: billHashOf(opts.file.bytes),
    originalImageKey: `enc://originals/${opts.id}`,
    detectedRegions: detected,
    // Auto-apply every detected region by default; the holder may only ADD
    // regions pre-submission (removal of an account-number region is blocked
    // at submit unless confidence < 0.8).
    appliedRegions: [...detected],
    redactedImageUrl: `https://cdn.example/redacted/${opts.id}.jpg`,
    createdAt: opts.nowMs,
  };
}

/** Holder adjusts redaction on the preview screen (Feature 1 requirement). */
export function adjustRedaction(rec: UploadRecord, added: RedactionRegion[]): UploadRecord {
  if (rec.stage !== 'redacted_preview') throw new Error('redaction editable only on preview');
  return { ...rec, appliedRegions: dedupe([...rec.appliedRegions, ...added]) };
}

/** Holder removes a false-positive region. Account numbers ≥0.8 confidence cannot be un-redacted. */
export function removeRegion(rec: UploadRecord, box: { x: number; y: number; w: number; h: number }): UploadRecord {
  if (rec.stage !== 'redacted_preview') throw new Error('redaction editable only on preview');
  const target = rec.appliedRegions.find(
    (r) => Math.abs(r.box.x - box.x) < 2 && Math.abs(r.box.y - box.y) < 2,
  );
  if (target && target.kind === 'account_number' && target.confidence >= 0.8) {
    throw new Error('cannot un-redact a high-confidence account number');
  }
  return { ...rec, appliedRegions: rec.appliedRegions.filter((r) => r !== target) };
}

/**
 * Step 6 of Flow 1: submit for review. FAILS CLOSED:
 *  - duplicate bill hash -> DuplicateBillError (verification pipeline AC)
 *  - incomplete account-number redaction -> RedactionIncompleteError
 */
export function submitForReview(rec: UploadRecord, existingHashes: Set<string>): UploadRecord {
  if (existingHashes.has(rec.billHash)) {
    throw new DuplicateBillError(`duplicate upload: ${rec.billHash.slice(0, 12)}…`);
  }
  if (!redactionComplete(rec.detectedRegions, rec.appliedRegions)) {
    throw new RedactionIncompleteError('account numbers still visible on the redacted render');
  }
  return { ...rec, stage: 'submitted' };
}

/** Only ever returned to the HOLDER's own session (never payers, never public API). */
export function previewForHolder(rec: UploadRecord): { redactedImageUrl: string; appliedRegions: RedactionRegion[] } {
  return { redactedImageUrl: rec.redactedImageUrl!, appliedRegions: rec.appliedRegions };
}

function dedupe(regions: RedactionRegion[]): RedactionRegion[] {
  const seen = new Set<string>();
  return regions.filter((r) => {
    const k = `${r.kind}:${r.box.x},${r.box.y},${r.box.w},${r.box.h}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
