import { describe, expect, it } from 'vitest';
import type { PayPalOrder } from '../src/paypal/schemas.js';
import {
  ApprovalTimeoutError,
  OrderNotApprovableError,
  waitForApproval,
} from '../src/sandbox/wait-for-approval.js';
import { FakeClock } from './support/fake-clock.js';

function order(status: string): PayPalOrder {
  return { id: 'ORDER-1', status, links: [], purchase_units: [] };
}

function ordersInSequence(statuses: string[]) {
  let reads = 0;
  const getOrder = () => {
    const status = statuses[Math.min(reads, statuses.length - 1)] ?? 'CREATED';
    reads += 1;
    return Promise.resolve(order(status));
  };
  return { getOrder, reads: () => reads };
}

describe('waitForApproval', () => {
  it('polls every 3 seconds until the order is approved', async () => {
    const clock = new FakeClock();
    const orders = ordersInSequence(['PAYER_ACTION_REQUIRED', 'PAYER_ACTION_REQUIRED', 'APPROVED']);

    const approved = await waitForApproval(orders.getOrder, { clock });

    expect(approved.status).toBe('APPROVED');
    expect(orders.reads()).toBe(3);
    expect(clock.sleeps).toEqual([3_000, 3_000]);
  });

  it('returns at once when the order is already approved', async () => {
    const clock = new FakeClock();

    await waitForApproval(ordersInSequence(['APPROVED']).getOrder, { clock });

    expect(clock.sleeps).toEqual([]);
  });

  it('gives up after 5 minutes with a clear message', async () => {
    const clock = new FakeClock();
    const orders = ordersInSequence(['PAYER_ACTION_REQUIRED']);

    const error: unknown = await waitForApproval(orders.getOrder, { clock }).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(ApprovalTimeoutError);
    expect(String(error)).toContain('not approved within 300 seconds');
    expect(String(error)).toContain('PAYER_ACTION_REQUIRED');
    expect(clock.nowMs).toBe(300_000);
    expect(orders.reads()).toBe(101);
  });

  it('honours custom interval and timeout', async () => {
    const clock = new FakeClock();
    const orders = ordersInSequence(['CREATED']);

    await expect(
      waitForApproval(orders.getOrder, { clock, intervalMs: 1_000, timeoutMs: 2_500 }),
    ).rejects.toThrow(ApprovalTimeoutError);
    expect(clock.sleeps).toEqual([1_000, 1_000]);
  });

  it.each(['VOIDED', 'COMPLETED'])('stops when the order is %s', async (status) => {
    const clock = new FakeClock();

    await expect(
      waitForApproval(ordersInSequence(['PAYER_ACTION_REQUIRED', status]).getOrder, { clock }),
    ).rejects.toThrow(OrderNotApprovableError);
    expect(clock.sleeps).toEqual([3_000]);
  });
});
