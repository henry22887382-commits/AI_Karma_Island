import type { JsonValue, WorldActor, WorldEvent } from './model.ts';

export interface SocialEventDraft {
  readonly worldTimeT: number;
  readonly actorId: string;
  readonly nodeId: string;
  readonly kind: string;
  readonly visibility: 'public';
  readonly payload: JsonValue;
  readonly randomDraws: readonly [];
}

export interface SocialGate {
  readonly sourceId: string;
  readonly detail: string;
}

export interface PublicMessageResult {
  readonly timeCostT: 1;
  readonly events: readonly SocialEventDraft[];
  readonly unresolved: readonly SocialGate[];
}

/** Sends one public short message. Off-Node recipients are targeted, not broadcast to their Node. */
export function resolvePublicMessage(input: {
  readonly sender: WorldActor;
  readonly recipientId: string;
  readonly text: string;
  readonly worldTimeT: number;
}): PublicMessageResult {
  const invalid = validateActorAtNode(input.sender, 'message-sender');
  if (invalid) return { timeCostT: 1, events: [], unresolved: [invalid] };
  if (input.recipientId.trim().length === 0) return { timeCostT: 1, events: [], unresolved: [{ sourceId: 'message-recipient', detail: 'A specific recipient is required by the source rule.' }] };
  const length = Array.from(input.text).length;
  if (length === 0 || length > 50) return { timeCostT: 1, events: [], unresolved: [{ sourceId: 'message-text-limit', detail: 'Public message text must contain 1 to 50 Unicode characters.' }] };
  if (!validTime(input.worldTimeT)) throw new RangeError('worldTimeT must be a nonnegative integer.');
  return {
    timeCostT: 1,
    events: [{
      worldTimeT: input.worldTimeT,
      actorId: input.sender.id,
      nodeId: input.sender.nodeId!,
      kind: 'public-message-sent',
      visibility: 'public',
      payload: { recipientId: input.recipientId, text: input.text },
      randomDraws: [],
    }],
    unresolved: [],
  };
}

/** Public messages reach their named recipient on the next action; other actors only see same-Node events. */
export function messagesVisibleAtNextAction(
  events: readonly WorldEvent[],
  input: { readonly actorId: string; readonly nodeId: string | null; readonly lastActionSequence: number; readonly currentSequence: number },
): readonly WorldEvent[] {
  return events.filter((event) => {
    if (event.kind !== 'public-message-sent' || event.visibility !== 'public' || event.sequence <= input.lastActionSequence || event.sequence > input.currentSequence) return false;
    const payload = asRecord(event.payload);
    return payload.recipientId === input.actorId || (input.nodeId !== null && event.nodeId === input.nodeId);
  }).sort((a, b) => a.sequence - b.sequence);
}

export interface TradeOffer {
  readonly offerId: string;
  readonly proposerId: string;
  readonly receiverId: string;
  readonly nodeId: string;
  readonly offeredItemId: string;
  readonly requestedItemId: string;
  readonly createdAtT: number;
  readonly status: 'pending';
}

export interface TradeRequestResult {
  readonly timeCostT: 1;
  readonly proposerInventory: readonly string[];
  readonly receiverInventory: readonly string[];
  readonly offer: TradeOffer | null;
  readonly events: readonly SocialEventDraft[];
  readonly unresolved: readonly SocialGate[];
}

