// The only place where integer cents meet PayPal's decimal strings. Integer arithmetic only, so no
// floating point rounding can creep in.

const DECIMAL_AMOUNT = /^(\d+)(?:\.(\d{1,2}))?$/;

/** Integer USD cents to a PayPal amount string: 1000 becomes "10.00", 5 becomes "0.05". */
export function centsToDecimalString(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`Expected a non-negative integer amount of cents, got ${cents}`);
  }
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}

/** A PayPal amount string to integer cents: "10.00" becomes 1000, "0.5" becomes 50. */
export function decimalStringToCents(value: string): number {
  const match = DECIMAL_AMOUNT.exec(value);
  if (match === null) {
    throw new RangeError(`Expected a decimal amount with at most two decimals, got "${value}"`);
  }
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const cents = whole * 100 + fraction;
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Amount "${value}" is too large`);
  }
  return cents;
}
