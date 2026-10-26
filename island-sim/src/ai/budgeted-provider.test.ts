import test from 'node:test';
import assert from 'node:assert/strict';
import { BudgetedModelProvider } from './budgeted-provider.ts';
import { ProviderBudgetBlockedError, type CostLedger, type ModelProvider } from './router.ts';

function fakeLedger(allowed = true) {
  const settlements: Array<{ actualUsd: number; record: unknown }> = [];
  const unpriced: unknown[] = [];
  const maximumReservations: number[] = [];
  let reservations = 0;
  const ledger: CostLedger = {
    reserveCost: async ({ maximumUsd }) => { reservations += 1; maximumReservations.push(maximumUsd); return { allowed, reservationId: allowed ? 'res-1' : null, remainingUsd: allowed ? 19 : 0 }; },
    settleCost: async ({ actualUsd, record }) => { settlements.push({ actualUsd, record }); return { exceededCap: false, remainingUsd: 19.9 }; },
    recordUnpricedCost: async (record) => { unpriced.push(record); },
  };
  return { ledger, settlements, unpriced, maximumReservations, get reservations() { return reservations; } };
}

const pricing = { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2, maxInputTokens: 1000, maxOutputTokens: 100 };

test('reserves worst-case monthly cost before HTTP and settles actual provider usage', async () => {
  const ledger = fakeLedger();
  const inner: ModelProvider = { id: 'provider/model', ready: true, complete: async () => ({ raw: '{}', usage: { inputTokens: 20, outputTokens: 10 }, actualCostUsd: 0.00004 }) };
  const provider = new BudgetedModelProvider({ inner, pricing, ledger: ledger.ledger, clock: () => new Date('2026-10-20T00:00:00Z') });
  await provider.complete('prompt', 100);
  assert.equal(ledger.reservations, 1);
  assert.deepEqual(ledger.maximumReservations, [0.0012]);
  assert.equal(ledger.settlements.length, 1);
  assert.equal(ledger.settlements[0]?.actualUsd, 0.00004);
  assert.deepEqual(ledger.settlements[0]?.record,
    { providerId: 'provider/model', category: 'prompt', inputTokens: 20, outputTokens: 10, costUsd: 0.00004, recordedAt: '2026-10-20T00:00:00.000Z' });
});

test('records provider-reported actual cost without deriving split fees from token counts', async () => {
  const ledger = fakeLedger();
  const inner: ModelProvider = { id: 'provider/model', ready: true, complete: async () => ({ raw: '{}', usage: { inputTokens: 20, outputTokens: 10 }, actualCostUsd: 0.00004 }) };
  const provider = new BudgetedModelProvider({ inner, pricing, ledger: ledger.ledger, clock: () => new Date('2026-10-20T00:00:00Z') });
  await provider.complete('prompt', 100);
  assert.deepEqual(ledger.settlements[0]?.record,
    { providerId: 'provider/model', category: 'prompt', inputTokens: 20, outputTokens: 10, costUsd: 0.00004, recordedAt: '2026-10-20T00:00:00.000Z' });
});

test('categorizes retried and message or biography provider calls', async () => {
  const inner: ModelProvider = { id: 'provider/model', ready: true, complete: async () => ({ raw: '{}', usage: { inputTokens: 20, outputTokens: 10 }, actualCostUsd: 0.00004 }) };
  const retryLedger = fakeLedger();
  const retryProvider = new BudgetedModelProvider({ inner, pricing, ledger: retryLedger.ledger, clock: () => new Date('2026-10-20T00:00:00Z') });
  await retryProvider.complete('prompt', 100, { operation: 'action', retry: true });
  assert.deepEqual(retryLedger.settlements[0]?.record,
    { providerId: 'provider/model', category: 'retry', inputTokens: 20, outputTokens: 10, costUsd: 0.00004, recordedAt: '2026-10-20T00:00:00.000Z' });

  for (const operation of ['message', 'biography'] as const) {
    const ledger = fakeLedger();
    const provider = new BudgetedModelProvider({ inner, pricing, ledger: ledger.ledger, clock: () => new Date('2026-10-20T00:00:00Z') });
    await provider.complete('prompt', 100, { operation, retry: false });
    assert.equal((ledger.settlements[0]?.record as { category: string }).category, operation);
  }
});

