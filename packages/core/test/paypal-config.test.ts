import { describe, expect, it } from 'vitest';
import { PayPalConfigError, loadPayPalConfig } from '../src/paypal/config.js';

// Fake values; never real credentials.
const CLIENT_ID = 'fake-client-id-AbC123';
const CLIENT_SECRET = 'fake-client-secret-XyZ789';

describe('loadPayPalConfig', () => {
  it('reads and trims the three variables', () => {
    expect(
      loadPayPalConfig({
        PAYPAL_CLIENT_ID: `  ${CLIENT_ID} `,
        PAYPAL_CLIENT_SECRET: `\t${CLIENT_SECRET}`,
        PAYPAL_API_BASE: 'https://api-m.sandbox.paypal.com/',
      }),
    ).toEqual({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      apiBase: 'https://api-m.sandbox.paypal.com',
    });
  });

  it('strips trailing carriage returns left by a Windows-edited .env', () => {
    const config = loadPayPalConfig({
      PAYPAL_CLIENT_ID: `${CLIENT_ID}\r`,
      PAYPAL_CLIENT_SECRET: `${CLIENT_SECRET}\r`,
      PAYPAL_API_BASE: 'https://api-m.sandbox.paypal.com\r',
    });

    expect(config.clientId).toBe(CLIENT_ID);
    expect(config.clientSecret).toBe(CLIENT_SECRET);
    expect(config.apiBase).toBe('https://api-m.sandbox.paypal.com');
    expect(JSON.stringify(config)).not.toContain('\\r');
  });

  it('names every missing variable', () => {
    expect(() => loadPayPalConfig({})).toThrow(PayPalConfigError);
    expect(() => loadPayPalConfig({})).toThrow(
      /PAYPAL_CLIENT_ID is missing.*PAYPAL_CLIENT_SECRET is missing.*PAYPAL_API_BASE must be/,
    );
  });

  it('treats whitespace-only values as missing', () => {
    expect(() =>
      loadPayPalConfig({
        PAYPAL_CLIENT_ID: ' \r',
        PAYPAL_CLIENT_SECRET: CLIENT_SECRET,
        PAYPAL_API_BASE: 'https://api-m.sandbox.paypal.com',
      }),
    ).toThrow('PAYPAL_CLIENT_ID is missing or empty');
  });

  it.each(['http://api-m.sandbox.paypal.com', 'not a url', 'https://example.com/?x=1'])(
    'rejects the API base %s',
    (apiBase) => {
      expect(() =>
        loadPayPalConfig({
          PAYPAL_CLIENT_ID: CLIENT_ID,
          PAYPAL_CLIENT_SECRET: CLIENT_SECRET,
          PAYPAL_API_BASE: apiBase,
        }),
      ).toThrow('PAYPAL_API_BASE must be an https URL');
    },
  );

  it('never puts the values in the error message', () => {
    let message = '';
    try {
      loadPayPalConfig({
        PAYPAL_CLIENT_ID: CLIENT_ID,
        PAYPAL_CLIENT_SECRET: CLIENT_SECRET,
        PAYPAL_API_BASE: `http://${CLIENT_SECRET}.example.com`,
      });
    } catch (error) {
      message = String(error);
    }

    expect(message).toContain('PAYPAL_API_BASE');
    expect(message).not.toContain(CLIENT_ID);
    expect(message).not.toContain(CLIENT_SECRET);
  });
});
