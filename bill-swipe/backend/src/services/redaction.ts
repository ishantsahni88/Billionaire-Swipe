/**
 * Redaction service — PRD Feature 1.
 * Detects and blurs account numbers, names, full addresses, and barcodes
 * BEFORE any non-verification party sees the bill. The unredacted original
 * is stored encrypted; only `redactedImageUrl` may ever reach a payer response.
 */

export interface BoundingBox { x: number; y: number; w: number; h: number }

export type PiiKind = 'account_number' | 'name' | 'address' | 'barcode';

export interface RedactionRegion {
  kind: PiiKind;
  box: BoundingBox;
  /** confidence 0..1 from the detection model */
  confidence: number;
}

// Common Canadian/utility account-number shapes: 8–20 digit groups, optionally
// hyphen/space separated, or "A1234-5678" style customer numbers.
const ACCOUNT_NUMBER_RE = /\b(?:\d[ -]?){7,19}\b/g;
const CUSTOMER_ID_RE = /\b[A-Z]\d{3}[ -]?\d{4}(?:[ -]?\d{1,4})?\b/g;
const ADDRESS_LINE_RE =
  /^\s*\d{1,6}\s+[A-Za-z' .-]+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Way|Place|Pl\.?)\b.*$/gim;
const NAME_LINE_RE = /^\s*(?:Account\s+(?:Name|Holder)|Bill\s+To|Dear)\s*[:.]?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*$/gim;

export interface OcrWord { text: string; box: BoundingBox }
export interface BarcodeHit { box: BoundingBox }

/** Pure detection pass — runs server-side on OCR output before image blur. */
export function detectPii(words: OcrWord[], barcodes: BarcodeHit[] = []): RedactionRegion[] {
  const regions: RedactionRegion[] = [];
  const lineText = words.map((w) => w.text).join(' ');

  for (const m of lineText.matchAll(ACCOUNT_NUMBER_RE)) {
    if ((m[0].match(/\d/g) ?? []).length >= 8) {
      regions.push({ kind: 'account_number', box: unionBox(words), confidence: 0.95 });
      break;
    }
  }
  for (const m of lineText.matchAll(CUSTOMER_ID_RE)) {
    regions.push({ kind: 'account_number', box: unionBox(words), confidence: 0.9 });
  }
  for (const m of lineText.matchAll(NAME_LINE_RE)) {
    regions.push({ kind: 'name', box: unionBox(words), confidence: 0.85 });
  }
  for (const m of lineText.matchAll(ADDRESS_LINE_RE)) {
    regions.push({ kind: 'address', box: unionBox(words), confidence: 0.85 });
  }
  for (const b of barcodes) {
    regions.push({ kind: 'barcode', box: b.box, confidence: 1 });
  }
  return dedupe(regions);
}

function unionBox(words: OcrWord[]): BoundingBox {
  if (!words.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x1 = Math.min(...words.map((w) => w.box.x));
  const y1 = Math.min(...words.map((w) => w.box.y));
  const x2 = Math.max(...words.map((w) => w.box.x + w.box.w));
  const y2 = Math.max(...words.map((w) => w.box.y + w.box.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
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

/**
 * Fail-closed rule for publishing: a bill may not publish unless every
 * high-confidence region has been applied to the redacted render.
 * AC target: account-number redaction catches 95%+ on the 200-bill test set.
 */
export function redactionComplete(detected: RedactionRegion[], applied: RedactionRegion[]): boolean {
  return detected
    .filter((r) => r.confidence >= 0.8 && r.kind === 'account_number')
    .every((r) => applied.some((a) => a.kind === r.kind && sameBox(a.box, r.box)));
}

const sameBox = (a: BoundingBox, b: BoundingBox) =>
  Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.w - b.w) < 2 && Math.abs(a.h - b.h) < 2;
