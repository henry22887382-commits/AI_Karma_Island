export type CandidateAction = {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly timeCostT: 1 | 3;
  readonly requiresText: boolean;
  readonly payload?: Readonly<Record<string, unknown>>;
};

export type ValidatedReply = {
  readonly actionId: string;
  readonly intent: string;
  readonly text?: string;
};

export type ReplyValidation =
  | { readonly ok: true; readonly value: ValidatedReply }
  | { readonly ok: false; readonly reason: 'invalid_json' | 'invalid_shape' | 'unknown_action' | 'invalid_intent' | 'invalid_text' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

export function validateModelReply(raw: string, actions: readonly CandidateAction[]): ReplyValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!isRecord(parsed)) return { ok: false, reason: 'invalid_shape' };
  if (Object.keys(parsed).some((key) => !['action_id', 'intent', 'text'].includes(key))) {
    return { ok: false, reason: 'invalid_shape' };
  }
  if (typeof parsed.action_id !== 'string' || typeof parsed.intent !== 'string') {
    return { ok: false, reason: 'invalid_shape' };
  }

  const action = actions.find((candidate) => candidate.id === parsed.action_id);
  if (!action) return { ok: false, reason: 'unknown_action' };
  if (characterCount(parsed.intent) > 30) return { ok: false, reason: 'invalid_intent' };

  if (action.requiresText) {
    if (typeof parsed.text !== 'string' || characterCount(parsed.text) > 50) {
      return { ok: false, reason: 'invalid_text' };
    }
    return { ok: true, value: { actionId: action.id, intent: parsed.intent, text: parsed.text } };
  }

  if (parsed.text !== undefined && (typeof parsed.text !== 'string' || characterCount(parsed.text) > 50)) {
    return { ok: false, reason: 'invalid_text' };
  }
  return {
    ok: true,
    value: parsed.text === undefined
      ? { actionId: action.id, intent: parsed.intent }
      : { actionId: action.id, intent: parsed.intent, text: parsed.text },
  };
}

export type ModelInput = {
  readonly narration: string;
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly actions: readonly CandidateAction[];
};

export function buildModelInput(input: ModelInput): string {
  const actionList = input.actions.map(({ id, type, name, timeCostT }) => ({
    id,
    type,
    name,
    time_cost: timeCostT,
  }));
  return [
    input.narration,
    JSON.stringify({ ...input.snapshot, available_actions: actionList }),
    '請只回傳一個 JSON 物件，包含 action_id 與 30 字內 intent；只有動作需要自由文字時才提供 50 字內 text。',
  ].join('\n\n');
}

export type ProviderUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type ProviderCompletion = {
  readonly raw: string;
  readonly usage?: ProviderUsage;
};

export interface ModelProvider {
  readonly id: string;
  readonly ready: boolean;
  complete(input: string, maxOutputTokens: number): Promise<ProviderCompletion>;
}

export type ProviderPricing = {
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly priceVersion?: string;
};

export type CostCategory = 'prompt' | 'output' | 'retry' | 'message' | 'biography';

export type CostRecord = {
  readonly providerId: string;
  readonly category: CostCategory;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly recordedAt: string;
};

export type CostLedger = {
  reserveCost(input: {
    readonly requestId: string;
    readonly atIso: string;
    readonly maximumUsd: number;
  }): Promise<{ readonly allowed: boolean; readonly reservationId: string | null; readonly remainingUsd: number }>;
  settleCost(input: {
    readonly reservationId: string;
    readonly actualUsd: number;
    readonly record: CostRecord;
  }): Promise<{ readonly exceededCap: boolean; readonly remainingUsd: number }>;
};

export type CostGate =
  | { readonly allowed: true; readonly reservationId: string; readonly reservationUsd: number }
  | { readonly allowed: false; readonly reason: 'pricing_unconfigured' | 'monthly_cap' };

