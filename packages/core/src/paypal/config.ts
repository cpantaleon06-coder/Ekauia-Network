export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  /** REST API origin without a trailing slash, e.g. `https://api-m.sandbox.paypal.com`. */
  apiBase: string;
}

/** Raised when the PayPal settings are missing or invalid. Never contains their values. */
export class PayPalConfigError extends Error {
  override readonly name = 'PayPalConfigError';
}

const NAMES = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_API_BASE'] as const;

/**
 * Reads PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_API_BASE. Values are trimmed of any
 * surrounding whitespace, including the carriage returns a Windows-edited .env leaves behind.
 * Errors name the offending variables but never print their values.
 */
export function loadPayPalConfig(env: Readonly<Record<string, string | undefined>>): PayPalConfig {
  const [clientId, clientSecret, rawApiBase] = NAMES.map((name) => env[name]?.trim() ?? '');
  const problems: string[] = [];
  if (clientId === '') {
    problems.push('PAYPAL_CLIENT_ID is missing or empty');
  }
  if (clientSecret === '') {
    problems.push('PAYPAL_CLIENT_SECRET is missing or empty');
  }
  const apiBase = parseApiBase(rawApiBase ?? '');
  if (apiBase === undefined) {
    problems.push('PAYPAL_API_BASE must be an https URL such as https://api-m.sandbox.paypal.com');
  }
  if (problems.length > 0 || clientId === undefined || clientSecret === undefined) {
    throw new PayPalConfigError(
      `Invalid PayPal configuration: ${problems.join('; ')}. Set these variables in .env ` +
        '(see .env.example).',
    );
  }
  return { clientId, clientSecret, apiBase: apiBase ?? '' };
}

function parseApiBase(value: string): string | undefined {
  if (value === '') {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.search !== '' || url.hash !== '') {
    return undefined;
  }
  return url.href.replace(/\/+$/, '');
}
