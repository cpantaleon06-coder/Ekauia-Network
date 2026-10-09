# @ecahuil/core

The claims pipeline, rule authorization and the only package that talks to PayPal.

## PayPal client

`src/paypal/` holds a small REST client built on Node's `fetch`:

- `getAccessToken()`: OAuth2 client credentials. The token is cached and renewed 60 seconds
  before it expires (or at half its lifetime, if that is shorter). Concurrent callers share one
  token request.
- `createOrder({ amountCents, returnUrl, cancelUrl, userAction })`, `getOrder(id)` and
  `captureOrder(id)` against Orders v2. `createOrder` and `captureOrder` send a fresh
  `PayPal-Request-Id`.
- Responses are parsed with zod. PayPal error bodies become a `PayPalApiError` that keeps
  `errorName`, `issue` and `debugId` (quote the debug id when contacting PayPal support).
- Amounts are integer USD cents everywhere; `src/money.ts` is the only place that converts them
  to and from PayPal's decimal strings.
- Credentials, tokens and `Authorization` headers are never logged.

`loadPayPalConfig(process.env)` reads `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and
`PAYPAL_API_BASE`, trims surrounding whitespace (including the carriage returns a Windows editor
leaves in `.env`), and fails with a message that names the missing variables without printing any
value.

## Sandbox order script

`sandbox:order` creates one PayPal sandbox order, waits for you to approve it in a browser,
captures it and prints the outcome. It never runs in tests; the test suite mocks `fetch`.

### Before the first run

1. Copy `.env.example` to `.env` at the repository root and fill in the client id and secret of a
   PayPal **sandbox** REST app. Keep `PAYPAL_API_BASE=https://api-m.sandbox.paypal.com`; the
   script refuses any other host.
2. Have the email and password of a sandbox **Personal** (buyer) account at hand. Find it in the
   PayPal developer dashboard under Testing Tools > Sandbox Accounts.

### Run it

From the repository root:

```bash
pnpm --filter @ecahuil/core sandbox:order
```

Add an amount in cents to change the default of 1000 (USD 10.00), for example
`pnpm --filter @ecahuil/core sandbox:order 2500`.

The script builds the package and its dependencies, then runs
`node --env-file=../../.env dist/cli/sandbox-order.js` from `packages/core`, so Node loads the
root `.env` itself. It then:

1. creates an order (intent `CAPTURE`, USD, `payment_source.paypal` with return URL
   `https://example.com/return`, cancel URL `https://example.com/cancel` and `PAY_NOW`);
2. prints the approval link;
3. checks the order every 3 seconds, for up to 5 minutes, until it is `APPROVED`;
4. captures it and prints the final status, the capture id and the seller receivable breakdown
   (gross, PayPal fee and net).

### What you do while it waits

1. Open the printed link in a **private** browser window, so your normal PayPal session does not
   interfere.
2. Sign in with the sandbox Personal account.
3. Approve the payment. PayPal then redirects to `https://example.com/return`; that page is a
   placeholder and can be closed.

If the order is not approved within 5 minutes, the script stops with a clear message and exits
with code 1, without capturing anything. Lines starting with `[paypal]` show each request and its
`debug_id`, which helps when something fails.