export async function reserveMaximumCallCost(
  pricing: ProviderPricing | undefined,
  ledger: CostLedger,
  now: Date,
  requestId: string,
): Promise<CostGate> {
  if (!pricing || !Number.isFinite(pricing.inputUsdPerMillionTokens) || pricing.inputUsdPerMillionTokens < 0
    || !Number.isFinite(pricing.outputUsdPerMillionTokens) || pricing.outputUsdPerMillionTokens < 0
    || !Number.isSafeInteger(pricing.maxInputTokens) || pricing.maxInputTokens < 1
    || !Number.isSafeInteger(pricing.maxOutputTokens) || pricing.maxOutputTokens < 1) {
    return { allowed: false, reason: 'pricing_unconfigured' };
  }

  const reservationUsd = (
    pricing.maxInputTokens * pricing.inputUsdPerMillionTokens
    + pricing.maxOutputTokens * pricing.outputUsdPerMillionTokens
  ) / 1_000_000;
  const reservation = await ledger.reserveCost({
    requestId,
    atIso: now.toISOString(),
    maximumUsd: reservationUsd,
  });
  if (!reservation.allowed || reservation.reservationId === null) {
    return { allowed: false, reason: 'monthly_cap' };
  }
  return { allowed: true, reservationUsd, reservationId: reservation.reservationId };
}

export function actualCostUsd(usage: ProviderUsage, pricing: ProviderPricing): number {
  return (
    usage.inputTokens * pricing.inputUsdPerMillionTokens
    + usage.outputTokens * pricing.outputUsdPerMillionTokens
  ) / 1_000_000;
}

export async function settleProviderCost(
  ledger: CostLedger,
  reservationId: string,
  usage: ProviderUsage | undefined,
  pricing: ProviderPricing,
  operation: 'action' | 'message' | 'biography',
  wasRetry: boolean,
  now: Date,
  maximumReservedUsd: number,
): Promise<{ readonly exceededCap: boolean; readonly remainingUsd: number }> {
  const actualUsd = usage === undefined ? maximumReservedUsd : actualCostUsd(usage, pricing);
  return ledger.settleCost({
    reservationId,
    actualUsd,
    record: {
      providerId: 'configured-provider',
      category: wasRetry ? 'retry' : operation === 'action' ? 'prompt' : operation,
      inputTokens: usage?.inputTokens ?? pricing.maxInputTokens,
      outputTokens: usage?.outputTokens ?? pricing.maxOutputTokens,
      costUsd: actualUsd,
      recordedAt: now.toISOString(),
    },
  });
}

export type RouterHealth = {
  readonly primaryFailures: number;
  readonly activeProvider: 'primary' | 'fallback';
  readonly fallbackValidActions: number;
  readonly probePrimaryNext: boolean;
};

export const initialRouterHealth: RouterHealth = {
  primaryFailures: 0,
  activeProvider: 'primary',
  fallbackValidActions: 0,
  probePrimaryNext: false,
};

export function recordPrimaryTransportFailure(health: RouterHealth): RouterHealth {
  const primaryFailures = health.primaryFailures + 1;
  return {
    ...health,
    primaryFailures,
    activeProvider: primaryFailures >= 3 ? 'fallback' : health.activeProvider,
    fallbackValidActions: primaryFailures >= 3 ? 0 : health.fallbackValidActions,
    probePrimaryNext: false,
  };
}

export function recordFallbackValidAction(health: RouterHealth): RouterHealth {
  if (health.activeProvider !== 'fallback') return health;
  const fallbackValidActions = health.fallbackValidActions + 1;
  return {
    ...health,
    fallbackValidActions,
    probePrimaryNext: fallbackValidActions >= 10,
  };
}

export function recordPrimaryProbe(health: RouterHealth, succeeded: boolean): RouterHealth {
  if (!health.probePrimaryNext) return health;
  return succeeded
    ? { primaryFailures: 0, activeProvider: 'primary', fallbackValidActions: 0, probePrimaryNext: false }
    : { ...health, primaryFailures: 3, fallbackValidActions: 0, probePrimaryNext: false };
}

export type DecisionOutcome =
  | { readonly kind: 'proposal'; readonly proposal: RouterActionProposal; readonly providerId: string; readonly health: RouterHealth }
  | { readonly kind: 'format-error'; readonly hesitationTimeT: 1; readonly reason: Extract<ReplyValidation, { ok: false }>['reason']; readonly health: RouterHealth }
  | { readonly kind: 'budget-blocked'; readonly reason: string; readonly health: RouterHealth }
  | { readonly kind: 'provider-unavailable'; readonly health: RouterHealth };

export type RouterActionProposal = {
  readonly actorId: string;
  readonly actionId: string;
  readonly timeCostT: 1 | 3;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly intent: string;
  readonly text?: string;
};

export class ProviderBudgetBlockedError extends Error {
  constructor(message = '模型呼叫因月預算上限或價格設定而停止。') {
    super(message);
    this.name = 'ProviderBudgetBlockedError';
  }
}

