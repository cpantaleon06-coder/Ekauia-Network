import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayPalClient } from '../src/paypal/client.js';
import { PayPalConfigError } from '../src/paypal/config.js';
import { PayPalApiError } from '../src/paypal/errors.js';
import { failureLines } from '../src/sandbox/failure-lines.js';
import { CaptureFailedError, runSandboxOrder } from '../src/sandbox/run-sandbox-order.js';
import { ApprovalTimeoutError } from '../src/sandbox/wait-for-approval.js';
import { FakeClock } from './support/fake-clock.js';
import { config, jsonResponse, orderBody, scriptedFetch } from './support/fake-paypal.js';

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('Network access is not allowed in tests')));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const declined = {
  name: 'UNPROCESSABLE_ENTITY',
  debug_id: '7a1b2c3d4e5f6',
  details: [{ issue: 'INSTRUMENT_DECLINED', description: 'The instrument was declined.' }],
};

describe('runSandboxOrder when the capture fails', () => {
  it('stops with the PayPal error and its debug_id, without retrying the capture', async () => {
    const paypal = scriptedFetch((request) => {
      if (request.url.endsWith('/capture')) {
        return jsonResponse(422, declined);
      }
      return request.method === 'POST'
        ? jsonResponse(201, orderBody('ORDER-1', 'PAYER_ACTION_REQUIRED'))
        : jsonResponse(200, orderBody('ORDER-1', 'APPROVED'));
    });
    const client = new PayPalClient({ config, fetch: paypal.fetch });

    const error: unknown = await runSandboxOrder({
      client,
      print: () => undefined,
      clock: new FakeClock(),
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(CaptureFailedError);
    expect(error).toMatchObject({ orderId: 'ORDER-1', debugId: '7a1b2c3d4e5f6' });
    expect((error as CaptureFailedError).cause).toMatchObject({ issue: 'INSTRUMENT_DECLINED' });
    expect(paypal.apiRequests().filter((request) => request.url.endsWith('/capture'))).toHaveLength(
      1,
    );
  });
});

describe('failureLines', () => {
  const apiError = new PayPalApiError({
    status: 422,
    errorName: 'UNPROCESSABLE_ENTITY',
    issue: 'INSTRUMENT_DECLINED',
    debugId: '7a1b2c3d4e5f6',
    description: 'The instrument was declined.',
  });

  it('writes a failed capture and its debug_id', () => {
    expect(failureLines(new CaptureFailedError('ORDER-1', apiError))).toEqual([
      'Capture failed for order ORDER-1: PayPal API error 422 UNPROCESSABLE_ENTITY ' +
        '(INSTRUMENT_DECLINED): The instrument was declined. [debug_id 7a1b2c3d4e5f6]',
      'debug_id: 7a1b2c3d4e5f6',
    ]);
  });

  it('writes the debug_id of any other PayPal error, or says it is missing', () => {
    const withoutDebugId = new PayPalApiError({
      status: 500,
      errorName: undefined,
      issue: undefined,
      debugId: undefined,
      description: undefined,
    });

    expect(failureLines(apiError)[1]).toBe('debug_id: 7a1b2c3d4e5f6');
    expect(failureLines(withoutDebugId)[1]).toBe('debug_id: (not provided by PayPal)');
  });

  it('writes only the message for expected errors and flags anything else', () => {
    expect(failureLines(new ApprovalTimeoutError('Not approved in time.'))).toEqual([
      'Not approved in time.',
    ]);
    expect(failureLines(new PayPalConfigError('Invalid PayPal configuration.'))).toEqual([
      'Invalid PayPal configuration.',
    ]);
    expect(failureLines(new Error('boom'))).toEqual(['Unexpected error: boom']);
  });
});
