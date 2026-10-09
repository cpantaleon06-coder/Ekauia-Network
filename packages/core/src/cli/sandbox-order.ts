// Creates, approves (in a browser) and captures one PayPal sandbox order.
// Run with: pnpm --filter @ecahuil/core sandbox:order [amountCents]
// The script loads the repository's .env through Node's --env-file flag; it never prints it.
import { PayPalClient } from '../paypal/client.js';
import { PayPalConfigError, loadPayPalConfig } from '../paypal/config.js';
import { PayPalApiError, PayPalResponseError } from '../paypal/errors.js';
import { DEFAULT_AMOUNT_CENTS, runSandboxOrder } from '../sandbox/run-sandbox-order.js';
import { ApprovalTimeoutError, OrderNotApprovableError } from '../sandbox/wait-for-approval.js';

const KNOWN_ERRORS = [
  PayPalConfigError,
  PayPalApiError,
  PayPalResponseError,
  ApprovalTimeoutError,
  OrderNotApprovableError,
];

function parseAmountCents(args: readonly string[]): number {
  const [value] = args.filter((arg) => arg !== '--');
  if (value === undefined) {
    return DEFAULT_AMOUNT_CENTS;
  }
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new RangeError(`The amount must be a positive integer number of cents, got "${value}"`);
  }
  return cents;
}

async function main(): Promise<void> {
  const amountCents = parseAmountCents(process.argv.slice(2));
  const config = loadPayPalConfig(process.env);
  if (!new URL(config.apiBase).hostname.includes('.sandbox.')) {
    throw new PayPalConfigError(
      'PAYPAL_API_BASE does not point at the PayPal sandbox; this script only runs against it.',
    );
  }
  const client = new PayPalClient({ config, log: (line) => console.log(`[paypal] ${line}`) });
  await runSandboxOrder({ client, amountCents, print: (line) => console.log(line) });
}

try {
  await main();
} catch (error) {
  if (error instanceof RangeError || KNOWN_ERRORS.some((type) => error instanceof type)) {
    console.error((error as Error).message);
  } else {
    console.error('Unexpected error:', error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}