export type DecisionInput = {
  readonly actorId: string;
  readonly prompt: string;
  readonly actions: readonly CandidateAction[];
  readonly primary: ModelProvider;
  readonly fallback?: ModelProvider;
  readonly health: RouterHealth;
};

type ProviderRun =
  | { readonly kind: 'valid'; readonly reply: ValidatedReply; readonly action: CandidateAction }
  | { readonly kind: 'format-error'; readonly reason: Extract<ReplyValidation, { ok: false }>['reason'] }
  | { readonly kind: 'budget-blocked'; readonly reason: string }
  | { readonly kind: 'transport-failure' };

async function runProvider(provider: ModelProvider, prompt: string, actions: readonly CandidateAction[]): Promise<ProviderRun> {
  if (!provider.ready) return { kind: 'transport-failure' };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let completion: ProviderCompletion;
    try {
      completion = await provider.complete(prompt, 512);
    } catch (error) {
      if (error instanceof ProviderBudgetBlockedError) return { kind: 'budget-blocked', reason: error.message };
      continue;
    }
    const validation = validateModelReply(completion.raw, actions);
    if (!validation.ok) return { kind: 'format-error', reason: validation.reason };
    const action = actions.find((candidate) => candidate.id === validation.value.actionId);
    if (!action) return { kind: 'format-error', reason: 'unknown_action' };
    return { kind: 'valid', reply: validation.value, action };
  }
  return { kind: 'transport-failure' };
}

function toProposal(actorId: string, run: Extract<ProviderRun, { kind: 'valid' }>): RouterActionProposal {
  return {
    actorId,
    actionId: run.reply.actionId,
    timeCostT: run.action.timeCostT,
    payload: run.action.payload ?? {},
    intent: run.reply.intent,
    ...(run.reply.text === undefined ? {} : { text: run.reply.text }),
  };
}

export async function executeDecision(input: DecisionInput): Promise<DecisionOutcome> {
  let health = input.health;
  if (!input.primary.ready || (health.activeProvider === 'fallback' && !input.fallback?.ready)) {
    return { kind: 'provider-unavailable', health };
  }

  if (health.activeProvider === 'fallback' && health.probePrimaryNext) {
    const probe = await runProvider(input.primary, input.prompt, input.actions);
    if (probe.kind === 'valid') {
      health = recordPrimaryProbe(health, true);
      return { kind: 'proposal', proposal: toProposal(input.actorId, probe), providerId: input.primary.id, health };
    }
    if (probe.kind === 'budget-blocked') return { kind: 'budget-blocked', reason: probe.reason, health };
    if (probe.kind === 'format-error') {
      return { kind: 'format-error', hesitationTimeT: 1, reason: probe.reason, health: recordPrimaryProbe(health, false) };
    }
    health = recordPrimaryProbe(health, false);
  }

  const active = health.activeProvider === 'primary' ? input.primary : input.fallback;
  if (!active?.ready) return { kind: 'provider-unavailable', health };
  const run = await runProvider(active, input.prompt, input.actions);
  if (run.kind === 'budget-blocked') return { kind: 'budget-blocked', reason: run.reason, health };
  if (run.kind === 'format-error') return { kind: 'format-error', hesitationTimeT: 1, reason: run.reason, health };
  if (run.kind === 'transport-failure') {
    if (active === input.primary) {
      for (let attempt = 0; attempt < 3; attempt += 1) health = recordPrimaryTransportFailure(health);
      if (!input.fallback?.ready) return { kind: 'provider-unavailable', health };
      const fallbackRun = await runProvider(input.fallback, input.prompt, input.actions);
      if (fallbackRun.kind === 'budget-blocked') return { kind: 'budget-blocked', reason: fallbackRun.reason, health };
      if (fallbackRun.kind === 'format-error') return { kind: 'format-error', hesitationTimeT: 1, reason: fallbackRun.reason, health };
      if (fallbackRun.kind === 'transport-failure') return { kind: 'provider-unavailable', health };
      health = recordFallbackValidAction(health);
      return { kind: 'proposal', proposal: toProposal(input.actorId, fallbackRun), providerId: input.fallback.id, health };
    }
    return { kind: 'provider-unavailable', health };
  }

  if (active === input.fallback) health = recordFallbackValidAction(health);
  else health = { ...health, primaryFailures: 0 };
  return { kind: 'proposal', proposal: toProposal(input.actorId, run), providerId: active.id, health };
}
