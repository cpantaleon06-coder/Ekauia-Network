import { PayPalConfigError } from '../paypal/config.js';
import { PayPalApiError, PayPalResponseError } from '../paypal/errors.js';
import { CaptureFailedError } from './run-sandbox-order.js';
import { ApprovalTimeoutError, OrderNotApprovableError } from './wait-for-approval.js';

const EXPECTED_ERRORS = [
  RangeError,
  PayPalConfigError,
  PayPalResponseError,
  ApprovalTimeoutError,
  OrderNotApprovableError,
];

/**
 * What the sandbox script prints when it fails: the message, plus PayPal's debug_id on its own
 * line whenever PayPal returned one.
 */
export function failureLines(error: unknown): string[] {
  if (error instanceof CaptureFailedError || error instanceof PayPalApiError) {
    return [error.message, `debug_id: ${error.debugId ?? '(not provided by PayPal)'}`];
  }
  if (EXPECTED_ERRORS.some((type) => error instanceof type)) {
    return [(error as Error).message];
  }
  return [`Unexpected error: ${error instanceof Error ? error.message : String(error)}`];
}