/** Creates a one-item-for-one-item offer; no items move until a later acceptance is revalidated. */
export function resolveTradeRequest(input: {
  readonly proposer: WorldActor;
  readonly receiver: WorldActor;
  readonly offerId: string;
  readonly offeredItemIds: readonly string[];
  readonly requestedItemIds: readonly string[];
  readonly worldTimeT: number;
}): TradeRequestResult {
  const inventories = inventoryPair(input.proposer, input.receiver);
  const base = { timeCostT: 1 as const, proposerInventory: inventories.proposer, receiverInventory: inventories.receiver };
  const actorGate = sameNodePair(input.proposer, input.receiver, 'trade-request');
  if (actorGate) return { ...base, offer: null, events: [], unresolved: [actorGate] };
  if (!validTime(input.worldTimeT)) throw new RangeError('worldTimeT must be a nonnegative integer.');
  if (input.offerId.trim().length === 0) return { ...base, offer: null, events: [], unresolved: [{ sourceId: 'trade-offer-id', detail: 'A stable offer ID is required for idempotent settlement.' }] };
  if (input.offeredItemIds.length !== 1 || input.requestedItemIds.length !== 1 || !input.offeredItemIds[0] || !input.requestedItemIds[0]) {
    return { ...base, offer: null, events: [], unresolved: [{ sourceId: 'trade-item-cardinality', detail: 'Only a one-for-one item trade is enabled; the source does not define bundle cardinality.' }] };
  }
  const offeredItemId = input.offeredItemIds[0];
  const requestedItemId = input.requestedItemIds[0];
  if (!inventories.proposer.includes(offeredItemId)) return { ...base, offer: null, events: [], unresolved: [{ sourceId: 'trade-ownership', detail: 'The proposer does not currently own the offered item.' }] };
  if (!inventories.receiver.includes(requestedItemId)) return { ...base, offer: null, events: [], unresolved: [{ sourceId: 'trade-requested-ownership', detail: 'The receiver does not currently own the requested item.' }] };
  const offer: TradeOffer = {
    offerId: input.offerId, proposerId: input.proposer.id, receiverId: input.receiver.id,
    nodeId: input.proposer.nodeId!, offeredItemId, requestedItemId, createdAtT: input.worldTimeT, status: 'pending',
  };
  return {
    ...base,
    offer,
    events: [socialEvent(input.worldTimeT, input.proposer, 'trade-requested', { offerId: offer.offerId, proposerId: offer.proposerId, receiverId: offer.receiverId, offeredItemId: offer.offeredItemId, requestedItemId: offer.requestedItemId })],
    unresolved: [],
  };
}

export interface TradeResponseResult {
  readonly timeCostT: 1;
  readonly offerStatus: 'pending' | 'accepted' | 'rejected';
  readonly inventoryByActorId: Readonly<Record<string, readonly string[]>>;
  readonly uniqueOwnerByItemIdDelta: Readonly<Record<string, string>>;
  readonly events: readonly SocialEventDraft[];
  readonly unresolved: readonly SocialGate[];
}

