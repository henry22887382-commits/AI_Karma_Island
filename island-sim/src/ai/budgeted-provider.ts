import { randomUUID } from 'node:crypto';
import type { CostLedger, CostRecord, ModelProvider, ProviderCallContext, ProviderCompletion, ProviderPricing } from './router.ts';
import { ProviderBudgetBlockedError } from './router.ts';

export class BudgetedModelProvider implements ModelProvider {
  readonly id: string;
  readonly ready: boolean;
  private readonly inner: ModelProvider;
  private readonly pricing: ProviderPricing;
  private readonly ledger: CostLedger;
  private readonly clock: () => Date;

  constructor(input: {
    readonly inner: ModelProvider;
    readonly pricing: ProviderPricing;
    readonly ledger: CostLedger;
    readonly clock?: () => Date;
  }) {
    this.inner = input.inner;
    this.pricing = input.pricing;
    this.ledger = input.ledger;
    this.clock = input.clock ?? (() => new Date());
    this.id = input.inner.id;
    this.ready = input.inner.ready && validPricing(input.pricing);
  }

  async complete(prompt: string, maxOutputTokens: number, context: ProviderCallContext = { operation: 'action', retry: false }): Promise<ProviderCompletion> {
    if (!this.ready) throw new ProviderBudgetBlockedError('模型輸入價格或 token 上限未正確設定。');
    const now = this.clock();
    const calculatedMaximumUsd = (
      this.pricing.maxInputTokens * this.pricing.inputUsdPerMillionTokens
    ) / 1_000_000;
    const maximumUsd = calculatedMaximumUsd;
    const requestId = randomUUID();
    const reservation = await this.ledger.reserveCost({
      requestId,
      atIso: now.toISOString(),
      maximumUsd,
    });
    if (!reservation.allowed || reservation.reservationId === null) {
      throw new ProviderBudgetBlockedError('月費用上限不足，模型呼叫已在送出前阻止。');
    }

    let completion: ProviderCompletion;
    try {
      completion = await this.inner.complete(prompt, maxOutputTokens, context);
    } catch {
      await this.recordUnknown(requestId, reservation.reservationId, undefined, now, context);
      throw new Error('模型服務傳輸失敗。');
    }
    if (completion.actualCostUsd === undefined) {
      await this.recordUnknown(requestId, reservation.reservationId, completion.usage, now, context);
      return completion;
    }
    const settled = await this.settle(reservation.reservationId, completion, now, context);
    if (settled.exceededCap) throw new ProviderBudgetBlockedError('模型回報用量超出預留費用；已停止後續模型呼叫。');
    return completion;
  }

  private async settle(reservationId: string, completion: ProviderCompletion, now: Date, context: ProviderCallContext) {
    const actualUsd = completion.actualCostUsd;
    if (actualUsd === undefined || !Number.isFinite(actualUsd) || actualUsd < 0) throw new Error('Provider did not return a valid actual cost.');
    const inputTokens = completion.usage?.inputTokens ?? null;
    const outputTokens = completion.usage?.outputTokens ?? null;
    const recordedAt = now.toISOString();
    const category: CostRecord['category'] = context.retry
      ? 'retry'
      : context.operation !== 'action'
        ? context.operation
        : selectedMessageAction(completion.raw, context.messageActionIds) ? 'message' : 'prompt';
    const record: CostRecord = {
      providerId: this.id, category, inputTokens, outputTokens, costUsd: actualUsd, recordedAt,
    };
    return this.ledger.settleCost({ reservationId, actualUsd, record });
  }

  private async recordUnknown(requestId: string, reservationId: string, usage: ProviderCompletion['usage'], now: Date, context: ProviderCallContext): Promise<void> {
    if (!this.ledger.recordUnpricedCost) throw new Error('Durable unknown-cost accounting is unavailable.');
    const category: CostRecord['category'] = context.retry ? 'retry'
      : context.operation !== 'action' ? context.operation : 'prompt';
    await this.ledger.recordUnpricedCost({
      requestId, providerId: this.id, category,
      inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null,
      recordedAt: now.toISOString(), reservationId,
    });
  }
}

export class UnpricedModelProvider implements ModelProvider {
  readonly id: string;
  readonly ready: boolean;
  private readonly inner: ModelProvider;
  private readonly ledger: CostLedger;
  private readonly clock: () => Date;
  private readonly acceptProviderActualCost: boolean;

  constructor(input: { readonly inner: ModelProvider; readonly ledger: CostLedger; readonly acceptProviderActualCost?: boolean; readonly clock?: () => Date }) {
    this.inner = input.inner;
    this.ledger = input.ledger;
    this.clock = input.clock ?? (() => new Date());
    this.acceptProviderActualCost = input.acceptProviderActualCost ?? false;
    this.id = input.inner.id;
    this.ready = input.inner.ready && input.ledger.recordUnpricedCost !== undefined
      && (!this.acceptProviderActualCost || input.ledger.recordActualCost !== undefined);
  }

  async complete(prompt: string, maxOutputTokens: number, context: ProviderCallContext = { operation: 'action', retry: false }): Promise<ProviderCompletion> {
    if (!this.ready || !this.ledger.recordUnpricedCost) throw new ProviderBudgetBlockedError('未知費用的持久化記錄不可用。');
    const now = this.clock();
    let completion: ProviderCompletion | undefined;
    let failed = false;
    try { completion = await this.inner.complete(prompt, maxOutputTokens, context); }
    catch (error) { failed = true; throw error; }
    finally {
      const category: CostRecord['category'] = context.retry ? 'retry' : context.operation === 'action'
        ? (completion && selectedMessageAction(completion.raw, context.messageActionIds) ? 'message' : 'prompt')
        : context.operation;
      const actualCost = this.acceptProviderActualCost ? completion?.actualCostUsd : undefined;
      if (!failed && actualCost !== undefined && Number.isFinite(actualCost) && actualCost >= 0 && this.ledger.recordActualCost) {
        await this.ledger.recordActualCost({
          requestId: randomUUID(), providerId: this.id, category,
          inputTokens: completion?.usage?.inputTokens ?? null, outputTokens: completion?.usage?.outputTokens ?? null,
          costUsd: actualCost, recordedAt: now.toISOString(),
        });
      } else {
        await this.ledger.recordUnpricedCost!({
          requestId: randomUUID(), providerId: this.id, category,
          inputTokens: completion?.usage?.inputTokens ?? null, outputTokens: completion?.usage?.outputTokens ?? null,
          recordedAt: now.toISOString(),
        });
      }
    }
    return completion!;
  }
}

function selectedMessageAction(raw: string | undefined, messageActionIds: readonly string[] | undefined): boolean {
  if (raw === undefined || !messageActionIds?.length) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  const reply = parsed as Record<string, unknown>;
  if (Object.keys(reply).some((key) => !['action_id', 'intent', 'text'].includes(key))) return false;
  return typeof reply.action_id === 'string' && messageActionIds.includes(reply.action_id)
    && typeof reply.intent === 'string' && Array.from(reply.intent).length <= 30
    && typeof reply.text === 'string' && Array.from(reply.text).length <= 50;
}

function validPricing(pricing: ProviderPricing): boolean {
  return Number.isFinite(pricing.inputUsdPerMillionTokens) && pricing.inputUsdPerMillionTokens >= 0
    && Number.isFinite(pricing.outputUsdPerMillionTokens) && pricing.outputUsdPerMillionTokens >= 0
    && Number.isSafeInteger(pricing.maxInputTokens) && pricing.maxInputTokens > 0;
}
