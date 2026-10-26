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
  readonly rememberedEvents?: readonly { readonly sequence: number; readonly importance: 'priority' | 'recent'; readonly text: string }[];
};

export const MAX_MODEL_INPUT_CHARACTERS = 8000;

function promptCharacterCount(value: string): number {
  return Array.from(value).length;
}

export type BudgetedModelInputResult =
  | { readonly ok: true; readonly prompt: string; readonly includedMemoryCount: number }
  | { readonly ok: false; readonly reason: 'current-input-overflow'; readonly requiredCharacters: number; readonly maximumCharacters: number };

function serializeModelInput(input: ModelInput, stylePrefix: string, rememberedEvents: ModelInput['rememberedEvents'] = []): string {
  const actionList = input.actions.map(({ id, type, name, timeCostT }) => ({
    id,
    type,
    name,
    time_cost: timeCostT,
  }));
  return [
    stylePrefix,
    input.narration,
    ...(rememberedEvents?.length ? [`你記得曾觀察到的公開事件：\n${rememberedEvents.map((event) => event.text).join('\n')}`] : []),
    JSON.stringify({ ...input.snapshot, available_actions: actionList }),
    '請只回傳一個 JSON 物件，包含 action_id 與 30 字內 intent；intent 描述角色當下心中所想；只有動作需要自由文字時才提供 50 字內 text。',
    '例如（以下示例 ID 僅供展示，必須替換為本回合 available_actions 中某個動作的真實 id；此動作需要自由文字才包含 text）：\n{"action_id":"替換為可用動作的真實 ID","intent":"我想看看 Node 8 有什麼","text":"沿著北側小徑前進"}',
  ].join('\n\n');
}

export function buildModelInput(input: ModelInput): string {
  return serializeModelInput(input, '', input.rememberedEvents);
}

export function buildBudgetedModelInput(input: ModelInput, stylePrefix = '', maximumCharacters = MAX_MODEL_INPUT_CHARACTERS): BudgetedModelInputResult {
  const basePrompt = serializeModelInput(input, stylePrefix, []);
  const baseCharacters = promptCharacterCount(basePrompt);
  if (baseCharacters > maximumCharacters) {
    return {
      ok: false,
      reason: 'current-input-overflow',
      requiredCharacters: baseCharacters,
      maximumCharacters,
    };
  }

  const memories = input.rememberedEvents ?? [];
  type RememberedEvent = NonNullable<ModelInput['rememberedEvents']>[number];
  const recentCandidates: RememberedEvent[] = memories.filter((event) => event.importance === 'recent').sort((left, right) => right.sequence - left.sequence);
  const priorityCandidates: RememberedEvent[] = memories.filter((event) => event.importance === 'priority').sort((left, right) => right.sequence - left.sequence);
  const memoryWrapperCharacters = promptCharacterCount('你記得曾觀察到的公開事件：\n') + 2;
  const memoryCharactersAvailable = Math.max(0, maximumCharacters - baseCharacters - memoryWrapperCharacters);
  const promptFor = (priority: readonly RememberedEvent[], recent: readonly RememberedEvent[]) => serializeModelInput(input, stylePrefix, [...priority, ...recent].sort((left, right) => left.sequence - right.sequence));
  const selectWithin = (candidates: readonly RememberedEvent[], budget: number) => {
    const selected: RememberedEvent[] = [];
    let used = 0;
    for (const candidate of candidates) {
      const cost = promptCharacterCount(candidate.text) + (selected.length > 0 ? 1 : 0);
      if (used + cost > budget) break;
      selected.push(candidate);
      used += cost;
    }
    return { selected, used };
  };
  const priorityBudget = Math.floor(memoryCharactersAvailable * 4 / 5);
  const recentBudget = memoryCharactersAvailable - priorityBudget;
  let priorityPick = selectWithin(priorityCandidates, priorityBudget);
  let recentPick = selectWithin(recentCandidates, recentBudget);
  if (priorityPick.used < priorityBudget) {
    recentPick = selectWithin(recentCandidates, memoryCharactersAvailable - priorityPick.used);
  } else if (recentPick.used < recentBudget) {
    priorityPick = selectWithin(priorityCandidates, memoryCharactersAvailable - recentPick.used);
  }
  const priority = priorityPick.selected;
  const recent = recentPick.selected;
  const promptForSelected = () => promptFor(priority, recent);
  let prompt = promptForSelected();
  while (promptCharacterCount(prompt) > maximumCharacters && recent.length > 0) {
    recent.pop();
    prompt = promptForSelected();
  }
  while (promptCharacterCount(prompt) > maximumCharacters && priority.length > 0) {
    priority.pop();
    prompt = promptForSelected();
  }
  if (promptCharacterCount(prompt) > maximumCharacters) {
    return {
      ok: false,
      reason: 'current-input-overflow',
      requiredCharacters: promptCharacterCount(prompt),
      maximumCharacters,
    };
  }
  return { ok: true, prompt, includedMemoryCount: priority.length + recent.length };
}