/** Revalidates offer participants, location and item ownership at response time before atomic transfer. */
export function resolveTradeResponse(input: {
  readonly offer: TradeOffer;
  readonly proposer: WorldActor;
  readonly receiver: WorldActor;
  readonly decision: 'accept' | 'reject';
  readonly worldTimeT: number;
  readonly uniqueItemIds?: readonly string[];
  readonly uniqueOwnerByItemId?: Readonly<Record<string, string>>;
}): TradeResponseResult {
  const noTransfer = { timeCostT: 1 as const, offerStatus: 'pending' as const, inventoryByActorId: {} as const, uniqueOwnerByItemIdDelta: {} as const, events: [] as readonly SocialEventDraft[] };
  if (input.offer.status !== 'pending') return { ...noTransfer, unresolved: [{ sourceId: 'trade-offer-status', detail: 'The offer is no longer pending.' }] };
  if (input.proposer.id !== input.offer.proposerId || input.receiver.id !== input.offer.receiverId) return { ...noTransfer, unresolved: [{ sourceId: 'trade-participants', detail: 'The response actors do not match the stored offer.' }] };
  if (!validTime(input.worldTimeT)) throw new RangeError('worldTimeT must be a nonnegative integer.');
  const gate = sameNodePair(input.proposer, input.receiver, 'trade-response');
  if (gate) return { ...noTransfer, unresolved: [gate] };
  if (input.proposer.nodeId !== input.offer.nodeId) return { ...noTransfer, unresolved: [{ sourceId: 'trade-same-node', detail: 'Both actors must still be at the Node where the offer was made.' }] };
  if (input.decision === 'reject') return {
    timeCostT: 1, offerStatus: 'rejected', inventoryByActorId: {},
    uniqueOwnerByItemIdDelta: {},
    events: [socialEvent(input.worldTimeT, input.receiver, 'trade-rejected', { offerId: input.offer.offerId, proposerId: input.proposer.id, receiverId: input.receiver.id, offeredItemId: input.offer.offeredItemId, requestedItemId: input.offer.requestedItemId })], unresolved: [],
  };
  const proposerInventory = input.proposer.inventory;
  const receiverInventory = input.receiver.inventory;
  if (!proposerInventory || !receiverInventory) return { ...noTransfer, unresolved: [{ sourceId: 'trade-inventory', detail: 'Both current inventories are required to settle atomically.' }] };
  if (!proposerInventory.includes(input.offer.offeredItemId) || !receiverInventory.includes(input.offer.requestedItemId)) return { ...noTransfer, unresolved: [{ sourceId: 'trade-ownership', detail: 'At least one party no longer owns the item promised in the offer.' }] };
  const uniqueGate = checkUniqueOwnership(input.offer, input.proposer, input.receiver, input.uniqueItemIds, input.uniqueOwnerByItemId);
  if (uniqueGate) return { ...noTransfer, unresolved: [uniqueGate] };
  const proposerAfter = replaceOne(proposerInventory, input.offer.offeredItemId, input.offer.requestedItemId);
  const receiverAfter = replaceOne(receiverInventory, input.offer.requestedItemId, input.offer.offeredItemId);
  if (proposerAfter.length > 10 || receiverAfter.length > 10) return { ...noTransfer, unresolved: [{ sourceId: 'trade-capacity', detail: 'The resulting inventory would exceed the 10-slot capacity.' }] };
  return {
    timeCostT: 1, offerStatus: 'accepted',
    inventoryByActorId: { [input.proposer.id]: proposerAfter, [input.receiver.id]: receiverAfter },
    uniqueOwnerByItemIdDelta: {
      ...(input.uniqueItemIds?.includes(input.offer.offeredItemId) ? { [input.offer.offeredItemId]: input.receiver.id } : {}),
      ...(input.uniqueItemIds?.includes(input.offer.requestedItemId) ? { [input.offer.requestedItemId]: input.proposer.id } : {}),
    },
    events: [socialEvent(input.worldTimeT, input.receiver, 'trade-accepted', { offerId: input.offer.offerId, proposerId: input.proposer.id, receiverId: input.receiver.id, offeredItemId: input.offer.offeredItemId, requestedItemId: input.offer.requestedItemId })],
    unresolved: [],
  };
}

export interface GiftResult {
  readonly timeCostT: 1;
  readonly inventoryByActorId: Readonly<Record<string, readonly string[]>>;
  readonly uniqueOwnerByItemIdDelta: Readonly<Record<string, string>>;
  readonly groundDrop?: { readonly itemId: string; readonly nodeId: string };
  readonly events: readonly SocialEventDraft[];
  readonly unresolved: readonly SocialGate[];
}

/** GIFT is a direct one-action transfer. Acceptance/consent is not invented as a second mechanic. */
export function resolveGift(input: {
  readonly giver: WorldActor;
  readonly recipient: WorldActor;
  readonly itemId: string;
  readonly worldTimeT: number;
  readonly uniqueItemIds?: readonly string[];
  readonly uniqueOwnerByItemId?: Readonly<Record<string, string>>;
}): GiftResult {
  const noTransfer = { timeCostT: 1 as const, inventoryByActorId: {} as const, uniqueOwnerByItemIdDelta: {} as const, events: [] as readonly SocialEventDraft[] };
  const gate = sameNodePair(input.giver, input.recipient, 'gift');
  if (gate) return { ...noTransfer, unresolved: [gate] };
  if (!validTime(input.worldTimeT)) throw new RangeError('worldTimeT must be a nonnegative integer.');
  const giverInventory = input.giver.inventory;
  const recipientInventory = input.recipient.inventory;
  if (!giverInventory || !recipientInventory) return { ...noTransfer, unresolved: [{ sourceId: 'gift-inventory', detail: 'Both current inventories are required to settle atomically.' }] };
  if (!giverInventory.includes(input.itemId)) return { ...noTransfer, unresolved: [{ sourceId: 'gift-ownership', detail: 'The giver does not currently own the item.' }] };
  const uniqueGate = checkUniqueOwnership({ offeredItemId: input.itemId, requestedItemId: '' }, input.giver, input.recipient, input.uniqueItemIds, input.uniqueOwnerByItemId);
  if (uniqueGate) return { ...noTransfer, unresolved: [uniqueGate] };
  if (recipientInventory.length >= 10) {
    return {
      timeCostT: 1,
      inventoryByActorId: { [input.giver.id]: removeOne(giverInventory, input.itemId) },
      uniqueOwnerByItemIdDelta: {},
      groundDrop: { itemId: input.itemId, nodeId: input.giver.nodeId! },
      events: [socialEvent(input.worldTimeT, input.giver, 'gift-dropped', {
        giverId: input.giver.id, recipientId: input.recipient.id, itemId: input.itemId,
        reason: 'recipient-inventory-full',
      })],
      unresolved: [],
    };
  }
  return {
    timeCostT: 1,
    inventoryByActorId: { [input.giver.id]: removeOne(giverInventory, input.itemId), [input.recipient.id]: [...recipientInventory, input.itemId] },
    uniqueOwnerByItemIdDelta: input.uniqueItemIds?.includes(input.itemId) ? { [input.itemId]: input.recipient.id } : {},
    events: [socialEvent(input.worldTimeT, input.giver, 'gift-transferred', { giverId: input.giver.id, recipientId: input.recipient.id, itemId: input.itemId })],
    unresolved: [],
  };
}

