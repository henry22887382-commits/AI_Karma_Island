import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveGift, resolvePublicMessage, resolveTradeRequest, resolveTradeResponse, messagesVisibleAtNextAction } from './social.ts';
import type { WorldActor, WorldEvent } from './model.ts';

const actor = (id: string, nodeId: string, inventory: readonly string[], alive = true): WorldActor => ({
  id, actorType: 'resident', alive, nodeId, nextActionAtT: 0, speed: 1,
  unsafeEntryAtT: null, sleeping: false, inventory,
});

test('public message costs sender one T, has a 50-character limit, and is observable at sender Node', () => {
  const sender = actor('a', 'n1', []);
  const result = resolvePublicMessage({ sender, recipientId: 'b', text: 'hello', worldTimeT: 8 });
  assert.equal(result.timeCostT, 1);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.events[0]?.payload, { recipientId: 'b', text: 'hello' });
  assert.equal(result.events[0]?.nodeId, 'n1');
  assert.equal(resolvePublicMessage({ sender, recipientId: 'b', text: 'x'.repeat(51), worldTimeT: 8 }).events.length, 0);
  assert.equal(resolvePublicMessage({ sender, recipientId: 'b', text: 'x'.repeat(51), worldTimeT: 8 }).unresolved[0]?.sourceId, 'message-text-limit');
});

test('recipient receives targeted public message on their next action; same-Node audience observes it', () => {
  const event: WorldEvent = {
    eventId: 'e1', sequence: 2, worldTimeT: 5, actorId: 'a', nodeId: 'n1',
    kind: 'public-message-sent', visibility: 'public', payload: { recipientId: 'b', text: 'hi' }, randomDraws: [],
  };
  assert.deepEqual(messagesVisibleAtNextAction([event], { actorId: 'b', nodeId: 'n2', lastActionSequence: 1, currentSequence: 2 }), [event]);
  assert.deepEqual(messagesVisibleAtNextAction([event], { actorId: 'c', nodeId: 'n1', lastActionSequence: 1, currentSequence: 2 }), [event]);
  assert.deepEqual(messagesVisibleAtNextAction([event], { actorId: 'c', nodeId: 'n2', lastActionSequence: 1, currentSequence: 2 }), []);
});

test('trade request costs one T but does not transfer; response revalidates same Node and ownership', () => {
  const proposer = actor('a', 'n1', ['sword']);
  const receiver = actor('b', 'n1', ['fish']);
  const request = resolveTradeRequest({ proposer, receiver, offerId: 'offer-1', offeredItemIds: ['sword'], requestedItemIds: ['fish'], worldTimeT: 4 });
  assert.equal(request.timeCostT, 1);
  assert.deepEqual(request.proposerInventory, ['sword']);
  assert.deepEqual(request.receiverInventory, ['fish']);
  assert.deepEqual(request.unresolved, []);
  const accepted = resolveTradeResponse({ offer: request.offer!, proposer: actor('a', 'n1', ['sword']), receiver, decision: 'accept', worldTimeT: 6 });
  assert.equal(accepted.timeCostT, 1);
  assert.deepEqual(accepted.inventoryByActorId, { a: ['fish'], b: ['sword'] });
  assert.deepEqual(accepted.uniqueOwnerByItemIdDelta, {});
  assert.equal(accepted.events[0]?.kind, 'trade-accepted');

  const moved = resolveTradeResponse({ offer: request.offer!, proposer: actor('a', 'n2', ['sword']), receiver, decision: 'accept', worldTimeT: 6 });
  assert.deepEqual(moved.inventoryByActorId, {});
  assert.equal(moved.unresolved[0]?.sourceId, 'trade-response-same-node');
  const stale = resolveTradeResponse({ offer: request.offer!, proposer: actor('a', 'n1', []), receiver, decision: 'accept', worldTimeT: 6 });
  assert.deepEqual(stale.inventoryByActorId, {});
  assert.equal(stale.unresolved[0]?.sourceId, 'trade-ownership');
});

test('trade rejection closes the offer without changing either inventory; stale/repeated item bundle is gated', () => {
  const request = resolveTradeRequest({ proposer: actor('a', 'n1', ['sword']), receiver: actor('b', 'n1', ['fish']), offerId: 'offer-2', offeredItemIds: ['sword'], requestedItemIds: ['fish'], worldTimeT: 4 });
  const rejected = resolveTradeResponse({ offer: request.offer!, proposer: actor('a', 'n1', ['sword']), receiver: actor('b', 'n1', ['fish']), decision: 'reject', worldTimeT: 5 });
  assert.deepEqual(rejected.inventoryByActorId, {});
  assert.equal(rejected.events[0]?.kind, 'trade-rejected');
  const repeated = resolveTradeRequest({ proposer: actor('a', 'n1', ['sword']), receiver: actor('b', 'n1', ['fish']), offerId: 'offer-3', offeredItemIds: ['sword', 'sword'], requestedItemIds: ['fish', 'fish'], worldTimeT: 4 });
  assert.equal(repeated.offer, null);
  assert.equal(repeated.unresolved[0]?.sourceId, 'trade-item-cardinality');
});

test('gift immediately transfers one owned item atomically and respects destination capacity', () => {
  const gift = resolveGift({ giver: actor('a', 'n1', ['book']), recipient: actor('b', 'n1', []), itemId: 'book', worldTimeT: 9 });
  assert.equal(gift.timeCostT, 1);
  assert.deepEqual(gift.inventoryByActorId, { a: [], b: ['book'] });
  const full = actor('b', 'n1', Array.from({ length: 10 }, (_, index) => `item-${index}`));
  const denied = resolveGift({ giver: actor('a', 'n1', ['book']), recipient: full, itemId: 'book', worldTimeT: 9 });
  assert.deepEqual(denied.inventoryByActorId, { a: [] });
  assert.deepEqual(denied.groundDrop, { itemId: 'book', nodeId: 'n1' });
  assert.equal(denied.events[0]?.kind, 'gift-dropped');
  assert.deepEqual(denied.unresolved, []);
});

test('unique-item transfer requires authoritative owner data and returns an atomic owner update', () => {
  const absent = resolveGift({ giver: actor('a', 'n1', ['hero-sword']), recipient: actor('b', 'n1', []), itemId: 'hero-sword', worldTimeT: 9, uniqueItemIds: ['hero-sword'] });
  assert.deepEqual(absent.inventoryByActorId, {});
  assert.equal(absent.unresolved[0]?.sourceId, 'unique-item-ledger');
  const gift = resolveGift({
    giver: actor('a', 'n1', ['hero-sword']), recipient: actor('b', 'n1', []), itemId: 'hero-sword', worldTimeT: 9,
    uniqueItemIds: ['hero-sword'], uniqueOwnerByItemId: { 'hero-sword': 'a' },
  });
  assert.deepEqual(gift.uniqueOwnerByItemIdDelta, { 'hero-sword': 'b' });
});
