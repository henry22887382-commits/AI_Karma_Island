import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiInput, formatAiNarrativeEvent, type AiLegalAction } from './view.ts';
import { buildModelInput } from './router.ts';
import type { JsonValue, WorldEvent, WorldState } from '../domain/model.ts';

function payloadText(payload: JsonValue): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || !('text' in payload)) return undefined;
  return typeof payload.text === 'string' ? payload.text : undefined;
}

const state: WorldState = {
  schemaVersion: 1,
  sequence: 3,
  contentVersion: 'test-content',
  worldTimeT: 49,
  seed: 'seed',
  rngState: 'rng',
  actors: {
    '1.1': { id: '1.1', actorType: 'resident', alive: true, nodeId: '1', nextActionAtT: 49, speed: 1, unsafeEntryAtT: 0, sleeping: false, hitPoints: 20, hunger: 4, sleep: 3, name: '本人', inventory: ['自有蘋果'], aiMemory: { processedThroughSequence: 0, entries: [] } },
    '2.1': { id: '2.1', actorType: 'resident', alive: true, nodeId: '1', nextActionAtT: 52, speed: 1, unsafeEntryAtT: null, sleeping: true, hitPoints: 4, hunger: 0, sleep: 0, name: '另一居民', inventory: ['不可見的物品'], aiMemory: { processedThroughSequence: 0, entries: [] } },
    'm.1': { id: 'm.1', actorType: 'monster', alive: true, nodeId: '1', nextActionAtT: 49, speed: 1, unsafeEntryAtT: null, sleeping: false, hitPoints: 99, hunger: 0, sleep: 0, inventory: ['怪物掉落表'] },
    '3.1': { id: '3.1', actorType: 'resident', alive: true, nodeId: '2', nextActionAtT: 49, speed: 1, unsafeEntryAtT: null, sleeping: false, hitPoints: 30, hunger: 5, sleep: 5, inventory: ['遠方私人物品'] },
  },
  nodes: {
    '1': { id: '1', label: null, labelStatus: '未逐點命名', visualType: 'beach', surfaceTerrain: 'beach', neighbors: ['2'], safe: true },
    '2': { id: '2', label: '遠方森林', labelStatus: 'confirmed', visualType: 'forest', surfaceTerrain: 'forest', neighbors: ['1'], safe: true },
  },
  objects: {
    obj1: { id: 'obj1', itemId: 'unread-note', ownerActorId: null, nodeId: '1', generatedAtT: 49, expiresAtT: null, unique: false, provisional: false },
    obj2: { id: 'obj2', itemId: 'far-object', ownerActorId: null, nodeId: '2', generatedAtT: 49, expiresAtT: null, unique: false, provisional: false },
  },
  privateLifeData: {
    '1.1': { intents: ['本人私下意圖不得送回模型'], biographyStatus: 'active' },
    '2.1': { intents: ['前代或他人私下意圖不得外洩'], biographyStatus: 'active' },
  },
};

const events: readonly WorldEvent[] = [
  { eventId: 'past-other-node', sequence: 1, worldTimeT: 48, actorId: '2.1', nodeId: '2', kind: 'public_action', visibility: 'public', payload: { text: '遠方事件不應可見' }, randomDraws: [] },
  { eventId: 'same-node', sequence: 2, worldTimeT: 48, actorId: '2.1', nodeId: '1', kind: 'public_action', visibility: 'public', payload: { text: '同Node事件' }, randomDraws: [] },
  { eventId: 'private-other', sequence: 3, worldTimeT: 48, actorId: '2.1', nodeId: '1', kind: 'private_action', visibility: 'private', payload: { text: '不可見內心' }, randomDraws: [] },
];

const legalActions: readonly AiLegalAction[] = [
  { id: 'a-read-1', type: 'read', name: '閱讀紙條', costT: 1, requiresText: false, payload: { objectSlot: 1 } },
  { id: 'a-wait-2', type: 'wait', name: '等待', costT: 1, requiresText: false, payload: {} },
];

test('builds a Node-scoped AI snapshot without integer clock, other inventory, or remote-node data', () => {
  const built = buildAiInput(state, '1.1', legalActions, events, (event) => payloadText(event.payload));
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.match(built.input.narration, /夜晚/);
  assert.match(built.input.narration, /同Node事件/);
  assert.doesNotMatch(built.input.narration, /遠方事件/);
  const serialized = JSON.stringify(built.input.snapshot);
  assert.doesNotMatch(serialized, /worldTimeT|遠方森林|不可見的物品|怪物掉落表|遠方私人物品|本人私下意圖|前代或他人私下意圖/);
  assert.match(serialized, /面黃肌瘦/);
  assert.match(serialized, /黑眼圈/);
  assert.match(serialized, /狀態不好/);
  assert.match(serialized, /"remaining_life":20/);
  assert.doesNotMatch(serialized, /hit_points/);
  assert.match(built.input.narration, /self\.remaining_life 代表目前餘命/);
});

