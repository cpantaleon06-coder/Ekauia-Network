import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { CURRENCY } from '@ecahuil/contracts';
import { centsToDecimalString } from '../money.js';
import type { PayPalConfig } from './config.js';
import { PayPalResponseError, toPayPalApiError } from './errors.js';
import { AccessTokenResponseSchema, PayPalOrderSchema, type PayPalOrder } from './schemas.js';

export interface PayPalClientOptions {
  config: PayPalConfig;
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Current time in epoch milliseconds, for token expiry. Default: Date.now. */
  now?: () => number;
  /** Generates PayPal-Request-Id values. Default: a random UUID. */
  requestId?: () => string;
  /** Receives one line per request and response. Never receives credentials or tokens. */
  log?: (message: string) => void;
}

export interface CreateOrderInput {
  /** Amount in integer USD cents. */
  amountCents: number;
  returnUrl: string;
  cancelUrl: string;
  userAction?: 'PAY_NOW' | 'CONTINUE';
}

/** Tokens are renewed this long before they expire (or at half their lifetime if shorter). */
export const TOKEN_REFRESH_MARGIN_MS = 60_000;

interface CachedToken {
  value: string;
  refreshAtMs: number;
}

/**
 * Minimal PayPal REST client: OAuth2 client credentials with a cached token, and Orders v2
 * create, get and capture. Mutating requests carry a fresh PayPal-Request-Id.
 */
export class PayPalClient {
  readonly #config: PayPalConfig;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;
  readonly #requestId: () => string;
  readonly #log: (message: string) => void;
  #token: CachedToken | undefined;
  #pendingToken: Promise<CachedToken> | undefined;

  constructor(options: PayPalClientOptions) {
    this.#config = options.config;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = options.now ?? Date.now;
    this.#requestId = options.requestId ?? randomUUID;
    this.#log = options.log ?? (() => undefined);
  }

  /** Returns a valid access token, reusing the cached one until shortly before it expires. */
  async getAccessToken(): Promise<string> {
    if (this.#token !== undefined && this.#now() < this.#token.refreshAtMs) {
      return this.#token.value;
    }
    // Concurrent callers share one token request.
    this.#pendingToken ??= this.#requestToken().finally(() => {
      this.#pendingToken = undefined;
    });
    this.#token = await this.#pendingToken;
    return this.#token.value;
  }

  createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
    return this.#request('POST', '/v2/checkout/orders', PayPalOrderSchema, {
      mutating: true,
      body: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: { currency_code: CURRENCY, value: centsToDecimalString(input.amountCents) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
              user_action: input.userAction ?? 'PAY_NOW',
            },
          },
        },
      },
    });
  }

  getOrder(orderId: string): Promise<PayPalOrder> {
    return this.#request(
      'GET',
      `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      PayPalOrderSchema,
    );
  }

  captureOrder(orderId: string): Promise<PayPalOrder> {
    return this.#request(
      'POST',
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      PayPalOrderSchema,
      { mutating: true },
    );
  }

  async #requestToken(): Promise<CachedToken> {
    const path = '/v1/oauth2/token';
    const credentials = Buffer.from(
      `${this.#config.clientId}:${this.#config.clientSecret}`,
    ).toString('base64');
    this.#log(`POST ${path}`);
    const requestedAtMs = this.#now();
    const response = await this.#fetch(`${this.#config.apiBase}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });
    this.#logResponse('POST', path, response);
    if (!response.ok) {
      throw await toPayPalApiError(response);
    }
    const token = await parseBody(response, AccessTokenResponseSchema, `POST ${path}`);
    const lifetimeMs = token.expires_in * 1000;
    const marginMs = Math.min(TOKEN_REFRESH_MARGIN_MS, lifetimeMs / 2);
    return { value: token.access_token, refreshAtMs: requestedAtMs + lifetimeMs - marginMs };
  }

  async #request<S extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    schema: S,
    options: { mutating?: boolean; body?: unknown } = {},
  ): Promise<z.output<S>> {
    // One id per logical request: a retry reuses it, so PayPal never applies the change twice.
    const requestId = options.mutating === true ? this.#requestId() : undefined;
    const send = async (): Promise<Response> => {
      const token = await this.getAccessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      let line = `${method} ${path}`;
      if (requestId !== undefined) {
        headers['PayPal-Request-Id'] = requestId;
        headers.Prefer = 'return=representation';
        line += ` (PayPal-Request-Id ${requestId})`;
      }
      this.#log(line);
      const response = await this.#fetch(`${this.#config.apiBase}${path}`, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      this.#logResponse(method, path, response);
      return response;
    };

    const usedCachedToken = this.#hasCachedToken();
    let response = await send();
    if (response.status === 401 && usedCachedToken) {
      // PayPal rejected a token we still considered valid (revoked or expired early): drop it,
      // get a new one and retry once.
      this.#log(`401 ${method} ${path}: cached token rejected, retrying once with a new token`);
      this.#token = undefined;
      response = await send();
    }
    if (!response.ok) {
      throw await toPayPalApiError(response);
    }
    return parseBody(response, schema, `${method} ${path}`);
  }

  #hasCachedToken(): boolean {
    return this.#token !== undefined && this.#now() < this.#token.refreshAtMs;
  }

  #logResponse(method: string, path: string, response: Response): void {
    const debugId = response.headers.get('paypal-debug-id');
    this.#log(
      `${response.status} ${method} ${path}${debugId === null ? '' : ` [debug_id ${debugId}]`}`,
    );
  }
}

async function parseBody<S extends z.ZodType>(
  response: Response,
  schema: S,
  location: string,
): Promise<z.output<S>> {
  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    throw new PayPalResponseError(`${location}: response is not JSON`, { cause: error });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new PayPalResponseError(`${location}: unexpected response shape`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
