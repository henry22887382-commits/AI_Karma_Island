import type { WorldActor } from '../domain/model.ts';
import type { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { BudgetedModelProvider } from './budgeted-provider.ts';
import { currentPriceForBinding } from './model-binding.ts';
import { HttpChatCompletionsProvider } from './http-provider.ts';
import type { CostLedger, ModelProvider, ProviderPricing } from './router.ts';
import type { ModelSettingsStore, ProcessModelSecrets } from './model-settings.ts';

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
  if (binding.maxInputTokens === null || binding.maxOutputTokens === null) {
    return { ok: false, unresolved: `居民 ${input.actor.id} 的此生 token 上限未設定。` };
  }

  const ledger: CostLedger = {
    reserveCost: async (request) => input.store.reserveCost(request),
    settleCost: async (request) => input.store.settleCost(request),
  };
  const pricing: ProviderPricing = {
    inputUsdPerMillionTokens: primaryPrice.price.inputUsdPerMillion,
    outputUsdPerMillionTokens: primaryPrice.price.outputUsdPerMillion,
    maxInputTokens: binding.maxInputTokens,
    maxOutputTokens: binding.maxOutputTokens,
    priceVersion: primaryPrice.price.priceVersion,
  };
  const primary = new BudgetedModelProvider({
    inner: new HttpChatCompletionsProvider({
      id: `${binding.provider}/${binding.model}`, baseUrl: binding.baseUrl, model: binding.model, apiKey,
      maxOutputTokens: binding.maxOutputTokens,
    }, input.fetcher),
    pricing, ledger, ...(input.clock ? { clock: input.clock } : {}),
  });

  const fallbacks: ModelProvider[] = [];
  for (const fallbackModel of binding.fallbackModels) {
    const fallbackBinding = { ...binding, model: fallbackModel };
    const fallbackPrice = currentPriceForBinding(fallbackBinding, slots);
    if (!fallbackPrice.ok) return { ok: false, unresolved: `備援模型 ${fallbackModel} 無法安全計價：${fallbackPrice.unresolved}` };
    fallbacks.push(new BudgetedModelProvider({
      inner: new HttpChatCompletionsProvider({
        id: `${binding.provider}/${fallbackModel}`, baseUrl: binding.baseUrl, model: fallbackModel, apiKey,
        maxOutputTokens: binding.maxOutputTokens,
      }, input.fetcher),
      pricing: {
        inputUsdPerMillionTokens: fallbackPrice.price.inputUsdPerMillion,
        outputUsdPerMillionTokens: fallbackPrice.price.outputUsdPerMillion,
        maxInputTokens: binding.maxInputTokens,
        maxOutputTokens: binding.maxOutputTokens,
        priceVersion: fallbackPrice.price.priceVersion,
      }, ledger, ...(input.clock ? { clock: input.clock } : {}),
    }));
  }
  const fallback = fallbacks.length > 0 ? new FallbackChainProvider(fallbacks) : undefined;
  return { ok: true, primary, ...(fallback ? { fallback } : {}) };
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

  async complete(input: string, maxOutputTokens: number) {
    for (const provider of this.providers) {
      if (!provider.ready) continue;
      try {
        return await provider.complete(input, maxOutputTokens);
      } catch (error) {
        if (error instanceof Error && error.name === 'ProviderBudgetBlockedError') throw error;
      }
    }
    throw new Error('No configured fallback provider completed the request.');
  }
}
