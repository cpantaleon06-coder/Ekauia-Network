import { decimalStringToCents } from '../money.js';
import type { PayPalClient } from '../paypal/client.js';
import { PayPalResponseError } from '../paypal/errors.js';
import { approvalLink, firstCapture, type PayPalMoney } from '../paypal/schemas.js';
import { waitForApproval, type PollingClock } from './wait-for-approval.js';

export const RETURN_URL = 'https://example.com/return';
export const CANCEL_URL = 'https://example.com/cancel';
export const DEFAULT_AMOUNT_CENTS = 1_000;

export interface SandboxOrderOptions {
  client: Pick<PayPalClient, 'createOrder' | 'getOrder' | 'captureOrder'>;
  amountCents?: number;
  print: (line: string) => void;
  clock?: PollingClock;
  intervalMs?: number;
  timeoutMs?: number;
}

export interface SandboxOrderResult {
  orderId: string;
  status: string;
  captureId: string | undefined;
}

/**
 * Creates a CAPTURE order, prints the approval link, waits for the payer to approve it, captures
 * it and prints the outcome with PayPal's fee breakdown.
 */
export async function runSandboxOrder(options: SandboxOrderOptions): Promise<SandboxOrderResult> {
  const { client, print } = options;
  const amountCents = options.amountCents ?? DEFAULT_AMOUNT_CENTS;

  const order = await client.createOrder({
    amountCents,
    returnUrl: RETURN_URL,
    cancelUrl: CANCEL_URL,
    userAction: 'PAY_NOW',
  });
  const link = approvalLink(order);
  if (link === undefined) {
    throw new PayPalResponseError(`Order ${order.id} came back without an approval link`);
  }
  print(`Created order ${order.id} for ${amountCents} cents (USD), status ${order.status}.`);
  print('Open this link in a private browser window, sign in with a sandbox Personal account');
  print('and approve the payment:');
  print(`  ${link}`);
  print('Waiting for approval (checking every 3 seconds, for up to 5 minutes)...');

  let lastStatus = order.status;
  await waitForApproval(() => client.getOrder(order.id), {
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    onPoll: (polled) => {
      if (polled.status !== lastStatus) {
        print(`Order status: ${polled.status}`);
        lastStatus = polled.status;
      }
    },
  });

  const captured = await client.captureOrder(order.id);
  const capture = firstCapture(captured);
  print(`Final order status: ${captured.status}`);
  print(`Capture id: ${capture?.id ?? '(none)'} (status ${capture?.status ?? 'unknown'})`);
  const breakdown = capture?.seller_receivable_breakdown;
  if (breakdown === undefined) {
    print('Seller receivable breakdown: not provided by PayPal');
  } else {
    print('Seller receivable breakdown:');
    print(`  Gross:      ${formatMoney(breakdown.gross_amount)}`);
    print(`  PayPal fee: ${formatMoney(breakdown.paypal_fee)}`);
    print(`  Net:        ${formatMoney(breakdown.net_amount)}`);
  }
  return { orderId: captured.id, status: captured.status, captureId: capture?.id };
}

function formatMoney(money: PayPalMoney | undefined): string {
  if (money === undefined) {
    return '(not provided)';
  }
  return `${money.value} ${money.currency_code} (${decimalStringToCents(money.value)} cents)`;
}
