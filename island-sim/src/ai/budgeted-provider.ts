import { randomUUID } from 'node:crypto';
import type { CostLedger, CostRecord, ModelProvider, ProviderCompletion, ProviderPricing } from './router.ts';
import { ProviderBudgetBlockedError, actualCostUsd } from './router.ts';

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

  async complete(prompt: string, maxOutputTokens: number): Promise<ProviderCompletion> {
    if (!this.ready) throw new ProviderBudgetBlockedError('模型價格或 token 上限未正確設定。');
    const now = this.clock();
    const calculatedMaximumUsd = (
      this.pricing.maxInputTokens * this.pricing.inputUsdPerMillionTokens
      + this.pricing.maxOutputTokens * this.pricing.outputUsdPerMillionTokens
    ) / 1_000_000;
    const maximumUsd = Math.max(calculatedMaximumUsd, 1e-12);
    const reservation = await this.ledger.reserveCost({
      requestId: randomUUID(),
      atIso: now.toISOString(),
      maximumUsd,
    });
    if (!reservation.allowed || reservation.reservationId === null) {
      throw new ProviderBudgetBlockedError('月費用上限不足，模型呼叫已在送出前阻止。');
    }

    let completion: ProviderCompletion;
    try {
      completion = await this.inner.complete(prompt, Math.min(maxOutputTokens, this.pricing.maxOutputTokens));
    } catch {
      await this.settle(reservation.reservationId, undefined, maximumUsd, now);
      throw new Error('模型服務傳輸失敗。');
    }
    const settled = await this.settle(reservation.reservationId, completion.usage, maximumUsd, now);
    if (settled.exceededCap) throw new ProviderBudgetBlockedError('模型回報用量超出預留費用；已停止後續模型呼叫。');
    return completion;
  }

  private async settle(reservationId: string, usage: ProviderCompletion['usage'], maximumUsd: number, now: Date) {
    const actualUsd = usage === undefined ? maximumUsd : actualCostUsd(usage, this.pricing);
    const record: CostRecord = {
      providerId: this.id,
      category: 'prompt',
      inputTokens: usage?.inputTokens ?? this.pricing.maxInputTokens,
      outputTokens: usage?.outputTokens ?? this.pricing.maxOutputTokens,
      costUsd: actualUsd,
      recordedAt: now.toISOString(),
    };
    return this.ledger.settleCost({ reservationId, actualUsd, record });
  }
}

function validPricing(pricing: ProviderPricing): boolean {
  return Number.isFinite(pricing.inputUsdPerMillionTokens) && pricing.inputUsdPerMillionTokens >= 0
    && Number.isFinite(pricing.outputUsdPerMillionTokens) && pricing.outputUsdPerMillionTokens >= 0
    && Number.isSafeInteger(pricing.maxInputTokens) && pricing.maxInputTokens > 0
    && Number.isSafeInteger(pricing.maxOutputTokens) && pricing.maxOutputTokens > 0;
}