function validateActorAtNode(actor: WorldActor, sourceId: string): SocialGate | null {
  if (actor.actorType !== 'resident' || !actor.alive) return { sourceId: `${sourceId}-alive`, detail: 'Only living residents may perform this action.' };
  if (actor.nodeId === null) return { sourceId: `${sourceId}-node`, detail: 'The actor must be at a Node.' };
  return null;
}

function sameNodePair(first: WorldActor, second: WorldActor, prefix: string): SocialGate | null {
  const firstGate = validateActorAtNode(first, `${prefix}-actor`);
  if (firstGate) return firstGate;
  const secondGate = validateActorAtNode(second, `${prefix}-target`);
  if (secondGate) return secondGate;
  if (first.id === second.id || first.nodeId !== second.nodeId) return { sourceId: `${prefix}-same-node`, detail: 'The two living residents must be distinct and at the same Node.' };
  return null;
}

function checkUniqueOwnership(
  offer: Pick<TradeOffer, 'offeredItemId' | 'requestedItemId'>,
  first: WorldActor,
  second: WorldActor,
  uniqueItemIds: readonly string[] | undefined,
  uniqueOwnerByItemId: Readonly<Record<string, string>> | undefined,
): SocialGate | null {
  for (const [itemId, expectedOwner] of [[offer.offeredItemId, first.id], [offer.requestedItemId, second.id]] as const) {
    if (itemId === '' || !uniqueItemIds?.includes(itemId)) continue;
    if (uniqueOwnerByItemId?.[itemId] === undefined) return { sourceId: 'unique-item-ledger', detail: `Current unique ownership for ${itemId} is required before transfer.` };
    if (uniqueOwnerByItemId[itemId] !== expectedOwner) return { sourceId: 'unique-item-ownership', detail: `Unique item ${itemId} is not recorded as owned by the offering actor.` };
  }
  return null;
}

function inventoryPair(first: WorldActor, second: WorldActor): { readonly proposer: readonly string[]; readonly receiver: readonly string[] } {
  return { proposer: first.inventory ?? [], receiver: second.inventory ?? [] };
}

function removeOne(inventory: readonly string[], itemId: string): readonly string[] {
  const index = inventory.indexOf(itemId);
  return index < 0 ? inventory : [...inventory.slice(0, index), ...inventory.slice(index + 1)];
}

function replaceOne(inventory: readonly string[], remove: string, add: string): readonly string[] {
  const index = inventory.indexOf(remove);
  return index < 0 ? inventory : [...inventory.slice(0, index), add, ...inventory.slice(index + 1)];
}

function socialEvent(worldTimeT: number, actor: WorldActor, kind: string, payload: JsonValue): SocialEventDraft {
  return { worldTimeT, actorId: actor.id, nodeId: actor.nodeId!, kind, visibility: 'public', payload, randomDraws: [] };
}

function validTime(time: number): boolean {
  return Number.isSafeInteger(time) && time >= 0;
}

function asRecord(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Readonly<Record<string, JsonValue>>;
}
