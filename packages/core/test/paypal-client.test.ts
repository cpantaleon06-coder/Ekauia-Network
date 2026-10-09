import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayPalClient, TOKEN_REFRESH_MARGIN_MS } from '../src/paypal/client.js';
import { PayPalApiError, PayPalResponseError } from '../src/paypal/errors.js';
import { approvalLink } from '../src/paypal/schemas.js';
import {
  API_BASE,
  BASIC_CREDENTIALS,
  CLIENT_ID,
  CLIENT_SECRET,
  config,
  jsonResponse,
  orderBody,
  scriptedFetch,
} from './support/fake-paypal.js';

beforeEach(() => {
  // Any accidental use of the real fetch fails the test instead of reaching the network.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('Network access is not allowed in tests')));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sequentialIds() {
  let next = 0;
  return () => {
    next += 1;
    return `request-${next}`;
  };
}

describe('PayPalClient access token', () => {
  it('requests a token with client credentials', async () => {
    const paypal = scriptedFetch();
    const client = new PayPalClient({ config, fetch: paypal.fetch });

    expect(await client.getAccessToken()).toBe('token-1');

    const [request] = paypal.tokenRequests();
    expect(request).toEqual({
      url: `${API_BASE}/v1/oauth2/token`,
      method: 'POST',
      headers: {
        Authorization: `Basic ${BASIC_CREDENTIALS}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });
  });

  it('reuses the token until shortly before it expires, then refreshes it', async () => {
    let nowMs = 0;
    const paypal = scriptedFetch(() => jsonResponse(200, orderBody('ORDER-1', 'CREATED')));
    const client = new PayPalClient({ config, fetch: paypal.fetch, now: () => nowMs });
    const lifetimeMs = 32_400 * 1000;

    await client.getOrder('ORDER-1');
    nowMs = lifetimeMs - TOKEN_REFRESH_MARGIN_MS - 1;
    await client.getOrder('ORDER-1');
    expect(paypal.tokenRequests()).toHaveLength(1);

    nowMs = lifetimeMs - TOKEN_REFRESH_MARGIN_MS;
    await client.getOrder('ORDER-1');
    expect(paypal.tokenRequests()).toHaveLength(2);
    expect(paypal.apiRequests().map((request) => request.headers.Authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });

  it('refreshes short-lived tokens at half their lifetime', async () => {
    let nowMs = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        jsonResponse(200, { access_token: 'short', token_type: 'Bearer', expires_in: 60 }),
      ),
    );
    const client = new PayPalClient({ config, fetch, now: () => nowMs });

    await client.getAccessToken();
    nowMs = 29_999;
    await client.getAccessToken();
    expect(fetch).toHaveBeenCalledTimes(1);
    nowMs = 30_000;
    await client.getAccessToken();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shares one token request between concurrent callers', async () => {
    const paypal = scriptedFetch();
    const client = new PayPalClient({ config, fetch: paypal.fetch });

    const tokens = await Promise.all([client.getAccessToken(), client.getAccessToken()]);

    expect(tokens).toEqual(['token-1', 'token-1']);
    expect(paypal.tokenRequests()).toHaveLength(1);
  });
});

describe('PayPalClient orders', () => {
  it('creates an order in USD with the amount as a decimal string', async () => {
    const paypal = scriptedFetch(() =>
      jsonResponse(201, orderBody('ORDER-1', 'PAYER_ACTION_REQUIRED')),
    );
    const client = new PayPalClient({ config, fetch: paypal.fetch, requestId: sequentialIds() });

    const order = await client.createOrder({
      amountCents: 1234,
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel',
    });

    expect(order.status).toBe('PAYER_ACTION_REQUIRED');
    expect(approvalLink(order)).toBe('https://www.sandbox.paypal.test/checkoutnow?token=ORDER-1');
    const [request] = paypal.apiRequests();
    expect(request?.url).toBe(`${API_BASE}/v2/checkout/orders`);
    expect(request?.method).toBe('POST');
    expect(request?.headers).toEqual({
      Authorization: 'Bearer token-1',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'PayPal-Request-Id': 'request-1',
      Prefer: 'return=representation',
    });
    expect(JSON.parse(request?.body ?? '')).toEqual({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'USD', value: '12.34' } }],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: 'https://example.com/return',
            cancel_url: 'https://example.com/cancel',
            user_action: 'PAY_NOW',
          },
        },
      },
    });
  });

  it('sends a fresh PayPal-Request-Id on every mutating request and none on reads', async () => {
    const paypal = scriptedFetch((request) =>
      jsonResponse(request.method === 'GET' ? 200 : 201, orderBody('ORDER-1', 'APPROVED')),
    );
    const client = new PayPalClient({ config, fetch: paypal.fetch, requestId: sequentialIds() });
    const input = {
      amountCents: 1000,
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel',
    };

    await client.createOrder(input);
    await client.createOrder(input);
    await client.getOrder('ORDER-1');
    await client.captureOrder('ORDER-1');

    expect(paypal.apiRequests().map((request) => request.headers['PayPal-Request-Id'])).toEqual([
      'request-1',
      'request-2',
      undefined,
      'request-3',
    ]);
  });

  it('gets and captures an order by id', async () => {
    const paypal = scriptedFetch((request) =>
      request.method === 'GET'
        ? jsonResponse(200, orderBody('ORDER/1', 'APPROVED'))
        : jsonResponse(201, orderBody('ORDER/1', 'COMPLETED')),
    );
    const client = new PayPalClient({ config, fetch: paypal.fetch, requestId: sequentialIds() });

    expect((await client.getOrder('ORDER/1')).status).toBe('APPROVED');
    expect((await client.captureOrder('ORDER/1')).status).toBe('COMPLETED');

    const [get, capture] = paypal.apiRequests();
    expect(get).toMatchObject({ method: 'GET', url: `${API_BASE}/v2/checkout/orders/ORDER%2F1` });
    expect(get?.body).toBeUndefined();
    expect(capture).toMatchObject({
      method: 'POST',
      url: `${API_BASE}/v2/checkout/orders/ORDER%2F1/capture`,
    });
    expect(capture?.body).toBeUndefined();
  });
});

describe('PayPalClient errors', () => {
  it('maps a REST error body to PayPalApiError with name, issue and debug_id', async () => {
    const paypal = scriptedFetch(() =>
      jsonResponse(422, {
        name: 'UNPROCESSABLE_ENTITY',
        message: 'The requested action could not be performed.',
        debug_id: 'f1e2d3c4b5a69',
        details: [{ issue: 'ORDER_NOT_APPROVED', description: 'Payer has not yet approved.' }],
      }),
    );
    const client = new PayPalClient({ config, fetch: paypal.fetch });

    const error: unknown = await client.captureOrder('ORDER-1').catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PayPalApiError);
    expect(error).toMatchObject({
      status: 422,
      errorName: 'UNPROCESSABLE_ENTITY',
      issue: 'ORDER_NOT_APPROVED',
      debugId: 'f1e2d3c4b5a69',
      description: 'Payer has not yet approved.',
    });
    expect(String(error)).toContain('debug_id f1e2d3c4b5a69');
  });

  it('maps an OAuth error body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        jsonResponse(401, {
          error: 'invalid_client',
          error_description: 'Client Authentication failed',
        }),
      ),
    );
    const client = new PayPalClient({ config, fetch });

    await expect(client.getAccessToken()).rejects.toMatchObject({
      status: 401,
      errorName: 'invalid_client',
      description: 'Client Authentication failed',
    });
  });

  it('keeps the debug id header when the body is not JSON', async () => {
    const paypal = scriptedFetch(
      () =>
        new Response('<html>Bad gateway</html>', {
          status: 502,
          headers: { 'paypal-debug-id': 'abc123' },
        }),
    );
    const client = new PayPalClient({ config, fetch: paypal.fetch });

    await expect(client.getOrder('ORDER-1')).rejects.toMatchObject({
      status: 502,
      debugId: 'abc123',
    });
  });

  it('rejects a success response with an unexpected shape', async () => {
    const paypal = scriptedFetch(() => jsonResponse(200, { unexpected: true }));
    const client = new PayPalClient({ config, fetch: paypal.fetch });

    await expect(client.getOrder('ORDER-1')).rejects.toBeInstanceOf(PayPalResponseError);
  });
});

describe('PayPalClient logging', () => {
  it('never logs or throws credentials, tokens or Authorization headers', async () => {
    const consoleLines: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleLines.push(args.map(String).join(' '));
      });
    }
    const logLines: string[] = [];
    let call = 0;
    const paypal = scriptedFetch(() => {
      call += 1;
      return call === 1
        ? jsonResponse(201, orderBody('ORDER-1', 'PAYER_ACTION_REQUIRED'), {
            'paypal-debug-id': 'd1',
          })
        : jsonResponse(422, {
            name: 'UNPROCESSABLE_ENTITY',
            debug_id: 'd2',
            details: [{ issue: 'X' }],
          });
    });
    const client = new PayPalClient({
      config,
      fetch: paypal.fetch,
      log: (line) => logLines.push(line),
    });

    await client.createOrder({
      amountCents: 1000,
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel',
    });
    const error: unknown = await client.captureOrder('ORDER-1').catch((reason: unknown) => reason);

    const output = [...logLines, ...consoleLines, String(error), JSON.stringify(error)].join('\n');
    expect(logLines.length).toBeGreaterThan(0);
    for (const secret of [
      CLIENT_ID,
      CLIENT_SECRET,
      BASIC_CREDENTIALS,
      'token-1',
      'Authorization',
      'Bearer',
    ]) {
      expect(output).not.toContain(secret);
    }
    vi.restoreAllMocks();
  });
});
