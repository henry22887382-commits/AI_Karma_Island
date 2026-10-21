import test from 'node:test';
import assert from 'node:assert/strict';
import { BudgetedModelProvider } from './budgeted-provider.ts';
import { ProviderBudgetBlockedError, type CostLedger, type ModelProvider } from './router.ts';

function fakeLedger(allowed = true) {
  const settlements: Array<{ actualUsd: number; record: unknown }> = [];
  let reservations = 0;
  const ledger: CostLedger = {
    reserveCost: async () => { reservations += 1; return { allowed, reservationId: allowed ? 'res-1' : null, remainingUsd: allowed ? 19 : 0 }; },
    settleCost: async ({ actualUsd, record }) => { settlements.push({ actualUsd, record }); return { exceededCap: false, remainingUsd: 19.9 }; },
  };
  return { ledger, settlements, get reservations() { return reservations; } };
}

const pricing = { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2, maxInputTokens: 1000, maxOutputTokens: 100 };

test('reserves worst-case monthly cost before HTTP and settles actual provider usage', async () => {
  const ledger = fakeLedger();
  const inner: ModelProvider = { id: 'provider/model', ready: true, complete: async () => ({ raw: '{}', usage: { inputTokens: 20, outputTokens: 10 } }) };
  const provider = new BudgetedModelProvider({ inner, pricing, ledger: ledger.ledger, clock: () => new Date('2026-10-20T00:00:00Z') });
  await provider.complete('prompt', 100);
  assert.equal(ledger.reservations, 1);
  assert.equal(ledger.settlements.length, 1);
  assert.equal(ledger.settlements[0]?.actualUsd, 0.00004);
  assert.deepEqual(ledger.settlements[0]?.record, {
    providerId: 'provider/model', category: 'prompt', inputTokens: 20, outputTokens: 10,
    costUsd: 0.00004, recordedAt: '2026-10-20T00:00:00.000Z',
  });
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
  assert.equal(ledger.settlements[0]?.actualUsd, 0.0012);
});
