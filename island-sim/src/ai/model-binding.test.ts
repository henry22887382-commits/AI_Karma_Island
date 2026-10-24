import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelBinding } from '../domain/model.ts';
import type { ModelSlotConfig } from './model-settings.ts';
import { currentPriceForBinding } from './model-binding.ts';

const binding: ModelBinding = {
  slotId: 1, provider: 'provider-a', baseUrl: 'https://api.example.test', model: 'old-model', fallbackModels: ['old-fallback'],
  maxInputTokens: 1000, maxOutputTokens: 300, modelSizeB: 8, styleDescription: '觀察型', updatedAt: 'config-v1', credentialRef: 'slot-1@config-v1',
};

function slot(overrides: Partial<ModelSlotConfig>): ModelSlotConfig {
  return {
    slotId: 1, provider: null, baseUrl: null, model: null, fallbackModels: [], inputUsdPerMillion: null,
    outputUsdPerMillion: null, maxInputTokens: null, maxContextCharacters: 8000, maxOutputTokens: null, modelSizeB: null, sizeAtLeast8BConfirmed: false, styleDescription: null, updatedAt: null, credentialRef: `ref-${overrides.slotId ?? 1}`, ...overrides,
  };
}

test('prices a resident by its life-bound model identity and current matching price version', () => {
  const result = currentPriceForBinding(binding, [
    slot({ slotId: 1, provider: 'provider-a', model: 'new-model', inputUsdPerMillion: 99, outputUsdPerMillion: 99, updatedAt: 'new-config' }),
    slot({ slotId: 2, provider: 'provider-a', model: 'old-model', inputUsdPerMillion: 2, outputUsdPerMillion: 3, updatedAt: 'price-v4' }),
  ]);
  assert.deepEqual(result, { ok: true, price: { inputUsdPerMillion: 2, outputUsdPerMillion: 3, priceVersion: 'price-v4' } });
});

test('fails closed when no matching identity, current rates, or unambiguous current price exists', () => {
  assert.equal(currentPriceForBinding(binding, [slot({ provider: 'provider-a', model: 'new-model', inputUsdPerMillion: 1, outputUsdPerMillion: 1 })]).ok, false);
  assert.equal(currentPriceForBinding(binding, [slot({ provider: 'provider-a', model: 'old-model' })]).ok, false);
  const conflict = currentPriceForBinding(binding, [
    slot({ slotId: 1, provider: 'provider-a', model: 'old-model', inputUsdPerMillion: 1, outputUsdPerMillion: 1 }),
    slot({ slotId: 2, provider: 'provider-a', model: 'old-model', inputUsdPerMillion: 2, outputUsdPerMillion: 2 }),
  ]);
  assert.equal(conflict.ok, false);
});