export type ProviderUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type ProviderCompletion = {
  readonly raw: string;
  readonly usage?: ProviderUsage;
  /** Exact USD cost returned by a provider for this response; never derived from token rates. */
  readonly actualCostUsd?: number;
};

export interface ModelProvider {
  readonly id: string;
  readonly ready: boolean;
  complete(input: string, maxOutputTokens: number, context?: ProviderCallContext): Promise<ProviderCompletion>;
}

export type ProviderCallContext = {
  readonly operation: 'action' | 'message' | 'biography';
  readonly retry: boolean;
  readonly messageActionIds?: readonly string[];
  readonly signal?: AbortSignal;
};

export type ProviderPricing = {
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
  readonly maxInputTokens: number;
  /** Legacy configuration value accepted but ignored; output allowance comes from each call. */
  readonly maxOutputTokens?: number;
  readonly priceVersion?: string;
};

export type CostCategory = 'prompt' | 'output' | 'retry' | 'message' | 'biography';

export type CostRecord = {
  readonly providerId: string;
  readonly category: CostCategory;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number;
  readonly recordedAt: string;
};

export type UnpricedProviderCall = {
  readonly requestId: string;
  readonly providerId: string;
  readonly category: CostCategory;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly recordedAt: string;
};

export type CostLedger = {
  reserveCost(input: {
    readonly requestId: string;
    readonly atIso: string;
    readonly maximumUsd: number;
  }): Promise<{ readonly allowed: boolean; readonly reservationId: string | null; readonly remainingUsd: number | null }>;
  settleCost(input: {
    readonly reservationId: string;
    readonly actualUsd: number;
    readonly record: CostRecord | readonly CostRecord[];
  }): Promise<{ readonly exceededCap: boolean; readonly remainingUsd: number | null }>;
  recordUnpricedCost?(input: UnpricedProviderCall & { readonly reservationId?: string }): Promise<void>;
  recordActualCost?(input: CostRecord & { readonly requestId: string }): Promise<{ readonly exceededCap: boolean }>;
};

export type CostGate =
  | { readonly allowed: true; readonly reservationId: string; readonly reservationUsd: number }
  | { readonly allowed: false; readonly reason: 'pricing_unconfigured' | 'monthly_cap' };

