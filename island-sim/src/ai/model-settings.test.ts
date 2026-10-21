import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { isModelSlotReady, ModelSettingsStore, ProcessModelSecrets } from './model-settings.ts';

test('each non-secret slot revision has a stable opaque credential reference', () => {
  const store = new ModelSettingsStore(new DatabaseSync(':memory:'));
  try {
    const initial = store.readSlots()[0];
    assert.ok(initial?.credentialRef);
    const input = {
      slotId: 1, provider: 'local', baseUrl: 'http://127.0.0.1:9999/v1', model: 'm1', fallbackModels: [],
      inputUsdPerMillion: 1, outputUsdPerMillion: 2, maxInputTokens: 1000, maxOutputTokens: 100,
      modelSizeB: null, sizeAtLeast8BConfirmed: true, styleDescription: '簡潔、謹慎',
    };
    store.saveSlot(input, '2026-10-20T00:00:00.000Z');
    const firstRevision = store.readSlots()[0];
    assert.ok(firstRevision?.credentialRef);
    assert.notEqual(firstRevision.credentialRef, initial.credentialRef);
    store.saveSlot(input, '2026-10-20T00:00:00.000Z');
    assert.equal(store.readSlots()[0]?.credentialRef, firstRevision.credentialRef);
    store.saveSlot({ ...input, model: 'm2' }, '2026-10-20T00:01:00.000Z');
    assert.notEqual(store.readSlots()[0]?.credentialRef, firstRevision.credentialRef);
  } finally {
    store.close();
  }
});

test('process secrets are addressable only by credential reference and preserve old life bindings', () => {
  const secrets = new ProcessModelSecrets();
  secrets.set('opaque-ref-old', 'old-life-secret');
  secrets.set('opaque-ref-new', 'new-slot-secret');
  assert.equal(secrets.getForCredential('opaque-ref-old'), 'old-life-secret');
  assert.equal(secrets.getForCredential('opaque-ref-new'), 'new-slot-secret');
  assert.equal(secrets.has('opaque-ref-old'), true);
  secrets.clearAll();
  assert.equal(secrets.getForCredential('opaque-ref-old'), undefined);
});

test('primary model identity cannot be assigned to two resident slots', () => {
  const settings = new ModelSettingsStore(new DatabaseSync(':memory:'));
  try {
    const base = {
      provider: 'local', baseUrl: 'http://127.0.0.1:1234/v1', model: 'same-model', fallbackModels: [],
      inputUsdPerMillion: 0, outputUsdPerMillion: 0, maxInputTokens: 1000, maxOutputTokens: 128,
      modelSizeB: null, sizeAtLeast8BConfirmed: true, styleDescription: '比較型',
    } as const;
    settings.saveSlot({ slotId: 1, ...base });
    assert.throws(() => settings.saveSlot({ slotId: 2, ...base }), /已配置於槽位 1/);
  } finally {
    settings.close();
  }
});

test('8B readiness requires an explicit user attestation, does not infer unknown metadata, and rejects a known sub-8B value', () => {
  const settings = new ModelSettingsStore(new DatabaseSync(':memory:'));
  try {
    const config = settings.saveSlot({
      slotId: 1, provider: 'local', baseUrl: 'http://127.0.0.1:1234/v1', model: 'size-check', fallbackModels: [],
      inputUsdPerMillion: 1, outputUsdPerMillion: 1, maxInputTokens: 1000, maxOutputTokens: 128,
      modelSizeB: null, sizeAtLeast8BConfirmed: false, styleDescription: null,
    });
    assert.equal(isModelSlotReady(config, true), false);
    const attested = settings.saveSlot({
      slotId: 1, provider: 'local', baseUrl: 'http://127.0.0.1:1234/v1', model: 'size-check', fallbackModels: [],
      inputUsdPerMillion: 1, outputUsdPerMillion: 1, maxInputTokens: 1000, maxOutputTokens: 128,
      modelSizeB: null, sizeAtLeast8BConfirmed: true, styleDescription: '謹慎探索',
    });
    assert.equal(isModelSlotReady(attested, true), true);
    const belowTarget = settings.saveSlot({
      slotId: 1, provider: 'local', baseUrl: 'http://127.0.0.1:1234/v1', model: 'size-check', fallbackModels: [],
      inputUsdPerMillion: 1, outputUsdPerMillion: 1, maxInputTokens: 1000, maxOutputTokens: 128,
      modelSizeB: 7, sizeAtLeast8BConfirmed: true, styleDescription: '謹慎探索',
    });
    assert.equal(isModelSlotReady(belowTarget, true), false);
  } finally {
    settings.close();
  }
});