test('does not synthesize narration when an eligible settled event lacks a source-backed template', () => {
  const built = buildAiInput(state, '1.1', legalActions, [{ ...events[1]!, payload: {} }], () => undefined);
  assert.deepEqual(built, { ok: false, unresolved: ['event:same-node:missing-narrative'] });
});

test('does not include a Node event while the resident is travelling', () => {
  const traveling = { ...state, actors: { ...state.actors, '1.1': { ...state.actors['1.1']!, nodeId: null } } };
  const built = buildAiInput(traveling, '1.1', legalActions, events, (event) => payloadText(event.payload));
  assert.equal(built.ok, true);
  if (built.ok) assert.doesNotMatch(built.input.narration, /同Node事件/);
});

test('keeps only the actor life own prior public narration and latest JSON, never private intents', () => {
  const ownAction: WorldEvent = {
    eventId: 'own-prior-action', sequence: 4, worldTimeT: 47, actorId: '1.1', nodeId: '1',
    kind: 'resident-action-settled', visibility: 'public', payload: { actionType: 'wait' }, randomDraws: [],
  };
  const privateAction: WorldEvent = {
    eventId: 'own-private', sequence: 5, worldTimeT: 48, actorId: '1.1', nodeId: '1',
    kind: 'private-intent', visibility: 'private', payload: { text: '本人私下意圖不得送回模型' }, randomDraws: [],
  };
  const built = buildAiInput({ ...state, sequence: 5 }, '1.1', legalActions, [ownAction, privateAction], formatAiNarrativeEvent);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.match(built.input.narration, /你等待了/);
  assert.doesNotMatch(built.input.narration, /本人私下意圖/);
  const next = buildAiInput({ ...state, sequence: 5 }, '1.1', legalActions, [], formatAiNarrativeEvent, built.memory);
  assert.equal(next.ok, true);
  if (!next.ok) return;
  const rememberedPrompt = buildModelInput(next.input);
  assert.match(rememberedPrompt, /你記得曾觀察到的公開事件：/);
  assert.match(rememberedPrompt, /你等待了/);
  assert.doesNotMatch(rememberedPrompt, /本人私下意圖/);
  assert.equal(built.input.snapshot.worldTimeT, undefined);
  assert.equal((built.input.snapshot.available_actions as readonly unknown[]).length, legalActions.length);
});

test('source narrative templates never translate an unknown event into an invented result', () => {
  const unknown: WorldEvent = { ...events[0]!, kind: 'unmapped-event' };
  assert.equal(formatAiNarrativeEvent(unknown, '1.1'), undefined);
});

test('provides the previous monster action outcome to an AI on the same Node', () => {
  const monsterAction: WorldEvent = {
    eventId: 'monster-action-1', sequence: 4, worldTimeT: 49, actorId: 'm.1', nodeId: '1',
    kind: 'monster-action-settled', visibility: 'public',
    payload: { monsterName: '森林野豬', action: 'attack', hits: [{ targetId: '1.1', appliedDamage: 2, targetHitPointsBefore: 20, hitPointsAfter: 18, killed: false }] },
    randomDraws: [],
  };
  const built = buildAiInput({ ...state, sequence: 4 }, '1.1', legalActions, [monsterAction], formatAiNarrativeEvent);
  assert.equal(built.ok, true);
  if (built.ok) assert.match(built.input.narration, /怪物森林野豬發動攻擊：你實際扣除 2 點餘命/);
});

test('shows a public message to the named same-Node recipient on their next action', () => {
  const message: WorldEvent = {
    eventId: 'message-to-2.1', sequence: 4, worldTimeT: 49, actorId: '1.1', nodeId: '1',
    kind: 'public-message-sent', visibility: 'public', payload: { recipientId: '2.1', text: '請一起探索河流' }, randomDraws: [],
  };
  const built = buildAiInput({ ...state, sequence: 4 }, '2.1', legalActions, [message], formatAiNarrativeEvent);
  assert.equal(built.ok, true);
  if (built.ok) assert.match(built.input.narration, /居民 1\.1向2\.1發送公開訊息：「請一起探索河流」/);
});

test('includes a resident HP loss summary in that resident next AI input, including off-Node events', () => {
  const healthLoss: WorldEvent = {
    eventId: 'daily-loss-2.1', sequence: 4, worldTimeT: 72, actorId: null, nodeId: null,
    kind: 'daily-survival-settled', visibility: 'public',
    payload: { hpChanges: [{ actorId: '2.1', damage: 3, remainingHp: 1 }] }, randomDraws: [],
  };
  const built = buildAiInput({ ...state, sequence: 4 }, '2.1', legalActions, [healthLoss], formatAiNarrativeEvent, { processedThroughSequence: 3, entries: [] });
  assert.equal(built.ok, true);
  if (built.ok) assert.match(built.input.narration, /你失去了 3 點餘命，目前剩餘 1 點/);
});
