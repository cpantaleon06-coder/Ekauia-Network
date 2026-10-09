import type { PayPalOrder } from '../paypal/schemas.js';

/** Time source for polling. Tests pass a fake; the script uses the real clock. */
export interface PollingClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: PollingClock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};

export const DEFAULT_POLL_INTERVAL_MS = 3_000;
export const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60_000;

/** The payer did not approve the order in time. */
export class ApprovalTimeoutError extends Error {
  override readonly name = 'ApprovalTimeoutError';
}

/** The order reached a state from which it can no longer be approved and captured. */
export class OrderNotApprovableError extends Error {
  override readonly name = 'OrderNotApprovableError';
}

export interface WaitForApprovalOptions {
  clock?: PollingClock;
  intervalMs?: number;
  timeoutMs?: number;
  /** Called with every order read, e.g. to print progress. */
  onPoll?: (order: PayPalOrder) => void;
}

/**
 * Reads the order every `intervalMs` until it is APPROVED and returns it. Throws
 * ApprovalTimeoutError once `timeoutMs` has passed, or OrderNotApprovableError if the order is
 * voided or already completed.
 */
export async function waitForApproval(
  getOrder: () => Promise<PayPalOrder>,
  options: WaitForApprovalOptions = {},
): Promise<PayPalOrder> {
  const clock = options.clock ?? systemClock;
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
  const deadlineMs = clock.now() + timeoutMs;

  for (;;) {
    const order = await getOrder();
    options.onPoll?.(order);
    if (order.status === 'APPROVED') {
      return order;
    }
    if (order.status === 'VOIDED' || order.status === 'COMPLETED') {
      throw new OrderNotApprovableError(
        `Order ${order.id} is ${order.status} and can no longer be approved and captured.`,
      );
    }
    if (clock.now() + intervalMs > deadlineMs) {
      throw new ApprovalTimeoutError(
        `Order ${order.id} was not approved within ${Math.round(timeoutMs / 1000)} seconds ` +
          `(last status: ${order.status}).`,
      );
    }
    await clock.sleep(intervalMs);
  }
}