test('records a valid message action proposal as message cost in the same action call', async () => {
  const ledger = fakeLedger();
  const inner: ModelProvider = {
    id: 'provider/model', ready: true,
    complete: async () => ({ raw: JSON.stringify({ action_id: 'say-2', intent: '回覆', text: 'TEST_TEXT' }), usage: { inputTokens: 20, outputTokens: 10 }, actualCostUsd: 0.00004 }),
  };
  const provider = new BudgetedModelProvider({ inner, pricing, ledger: ledger.ledger, clock: () => new Date('2026-10-20T00:00:00Z') });
  await provider.complete('prompt', 100, { operation: 'action', retry: false, messageActionIds: ['say-2'] });
  assert.deepEqual(ledger.settlements[0]?.record,
    { providerId: 'provider/model', category: 'message', inputTokens: 20, outputTokens: 10, costUsd: 0.00004, recordedAt: '2026-10-20T00:00:00.000Z' });
});

test('monthly cap rejection makes no provider request and does not retry', async () => {
  const ledger = fakeLedger(false);
  let calls = 0;
  const provider = new BudgetedModelProvider({
    inner: { id: 'provider/model', ready: true, complete: async () => { calls += 1; return { raw: '{}' }; } },
    pricing, ledger: ledger.ledger,
  });
  await assert.rejects(provider.complete('prompt', 100), ProviderBudgetBlockedError);
  assert.equal(calls, 0);
  assert.equal(ledger.reservations, 1);
  assert.equal(ledger.settlements.length, 0);
});

test('missing usage settles the full reservation conservatively after transport failure', async () => {
  const ledger = fakeLedger();
  const provider = new BudgetedModelProvider({
    inner: { id: 'provider/model', ready: true, complete: async () => { throw new Error('transport'); } },
    pricing, ledger: ledger.ledger,
  });
  await assert.rejects(provider.complete('prompt', 100), /傳輸失敗/);
  assert.equal(ledger.unpriced.length, 1);
  const record = ledger.unpriced[0] as { requestId: string; providerId: string; category: string; inputTokens: number | null; outputTokens: number | null; reservationId?: string };
  assert.match(record.requestId, /^[0-9a-f-]{36}$/i);
  assert.equal(record.providerId, 'provider/model');
  assert.equal(record.category, 'prompt');
  assert.equal(record.inputTokens, null);
  assert.equal(record.outputTokens, null);
  assert.equal(record.reservationId, undefined);
});

test('unknown-cost recording preserves the full reservation and blocks later calls at the monthly cap', async () => {
  let committedUsd = 19.9988;
  let reservations = 0;
  let providerCalls = 0;
  const unpriced: unknown[] = [];
  const ledger: CostLedger = {
    reserveCost: async ({ maximumUsd }) => {
      reservations += 1;
      if (committedUsd + maximumUsd > 20 + Number.EPSILON) {
        return { allowed: false, reservationId: null, remainingUsd: Math.max(0, 20 - committedUsd) };
      }
      committedUsd += maximumUsd;
      return { allowed: true, reservationId: `res-${reservations}`, remainingUsd: Math.max(0, 20 - committedUsd) };
    },
    settleCost: async ({ actualUsd }) => ({ exceededCap: false, remainingUsd: Math.max(0, 20 - committedUsd + actualUsd) }),
    recordUnpricedCost: async (record) => { unpriced.push(record); },
  };
  const provider = new BudgetedModelProvider({
    inner: { id: 'provider/model', ready: true, complete: async () => { providerCalls += 1; throw new Error('transport'); } },
    pricing, ledger,
  });

  await assert.rejects(provider.complete('prompt', 100), /傳輸失敗/);
  assert.equal(unpriced.length, 1);
  assert.equal(committedUsd, 20);
  await assert.rejects(provider.complete('prompt', 100), ProviderBudgetBlockedError);
  assert.equal(reservations, 2);
  assert.equal(providerCalls, 1);
});
