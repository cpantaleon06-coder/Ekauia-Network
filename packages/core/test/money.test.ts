import { describe, expect, it } from 'vitest';
import { centsToDecimalString, decimalStringToCents } from '../src/money.js';

describe('centsToDecimalString', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [99, '0.99'],
    [100, '1.00'],
    [1000, '10.00'],
    [123_456, '1234.56'],
    [Number.MAX_SAFE_INTEGER, '90071992547409.91'],
  ])('converts %i cents to "%s"', (cents, expected) => {
    expect(centsToDecimalString(cents)).toBe(expected);
  });

  it.each([-1, 10.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (cents) => {
    expect(() => centsToDecimalString(cents)).toThrow(RangeError);
  });
});

describe('decimalStringToCents', () => {
  it.each([
    ['0.00', 0],
    ['0.05', 5],
    ['0.5', 50],
    ['10', 1000],
    ['10.00', 1000],
    ['1234.56', 123_456],
  ])('converts "%s" to %i cents', (value, expected) => {
    expect(decimalStringToCents(value)).toBe(expected);
  });

  it.each(['', '-1.00', '1.234', '1,00', 'abc', ' 1.00', '1e3'])('rejects "%s"', (value) => {
    expect(() => decimalStringToCents(value)).toThrow(RangeError);
  });

  it('round-trips with centsToDecimalString', () => {
    for (const cents of [0, 1, 10, 101, 99_999, 1_000_000]) {
      expect(decimalStringToCents(centsToDecimalString(cents))).toBe(cents);
    }
  });
});
