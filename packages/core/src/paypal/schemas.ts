import { z } from 'zod';

export const AccessTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  /** Lifetime in seconds. */
  expires_in: z.number().positive(),
});

const MoneySchema = z.object({
  currency_code: z.string(),
  value: z.string(),
});
export type PayPalMoney = z.infer<typeof MoneySchema>;

const LinkSchema = z.object({
  href: z.string(),
  rel: z.string(),
  method: z.string().optional(),
});

export const SellerReceivableBreakdownSchema = z.object({
  gross_amount: MoneySchema,
  paypal_fee: MoneySchema.optional(),
  net_amount: MoneySchema.optional(),
});
export type SellerReceivableBreakdown = z.infer<typeof SellerReceivableBreakdownSchema>;

const CaptureSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: MoneySchema.optional(),
  seller_receivable_breakdown: SellerReceivableBreakdownSchema.optional(),
});
export type PayPalCapture = z.infer<typeof CaptureSchema>;

/** The parts of an Orders v2 order this code reads. Unknown fields are ignored. */
export const PayPalOrderSchema = z.object({
  id: z.string(),
  /** CREATED, SAVED, APPROVED, VOIDED, COMPLETED or PAYER_ACTION_REQUIRED. */
  status: z.string(),
  links: z.array(LinkSchema).default([]),
  purchase_units: z
    .array(
      z.object({
        payments: z
          .object({
            captures: z.array(CaptureSchema).default([]),
          })
          .optional(),
      }),
    )
    .default([]),
});
export type PayPalOrder = z.infer<typeof PayPalOrderSchema>;

/** The link the payer opens to approve the order. */
export function approvalLink(order: PayPalOrder): string | undefined {
  return order.links.find((link) => link.rel === 'payer-action' || link.rel === 'approve')?.href;
}

export function firstCapture(order: PayPalOrder): PayPalCapture | undefined {
  return order.purchase_units[0]?.payments?.captures[0];
}