export async function reserveMaximumCallCost(
  pricing: ProviderPricing | undefined,
  maxOutputTokens: number,
  ledger: CostLedger,
  now: Date,
  requestId: string,
): Promise<CostGate> {
  if (!pricing || !Number.isFinite(pricing.inputUsdPerMillionTokens) || pricing.inputUsdPerMillionTokens < 0
    || !Number.isFinite(pricing.outputUsdPerMillionTokens) || pricing.outputUsdPerMillionTokens < 0
    || !Number.isSafeInteger(pricing.maxInputTokens) || pricing.maxInputTokens < 1
    || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 0) {
    return { allowed: false, reason: 'pricing_unconfigured' };
  }

  const reservationUsd = (
    pricing.maxInputTokens * pricing.inputUsdPerMillionTokens
    + maxOutputTokens * pricing.outputUsdPerMillionTokens
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
  | { readonly kind: 'format-error'; readonly hesitationTimeT: 1; readonly reason: Extract<ReplyValidation, { ok: false }>['reason']; readonly rawOutput: string; readonly health: RouterHealth }
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
  readonly operation?: ProviderCallContext['operation'];
  readonly signal?: AbortSignal;
};

type ProviderRun =
  | { readonly kind: 'valid'; readonly reply: ValidatedReply; readonly action: CandidateAction }
  | { readonly kind: 'format-error'; readonly reason: Extract<ReplyValidation, { ok: false }>['reason']; readonly rawOutput: string }
  | { readonly kind: 'budget-blocked'; readonly reason: string }
  | { readonly kind: 'transport-failure' };

async function runProvider(provider: ModelProvider, prompt: string, actions: readonly CandidateAction[], operation: ProviderCallContext['operation'], signal?: AbortSignal): Promise<ProviderRun> {
  if (!provider.ready) return { kind: 'transport-failure' };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal?.throwIfAborted();
    let completion: ProviderCompletion;
    try {
      completion = await provider.complete(prompt, 512, {
        operation,
        retry: attempt > 0,
        messageActionIds: actions.filter((action) => action.requiresText).map((action) => action.id),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ProviderBudgetBlockedError) return { kind: 'budget-blocked', reason: error.message };
      continue;
    }
    signal?.throwIfAborted();
    const validation = validateModelReply(completion.raw, actions);
    if (!validation.ok) return { kind: 'format-error', reason: validation.reason, rawOutput: completion.raw };
    const action = actions.find((candidate) => candidate.id === validation.value.actionId);
    if (!action) return { kind: 'format-error', reason: 'unknown_action', rawOutput: completion.raw };
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
    const probe = await runProvider(input.primary, input.prompt, input.actions, input.operation ?? 'action', input.signal);
    if (probe.kind === 'valid') {
      health = recordPrimaryProbe(health, true);
      return { kind: 'proposal', proposal: toProposal(input.actorId, probe), providerId: input.primary.id, health };
    }
    if (probe.kind === 'budget-blocked') return { kind: 'budget-blocked', reason: probe.reason, health };
    if (probe.kind === 'format-error') {
      return { kind: 'format-error', hesitationTimeT: 1, reason: probe.reason, rawOutput: probe.rawOutput, health: recordPrimaryProbe(health, false) };
    }
    health = recordPrimaryProbe(health, false);
  }

  const active = health.activeProvider === 'primary' ? input.primary : input.fallback;
  if (!active?.ready) return { kind: 'provider-unavailable', health };
  const run = await runProvider(active, input.prompt, input.actions, input.operation ?? 'action', input.signal);
  if (run.kind === 'budget-blocked') return { kind: 'budget-blocked', reason: run.reason, health };
  if (run.kind === 'format-error') return { kind: 'format-error', hesitationTimeT: 1, reason: run.reason, rawOutput: run.rawOutput, health };
  if (run.kind === 'transport-failure') {
    if (active === input.primary) {
      for (let attempt = 0; attempt < 3; attempt += 1) health = recordPrimaryTransportFailure(health);
      if (!input.fallback?.ready) return { kind: 'provider-unavailable', health };
      const fallbackRun = await runProvider(input.fallback, input.prompt, input.actions, input.operation ?? 'action', input.signal);
      if (fallbackRun.kind === 'budget-blocked') return { kind: 'budget-blocked', reason: fallbackRun.reason, health };
      if (fallbackRun.kind === 'format-error') return { kind: 'format-error', hesitationTimeT: 1, reason: fallbackRun.reason, rawOutput: fallbackRun.rawOutput, health };
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
