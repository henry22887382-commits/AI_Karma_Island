import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderBudgetBlockedError,
  initialRouterHealth,
  recordFallbackValidAction,
  recordPrimaryProbe,
  recordPrimaryTransportFailure,
  reserveMaximumCallCost,
  executeDecision,
  validateModelReply,
  type CandidateAction,
  type CostLedger,
} from './router.ts';

const actions = [
  { id: 'look-1', type: 'observe', name: '觀察周圍', timeCostT: 1, requiresText: false },
  { id: 'say-2', type: 'message', name: '公開發話', timeCostT: 1, requiresText: true },
] satisfies readonly CandidateAction[];

test('accepts one JSON reply only when its ID is in the current action snapshot', () => {
  assert.deepEqual(validateModelReply('{"action_id":"look-1","intent":"看看四周"}', actions), {
    ok: true,
    value: { actionId: 'look-1', intent: '看看四周' },
  });
});

test('marks text-bearing legal actions for message cost accounting on the proposal call', async () => {
  let messageActionIds: readonly string[] | undefined;
  const primary = {
    id: 'primary', ready: true,
    complete: async (_input: string, _maxOutputTokens: number, context?: { messageActionIds?: readonly string[] }) => {
      messageActionIds = context?.messageActionIds;
      return { raw: JSON.stringify({ action_id: 'say-2', intent: '回覆', text: '測試訊息' }) };
    },
  };
  const result = await executeDecision({ actorId: 'resident', prompt: 'prompt', actions, primary, health: initialRouterHealth });
  assert.equal(result.kind, 'proposal');
  assert.deepEqual(messageActionIds, ['say-2']);
});

test('rejects trailing prose and unknown action IDs without asking a provider to retry', () => {
  assert.equal(validateModelReply('{"action_id":"look-1","intent":"觀察"}\n完成', actions).ok, false);
  assert.equal(validateModelReply('{"action_id":"invented","intent":"觀察"}', actions).ok, false);
});

test('enforces intent and action text limits by Unicode code points and required text', () => {
  assert.equal(validateModelReply(JSON.stringify({ action_id: 'look-1', intent: '😀'.repeat(31) }), actions).ok, false);
  assert.equal(validateModelReply('{"action_id":"say-2","intent":"回應"}', actions).ok, false);
  assert.equal(validateModelReply(JSON.stringify({ action_id: 'say-2', intent: '回應', text: '😀'.repeat(50) }), actions).ok, true);
  assert.equal(validateModelReply(JSON.stringify({ action_id: 'say-2', intent: '回應', text: '😀'.repeat(51) }), actions).ok, false);
});

test('switches after three transport failures and probes primary after ten valid fallback actions', () => {
  let health = recordPrimaryTransportFailure(initialRouterHealth);
  health = recordPrimaryTransportFailure(health);
  assert.equal(health.activeProvider, 'primary');
  health = recordPrimaryTransportFailure(health);
  assert.equal(health.activeProvider, 'fallback');
  for (let index = 0; index < 10; index += 1) health = recordFallbackValidAction(health);
  assert.equal(health.probePrimaryNext, true);
  assert.equal(recordPrimaryProbe(health, false).fallbackValidActions, 0);
  assert.equal(recordPrimaryProbe(health, true).activeProvider, 'primary');
});

test('blocks calls when current pricing is absent and respects the hard monthly cap reservation', async () => {
  const ledger: CostLedger = {
    reserveCost: async ({ maximumUsd }) => ({
      allowed: 19.99 + maximumUsd <= 20,
      reservationId: 19.99 + maximumUsd <= 20 ? 'reserved' : null,
      remainingUsd: Math.max(0, 20 - 19.99 - maximumUsd),
    }),
    settleCost: async () => ({ exceededCap: false, remainingUsd: 0 }),
  };
  assert.deepEqual(await reserveMaximumCallCost(undefined, 10_000, ledger, new Date('2026-10-20T00:00:00Z'), 'call-0'), {
    allowed: false,
    reason: 'pricing_unconfigured',
  });
  const pricing = {
    inputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 1,
    maxInputTokens: 10_000,
    maxOutputTokens: 10_000,
    verifiedAt: '2026-10-20',
    sourceUrl: 'https://provider.example/pricing',
  };
  assert.deepEqual(await reserveMaximumCallCost(pricing, 10_000, ledger, new Date('2026-10-20T00:00:00Z'), 'call-1'), {
    allowed: false,
    reason: 'monthly_cap',
  });
});

test('retries transport errors at most twice, then uses the supplied fallback adapter', async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primaryRetryFlags: boolean[] = [];
  let fallbackRetryFlag: boolean | undefined;
  const primary = {
    id: 'primary',
    ready: true,
    complete: async (_input: string, _maxOutputTokens: number, context?: { retry: boolean }) => { primaryCalls += 1; primaryRetryFlags.push(context?.retry ?? false); throw new Error('offline'); },
  };
  const fallback = {
    id: 'fallback',
    ready: true,
    complete: async (_input: string, _maxOutputTokens: number, context?: { retry: boolean }) => { fallbackCalls += 1; fallbackRetryFlag = context?.retry; return { raw: '{"action_id":"look-1","intent":"觀察"}' }; },
  };
  const result = await executeDecision({ actorId: '1.1', prompt: 'prompt', actions, primary, fallback, health: initialRouterHealth });
  assert.equal(primaryCalls, 3);
  assert.equal(fallbackCalls, 1);
  assert.deepEqual(primaryRetryFlags, [false, true, true]);
  assert.equal(fallbackRetryFlag, false);
  assert.equal(result.kind, 'proposal');
  if (result.kind === 'proposal') {
    assert.equal(result.providerId, 'fallback');
    assert.equal(result.proposal.timeCostT, 1);
  }
});

test('does not retry or switch providers after a model returns invalid JSON', async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primary = {
    id: 'primary',
    ready: true,
    complete: async () => { primaryCalls += 1; return { raw: '```json\n{}\n```' }; },
  };
  const fallback = {
    id: 'fallback',
    ready: true,
    complete: async () => { fallbackCalls += 1; return { raw: '{}' }; },
  };
  const result = await executeDecision({ actorId: '1.1', prompt: 'prompt', actions, primary, fallback, health: initialRouterHealth });
  assert.equal(result.kind, 'format-error');
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 0);
});

test('stops before retry or fallback when the atomic cost gate rejects a provider call', async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const primary = { id: 'primary', ready: true, complete: async () => { primaryCalls += 1; throw new ProviderBudgetBlockedError(); } };
  const fallback = { id: 'fallback', ready: true, complete: async () => { fallbackCalls += 1; return { raw: '{}' }; } };
  const result = await executeDecision({ actorId: '1.1', prompt: 'test', actions, primary, fallback, health: initialRouterHealth });
  assert.equal(result.kind, 'budget-blocked');
  assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, 0);
});

test('returns validated subjective intent with the server-created legal action proposal', async () => {
  const primary = { id: 'primary', ready: true, complete: async () => ({ raw: JSON.stringify({ action_id: 'look-1', intent: '想確認周遭' }) }) };
  const result = await executeDecision({ actorId: '1.1', prompt: 'test', actions, primary, health: initialRouterHealth });
  assert.equal(result.kind, 'proposal');
  if (result.kind === 'proposal') {
    assert.equal(result.proposal.actionId, 'look-1');
    assert.equal(result.proposal.intent, '想確認周遭');
  }
});
