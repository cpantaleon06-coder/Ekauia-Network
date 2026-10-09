// Test helpers: a scripted fetch that never touches the network, and fake credentials.
import { vi } from 'vitest';
import type { PayPalConfig } from '../../src/paypal/config.js';

export const CLIENT_ID = 'fake-client-id-AbC123';
export const CLIENT_SECRET = 'fake-client-secret-XyZ789';
export const BASIC_CREDENTIALS = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
export const API_BASE = 'https://api-m.sandbox.paypal.test';

export const config: PayPalConfig = {
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  apiBase: API_BASE,
};

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function tokenBody(accessToken: string, expiresIn = 32_400) {
  return { access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn };
}

export function orderBody(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status,
    links: [
      { href: `${API_BASE}/v2/checkout/orders/${id}`, rel: 'self', method: 'GET' },
      { href: `https://www.sandbox.paypal.test/checkoutnow?token=${id}`, rel: 'payer-action' },
    ],
    ...extra,
  };
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/**
 * A fetch mock that answers token requests with successive tokens (`token-1`, `token-2`, ...)
 * and every other request through `respond`. It records every request.
 */
export function scriptedFetch(
  respond: (request: RecordedRequest) => Response = () => jsonResponse(404, {}),
) {
  const requests: RecordedRequest[] = [];
  let tokens = 0;
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
    const request: RecordedRequest = {
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    requests.push(request);
    if (request.url.endsWith('/v1/oauth2/token')) {
      tokens += 1;
      return Promise.resolve(jsonResponse(200, tokenBody(`token-${tokens}`)));
    }
    return Promise.resolve(respond(request));
  });
  return {
    fetch,
    requests,
    tokenRequests: () => requests.filter((request) => request.url.endsWith('/v1/oauth2/token')),
    apiRequests: () => requests.filter((request) => !request.url.endsWith('/v1/oauth2/token')),
  };
}
