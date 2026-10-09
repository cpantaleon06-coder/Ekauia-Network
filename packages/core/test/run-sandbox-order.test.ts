import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayPalClient } from '../src/paypal/client.js';
import { runSandboxOrder } from '../src/sandbox/run-sandbox-order.js';
import { ApprovalTimeoutError } from '../src/sandbox/wait-for-approval.js';
import {
  BASIC_CREDENTIALS,
  CLIENT_ID,
  CLIENT_SECRET,
  config,
  jsonResponse,
  orderBody,
  scriptedFetch,
  type RecordedRequest,
} from './support/fake-paypal.js';
import { FakeClock } from './support/fake-clock.js';

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('Network access is not allowed in tests')));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const capturedOrder = orderBody('ORDER-1', 'COMPLETED', {
  purchase_units: [
    {
      payments: {
        captures: [
          {
            id: 'CAPTURE-1',
            status: 'COMPLETED',
            amount: { currency_code: 'USD', value: '10.00' },
            seller_receivable_breakdown: {
              gross_amount: { currency_code: 'USD', value: '10.00' },
              paypal_fee: { currency_code: 'USD', value: '0.84' },
              net_amount: { currency_code: 'USD', value: '9.16' },
            },
          },
        ],
      },
    },
  ],
});

/** PayPal as seen by the script: approval happens after `approveAfterReads` order reads. */
function sandbox(approveAfterReads: number) {
  let reads = 0;
  return scriptedFetch((request: RecordedRequest) => {
    if (request.url.endsWith('/capture')) {
      return jsonResponse(201, capturedOrder);
    }
    if (request.method === 'POST') {
      return jsonResponse(201, orderBody('ORDER-1', 'PAYER_ACTION_REQUIRED'));
    }
    reads += 1;
    return jsonResponse(
      200,
      orderBody('ORDER-1', reads >= approveAfterReads ? 'APPROVED' : 'PAYER_ACTION_REQUIRED'),
    );
  });
}

describe('runSandboxOrder', () => {
  it('creates, waits for approval, captures and prints the breakdown', async () => {
    const paypal = sandbox(3);
    const lines: string[] = [];
    const clock = new FakeClock();
    const client = new PayPalClient({
      config,
      fetch: paypal.fetch,
      log: (line) => lines.push(line),
    });

    const result = await runSandboxOrder({ client, print: (line) => lines.push(line), clock });

    expect(result).toEqual({ orderId: 'ORDER-1', status: 'COMPLETED', captureId: 'CAPTURE-1' });
    expect(JSON.parse(paypal.apiRequests()[0]?.body ?? '')).toMatchObject({
      purchase_units: [{ amount: { currency_code: 'USD', value: '10.00' } }],
    });
    expect(clock.sleeps).toEqual([3_000, 3_000]);
    const output = lines.join('\n');
    expect(output).toContain('https://www.sandbox.paypal.test/checkoutnow?token=ORDER-1');
    expect(output).toContain('Final order status: COMPLETED');
    expect(output).toContain('Capture id: CAPTURE-1');
    expect(output).toContain('Gross:      10.00 USD (1000 cents)');
    expect(output).toContain('PayPal fee: 0.84 USD (84 cents)');
    expect(output).toContain('Net:        9.16 USD (916 cents)');
    for (const secret of [
      CLIENT_ID,
      CLIENT_SECRET,
      BASIC_CREDENTIALS,
      'token-1',
      'Authorization',
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it('uses the requested amount in cents', async () => {
    const paypal = sandbox(1);
    const client = new PayPalClient({ config, fetch: paypal.fetch });

    await runSandboxOrder({
      client,
      amountCents: 2_550,
      print: () => undefined,
      clock: new FakeClock(),
    });

    expect(JSON.parse(paypal.apiRequests()[0]?.body ?? '')).toMatchObject({
      purchase_units: [{ amount: { value: '25.50' } }],
    });
  });

  it('stops after 5 minutes without capturing when the order is never approved', async () => {
    const paypal = sandbox(Number.POSITIVE_INFINITY);
    const client = new PayPalClient({ config, fetch: paypal.fetch });

    await expect(
      runSandboxOrder({ client, print: () => undefined, clock: new FakeClock() }),
    ).rejects.toThrow(ApprovalTimeoutError);
    expect(paypal.apiRequests().some((request) => request.url.endsWith('/capture'))).toBe(false);
  });
});
