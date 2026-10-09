import { z } from 'zod';

/** Error body of the REST APIs (`name`, `details[].issue`) and of OAuth (`error`). */
export const PayPalErrorBodySchema = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
  debug_id: z.string().optional(),
  details: z
    .array(
      z.object({
        issue: z.string().optional(),
        description: z.string().optional(),
        field: z.string().optional(),
      }),
    )
    .optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export interface PayPalApiErrorDetails {
  status: number;
  /** PayPal's error name, e.g. `UNPROCESSABLE_ENTITY` or OAuth's `invalid_client`. */
  errorName: string | undefined;
  /** The first detail's issue code, e.g. `ORDER_NOT_APPROVED`. */
  issue: string | undefined;
  /** Correlation id to quote when contacting PayPal. */
  debugId: string | undefined;
  description: string | undefined;
}

/** A non-2xx response from PayPal. Built only from PayPal's response, never from our request. */
export class PayPalApiError extends Error {
  override readonly name = 'PayPalApiError';
  readonly status: number;
  readonly errorName: string | undefined;
  readonly issue: string | undefined;
  readonly debugId: string | undefined;
  readonly description: string | undefined;

  constructor(details: PayPalApiErrorDetails) {
    super(describe(details));
    this.status = details.status;
    this.errorName = details.errorName;
    this.issue = details.issue;
    this.debugId = details.debugId;
    this.description = details.description;
  }
}

/** A 2xx response whose body does not have the expected shape. */
export class PayPalResponseError extends Error {
  override readonly name = 'PayPalResponseError';
}

/** Maps a failed response to PayPalApiError, whatever its body looks like. */
export async function toPayPalApiError(response: Response): Promise<PayPalApiError> {
  let body: z.infer<typeof PayPalErrorBodySchema> = {};
  try {
    const parsed = PayPalErrorBodySchema.safeParse(JSON.parse(await response.text()));
    if (parsed.success) {
      body = parsed.data;
    }
  } catch {
    // Not JSON: keep the status and the debug id header.
  }
  const detail = body.details?.[0];
  return new PayPalApiError({
    status: response.status,
    errorName: body.name ?? body.error,
    issue: detail?.issue,
    debugId: body.debug_id ?? response.headers.get('paypal-debug-id') ?? undefined,
    description: detail?.description ?? body.message ?? body.error_description,
  });
}

function describe(details: PayPalApiErrorDetails): string {
  const parts = [`PayPal API error ${details.status}`];
  if (details.errorName !== undefined) {
    parts.push(details.errorName);
  }
  if (details.issue !== undefined) {
    parts.push(`(${details.issue})`);
  }
  let message = parts.join(' ');
  if (details.description !== undefined) {
    message += `: ${details.description}`;
  }
  if (details.debugId !== undefined) {
    message += ` [debug_id ${details.debugId}]`;
  }
  return message;
}
