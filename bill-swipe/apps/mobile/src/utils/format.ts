/** Formatting helpers — amounts always integer cents, tabular-safe strings. */

export function formatCents(cents: number, currency = 'CAD'): string {
  if (!Number.isInteger(cents)) throw new Error('amounts must be integer cents');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-CA');
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}$${whole}.${frac}${currency === 'CAD' ? '' : ` ${currency}`}`;
}

export function daysUntilLabel(dueIso: string, nowMs: number = Date.now()): string {
  const days = Math.ceil((Date.parse(dueIso) - nowMs) / 86_400_000);
  if (days < 0) return 'past due';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}
