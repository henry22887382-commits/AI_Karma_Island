import type { WorldActor } from '../domain/model.ts';
import type { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { BudgetedModelProvider, UnpricedModelProvider } from './budgeted-provider.ts';
import { currentPriceForBinding, type ModelPrice } from './model-binding.ts';
import { HttpChatCompletionsProvider } from './http-provider.ts';
import { providerAccountingAdapter } from './provider-accounting.ts';
import type { CostLedger, ModelProvider, ProviderPricing } from './router.ts';
import type { ModelSettingsStore, ProcessModelSecrets } from './model-settings.ts';
import type { ModelSlotConfig } from './model-settings.ts';

export function createSummarizerProvider(input: { readonly config: ModelSlotConfig; readonly secrets: ProcessModelSecrets; readonly store: SQLiteWorldStore; readonly fetcher?: typeof fetch }): ModelProvider | null {
  const { config } = input;
  const apiKey = input.secrets.getForCredential(config.credentialRef);
  if (!config.provider || !config.baseUrl || !config.model || !apiKey) return null;
  const accounting = providerAccountingAdapter(config.baseUrl);
  const inner = new HttpChatCompletionsProvider({ id: `${config.provider}/${config.model}`, baseUrl: config.baseUrl, model: config.model, apiKey, includeActualCost: accounting.kind === 'openrouter' }, input.fetcher);
  const ledger: CostLedger = {
    reserveCost: async (request) => input.store.reserveCost(request),
    settleCost: async (request) => input.store.settleCost(request),
    recordUnpricedCost: async (request) => input.store.recordUnpricedCost(request),
    recordActualCost: async (request) => input.store.recordActualCost(request),
  };
  return new UnpricedModelProvider({ inner, ledger, acceptProviderActualCost: accounting.kind === 'openrouter' });
}

export type BoundProvidersResult =
  | { readonly ok: true; readonly primary: ModelProvider; readonly fallback?: ModelProvider }
  | { readonly ok: false; readonly unresolved: string };

export function createBoundProviders(input: {
  readonly actor: WorldActor;
  readonly settings: ModelSettingsStore;
  readonly secrets: ProcessModelSecrets;
  readonly store: SQLiteWorldStore;
  readonly clock?: () => Date;
  readonly fetcher?: typeof fetch;
}): BoundProvidersResult {
  const binding = input.actor.modelAssignment ?? null;
  if (!binding || !binding.provider || !binding.baseUrl || !binding.model || !binding.credentialRef) {
    return { ok: false, unresolved: `居民 ${input.actor.id} 的此生模型尚未綁定完整設定。` };
  }
  const apiKey = input.secrets.getForCredential(binding.credentialRef);
  if (!apiKey) return { ok: false, unresolved: `居民 ${input.actor.id} 的此生 API 金鑰本次尚未重新輸入。` };
  const slots = input.settings.readSlots();
  const primaryPrice = currentPriceForBinding(binding, slots);
  if (!primaryPrice.ok) return { ok: false, unresolved: primaryPrice.unresolved };
  if (binding.maxInputTokens === null) {
    return { ok: false, unresolved: `居民 ${input.actor.id} 的此生輸入 token 上限未設定。` };
  }

  const ledger: CostLedger = {
    reserveCost: async (request) => input.store.reserveCost(request),
    settleCost: async (request) => input.store.settleCost(request),
    recordUnpricedCost: async (request) => input.store.recordUnpricedCost(request),
    recordActualCost: async (request) => input.store.recordActualCost(request),
  };
  const adapter = providerAccountingAdapter(binding.baseUrl);
  const primaryHttp = new HttpChatCompletionsProvider({
    id: `${binding.provider}/${binding.model}`, baseUrl: binding.baseUrl, model: binding.model, apiKey,
    includeActualCost: adapter.kind === 'openrouter',
  }, input.fetcher);
  const primary = adapter.kind === 'openrouter' && primaryPrice.price !== null
    ? new BudgetedModelProvider({
      inner: primaryHttp,
      pricing: toProviderPricing(primaryPrice.price, binding.maxInputTokens),
      ledger, ...(input.clock ? { clock: input.clock } : {}),
    })
    : new UnpricedModelProvider({
      inner: primaryHttp, ledger, acceptProviderActualCost: adapter.kind === 'openrouter', ...(input.clock ? { clock: input.clock } : {}),
    });

  const fallbacks: ModelProvider[] = [];
  for (const fallbackModel of binding.fallbackModels) {
    const fallbackBinding = { ...binding, model: fallbackModel };
    const fallbackPrice = currentPriceForBinding(fallbackBinding, slots);
    if (!fallbackPrice.ok) return { ok: false, unresolved: `備援模型 ${fallbackModel} 設定無效：${fallbackPrice.unresolved}` };
    const fallbackHttp = new HttpChatCompletionsProvider({
      id: `${binding.provider}/${fallbackModel}`, baseUrl: binding.baseUrl, model: fallbackModel, apiKey,
      includeActualCost: adapter.kind === 'openrouter',
    }, input.fetcher);
    fallbacks.push(adapter.kind === 'openrouter' && fallbackPrice.price !== null
      ? new BudgetedModelProvider({
        inner: fallbackHttp,
        pricing: toProviderPricing(fallbackPrice.price, binding.maxInputTokens),
        ledger, ...(input.clock ? { clock: input.clock } : {}),
      })
      : new UnpricedModelProvider({
        inner: fallbackHttp, ledger, acceptProviderActualCost: adapter.kind === 'openrouter', ...(input.clock ? { clock: input.clock } : {}),
      }));
  }
  const fallback = fallbacks.length > 0 ? new FallbackChainProvider(fallbacks) : undefined;
  return { ok: true, primary, ...(fallback ? { fallback } : {}) };
}

function toProviderPricing(price: ModelPrice, maxInputTokens: number): ProviderPricing {
  return {
    inputUsdPerMillionTokens: price.inputUsdPerMillion,
    outputUsdPerMillionTokens: price.outputUsdPerMillion,
    maxInputTokens, priceVersion: price.priceVersion,
  };
}

class FallbackChainProvider implements ModelProvider {
  readonly id: string;
  readonly ready: boolean;
  private readonly providers: readonly ModelProvider[];

  constructor(providers: readonly ModelProvider[]) {
    this.providers = providers;
    this.id = providers.map(({ id }) => id).join(',');
    this.ready = providers.some(({ ready }) => ready);
  }

  async complete(input: string, maxOutputTokens: number, context?: Parameters<ModelProvider['complete']>[2]) {
    for (const provider of this.providers) {
      if (!provider.ready) continue;
      try {
        return await provider.complete(input, maxOutputTokens, context);
      } catch (error) {
        if (error instanceof Error && error.name === 'ProviderBudgetBlockedError') throw error;
      }
    }
    throw new Error('No configured fallback provider completed the request.');
  }
}
