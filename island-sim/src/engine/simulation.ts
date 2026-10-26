import type { IslandGraph } from '../content/island.ts';
import type { CsvRow } from '../content/csv.ts';
import type { ActionDefinition, ActionProposal, JsonValue, ModelBinding, PrivateLifeRecord, RandomDraw, ReadableInventoryItem, WorldActor, WorldEvent, WorldObject, WorldState } from '../domain/model.ts';
import type { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { applyFood, createInitialVitals } from '../domain/survival.ts';
import { applyDamage, playerDamageOnHit, residentSpeed } from '../domain/combat.ts';
import { orderReadyActorsByPriority, resolveSameSpeedGroup, type TieBreakMetrics } from './tie-break.ts';
import { nextPersonalUnsafeNightRiskAt } from './night-risk.ts';
import { locationNameForNode } from '../content/location-names.ts';
import { isNodeCampfireProtected } from '../domain/campfire-safety.ts';
import { dayPhaseAt } from './clock.ts';
import { startingLocationNodeIds } from './world.ts';
import { SeededRandom } from './random.ts';
import type { AreaRiskEntry } from '../domain/surface.ts';
import { resolveSurfaceEntry, resolveSurfaceAction, harvestCoconut, advanceCoconutBeachStocks, advanceNightExplorationStreak, isSurfaceAction, type SurfaceAction, type SurfaceTables } from '../domain/surface.ts';
import { createActiveSurfaceCapabilities, type ActiveSurfaceCapabilities } from '../content/approved-surface-capabilities.ts';
import { nightEnemySourceRow, resolveNightEncounterCheck, selectNightEnemy } from '../domain/night-encounter.ts';
import { chooseLivingTarget, drawAttack, monsterStatsFromSource, parrotCounterattackOnTauntedHit, planBossVictoryRewards, recordBoss2Breakthroughs, resolveScheduledMonsterTurn, selectMementoItemVariant, shouldSummonCompanion } from '../domain/monsters.ts';
import { canRespawnUniqueItem, createDropObject, drawContainerItem, drawMonsterBonusDrop } from '../domain/dungeon.ts';
import { resolveSlimeRetaliation } from '../domain/monsters.ts';
import { resolveGift, resolvePublicMessage } from '../domain/social.ts';
import { selectReadableDocument, type ReadableDocumentPool } from '../domain/document-pools.ts';
import { DUNGEON_ENTRY_CELL_ID, dungeonCellNeighbors, resolveDungeonRuntimeStep } from './dungeon-runtime.ts';
import { allowsDaySurfaceEntryEvents, environmentTerrainForClassification, hasNodeClassificationBehavior } from '../domain/node-classification.ts';
import { canonicalInventoryItemId } from '../domain/item-identity.ts';
import { nextEquipmentUpgrade } from '../domain/equipment-upgrade.ts';

const WAIT_ACTION_COST_T = 1 as const;
const HERO_UNIQUE_ITEM_IDS = ['勇者劍', '勇者盾', '勇者上甲', '勇者下甲'] as const;

export type ActionSettlement =
  | { readonly ok: true; readonly state: WorldState; readonly event: WorldEvent; readonly randomDraws: readonly RandomDraw[] }
  | { readonly ok: false; readonly state: WorldState; readonly unresolved: readonly string[] };

function surfaceActionAvailableAtNode(
  action: SurfaceAction,
  nodeId: string,
  state: WorldState,
  capabilities: ActiveSurfaceCapabilities,
): boolean {
  if (!capabilities.nodeIdsByAction[action].includes(nodeId)) return false;
  const terrain = state.nodes[nodeId]?.surfaceTerrain;
  if (action === 'fishing') return terrain === 'port';
  if (action === 'forest-berry-gather') return terrain === 'berry-forest';
  if (action === 'rock-exploration') return terrain === 'rock';
  return terrain === 'river';
}

function recordResidentHpChanges(previous: WorldState, next: WorldState, event: WorldEvent): WorldEvent {
  const hpChanges = Object.values(previous.actors).flatMap((before) => {
    const after = next.actors[before.id];
    if (before.actorType !== 'resident' || before.hitPoints === undefined || after?.hitPoints === undefined) return [];
    const damage = Math.max(0, before.hitPoints - after.hitPoints);
    return damage > 0 ? [{ actorId: before.id, damage, remainingHp: after.hitPoints }] : [];
  });
  if (hpChanges.length === 0) return event;
  const basePayload = typeof event.payload === 'object' && event.payload !== null && !Array.isArray(event.payload)
    ? event.payload : {};
  return { ...event, payload: { ...basePayload, hpChanges } };
}

export type ScheduledWorldEvent =
  | { readonly kind: 'resident-action'; readonly timeT: number; readonly actorIds: readonly string[]; readonly randomDraws: readonly RandomDraw[]; readonly rngState: string; readonly unresolved: readonly string[] }
  | { readonly kind: 'monster-action'; readonly timeT: number; readonly monsterId: string; readonly unresolved: readonly string[]; readonly randomDraws?: readonly RandomDraw[]; readonly rngState?: string }
  | { readonly kind: 'travel-arrival'; readonly timeT: number; readonly actorId: string }
  | { readonly kind: 'object-expiry'; readonly timeT: number; readonly objectId: string }
  | { readonly kind: 'day-boundary'; readonly timeT: number }
  | { readonly kind: 'sleep-recovery'; readonly timeT: number; readonly actorId: string }
  | { readonly kind: 'personal-sleep-risk-unresolved'; readonly timeT: number; readonly actorId: string; readonly unresolved: readonly string[] };

export interface CorpseActionCosts {
  readonly scavengeT: 1 | 3 | null;
  readonly carryT: 1 | 3 | null;
  readonly dropT: 1 | 3 | null;
}

export interface CorpseActionCostsProposal {
  readonly status: 'approved';
  readonly approvedBy: 'user';
  readonly approvalSource: '2026-10-20 user decision';
  readonly scavengeT: 1;
  readonly carryT: 1;
  readonly dropT: 1;
  readonly rationale: string;
}

/** Proposal only: the Reference classifies item operation as a 1T small action; runtime remains opt-in until reviewed. */
export const CORPSE_ACTION_COSTS_PROPOSAL: CorpseActionCostsProposal = {
  status: 'approved',
  approvedBy: 'user',
  approvalSource: '2026-10-20 user decision',
  scavengeT: 1,
  carryT: 1,
  dropT: 1,
  rationale: '02 classifies item movement and operation as 1T small actions; 08 requires one action per scavenged item and makes carrying distinct from scavenging. Carrying during a map move adds no surcharge.',
};

export const CORPSE_ACTION_COSTS: CorpseActionCosts = {
  scavengeT: CORPSE_ACTION_COSTS_PROPOSAL.scavengeT,
  carryT: CORPSE_ACTION_COSTS_PROPOSAL.carryT,
  dropT: CORPSE_ACTION_COSTS_PROPOSAL.dropT,
};

export interface SimulationActionContent {
  readonly foods: readonly CsvRow[];
  readonly equipment: readonly CsvRow[];
  readonly fishing?: readonly CsvRow[];
  readonly surface?: readonly CsvRow[];
  readonly surfaceEntryEvents?: readonly CsvRow[];
  readonly recovered?: readonly CsvRow[];
  readonly monsters?: readonly CsvRow[];
  readonly attackDistributions?: readonly CsvRow[];
  readonly dungeonEvents?: readonly CsvRow[];
  readonly monsterBonusDrops?: readonly CsvRow[];
  readonly surfaceMonsterDrops?: readonly CsvRow[];
  readonly readableTexts?: Readonly<Record<string, string>>;
  readonly nodeNotices?: readonly CsvRow[];
  readonly containerCategoryWeights?: readonly CsvRow[];
  readonly containerItemSubpools?: readonly CsvRow[];
  readonly containerItemIdentities?: readonly CsvRow[];
  readonly functionalItems?: readonly CsvRow[];
  readonly readableDocumentPools?: readonly CsvRow[];
  readonly readableDocuments?: readonly CsvRow[];
  readonly capabilities?: ActiveSurfaceCapabilities;
}

export interface SimulationTimerOptions {
  readonly sleepRiskTableByNode?: Readonly<Record<string, readonly AreaRiskEntry[] | null>>;
  readonly wildernessNodeIds?: readonly string[];
  readonly monsters?: readonly CsvRow[];
  readonly attackDistributions?: readonly CsvRow[];
  readonly surfaceEntryEvents?: readonly CsvRow[];
  readonly surfaceMonsters?: readonly CsvRow[];
}

export function availableActions(state: WorldState, actorId: string, graph: IslandGraph, corpseCosts: CorpseActionCosts = CORPSE_ACTION_COSTS, actionContent?: SimulationActionContent): readonly ActionDefinition[] {
  const actor = state.actors[actorId];
  if (actor === undefined || !actor.alive || actor.actorType !== 'resident' || actor.nodeId === null || actor.sleeping) return [];
  const actions: ActionDefinition[] = [{
    id: 'wait', type: 'wait', name: '等待', costT: WAIT_ACTION_COST_T, requiresText: false, payload: {}, payloadSchemaKey: 'empty',
  }];
  const decisionTimeT = Math.max(state.worldTimeT, actor.nextActionAtT);
  if (dayPhaseAt(decisionTimeT) === 'night') {
    const wakeAtT = (Math.floor(decisionTimeT / 72) + 1) * 72;
    actions.push({
      id: 'sleep-until-dawn', type: 'sleep', name: '睡到天亮', costT: 1, requiresText: false,
      payload: { wakeAtT }, payloadSchemaKey: 'sleep-until-dawn',
    });
  }
  const node = state.nodes[actor.nodeId];
  if (node === undefined) return actions;
  if (actor.inventory?.includes('普通垃圾') && actionContent?.functionalItems?.some((row) => row.item_id === '普通垃圾' && row.use_effect === 'consume_no_effect')) {
    actions.push({ id: 'use:普通垃圾', type: 'use-garbage', name: '使用普通垃圾', costT: 1, requiresText: false, payload: { itemId: '普通垃圾' }, payloadSchemaKey: 'inventory-item-id' });
  }
  if (actor.inventory?.includes('魔法石') && actor.attack !== undefined && actor.defense !== undefined && actor.hitPoints !== undefined
    && actionContent?.functionalItems?.some((row) => row.item_id === '魔法石' && row.use_effect === 'upgrade_equipped_one_tier')) {
    const equippedIds = [...new Set(Object.values(actor.equipment ?? {}).filter((itemId): itemId is string => typeof itemId === 'string'))];
    const equippedEffectsKnown = equippedIds.every((itemId) => readEquipmentEffect(findEquipment(actionContent, itemId)) !== null);
    for (const [slot, itemId] of Object.entries(actor.equipment ?? {})) {
      if (typeof itemId !== 'string' || !equippedEffectsKnown) continue;
      const effect = readEquipmentEffect(findEquipment(actionContent, itemId));
      const upgraded = readEquipmentUpgrade(actionContent, itemId);
      if (effect === null || upgraded === null || !isEquippedInSlot(actor, slot, itemId, effect.slot)) continue;
      actions.push({
        id: `upgrade:${slot}:${itemId}`, type: 'upgrade-equipment', name: `使用魔法石將${canonicalInventoryItemId(itemId)}升級為${upgraded.itemId}`,
        costT: 1, requiresText: false, payload: { slot, fromItemId: itemId, toItemId: upgraded.itemId }, payloadSchemaKey: 'equipped-item-upgrade',
      });
    }
  }
  if (hasNodeClassificationBehavior(node.surfaceTerrain, 'monumentValley') && actor.dungeonLocation == null) {
    actions.push({ id: 'monument-inscribe', type: 'monument-inscribe', name: '在紀念碑谷立碑並留下碑文', costT: 3, requiresText: true, payload: { poolId: 'monument-valley' }, payloadSchemaKey: 'free-text' });
    if ((state.monumentValleyInscriptionPool?.length ?? 0) > 0) {
      actions.push({ id: 'monument-read', type: 'monument-read', name: '隨機閱讀一則碑文', costT: 1, requiresText: false, payload: { poolId: 'monument-valley' }, payloadSchemaKey: 'document-pool' });
    }
  }
  if (actor.dungeonLocation !== undefined && actor.dungeonLocation !== null) {
    const runtime = state.dungeonRuntime;
    const floor = runtime?.activeFloor ?? actor.dungeonLocation.floor;
    const fromCellId = runtime?.cellByActorId[actor.id] ?? actor.dungeonLocation.cellId;
    if (['A1', 'B1', 'C1'].includes(fromCellId)) {
      actions.push({ id: `dungeon-exit:${fromCellId}`, type: 'dungeon-exit', name: '離開地牢', costT: 3, requiresText: false, payload: { fromCellId }, payloadSchemaKey: 'dungeon-exit' });
    }
    if (actionContent?.dungeonEvents !== undefined) {
      const livingEnemies = Object.values(state.actors).filter((candidate) => candidate.alive
        && candidate.actorType === 'monster' && isSameDungeonLocation(actor, candidate));
      const slimeBlocksRetreat = livingEnemies.some((candidate) => candidate.name === '黏液怪');
      const previousCellId = actor.dungeonRouteHistory?.at(-1);
      const destinations = livingEnemies.length > 0
        ? (!slimeBlocksRetreat && previousCellId !== undefined && dungeonCellNeighbors(floor, fromCellId).includes(previousCellId) ? [previousCellId] : [])
        : dungeonCellNeighbors(floor, fromCellId);
      for (const toCellId of destinations) {
        const retreating = livingEnemies.length > 0;
        actions.push({
          id: `${retreating ? 'dungeon-retreat' : 'dungeon-move'}:${toCellId}`,
          type: retreating ? 'dungeon-retreat' : 'dungeon-move',
          name: `${retreating ? '沿路撤退至' : '深入地牢至'} ${toCellId}`, costT: 3,
          requiresText: false, payload: { fromCellId, toCellId }, payloadSchemaKey: 'dungeon-cell-move',
        });
      }
    }
    for (const target of Object.values(state.actors).filter((candidate) => candidate.id !== actor.id && candidate.alive
      && (candidate.actorType === 'resident' || candidate.actorType === 'monster') && isSameDungeonLocation(actor, candidate)
      && candidate.defense !== undefined && (candidate.hitPoints !== undefined || candidate.name === '大貓爪'))) {
      actions.push({ id: `attack:${target.id}`, type: 'attack', name: `攻擊${target.name ?? target.id}`, costT: 1, requiresText: false, payload: { targetActorId: target.id }, payloadSchemaKey: 'actor-id' });
    }
    const nextFloor = floor + 1;
    const defeatedBoss = state.actors[`boss-${actor.dungeonLocation.tripId}-floor-${floor}`];
    if (fromCellId === 'E' && nextFloor <= (runtime?.unlockedFloorByActorId[actor.id] ?? floor) && defeatedBoss?.alive === false) {
      actions.push({ id: `dungeon-advance-floor:${nextFloor}`, type: 'dungeon-advance-floor', name: `進入第${nextFloor}層`, costT: 3, requiresText: false, payload: { toFloor: nextFloor, toCellId: DUNGEON_ENTRY_CELL_ID }, payloadSchemaKey: 'dungeon-floor-entry' });
    }
    appendReadAndContainerActions(actions, state, actor, actionContent, decisionTimeT);
    return actions;
  }
  if (hasNodeClassificationBehavior(node.surfaceTerrain, 'dungeonEntrance') && actionContent?.dungeonEvents !== undefined) {
    actions.push({
      id: 'dungeon-enter', type: 'dungeon-enter', name: '進入地牢', costT: 3,
      requiresText: false, payload: { toCellId: DUNGEON_ENTRY_CELL_ID }, payloadSchemaKey: 'dungeon-entry',
    });
  }
  if (actionContent !== undefined) {
    const inventory = actor.inventory ?? [];
    if ((actor.hunger ?? 5) < 5) {
      for (const itemId of inventory) {
        const food = actionContent.foods.find((row) => row.name === canonicalInventoryItemId(itemId));
        if (food === undefined || food.name === '龍血' || readFoodEffect(food) === null) continue;
        actions.push({ id: `eat:${itemId}`, type: 'eat', name: `食用${canonicalInventoryItemId(itemId)}`, costT: 1, requiresText: false, payload: { itemId }, payloadSchemaKey: 'inventory-item-id' });
      }
    }
    if (actor.attack !== undefined) {
      for (const itemId of inventory) {
        if (readEquipmentEffect(findEquipment(actionContent, itemId)) !== null) {
          actions.push({ id: `equip:${itemId}`, type: 'equip', name: `裝備${canonicalInventoryItemId(itemId)}`, costT: 1, requiresText: false, payload: { itemId }, payloadSchemaKey: 'inventory-item-id' });
        }
      }
    }
  }
  if ((actor.inventory?.length ?? 0) < 10) {
    for (const object of Object.values(state.objects).filter((candidate) => candidate.objectType !== 'corpse' && candidate.objectType !== 'container' && candidate.placed !== true && candidate.itemId !== null && candidate.nodeId === actor.nodeId && candidate.ownerActorId === null && (candidate.corpseId === undefined || candidate.corpseId === null))) {
      actions.push({ id: `pickup:${object.id}`, type: 'pickup', name: `拾取${object.itemId}`, costT: 1, requiresText: false, payload: { objectId: object.id }, payloadSchemaKey: 'world-object-id' });
    }
  }
  for (const object of Object.values(state.objects).filter((candidate) => candidate.placed === true && candidate.itemId !== null && candidate.nodeId === actor.nodeId && candidate.ownerActorId === null)) {
    actions.push({ id: `destroy-placed:${object.id}`, type: 'destroy-placed', name: `破壞${object.itemId}`, costT: 1, requiresText: false, payload: { objectId: object.id }, payloadSchemaKey: 'world-object-id' });
  }
  appendReadAndContainerActions(actions, state, actor, actionContent, decisionTimeT);
  const inventory = actor.inventory ?? [];
  const readableItems = (actor.readableInventoryItems ?? []).filter(({ itemId }) => inventory.includes(itemId));
  for (const readableItem of readableItems) {
    actions.push({ id: `drop-readable:${readableItem.instanceId}`, type: 'drop', name: `丟下${readableItem.itemId}`, costT: 1, requiresText: false, payload: { itemId: readableItem.itemId, readableInstanceId: readableItem.instanceId }, payloadSchemaKey: 'inventory-item-id' });
  }
  for (const itemId of new Set(inventory)) {
    if (readableItems.filter(({ itemId: readableItemId }) => readableItemId === itemId).length < inventory.filter((id) => id === itemId).length) {
      actions.push({ id: `drop:${itemId}`, type: 'drop', name: `丟下${itemId}`, costT: 1, requiresText: false, payload: { itemId }, payloadSchemaKey: 'inventory-item-id' });
    }
  }
  for (const recipient of Object.values(state.actors).filter((candidate) => candidate.actorType === 'resident' && candidate.alive && candidate.id !== actor.id && candidate.nodeId === actor.nodeId)) {
    actions.push({ id: `message:${recipient.id}`, type: 'message', name: `向${recipient.name ?? recipient.id}公開發訊`, costT: 1, requiresText: true, payload: { recipientActorId: recipient.id }, payloadSchemaKey: 'recipient-message' });
    for (const readableItem of readableItems) {
      actions.push({ id: `gift-readable:${recipient.id}:${readableItem.instanceId}`, type: 'gift', name: `贈送${readableItem.itemId}給${recipient.name ?? recipient.id}`, costT: 1, requiresText: false, payload: { recipientActorId: recipient.id, itemId: readableItem.itemId, readableInstanceId: readableItem.instanceId }, payloadSchemaKey: 'gift-item' });
    }
    for (const itemId of new Set(inventory)) {
      const readableCount = readableItems.filter(({ itemId: readableItemId }) => readableItemId === itemId).length;
      if (readableCount < inventory.filter((id) => id === itemId).length) {
        actions.push({ id: `gift:${recipient.id}:${itemId}`, type: 'gift', name: `贈送${itemId}給${recipient.name ?? recipient.id}`, costT: 1, requiresText: false, payload: { recipientActorId: recipient.id, itemId }, payloadSchemaKey: 'gift-item' });
      }
    }
  }
  const capabilities = actionContent?.capabilities;
  if (capabilities?.runtimeEnabled === true) {
    const nodeActions: readonly [string, SurfaceAction, string][] = [
      ['fishing', 'fishing', '釣魚'],
      ['forest-berry-gather', 'forest-berry-gather', '採野莓'],
      ['rock-exploration', 'rock-exploration', '岩石探索'],
      ['river-exploration', 'river-exploration', '河流探索'],
    ];
    for (const [capability, surfaceAction, label] of nodeActions) {
      const availableHere = surfaceActionAvailableAtNode(surfaceAction, actor.nodeId, state, capabilities);
      if (availableHere) {
        actions.push({ id: `surface:${surfaceAction}`, type: 'surface', name: label, costT: 3, requiresText: false, payload: { surfaceAction }, payloadSchemaKey: 'surface-action' });
      }
    }
    if (dayPhaseAt(decisionTimeT) === 'night' && surfaceActionAvailableAtNode('night-river-dive', actor.nodeId, state, capabilities)) {
      actions.push({ id: 'surface:night-river-dive', type: 'surface', name: '夜間河流潛水', costT: 3, requiresText: false, payload: { surfaceAction: 'night-river-dive' }, payloadSchemaKey: 'surface-action' });
    }
    if (capabilities.nodeIdsByAction['coconut-harvest'].includes(actor.nodeId) && (state.surfaceStocks?.byNode[actor.nodeId] ?? 0) > 0) {
      actions.push({ id: 'harvest-coconut', type: 'harvest-coconut', name: '採集椰子', costT: capabilities.coconut.harvestCostT, requiresText: false, payload: { nodeId: actor.nodeId }, payloadSchemaKey: 'current-node' });
    }
  }
  if (actor.attack !== undefined) {
    for (const target of Object.values(state.actors).filter((candidate) => candidate.id !== actor.id && candidate.alive && (candidate.actorType === 'resident' || candidate.actorType === 'monster') && sameCombatLocation(actor, candidate) && candidate.defense !== undefined && candidate.hitPoints !== undefined)) {
      actions.push({ id: `attack:${target.id}`, type: 'attack', name: `攻擊${target.name ?? target.id}`, costT: 1, requiresText: false, payload: { targetActorId: target.id }, payloadSchemaKey: 'actor-id' });
    }
  }
  if (corpseCosts?.scavengeT !== null && corpseCosts?.scavengeT !== undefined && (actor.inventory?.length ?? 0) < 10) {
    for (const object of Object.values(state.objects).filter((candidate) => candidate.objectType === 'item' && candidate.corpseId !== null && candidate.corpseId !== undefined && candidate.nodeId === actor.nodeId && candidate.ownerActorId === null)) {
      actions.push({
        id: `scavenge-corpse:${object.id}`, type: 'scavenge-corpse', name: '搜刮屍體物品', costT: corpseCosts.scavengeT,
        requiresText: false, payload: { objectId: object.id }, payloadSchemaKey: 'world-object-id',
      });
    }
  }
  if (corpseCosts?.carryT !== null && corpseCosts?.carryT !== undefined && !Object.values(state.objects).some((object) => object.objectType === 'corpse' && object.ownerActorId === actor.id)) {
    for (const corpse of Object.values(state.objects).filter((candidate) => candidate.objectType === 'corpse' && candidate.nodeId === actor.nodeId && candidate.ownerActorId === null)) {
      actions.push({
        id: `carry-corpse:${corpse.id}`, type: 'carry-corpse', name: '搬運屍體', costT: corpseCosts.carryT,
        requiresText: false, payload: { objectId: corpse.id }, payloadSchemaKey: 'world-object-id',
      });
    }
  }
  if (corpseCosts?.dropT !== null && corpseCosts?.dropT !== undefined) {
    for (const corpse of Object.values(state.objects).filter((candidate) => candidate.objectType === 'corpse' && candidate.ownerActorId === actor.id)) {
      actions.push({
        id: `drop-corpse:${corpse.id}`, type: 'drop-corpse', name: '放下屍體', costT: corpseCosts.dropT,
        requiresText: false, payload: { objectId: corpse.id }, payloadSchemaKey: 'world-object-id',
      });
    }
  }
  const neighbors = graph.edges.flatMap(({ source, target }) => source === actor.nodeId ? [target] : target === actor.nodeId ? [source] : []);
  for (const targetNodeId of neighbors) {
    const targetLabel = locationNameForNode(targetNodeId, state.nodes[targetNodeId]?.label);
    actions.push({
      id: `move:${targetNodeId}`, type: 'move', name: `移動至${targetLabel ?? `Node ${targetNodeId}`}`, costT: 3,
      requiresText: false, payload: { toNodeId: targetNodeId }, payloadSchemaKey: 'move-target',
    });
  }
  const previousNodeId = actor.routeHistory?.at(-1);
  const livingMonstersAtNode = Object.values(state.actors).filter((candidate) => candidate.alive && candidate.actorType === 'monster' && candidate.nodeId === actor.nodeId);
  if (previousNodeId !== undefined && livingMonstersAtNode.length > 0) {
    const previousLabel = locationNameForNode(previousNodeId, state.nodes[previousNodeId]?.label);
    actions.push({ id: `retreat:${previousNodeId}`, type: 'retreat', name: `沿原路撤退至${previousLabel ?? `Node ${previousNodeId}`}`, costT: 3, requiresText: false, payload: { toNodeId: previousNodeId }, payloadSchemaKey: 'move-target' });
  }
  return actions;
}

function appendReadAndContainerActions(
  actions: ActionDefinition[], state: WorldState, actor: WorldActor, actionContent: SimulationActionContent | undefined, decisionTimeT: number,
): void {
  for (const object of Object.values(state.objects).filter((candidate) => candidate.objectType !== 'corpse'
    && candidate.objectType !== 'container' && candidate.nodeId === actor.nodeId)) {
    const pool = fixedReadablePoolForItem(object.itemId);
    const hasBoundText = typeof object.readableText === 'string' && object.readableText.trim().length > 0
      && (object.itemId !== '告示牌' || object.readableTextId == null);
    const hasMappedText = typeof object.readableTextId === 'string' && Boolean(mappedReadableTextForItem(actionContent, object.itemId, object.readableTextId)?.trim());
    const hasPoolText = pool !== null && pool !== 'signboard' && readablePoolDocuments(actionContent, pool).length > 0;
    if (!hasBoundText && !hasMappedText && !hasPoolText) continue;
    actions.push({ id: `read:${object.id}`, type: 'read', name: `閱讀${object.itemId ?? '物件'}`, costT: 1, requiresText: false, payload: { objectId: object.id }, payloadSchemaKey: 'world-object-id' });
  }
  for (const item of actor.readableInventoryItems ?? []) {
    if (!(actor.inventory ?? []).includes(item.itemId)) continue;
    const pool = fixedReadablePoolForItem(item.itemId);
    const hasText = (Boolean(item.readableText?.trim()) && (item.itemId !== '告示牌' || item.readableTextId == null))
      || (typeof item.readableTextId === 'string' && Boolean(mappedReadableTextForItem(actionContent, item.itemId, item.readableTextId)?.trim()))
      || (pool !== null && pool !== 'signboard' && readablePoolDocuments(actionContent, pool).length > 0);
    if (!hasText) continue;
    actions.push({ id: `read-inventory:${item.instanceId}`, type: 'read', name: `閱讀背包中的${item.itemId}`, costT: 1, requiresText: false, payload: { readableInstanceId: item.instanceId }, payloadSchemaKey: 'world-object-id' });
  }
  const weights = actionContent?.containerCategoryWeights;
  const subpools = actionContent?.containerItemSubpools;
  const openCostT = 1;
  if (actionContent === undefined || weights === undefined || subpools === undefined) return;
      for (const object of Object.values(state.objects).filter((candidate) => candidate.objectType === 'container'
        && isObjectAtActorLocation(candidate, actor) && candidate.ownerActorId === null
      && (candidate.expiresAtT === null || candidate.expiresAtT > decisionTimeT)
      && typeof candidate.containerSourceId === 'string'
      && weights.some((row) => row.source === candidate.containerSourceId)
      && subpools.some((row) => row.source === candidate.containerSourceId)
      && isContainerPoolMapped(candidate.containerSourceId, weights, subpools, actionContent))) {
    actions.push({ id: `container-open:${object.id}`, type: 'container-open', name: `開啟${object.itemId ?? '容器'}`, costT: openCostT, requiresText: false, payload: { objectId: object.id }, payloadSchemaKey: 'world-object-id' });
  }
}

function isContainerPoolMapped(
  source: string,
  categoryWeights: readonly CsvRow[],
  itemSubpools: readonly CsvRow[],
  content: SimulationActionContent,
): boolean {
  const categoryRows = categoryWeights.filter((row) => row.source === source);
  const itemRows = itemSubpools.filter((row) => row.source === source);
  if (categoryRows.length === 0 || itemRows.length === 0) return false;
  const identities = content.containerItemIdentities ?? [];
  return categoryRows.every((categoryRow) => {
    const category = categoryRow.category;
    if (Number(categoryRow.category_percent) === 0) return true;
    const items = itemRows.filter((row) => row.category === category);
    if (items.length === 0) return false;
    return items.every((row) => {
      const identity = identities.find((candidate) => candidate.source_label === row.item && candidate.category === category);
      if (identity === undefined || typeof identity.inventory_id !== 'string' || identity.inventory_id.length === 0) return false;
      if (category === '食物') return content.foods.some((food) => food.name === identity.inventory_id);
      if (category === '武器' || category === '防具') return content.equipment.some((equipment) => equipment.name_zh === identity.inventory_id);
      if (category === '功能道具') return (content.functionalItems ?? []).some((item) => item.item_id === identity.inventory_id);
      return false;
    });
  });
}

function isObjectAtActorLocation(object: WorldObject, actor: WorldActor): boolean {
  if (actor.dungeonLocation !== undefined && actor.dungeonLocation !== null) {
    const location = object.dungeonLocation;
    return location !== undefined && location !== null
      && location.tripId === actor.dungeonLocation.tripId
      && location.floor === actor.dungeonLocation.floor
      && location.cellId === actor.dungeonLocation.cellId;
  }
  return (object.dungeonLocation === undefined || object.dungeonLocation === null) && object.nodeId === actor.nodeId;
}

export function orderNextResidents(state: WorldState): {
  readonly actionTimeT: number | null;
  readonly actorIds: readonly string[];
  readonly randomDraws: readonly RandomDraw[];
  readonly rngState: string;
  readonly unresolved: readonly string[];
} {
  const living = Object.values(state.actors).filter((actor) => actor.actorType === 'resident' && actor.alive && actor.nodeId !== null && actor.travel == null);
  if (living.length === 0) return { actionTimeT: null, actorIds: [], randomDraws: [], rngState: state.rngState, unresolved: ['No living residents are available to act.'] };
  const actionTimeT = Math.max(state.worldTimeT, Math.min(...living.map((actor) => actor.nextActionAtT)));
  const metrics = new Map<string, TieBreakMetrics>();
  const unresolved: string[] = [];
  for (const actor of living) if (actor.speed === null || actor.speed === undefined) unresolved.push(`Resident ${actor.id} has unresolved current speed.`);
  for (const actor of living) {
    const metric = tieBreakMetrics(actor);
    metrics.set(actor.id, metric);
  }
  if (unresolved.length > 0) return { actionTimeT, actorIds: [], randomDraws: [], rngState: state.rngState, unresolved };
  const schedule = orderReadyActorsByPriority(living.map(toReadyActor), actionTimeT, metrics, state.rngState);
  return {
    actionTimeT,
    actorIds: schedule.actors.map(({ id }) => id),
    randomDraws: schedule.draws,
    rngState: schedule.rngState,
    unresolved: schedule.unresolved,
  };
}

export function nextWorldEvent(state: WorldState): ScheduledWorldEvent {
  const residentOrder = orderNextResidents(state);
  const residentTime = residentOrder.actionTimeT;
  const timers: Array<Extract<ScheduledWorldEvent, { readonly kind: 'travel-arrival' | 'object-expiry' | 'day-boundary' | 'sleep-recovery' | 'personal-sleep-risk-unresolved' }>> = [];
  for (const actor of Object.values(state.actors)) {
    if (actor.alive && actor.travel !== undefined && actor.travel !== null) {
      timers.push({ kind: 'travel-arrival', timeT: actor.travel.arrivesAtT, actorId: actor.id });
    }
  }
  for (const object of Object.values(state.objects)) {
    if (object.expiresAtT !== null) timers.push({ kind: 'object-expiry', timeT: object.expiresAtT, objectId: object.id });
  }
  const nextDayBoundary = (Math.floor(state.worldTimeT / 72) + 1) * 72;
  const hasSleeperDueToWake = state.worldTimeT % 72 === 0 && Object.values(state.actors).some((actor) =>
    actor.alive && actor.actorType === 'resident' && actor.sleeping && actor.nextActionAtT <= state.worldTimeT);
  timers.push({ kind: 'day-boundary', timeT: hasSleeperDueToWake ? state.worldTimeT : nextDayBoundary });
  for (const actor of Object.values(state.actors)) {
    if (actor.alive && actor.actorType === 'resident' && actor.sleeping && actor.sleepingSinceT != null) {
      const dueAtT = Math.max(state.worldTimeT, actor.sleepingSinceT + ((actor.sleepRecoveryBlocks ?? 0) + 1) * 8);
      if (dueAtT <= actor.nextActionAtT) timers.push({ kind: 'sleep-recovery', timeT: dueAtT, actorId: actor.id });
    }
  }
  for (const actor of Object.values(state.actors)) {
    if (!actor.alive || actor.actorType !== 'resident' || actor.unsafeEntryAtT === null || !actor.sleeping || actor.nodeId === null) continue;
    const node = state.nodes[actor.nodeId];
    if (environmentTerrainForClassification(node?.surfaceTerrain) === 'unclassified') continue;
    let dueAtT = nextPersonalUnsafeNightRiskAt(actor.unsafeEntryAtT, state.worldTimeT, true, true);
    while (dueAtT !== null && isNodeCampfireProtected(state, actor.nodeId, dueAtT, actor.dungeonLocation != null)) {
      if (hasPermanentCampfire(state, actor.nodeId, actor.dungeonLocation != null)) {
        dueAtT = null;
        break;
      }
      dueAtT = nextPersonalUnsafeNightRiskAt(actor.unsafeEntryAtT, dueAtT, true, true);
    }
    if (dueAtT === null) continue;
      const unresolved = node?.surfaceTerrain === null || node?.surfaceTerrain === undefined
        ? [`Node ${actor.nodeId} has no source-backed surface terrain classification for the night encounter rate.`]
        : [];
      timers.push({ kind: 'personal-sleep-risk-unresolved', timeT: dueAtT, actorId: actor.id, unresolved });
  }
  const firstTimer = timers.sort((left, right) => left.timeT - right.timeT || timerPriority(left.kind) - timerPriority(right.kind))[0];
  const monsters = Object.values(state.actors).filter((actor) => actor.actorType === 'monster' && actor.alive && actor.nodeId !== null && actor.spawnedAtSequence !== state.sequence);
  const monsterTime = monsters.length === 0 ? null : Math.max(state.worldTimeT, Math.min(...monsters.map(({ nextActionAtT }) => nextActionAtT)));
  const actionTime = residentTime === null ? monsterTime : monsterTime === null ? residentTime : Math.min(residentTime, monsterTime);
  if (firstTimer !== undefined && (actionTime === null || firstTimer.timeT <= actionTime)) {
    if (firstTimer.kind !== 'personal-sleep-risk-unresolved') return firstTimer;
    const unresolved = timers.filter((timer) => timer.kind === 'personal-sleep-risk-unresolved' && timer.timeT === firstTimer.timeT)
      .flatMap((timer) => timer.kind === 'personal-sleep-risk-unresolved' ? timer.unresolved : []);
    return { ...firstTimer, unresolved: [...new Set(unresolved)] };
  }
  if (monsterTime !== null && (residentTime === null || monsterTime < residentTime)) {
    return nextMonsterAction(state, monsters, monsterTime);
  }
  if (monsterTime !== null && residentTime !== null && monsterTime === residentTime) {
      const residentId = residentOrder.actorIds[0];
      const resident = residentId === undefined ? undefined : state.actors[residentId];
      const dueMonsters = monsters.filter((actor) => Math.max(state.worldTimeT, actor.nextActionAtT) === monsterTime);
      const fastestSpeed = Math.max(...dueMonsters.map((actor) => actor.speed ?? Number.NEGATIVE_INFINITY));
      const fastest = dueMonsters.filter((actor) => actor.speed === fastestSpeed);
      if (typeof resident?.speed === 'number' && fastestSpeed > resident.speed) return nextMonsterAction(state, dueMonsters, monsterTime);
      if (typeof resident?.speed === 'number' && fastestSpeed === resident.speed) {
        const monsterPriority = resolveSameSpeedGroup(fastest, new Map(fastest.map((candidate) => [candidate.id, tieBreakMetrics(candidate)])), residentOrder.rngState);
        if (monsterPriority.unresolved.length > 0) return { kind: 'monster-action', timeT: monsterTime, monsterId: fastest[0]?.id ?? '', unresolved: monsterPriority.unresolved };
        const monster = monsterPriority.actors[0];
        if (monster === undefined) return { kind: 'monster-action', timeT: monsterTime, monsterId: '', unresolved: ['No monster is available for a same-time cross-type comparison.'] };
        const priority = resolveSameSpeedGroup([resident!, monster], new Map([[resident!.id, tieBreakMetrics(resident!)], [monster.id, tieBreakMetrics(monster)]]), monsterPriority.rngState);
      if (priority.unresolved.length > 0) return { kind: 'monster-action', timeT: monsterTime, monsterId: monster.id, unresolved: priority.unresolved };
      if (priority.actors[0]?.actorType === 'monster') {
          return { kind: 'monster-action', timeT: monsterTime, monsterId: monster.id, unresolved: [], randomDraws: [...residentOrder.randomDraws, ...monsterPriority.draws, ...priority.draws], rngState: priority.rngState };
      }
        return { kind: 'resident-action', timeT: residentTime!, actorIds: residentOrder.actorIds, randomDraws: [...residentOrder.randomDraws, ...monsterPriority.draws, ...priority.draws], rngState: priority.rngState, unresolved: [] };
      }
  }
  if (residentOrder.unresolved.length > 0) {
    return { kind: 'resident-action', timeT: residentTime ?? state.worldTimeT, actorIds: [], randomDraws: [], rngState: state.rngState, unresolved: residentOrder.unresolved };
  }
  return {
    kind: 'resident-action',
    timeT: residentTime ?? state.worldTimeT,
    actorIds: residentOrder.actorIds,
    randomDraws: residentOrder.randomDraws,
    rngState: residentOrder.rngState,
    unresolved: residentOrder.unresolved,
  };
}

function nextMonsterAction(state: WorldState, dueMonsters: readonly WorldActor[], timeT: number): ScheduledWorldEvent {
  const due = dueMonsters.filter((actor) => Math.max(state.worldTimeT, actor.nextActionAtT) === timeT);
  const missingSpeed = due.find((actor) => actor.speed === null || actor.speed === undefined);
  if (missingSpeed !== undefined) return { kind: 'monster-action', timeT, monsterId: missingSpeed.id, unresolved: [`Monster ${missingSpeed.id} has unresolved speed.`] };
  const fastestSpeed = Math.max(...due.map((actor) => actor.speed ?? Number.NEGATIVE_INFINITY));
  const fastest = due.filter((actor) => actor.speed === fastestSpeed);
  if (fastest.length > 1) {
    const priority = resolveSameSpeedGroup(fastest, new Map(fastest.map((actor) => [actor.id, tieBreakMetrics(actor)])), state.rngState);
    if (priority.unresolved.length > 0) return { kind: 'monster-action', timeT, monsterId: fastest[0]?.id ?? '', unresolved: priority.unresolved };
    return { kind: 'monster-action', timeT, monsterId: priority.actors[0]?.id ?? '', unresolved: [], randomDraws: priority.draws, rngState: priority.rngState };
  }
  return { kind: 'monster-action', timeT, monsterId: fastest[0]!.id, unresolved: [] };
}

function settleNextActionCore(state: WorldState, proposal: ActionProposal, graph: IslandGraph, corpseCosts: CorpseActionCosts = CORPSE_ACTION_COSTS, actionContent?: SimulationActionContent): ActionSettlement {
  const nextEvent = nextWorldEvent(state);
  if (nextEvent.kind !== 'resident-action') {
    const unresolved = nextEvent.kind === 'personal-sleep-risk-unresolved'
      ? nextEvent.unresolved
      : [`World timer ${nextEvent.kind} at T=${nextEvent.timeT} must settle before a resident action.`];
    return { ok: false, state, unresolved };
  }
  const schedule = nextEvent;
  if (schedule.unresolved.length > 0) return { ok: false, state, unresolved: schedule.unresolved };
  const actorId = schedule.actorIds[0];
  if (actorId === undefined || proposal.actorId !== actorId) {
    return { ok: false, state, unresolved: [`Action proposal actor ${proposal.actorId} is not the next scheduled resident (${actorId ?? 'none'}).`] };
  }
  const action = availableActions(state, actorId, graph, corpseCosts, actionContent).find(({ id }) => id === proposal.actionId);
  if (action === undefined) {
    const actor = state.actors[actorId];
    const isDungeonRetreat = proposal.actionId.startsWith('dungeon-retreat:') && actor?.dungeonLocation != null
      && Object.values(state.actors).some((candidate) => candidate.alive && candidate.actorType === 'monster'
        && candidate.name === '黏液怪' && isSameDungeonLocation(actor, candidate));
    if (isDungeonRetreat) return { ok: false, state, unresolved: ['A living slime monster blocks retreat from this dungeon Cell.'] };
    return { ok: false, state, unresolved: [`Action ${proposal.actionId} is not currently legal for ${actorId}.`] };
  }
  if (proposal.timeCostT !== action.costT || !sameJson(proposal.payload, action.payload)) {
    return { ok: false, state, unresolved: [`Action proposal for ${proposal.actionId} does not match the current action definition.`] };
  }
  if (proposal.intent !== undefined && Array.from(proposal.intent).length > 30) {
    return { ok: false, state, unresolved: ['Action intent exceeds the source 30-character limit.'] };
  }
  const actor = state.actors[actorId];
  if (actor === undefined) return { ok: false, state, unresolved: [`Resident ${actorId} is missing from the world snapshot.`] };

  if (action.type === 'monument-inscribe') {
    const text = proposal.text?.trim();
    if (actor.nodeId === null || !hasNodeClassificationBehavior(state.nodes[actor.nodeId]?.surfaceTerrain, 'monumentValley') || actor.dungeonLocation != null || !text || Array.from(text).length > 50) {
      return { ok: false, state, unresolved: ['紀念碑谷碑文必須在地表紀念碑谷分類的地點提供 1–50 字模型文字。'] };
    }
    const sequence = state.sequence + 1;
    const inscription = {
      id: `monument-valley-${sequence}-${actor.id}`,
      poolId: 'monument-valley' as const,
      text,
      authorActorId: actor.id,
      createdAtT: schedule.timeT,
    };
    const event: WorldEvent = {
      eventId: `action-${sequence}-${actor.id}`, sequence, worldTimeT: schedule.timeT,
      actorId: actor.id, nodeId: actor.nodeId, kind: 'monument-inscription-written', visibility: 'public',
      payload: { poolId: inscription.poolId, inscriptionId: inscription.id, authorActorId: actor.id, text },
      randomDraws: schedule.randomDraws,
    };
    return {
      ok: true,
      state: {
        ...state, sequence, worldTimeT: schedule.timeT, rngState: schedule.rngState,
        monumentValleyInscriptionPool: [...(state.monumentValleyInscriptionPool ?? []), inscription],
        actors: { ...state.actors, [actor.id]: { ...actor, nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id, lastActionResult: '在紀念碑谷留下碑文' } },
        ...(proposal.intent === undefined ? {} : {
          privateLifeData: {
            ...state.privateLifeData,
            [actor.id]: { intents: [...(state.privateLifeData?.[actor.id]?.intents ?? []), proposal.intent], biographyStatus: 'active' as const },
          },
        }),
      },
      event,
      randomDraws: schedule.randomDraws,
    };
  }

  if (action.type === 'monument-read') {
    if (actor.nodeId === null || !hasNodeClassificationBehavior(state.nodes[actor.nodeId]?.surfaceTerrain, 'monumentValley') || actor.dungeonLocation != null) {
      return { ok: false, state, unresolved: ['紀念碑谷碑文只能在地表紀念碑谷分類的地點閱讀。'] };
    }
    const inscriptions = (state.monumentValleyInscriptionPool ?? []).map(({ id, poolId, text }) => ({ id, pool: poolId, text }));
    const random = new SeededRandom(schedule.rngState);
    const draw = random.next(`monument-valley-read:${actor.id}`);
    const selected = selectReadableDocument(inscriptions, 'monument-valley', draw.value);
    if (!selected) return { ok: false, state, unresolved: ['紀念碑谷碑文池目前沒有內容。'] };
    const inscription = state.monumentValleyInscriptionPool?.find(({ id }) => id === selected.id);
    if (!inscription) return { ok: false, state, unresolved: ['抽中的碑文無法對應回本局碑文池。'] };
    const sequence = state.sequence + 1;
    const event: WorldEvent = {
      eventId: `action-${sequence}-${actor.id}`, sequence, worldTimeT: schedule.timeT,
      actorId: actor.id, nodeId: actor.nodeId, kind: 'monument-inscription-read', visibility: 'public',
      payload: { poolId: inscription.poolId, inscriptionId: inscription.id, authorActorId: inscription.authorActorId, text: inscription.text },
      randomDraws: [...schedule.randomDraws, draw],
    };
    return {
      ok: true,
      state: {
        ...state, sequence, worldTimeT: schedule.timeT, rngState: random.stateHex,
        actors: { ...state.actors, [actor.id]: { ...actor, nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id, lastActionResult: '讀到一則紀念碑谷碑文' } },
      },
      event,
      randomDraws: event.randomDraws,
    };
  }

  if (action.type === 'container-open') {
    const objectId = readObjectId(action.payload);
    const container = objectId === null ? undefined : state.objects[objectId];
    const inventory = actor.inventory ?? [];
    const source = container?.containerSourceId;
    const categoryWeights = actionContent?.containerCategoryWeights;
    const itemSubpools = actionContent?.containerItemSubpools;
    if (actionContent === undefined || !container || container.objectType !== 'container' || !isObjectAtActorLocation(container, actor) || container.ownerActorId !== null
      || typeof source !== 'string'
        || categoryWeights === undefined || itemSubpools === undefined
        || (container.expiresAtT !== null && container.expiresAtT <= schedule.timeT)
        || !categoryWeights.some((row) => row.source === source) || !itemSubpools.some((row) => row.source === source)
        || !isContainerPoolMapped(source, categoryWeights, itemSubpools, actionContent)) {
        return { ok: false, state, unresolved: ['Open-container settlement requires a same-location unexpired container with a fully mapped source pool.'] };
    }
    const random = new SeededRandom(schedule.rngState);
    const draw = drawContainerItem({ source, categoryWeights, subpools: itemSubpools, random });
    const identity = actionContent?.containerItemIdentities?.find((candidate) => candidate.source_label === draw.item && candidate.category === draw.category);
    const itemId = identity?.inventory_id;
    if (typeof itemId !== 'string' || itemId.length === 0) return { ok: false, state, unresolved: [`Container source label ${draw.item} has no stable inventory identity.`] };
    const unique = HERO_UNIQUE_ITEM_IDS.includes(itemId as (typeof HERO_UNIQUE_ITEM_IDS)[number]);
    const remainingObjects = { ...state.objects };
    delete remainingObjects[container.id];
    const heldUniqueItemIds = Object.values(state.actors).flatMap((candidate) => [
      ...(candidate.inventory ?? []), ...Object.values(candidate.equipment ?? {}).filter((item): item is string => item !== null),
    ]);
    if (unique && !canRespawnUniqueItem(itemId, Object.values(remainingObjects), heldUniqueItemIds, schedule.timeT)) {
      return { ok: false, state, unresolved: [`Unique container reward ${itemId} already exists; no container contents were committed.`] };
    }
    const sequence = state.sequence + 1;
    const overflowObjectId = inventory.length >= 10 ? `action-${sequence}-${actor.id}:container-item` : null;
    if (overflowObjectId !== null && remainingObjects[overflowObjectId] !== undefined) {
      return { ok: false, state, unresolved: [`Container overflow object ID ${overflowObjectId} already exists.`] };
    }
    const uniqueOwnerByItemId = { ...(state.uniqueOwnerByItemId ?? {}) };
    if (unique) {
      if (overflowObjectId === null) uniqueOwnerByItemId[itemId] = actor.id;
      else delete uniqueOwnerByItemId[itemId];
    }
    const event: WorldEvent = {
      eventId: `action-${sequence}-${actor.id}`, sequence, worldTimeT: schedule.timeT,
      actorId: actor.id, nodeId: actor.nodeId, kind: 'container-opened', visibility: 'public',
      payload: {
        containerId: container.id, containerName: container.itemId, source, category: draw.category,
        itemId, sourceItemLabel: draw.item, overflowObjectId, provisional: draw.provisional, status: draw.status, timeCostT: action.costT,
      },
      randomDraws: [...schedule.randomDraws, ...draw.randomDraws],
    };
    return {
      ok: true,
      state: {
        ...state, sequence, worldTimeT: schedule.timeT, rngState: draw.rngStateAfter,
        actors: { ...state.actors, [actor.id]: {
          ...actor, inventory: overflowObjectId === null ? [...inventory, itemId] : inventory, nextActionAtT: schedule.timeT + action.costT,
          lastActionId: action.id, lastActionResult: overflowObjectId === null ? `從${container.itemId ?? '容器'}取得${draw.item}` : `${draw.item}已掉落在目前位置`,
        } },
        objects: overflowObjectId === null ? remainingObjects : { ...remainingObjects, [overflowObjectId]: {
          ...createDropObject({ id: overflowObjectId, itemId, nodeId: actor.nodeId, generatedAtT: schedule.timeT, unique, provisional: draw.provisional }),
          objectType: 'item', dungeonLocation: actor.dungeonLocation ?? null,
        } },
        ...(unique ? { uniqueOwnerByItemId } : {}),
      },
      event, randomDraws: event.randomDraws,
    };
  }

  if (action.type === 'read') {
    const objectId = readString(action.payload, 'objectId');
    const object = objectId === null ? undefined : state.objects[objectId];
    const readableInstanceId = readString(action.payload, 'readableInstanceId');
    const carriedItem = readableInstanceId === null ? undefined : actor.readableInventoryItems?.find(({ instanceId }) => instanceId === readableInstanceId);
    const itemId = object?.itemId ?? carriedItem?.itemId ?? null;
    const pool = fixedReadablePoolForItem(itemId);
    const mappedText = carriedItem?.readableTextId == null
      ? (object?.readableTextId == null ? undefined : mappedReadableTextForItem(actionContent, itemId, object.readableTextId))
      : mappedReadableTextForItem(actionContent, itemId, carriedItem.readableTextId);
    let text = itemId === '告示牌' && (carriedItem?.readableTextId ?? object?.readableTextId) != null
      ? mappedText
      : typeof carriedItem?.readableText === 'string' && carriedItem.readableText.trim()
        ? carriedItem.readableText
        : typeof object?.readableText === 'string' && object.readableText.trim() ? object.readableText : mappedText;
    let textId = carriedItem?.readableTextId ?? object?.readableTextId ?? null;
    const drawIdentity = carriedItem?.instanceId ?? object?.id ?? null;
    let readRandomDraws: readonly RandomDraw[] = schedule.randomDraws;
    let readRngState = schedule.rngState;
    if (drawIdentity !== null && (typeof text !== 'string' || !text.trim()) && pool !== null && pool !== 'signboard') {
      const random = new SeededRandom(schedule.rngState);
      const draw = random.next(`readable-document:${pool}:${drawIdentity}`);
      const selected = selectReadableDocument(readablePoolDocuments(actionContent, pool), pool, draw.value);
      if (selected !== null) {
        text = selected.text;
        textId = selected.id;
        readRandomDraws = [...schedule.randomDraws, draw];
        readRngState = random.stateHex;
      }
    }
    const validGroundObject = object !== undefined && object.nodeId === actor.nodeId && object.ownerActorId === null
      && object.objectType !== 'corpse' && object.objectType !== 'container';
    const validCarriedItem = carriedItem !== undefined && (actor.inventory ?? []).includes(carriedItem.itemId);
    if ((!validGroundObject && !validCarriedItem)
      || typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, state, unresolved: ['Read action requires a readable ground object or carried readable item with bound text or an available matching text pool.'] };
    }
    const sequence = state.sequence + 1;
    const event: WorldEvent = {
      eventId: `action-${sequence}-${actor.id}`, sequence, worldTimeT: schedule.timeT,
      actorId: actor.id, nodeId: actor.nodeId, kind: 'object-read', visibility: 'public',
      payload: { objectId: drawIdentity, itemId, ...(carriedItem === undefined ? {} : { heldByActorId: actor.id }), ...(textId === null ? {} : { documentId: textId }), text }, randomDraws: readRandomDraws,
    };
    const updatedObjects = validGroundObject && pool !== null && pool !== 'signboard'
      ? { ...state.objects, [object!.id]: { ...object!, readableTextId: textId, readableText: text } }
      : state.objects;
    const updatedReadableInventoryItems: readonly ReadableInventoryItem[] | undefined = validCarriedItem
      ? (actor.readableInventoryItems ?? []).map((item) => item.instanceId === carriedItem!.instanceId
        ? { ...item, readableTextId: textId, readableText: text } : item)
      : actor.readableInventoryItems;
    return {
      ok: true,
      state: {
        ...state, sequence, worldTimeT: schedule.timeT, rngState: readRngState,
        ...(updatedObjects === state.objects ? {} : { objects: updatedObjects }),
        actors: { ...state.actors, [actor.id]: { ...actor, ...(updatedReadableInventoryItems === undefined ? {} : { readableInventoryItems: updatedReadableInventoryItems }), nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id, lastActionResult: '已閱讀物件內容' } },
      },
      event, randomDraws: readRandomDraws,
    };
  }

  if (action.type === 'surface') {
    const surfaceAction = readString(action.payload, 'surfaceAction');
    const nodeId = actor.nodeId;
    if (surfaceAction === null || nodeId === null || actionContent?.capabilities?.runtimeEnabled !== true
      || actionContent.fishing === undefined || actionContent.surface === undefined || actionContent.recovered === undefined) {
      return { ok: false, state, unresolved: ['Surface action requires the active node crosswalk and complete source action tables.'] };
    }
    if (!isSurfaceAction(surfaceAction)) return { ok: false, state, unresolved: [`Unsupported surface action ${surfaceAction}.`] };
    if (!surfaceActionAvailableAtNode(surfaceAction, nodeId, state, actionContent.capabilities)) {
      return { ok: false, state, unresolved: [`${surfaceAction} is not available at Node ${nodeId} in the active map profile.`] };
    }
    const tables: SurfaceTables = {
      fishing: actionContent.fishing, surface: actionContent.surface, recovered: actionContent.recovered,
      ...(actionContent.monsters === undefined ? {} : { monsters: actionContent.monsters }),
    };
    const objectId = `surface-item-${state.sequence + 1}-${actor.id}`;
    const existingUniqueItems = [
      ...Object.values(state.objects)
        .filter((object) => object.unique && object.itemId !== null && (object.expiresAtT === null || object.expiresAtT > schedule.timeT))
        .map((object) => object.itemId as string),
      ...Object.values(state.actors).flatMap((worldActor) => [
        ...(worldActor.inventory ?? []),
        ...Object.values(worldActor.equipment ?? {}).filter((itemId): itemId is string => itemId !== null),
      ]),
    ];
    const result = resolveSurfaceAction({
      action: surfaceAction,
      actor: { id: actor.id, hitPoints: actor.hitPoints ?? 0, hunger: actor.hunger ?? 0, sleep: actor.sleep ?? 0, inventory: actor.inventory ?? [] },
      nodeId,
      worldTimeT: schedule.timeT,
      phase: dayPhaseAt(schedule.timeT),
      actionAvailableAtNode: surfaceActionAvailableAtNode(surfaceAction, nodeId, state, actionContent.capabilities),
      randomState: schedule.rngState,
      tables,
      existingUniqueItems,
      objectId,
    });
    if (result.timeCostT !== action.costT) return { ok: false, state, unresolved: result.unresolved.map(({ detail }) => detail).concat(`Surface action resolved with ${result.timeCostT}T but its legal definition costs ${action.costT}T.`) };
    const sequence = state.sequence + 1;
    const newObjects = { ...state.objects, ...Object.fromEntries(result.createdObjects.map((object) => [object.id, object])) };
    const encounterRow = result.spawnMonsterName === null ? undefined : actionContent.monsters?.find((row) => row.name === result.spawnMonsterName && row.region === 'surface');
    const encounterStats = encounterRow === undefined ? null : monsterStatsFromSource(encounterRow);
    const spawnedActionMonster: WorldActor | null = encounterStats !== null && encounterStats.hitPoints !== null && encounterStats.defense !== null && encounterStats.speed !== null
      ? { id: `surface-action-monster-${sequence}-${actor.id}`, actorType: 'monster', alive: true, nodeId, nextActionAtT: schedule.timeT, spawnedAtSequence: sequence, speed: encounterStats.speed, unsafeEntryAtT: schedule.timeT, travel: null, sleeping: false, hitPoints: encounterStats.hitPoints, attack: 0, defense: encounterStats.defense, name: encounterStats.name, encounterId: `encounter-${sequence}-${actor.id}` }
      : null;
    const hpBefore = actor.hitPoints ?? 0;
    const hitPoints = Math.max(0, hpBefore + (result.actorDelta.hitPoints ?? 0));
    const alive = hitPoints > 0;
    let streakAction: 'night-river-dive' | 'rock-exploration' | null = null;
    let streakCount = 0;
    if (surfaceAction === 'night-river-dive' || surfaceAction === 'rock-exploration') {
      const streak = advanceNightExplorationStreak({
        action: dayPhaseAt(schedule.timeT) === 'night' ? surfaceAction : null,
        previousAction: actor.nightExplorationStreakAction ?? null,
        previousCount: actor.nightExplorationStreakCount ?? 0,
        uninterrupted: actor.lastActionId === `surface:${surfaceAction}`,
        phase: dayPhaseAt(schedule.timeT), actorId: actor.id, nodeId, worldTimeT: schedule.timeT,
        existingUniqueItems: [...existingUniqueItems, ...(actor.inventory ?? [])],
        rewardObjectId: `surface-hero-reward-${sequence}-${actor.id}`,
      });
      streakAction = streak.rewardItemId === null ? (streak.consecutiveCount > 0 ? surfaceAction : null) : surfaceAction;
      streakCount = streak.consecutiveCount;
      if (streak.rewardObject !== null) newObjects[streak.rewardObject.id] = streak.rewardObject;
    }
    const updatedActor: WorldActor = {
      ...actor,
      alive,
      hitPoints,
      hunger: Math.max(0, (actor.hunger ?? 0) + (result.actorDelta.hunger ?? 0)),
      sleep: Math.max(0, (actor.sleep ?? 0) + (result.actorDelta.sleep ?? 0)),
      inventory: result.actorDelta.inventory ?? actor.inventory ?? [],
      nextActionAtT: schedule.timeT + action.costT,
      lastActionId: action.id,
      lastActionResult: result.outcome,
      nightExplorationStreakAction: streakAction,
      nightExplorationStreakCount: streakCount,
      ...(!alive ? { diedAtT: schedule.timeT, nodeId: null, sleeping: false, sleepingSinceT: null, inventory: [], equipment: {} } : {}),
    };
    let privateLifeData = state.privateLifeData;
    if (!alive) {
      const corpseId = `corpse-${actor.id}-${sequence}`;
      newObjects[corpseId] = { id: corpseId, itemId: null, objectType: 'corpse', remainsActorId: actor.id, ownerActorId: null, nodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: false, provisional: false };
      [...(actor.inventory ?? []), ...Object.values(actor.equipment ?? {}).filter((item): item is string => item !== null)].forEach((itemId, index) => {
        const droppedId = `corpse-loot-${actor.id}-${sequence}-${index + 1}`;
        newObjects[droppedId] = { id: droppedId, itemId, objectType: 'item', corpseId, ownerActorId: null, nodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: isUniqueHeroItem(itemId), provisional: false };
      });
      privateLifeData = { ...state.privateLifeData, [actor.id]: { intents: state.privateLifeData?.[actor.id]?.intents ?? [], biographyStatus: 'pending' } };
    }
    const payload: JsonValue = {
      action: surfaceAction, outcome: result.outcome, actorDelta: result.actorDelta,
      uniqueItemAlreadyExists: result.uniqueItemAlreadyExists, spawnMonsterName: result.spawnMonsterName, spawnedMonsterId: spawnedActionMonster?.id ?? null,
      unresolved: result.unresolved.map(({ sourceId, detail }) => ({ sourceId, detail })),
      randomDraws: result.randomDraws.map(({ sourceId, stateBefore, stateAfter, value }) => ({ sourceId, stateBefore, stateAfter, value })), nightExplorationStreak: { action: streakAction, count: streakCount },
      createdObjectIds: result.createdObjects.map(({ id }) => id),
    };
    const event: WorldEvent = {
      eventId: `action-${sequence}-${actor.id}`, sequence, worldTimeT: schedule.timeT, actorId: actor.id, nodeId,
      kind: result.events[0]?.kind ?? 'surface-action-resolved', visibility: result.events[0]?.visibility ?? 'player-only',
      payload, randomDraws: [...schedule.randomDraws, ...result.randomDraws],
    };
    return { ok: true, state: {
      ...state, sequence, worldTimeT: schedule.timeT, rngState: result.rngStateAfter,
      actors: { ...state.actors, [actor.id]: updatedActor, ...(spawnedActionMonster === null ? {} : { [spawnedActionMonster.id]: spawnedActionMonster }) }, objects: newObjects,
      ...(privateLifeData === undefined ? {} : { privateLifeData }),
      ...(proposal.intent === undefined ? {} : { privateLifeData: { ...privateLifeData, [actor.id]: { intents: [...(privateLifeData?.[actor.id]?.intents ?? []), proposal.intent], biographyStatus: 'active' as const } } }),
      unresolved: [...(state.unresolved ?? []), ...result.unresolved.map(({ sourceId, detail }) => ({ sourceId, detail }))],
    }, event, randomDraws: [...schedule.randomDraws, ...result.randomDraws] };
  }

  if (action.type === 'harvest-coconut') {
    if (actionContent?.capabilities?.runtimeEnabled !== true || state.surfaceStocks === undefined || actor.nodeId === null) return { ok: false, state, unresolved: ['Coconut harvest requires approved capabilities and initialized persistent beach stocks.'] };
    const result = harvestCoconut({
      beachNodeIds: actionContent.capabilities.coconut.nodeIds,
      nodeId: actor.nodeId,
      stockByNode: state.surfaceStocks.byNode,
      inventory: actor.inventory ?? [], inventoryCapacity: 10, worldTimeT: schedule.timeT,
      objectId: `coconut-${state.sequence + 1}-${actor.id}`,
    });
    if (!result.harvested) return { ok: false, state, unresolved: result.unresolved.map(({ detail }) => detail).concat('No coconut stock is available at this Node.') };
    const sequence = state.sequence + 1;
    const event: WorldEvent = {
      eventId: `action-${sequence}-${actor.id}`, sequence, worldTimeT: schedule.timeT, actorId: actor.id, nodeId: actor.nodeId,
      kind: 'coconut-harvested', visibility: 'public', payload: { itemId: '椰子', stockAfter: result.stocks[actor.nodeId] ?? 0, createdObjectIds: result.createdObjects.map(({ id }) => id), timeCostT: action.costT },
      randomDraws: schedule.randomDraws,
    };
    return { ok: true, state: {
      ...state, sequence, worldTimeT: schedule.timeT, rngState: schedule.rngState,
      actors: { ...state.actors, [actor.id]: { ...actor, inventory: result.inventory, nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id } },
      objects: { ...state.objects, ...Object.fromEntries(result.createdObjects.map((object) => [object.id, object])) },
      surfaceStocks: { ...state.surfaceStocks, byNode: result.stocks },
    }, event, randomDraws: schedule.randomDraws };
  }

  if (action.type === 'use-garbage') {
    const itemId = readString(action.payload, 'itemId');
    const inventory = actor.inventory ?? [];
    const itemIndex = inventory.indexOf('普通垃圾');
    if (itemId !== '普通垃圾' || itemIndex < 0 || !actionContent?.functionalItems?.some((row) => row.item_id === itemId && row.use_effect === 'consume_no_effect')) {
      return { ok: false, state, unresolved: ['Ordinary garbage is no longer available for use.'] };
    }
    const updatedActor = { ...actor, inventory: inventory.filter((_, index) => index !== itemIndex), nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id };
    return settleActionRecord(state, schedule, actor, updatedActor, action.id, 'item-used', { itemId, effect: 'none', timeCostT: action.costT }, undefined, proposal.intent);
  }

  if (action.type === 'eat') {
    const itemId = readString(action.payload, 'itemId');
    const food = itemId === null ? undefined : actionContent?.foods.find((row) => row.name === canonicalInventoryItemId(itemId));
    const effect = food === undefined ? null : readFoodEffect(food);
    if (itemId === null || effect === null || itemId === '龍血') return { ok: false, state, unresolved: [`Food item for ${action.id} is not available from the current source catalog.`] };
    const inventory = actor.inventory ?? [];
    const itemIndex = inventory.indexOf(itemId);
    if (itemIndex < 0) return { ok: false, state, unresolved: [`Resident ${actorId} no longer carries ${itemId}.`] };
    const foodResult = applyFood({ hitPoints: actor.hitPoints ?? 0, hunger: actor.hunger ?? 5, sleep: actor.sleep ?? 0, inventory: [] }, effect);
    if (!foodResult.accepted) return { ok: false, state, unresolved: [`Resident ${actorId} cannot eat ${itemId} in the current state.`] };
    const nextInventory = inventory.filter((_, index) => index !== itemIndex);
    const died = foodResult.vitals.hitPoints === 0;
    const sequence = state.sequence + 1;
    let objects = state.objects;
    if (died && actor.nodeId !== null) {
      const corpseId = `corpse-${actor.id}-${sequence}`;
      const droppedItems = [...nextInventory, ...Object.values(actor.equipment ?? {}).filter((value): value is string => value !== null)];
      objects = {
        ...objects,
        [corpseId]: { id: corpseId, itemId: null, objectType: 'corpse', remainsActorId: actor.id, ownerActorId: null, nodeId: actor.nodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: false, provisional: false },
        ...Object.fromEntries(droppedItems.map((droppedItemId, index) => {
          const objectId = `corpse-loot-${actor.id}-${sequence}-${index + 1}`;
          return [objectId, { id: objectId, itemId: droppedItemId, objectType: 'item' as const, corpseId, ownerActorId: null, nodeId: actor.nodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: isUniqueHeroItem(droppedItemId), provisional: false }];
        })),
        ...Object.fromEntries(Object.values(objects).filter((object) => object.ownerActorId === actor.id
          && (object.objectType === 'corpse' || object.corpseId !== null && object.corpseId !== undefined))
          .map((object) => [object.id, { ...object, ownerActorId: null, nodeId: actor.nodeId }])),
      };
    }
    const updatedActor = {
      ...actor,
      hitPoints: foodResult.vitals.hitPoints,
      alive: !died,
      ...(died ? { diedAtT: schedule.timeT, nodeId: null, sleeping: false, sleepingSinceT: null, inventory: [], equipment: {} } : { inventory: nextInventory }),
      hunger: foodResult.vitals.hunger,
      sleep: foodResult.vitals.sleep,
      nextActionAtT: schedule.timeT + action.costT,
      lastActionId: action.id,
    };
    const settled = settleActionRecord(state, schedule, actor, updatedActor, action.id, 'resident-ate', { itemId, timeCostT: action.costT }, objects, died ? undefined : proposal.intent);
    if (!died) return settled;
    return {
      ...settled,
      state: {
        ...settled.state,
        privateLifeData: {
          ...state.privateLifeData,
          [actor.id]: {
            intents: [...(state.privateLifeData?.[actor.id]?.intents ?? []), ...(proposal.intent === undefined ? [] : [proposal.intent])],
            biographyStatus: 'pending',
          },
        },
      },
    };
  }

  if (action.type === 'pickup') {
    const objectId = readObjectId(action.payload);
    const object = objectId === null ? undefined : state.objects[objectId];
    const inventory = actor.inventory ?? [];
    if (object === undefined || object.placed === true || object.objectType === 'corpse' || object.itemId === null || object.nodeId !== actor.nodeId || object.ownerActorId !== null || (object.corpseId !== undefined && object.corpseId !== null)) {
      return { ok: false, state, unresolved: [`Ground item ${objectId ?? '(missing)'} is no longer available at the resident's Node.`] };
    }
    if (inventory.length >= 10) return { ok: false, state, unresolved: [`Resident ${actorId} has no free inventory slot.`] };
    const objects = { ...state.objects };
    delete objects[object.id];
    const pool = fixedReadablePoolForItem(object.itemId);
    const hasReadableBinding = pool !== null || typeof object.readableText === 'string' || typeof object.readableTextId === 'string';
    const readableInventoryItems = hasReadableBinding
      ? [...(actor.readableInventoryItems ?? []).filter(({ instanceId }) => instanceId !== object.id), {
        instanceId: object.id, itemId: object.itemId,
        ...(object.readableTextId == null ? {} : { readableTextId: object.readableTextId }),
        ...(object.readableText == null ? {} : { readableText: object.readableText }),
      }]
      : actor.readableInventoryItems;
    const updatedActor = { ...actor, inventory: [...inventory, object.itemId], ...(readableInventoryItems === undefined ? {} : { readableInventoryItems }), nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id };
    return settleActionRecord(state, schedule, actor, updatedActor, action.id, 'item-picked-up', { objectId: object.id, itemId: object.itemId, timeCostT: action.costT }, objects, proposal.intent);
  }

  if (action.type === 'destroy-placed') {
    const objectId = readObjectId(action.payload);
    const object = objectId === null ? undefined : state.objects[objectId];
    if (object === undefined || object.placed !== true || object.nodeId !== actor.nodeId || object.ownerActorId !== null) {
      return { ok: false, state, unresolved: ['Only a placed scene object at the resident current Node can be destroyed.'] };
    }
    const objects = { ...state.objects };
    delete objects[object.id];
    const updatedActor = { ...actor, nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id };
    const destroyedNoticeKey = object.managedBy === 'node-notices' && object.managedNoticeKey ? object.managedNoticeKey : undefined;
    return settleActionRecord(state, schedule, actor, updatedActor, action.id, 'scene-object-destroyed', { objectId: object.id, itemId: object.itemId, timeCostT: action.costT }, objects, proposal.intent, destroyedNoticeKey);
  }

  if (action.type === 'drop') {
    const itemId = readString(action.payload, 'itemId');
    const readableInstanceId = readString(action.payload, 'readableInstanceId');
    const inventory = actor.inventory ?? [];
    const readableItem = readableInstanceId === null ? undefined : actor.readableInventoryItems?.find((item) => item.instanceId === readableInstanceId && item.itemId === itemId);
    const itemIndex = itemId === null ? -1 : inventory.indexOf(itemId);
    if (itemId === null || itemIndex < 0 || actor.nodeId === null) return { ok: false, state, unresolved: [`Resident ${actorId} no longer carries the item to drop.`] };
    const sequence = state.sequence + 1;
    const unique = HERO_UNIQUE_ITEM_IDS.includes(itemId as (typeof HERO_UNIQUE_ITEM_IDS)[number]);
    const objectId = `drop-${sequence}-${actorId}`;
    const object: WorldState['objects'][string] = {
      id: objectId, itemId, objectType: 'item', remainsActorId: null, corpseId: null, ownerActorId: null, nodeId: actor.nodeId,
      generatedAtT: schedule.timeT, expiresAtT: unique ? null : schedule.timeT + 72, unique, provisional: false,
      ...(readableItem?.readableTextId == null ? {} : { readableTextId: readableItem.readableTextId }),
      ...(readableItem?.readableText == null ? {} : { readableText: readableItem.readableText }),
    };
    const readableInventoryItems = readableItem === undefined
      ? actor.readableInventoryItems
      : (actor.readableInventoryItems ?? []).filter(({ instanceId }) => instanceId !== readableItem.instanceId);
    const updatedActor = {
      ...actor,
      inventory: inventory.filter((_, index) => index !== itemIndex),
      ...(readableInventoryItems === undefined ? {} : { readableInventoryItems }),
      nextActionAtT: schedule.timeT + action.costT,
      lastActionId: action.id,
    };
    return settleActionRecord(state, schedule, actor, updatedActor, action.id, 'item-dropped', { objectId, itemId, timeCostT: action.costT }, { ...state.objects, [objectId]: object }, proposal.intent);
  }

  if (action.type === 'gift') {
    const itemId = readString(action.payload, 'itemId');
    const recipientId = readString(action.payload, 'recipientActorId');
    const readableInstanceId = readString(action.payload, 'readableInstanceId');
    const recipient = recipientId === null ? undefined : state.actors[recipientId];
    if (itemId === null || recipient === undefined) return { ok: false, state, unresolved: ['Gift action is missing its item or recipient.'] };
    const giftedReadableItem = readableInstanceId === null ? undefined : actor.readableInventoryItems?.find((item) => item.instanceId === readableInstanceId && item.itemId === itemId);
    if (readableInstanceId !== null && (!giftedReadableItem || !(actor.inventory ?? []).includes(itemId))) {
      return { ok: false, state, unresolved: ['The selected readable item is no longer in the giver inventory.'] };
    }
    const uniqueOwnerByItemId: Record<string, string> = { ...(state.uniqueOwnerByItemId ?? {}) };
    for (const uniqueItemId of HERO_UNIQUE_ITEM_IDS) {
      const owners = Object.values(state.actors).filter((candidate) =>
        (candidate.inventory ?? []).includes(uniqueItemId) || Object.values(candidate.equipment ?? {}).includes(uniqueItemId));
      if (owners.length === 1) uniqueOwnerByItemId[uniqueItemId] = owners[0]!.id;
      else delete uniqueOwnerByItemId[uniqueItemId];
    }
    const result = resolveGift({
      giver: actor, recipient, itemId, worldTimeT: schedule.timeT,
      uniqueItemIds: HERO_UNIQUE_ITEM_IDS,
      uniqueOwnerByItemId,
    });
    if (result.unresolved.length > 0) return { ok: false, state, unresolved: result.unresolved.map(({ detail }) => detail) };
    const sequence = state.sequence + 1;
    const eventDraft = result.events[0];
    if (eventDraft === undefined) return { ok: false, state, unresolved: ['Gift resolver returned no event for a successful transfer.'] };
    const actors = { ...state.actors };
    for (const [id, inventory] of Object.entries(result.inventoryByActorId)) {
      const current = state.actors[id];
      if (current === undefined) return { ok: false, state, unresolved: [`Gift recipient ${id} disappeared before settlement.`] };
      const readableInventoryItems = giftedReadableItem === undefined
        ? current.readableInventoryItems
        : id === actor.id
          ? (current.readableInventoryItems ?? []).filter(({ instanceId }) => instanceId !== giftedReadableItem.instanceId)
          : [...(current.readableInventoryItems ?? []), giftedReadableItem];
      actors[id] = id === actor.id
        ? { ...current, inventory, ...(readableInventoryItems === undefined ? {} : { readableInventoryItems }), nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id, lastActionResult: result.groundDrop ? '對方背包已滿，物品掉在地上，沒有交付' : null }
        : { ...current, inventory, ...(readableInventoryItems === undefined ? {} : { readableInventoryItems }) };
    }
    let objects = state.objects;
    let eventPayload = eventDraft.payload;
    const uniqueOwnerByItemIdNext = { ...uniqueOwnerByItemId, ...result.uniqueOwnerByItemIdDelta };
    if (result.groundDrop) {
      const objectId = `gift-drop-${sequence}-${actor.id}`;
      const unique = HERO_UNIQUE_ITEM_IDS.includes(result.groundDrop.itemId as (typeof HERO_UNIQUE_ITEM_IDS)[number]);
      objects = {
        ...state.objects,
        [objectId]: {
          id: objectId, itemId: result.groundDrop.itemId, objectType: 'item',
          ...(giftedReadableItem?.readableTextId == null ? {} : { readableTextId: giftedReadableItem.readableTextId }),
          ...(giftedReadableItem?.readableText == null ? {} : { readableText: giftedReadableItem.readableText }),
          remainsActorId: null, corpseId: null, ownerActorId: null, nodeId: result.groundDrop.nodeId,
          generatedAtT: schedule.timeT, expiresAtT: unique ? null : schedule.timeT + 72, unique, provisional: false,
        },
      };
      if (unique) delete uniqueOwnerByItemIdNext[result.groundDrop.itemId];
      eventPayload = { ...(eventDraft.payload as Record<string, JsonValue>), objectId };
    }
    const event: WorldEvent = {
      eventId: `action-${sequence}-${actor.id}`, sequence, worldTimeT: schedule.timeT,
      actorId: actor.id, nodeId: actor.nodeId, kind: eventDraft.kind,
      visibility: eventDraft.visibility, payload: eventPayload, randomDraws: schedule.randomDraws,
    };
    return {
      ok: true,
      state: {
        ...state, sequence, worldTimeT: schedule.timeT, rngState: schedule.rngState,
        actors, objects, uniqueOwnerByItemId: uniqueOwnerByItemIdNext,
      },
      event,
      randomDraws: schedule.randomDraws,
    };
  }

  if (action.type === 'message') {
    const recipientId = readString(action.payload, 'recipientActorId');
    const recipient = recipientId === null ? undefined : state.actors[recipientId];
    if (recipient === undefined || !recipient.alive || recipient.actorType !== 'resident' || recipient.nodeId !== actor.nodeId) {
      return { ok: false, state, unresolved: ['Message recipient is no longer an available same-Node resident.'] };
    }
    if (proposal.text === undefined) return { ok: false, state, unresolved: ['A public message requires text.'] };
    const result = resolvePublicMessage({ sender: actor, recipientId: recipient.id, text: proposal.text, worldTimeT: schedule.timeT });
    if (result.unresolved.length > 0) return { ok: false, state, unresolved: result.unresolved.map(({ detail }) => detail) };
    const draft = result.events[0];
    if (draft === undefined) return { ok: false, state, unresolved: ['Message resolver returned no public event.'] };
    return settleActionRecord(state, schedule, actor, { ...actor, nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id }, action.id, draft.kind, draft.payload, undefined, proposal.intent);
  }

  if (action.type === 'upgrade-equipment') {
    const slot = readString(action.payload, 'slot');
    const fromItemId = readString(action.payload, 'fromItemId');
    const toItemId = readString(action.payload, 'toItemId');
    const inventory = actor.inventory ?? [];
    const stoneIndex = inventory.indexOf('魔法石');
    const equipmentRows = actionContent?.equipment;
    if (slot === null || fromItemId === null || toItemId === null || stoneIndex < 0 || equipmentRows === undefined
      || actor.attack === undefined || actor.defense === undefined || actor.hitPoints === undefined) {
      return { ok: false, state, unresolved: ['魔法石需要一顆在背包中，且居民必須穿戴一件可升級的裝備。'] };
    }
    const catalog = { foods: [], equipment: equipmentRows };
    const sourceEffect = readEquipmentEffect(findEquipment(catalog, fromItemId));
    const targetEffect = readEquipmentUpgrade(catalog, fromItemId);
    const oldEquipment = actor.equipment ?? {};
    if (oldEquipment[slot] !== fromItemId || sourceEffect === null || targetEffect === null
      || targetEffect.itemId !== toItemId || !isEquippedInSlot(actor, slot, fromItemId, sourceEffect.slot)) {
      return { ok: false, state, unresolved: ['選取的裝備已改變，或沒有來源確認的同類型下一階裝備。'] };
    }
    const oldIds = [...new Set(Object.values(oldEquipment).filter((value): value is string => value !== null))];
    const oldEffects = oldIds.map((itemId) => readEquipmentEffect(findEquipment(catalog, itemId)));
    if (oldEffects.some((effect) => effect === null)) {
      return { ok: false, state, unresolved: ['已穿戴的裝備缺少完整能力資料，無法安全結算升級。'] };
    }
    const nextEquipment = { ...oldEquipment, [slot]: toItemId };
    if (sourceEffect.slot === 'both_hands') nextEquipment['off_hand'] = toItemId;
    const nextIds = [...new Set(Object.values(nextEquipment).filter((value): value is string => value !== null))];
    const nextEffects = nextIds.map((itemId) => readEquipmentEffect(findEquipment(catalog, itemId)));
    if (nextEffects.some((effect) => effect === null)) {
      return { ok: false, state, unresolved: ['升級後的裝備缺少完整能力資料，無法安全結算升級。'] };
    }
    const oldEffectList = oldEffects.filter((effect): effect is EquipmentEffect => effect !== null);
    const nextEffectList = nextEffects.filter((effect): effect is EquipmentEffect => effect !== null);
    const baseAttack = actor.attack - oldEffectList.reduce((sum, effect) => sum + effect.attack, 0);
    const baseDefense = actor.defense - oldEffectList.reduce((sum, effect) => sum + effect.defense, 0);
    const attack = baseAttack + nextEffectList.reduce((sum, effect) => sum + effect.attack, 0);
    const defense = baseDefense + nextEffectList.reduce((sum, effect) => sum + effect.defense, 0);
    const speedModifier = nextEffectList.reduce((sum, effect) => sum + effect.speedModifier, 0);
    const speed = residentSpeed(actor.hitPoints, speedModifier).speed;
    const nextInventory = [...inventory.slice(0, stoneIndex), ...inventory.slice(stoneIndex + 1)];
    const updatedActor = { ...actor, equipment: nextEquipment, inventory: nextInventory, attack, defense, speed, nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id };
    return settleActionRecord(state, schedule, actor, updatedActor, action.id, 'item-upgraded', {
      itemId: toItemId, fromItemId: canonicalInventoryItemId(fromItemId), toItemId, slot, consumedItemId: '魔法石',
      attack, defense, speed, timeCostT: action.costT,
    }, undefined, proposal.intent);
  }

  if (action.type === 'equip') {
    const itemId = readString(action.payload, 'itemId');
    const equipmentItemId = itemId === null ? null : canonicalInventoryItemId(itemId);
    const equipmentRows = actionContent?.equipment;
    const itemCatalog = { foods: [], equipment: equipmentRows ?? [] };
    const item = itemId === null ? null : findEquipment(itemCatalog, itemId);
    const effect = readEquipmentEffect(item);
    if (itemId === null || equipmentItemId === null || effect === null) return { ok: false, state, unresolved: [`Equipment item for ${action.id} is not available with complete source combat values.`] };
    const inventory = actor.inventory ?? [];
    if (!inventory.includes(itemId)) return { ok: false, state, unresolved: [`Resident ${actorId} no longer carries ${itemId}.`] };
    const oldEquipment = actor.equipment ?? {};
    const oldIds = [...new Set(Object.values(oldEquipment).filter((value): value is string => value !== null))];
    const oldEffects = oldIds.map((id) => readEquipmentEffect(findEquipment(itemCatalog, id)));
    if (oldEffects.some((value) => value === null)) return { ok: false, state, unresolved: ['Existing equipped item has incomplete source combat values; cannot safely recompute stats.'] };
    const nextEquipment = { ...oldEquipment };
    const displaced = new Set<string>();
    if (effect.slot === 'both_hands') {
      for (const slot of ['main_hand', 'off_hand']) {
        const existing = nextEquipment[slot];
        if (existing !== null && existing !== undefined) displaced.add(existing);
        nextEquipment[slot] = equipmentItemId;
      }
    } else {
      const slot = equipmentSlot(effect.slot);
      if (slot === null) return { ok: false, state, unresolved: [`Equipment slot ${effect.slot} has no source-backed runtime mapping.`] };
      const existing = nextEquipment[slot];
      if (existing !== null && existing !== undefined) {
        const existingEffect = readEquipmentEffect(findEquipment(itemCatalog, existing));
        if (existingEffect?.slot === 'both_hands') {
          delete nextEquipment['main_hand'];
          delete nextEquipment['off_hand'];
        }
        displaced.add(existing);
      }
      nextEquipment[slot] = equipmentItemId;
    }
    displaced.delete(itemId);
    const nextInventory = inventory.filter((candidate) => candidate !== itemId).concat([...displaced]);
    if (nextInventory.length > 10) return { ok: false, state, unresolved: [`Resident ${actorId} has no inventory space for displaced equipment.`] };
    const nextIds = [...new Set(Object.values(nextEquipment).filter((value): value is string => value !== null))];
    const nextEffects = nextIds.map((id) => readEquipmentEffect(findEquipment(itemCatalog, id)));
    if (nextEffects.some((value) => value === null)) return { ok: false, state, unresolved: ['New equipment set has incomplete source combat values.'] };
    const oldEffectList = oldEffects.filter((value) => value !== null);
    const nextEffectList = nextEffects.filter((value) => value !== null);
    const baseAttack = (actor.attack ?? 0) - oldEffectList.reduce((sum, value) => sum + value.attack, 0);
    const baseDefense = (actor.defense ?? 0) - oldEffectList.reduce((sum, value) => sum + value.defense, 0);
    const attack = baseAttack + nextEffectList.reduce((sum, value) => sum + value.attack, 0);
    const defense = baseDefense + nextEffectList.reduce((sum, value) => sum + value.defense, 0);
    const speedModifier = nextEffectList.reduce((sum, value) => sum + value.speedModifier, 0);
    const speed = residentSpeed(actor.hitPoints ?? 0, speedModifier).speed;
    const updatedActor = { ...actor, equipment: nextEquipment, inventory: nextInventory, attack, defense, speed, nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id };
    return settleActionRecord(state, schedule, actor, updatedActor, action.id, 'item-equipped', { itemId: equipmentItemId, attack, defense, speed, timeCostT: action.costT }, undefined, proposal.intent);
  }

  if (action.type === 'attack') {
    const targetId = readString(action.payload, 'targetActorId');
    const target = targetId === null ? undefined : state.actors[targetId];
    if (target?.actorType === 'monster' && target.name === '大金剛鸚鵡' && target.alive && sameCombatLocation(actor, target)) {
      if (target.invulnerableUntilT !== undefined && target.invulnerableUntilT !== null && schedule.timeT < target.invulnerableUntilT) {
        const sequence = state.sequence + 1;
        const event: WorldEvent = {
          eventId: `action-${sequence}-${actor.id}`, sequence, worldTimeT: schedule.timeT, actorId: actor.id, nodeId: actor.nodeId,
          kind: 'boss1-flying-hit-blocked', visibility: 'public', payload: { targetActorId: target.id, invulnerableUntilT: target.invulnerableUntilT, residentHitLanded: false }, randomDraws: schedule.randomDraws,
        };
        return { ok: true, state: { ...state, sequence, worldTimeT: schedule.timeT, actors: { ...state.actors, [actor.id]: { ...actor, nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id, lastActionResult: 'boss1-flying-hit-blocked' } } }, event, randomDraws: schedule.randomDraws };
      }
      if (parrotCounterattackOnTauntedHit(target.taunted === true).parrotActsImmediately) {
        const attackDistributions = actionContent?.attackDistributions;
        const livingTargets = Object.values(state.actors).filter((candidate) => candidate.actorType === 'resident' && candidate.alive && sameCombatLocation(candidate, target) && candidate.hitPoints !== undefined && candidate.defense !== undefined);
        if (attackDistributions === undefined || livingTargets.length === 0) return { ok: false, state, unresolved: ['Boss 1 taunt counterattack requires source attack distributions and a living same-encounter resident.'] };
        const random = new SeededRandom(schedule.rngState);
        const selection = chooseLivingTarget(livingTargets.map(({ id, hitPoints }) => ({ id, hitPoints: hitPoints! })), random, `boss1-counter.${state.sequence + 1}.target`);
        if (selection.target === null) return { ok: false, state, unresolved: ['Boss 1 taunt counterattack has no living target.'] };
        const raw = drawAttack(attackDistributions, random, `boss1-counter.${state.sequence + 1}.damage`, 'peck_if_75pct_action', '大金剛鸚鵡');
        const victim = state.actors[selection.target.id]!;
        const damage = Math.max(0, raw.rawDamage - victim.defense!);
        const after = applyDamage(victim.hitPoints!, damage);
        const sequence = state.sequence + 1;
        const actors = { ...state.actors,
          [actor.id]: { ...actor, nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id, lastActionResult: 'resident-hit-invalidated-by-taunt' },
          [target.id]: { ...target, taunted: false, nextActionAtT: schedule.timeT + 1, lastActionResult: 'taunt-counterattack' },
          [victim.id]: { ...applyActorHit(victim, after.hitPoints, schedule.timeT), lastActionResult: `大金剛鸚鵡反擊造成${damage}點傷害` },
        };
        const randomDraws = [...schedule.randomDraws, ...(selection.randomDraw === null ? [] : [selection.randomDraw]), raw.randomDraw];
        const event: WorldEvent = {
          eventId: `action-${sequence}-${actor.id}`, sequence, worldTimeT: schedule.timeT, actorId: actor.id, nodeId: actor.nodeId,
          kind: 'boss1-taunt-counterattack', visibility: 'public', payload: { targetActorId: target.id, residentHitLanded: false, bossAttacks: [{ targetId: victim.id, rawDamage: raw.rawDamage, appliedDamage: damage, ...(victim.hitPoints === undefined ? {} : { targetHitPointsBefore: victim.hitPoints }) }], bossNextActionAtT: schedule.timeT + 1 }, randomDraws,
        };
        return { ok: true, state: { ...state, sequence, worldTimeT: schedule.timeT, rngState: random.stateHex, actors }, event, randomDraws };
      }
    }
    if (target?.actorType === 'monster' && target.name === '大貓爪') {
      if (!target.alive || !sameCombatLocation(actor, target) || target.defense === undefined || actor.attack === undefined) {
        return { ok: false, state, unresolved: [`Boss 2 attack target for ${action.id} is no longer in the same encounter or lacks combat stats.`] };
      }
      const breakthroughAdded = actor.attack > 4 ? 1 : 0;
      const breakthrough = recordBoss2Breakthroughs(target.boss2Breakthroughs ?? 0, breakthroughAdded);
      const sequence = state.sequence + 1;
      if (breakthrough.defeated) {
        const runtime = state.dungeonRuntime;
        if (runtime === undefined || actionContent?.equipment === undefined || actor.nodeId === null) {
          return { ok: false, state, unresolved: ['Boss 2 victory requires dungeon runtime and the equipment source table for atomic access and rewards.'] };
        }
        const armorRows = actionContent.equipment.filter((row) => row.tier === 'knight' && row.category !== 'weapon' && row.name_zh !== undefined);
        if (armorRows.length === 0) return { ok: false, state, unresolved: ['Knight armor source rows are unavailable for the Boss 2 victory reward.'] };
        const participants = Object.values(state.actors)
          .filter((candidate) => candidate.actorType === 'resident' && candidate.alive && isSameDungeonLocation(candidate, target))
          .map(({ id, alive }) => ({ id, alive }));
        const rewardPlan = planBossVictoryRewards({ boss: 'catpaw', lastHitActorId: actor.id, participants });
        const rewardRandom = new SeededRandom(schedule.rngState);
        const rewardDraw = rewardRandom.next(`boss2-victory.${sequence}.knight-armor`);
        const armorItemId = armorRows[Math.floor(rewardDraw.value * armorRows.length)]!.name_zh!;
        const mementoDraw = rewardRandom.next(`boss2-victory.${sequence}.yarn-ball-color`);
        const mementoItemId = selectMementoItemVariant(rewardPlan.mementoItemId!, mementoDraw.value);
        const rewardItems = [armorItemId, mementoItemId];
        const inventory = [...(actor.inventory ?? [])];
        const objects = { ...state.objects };
        const rewardObjectIds: string[] = [];
        const nextFloor = actor.dungeonLocation!.floor + 1;
        const nextStartLocation = { tripId: runtime.tripId, floor: nextFloor, cellId: DUNGEON_ENTRY_CELL_ID };
        for (const [index, itemId] of rewardItems.entries()) {
          if (inventory.length < 10) {
            inventory.push(itemId);
          } else {
            const objectId = `boss2-reward-${sequence}-${index + 1}`;
            objects[objectId] = { ...createDropObject({ id: objectId, itemId, nodeId: actor.nodeId, generatedAtT: schedule.timeT }), objectType: 'item', dungeonLocation: nextStartLocation };
            rewardObjectIds.push(objectId);
          }
        }
        const actors: Record<string, WorldActor> = { ...state.actors };
        for (const participantId of rewardPlan.accessGrantedTo) {
          const participant = actors[participantId];
          if (participant?.alive !== true) continue;
          actors[participantId] = { ...participant, dungeonLocation: nextStartLocation, dungeonRouteHistory: [], lastActionResult: 'boss2-victory-next-floor' };
        }
        actors[actor.id] = { ...actors[actor.id]!, inventory, nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id, lastActionResult: 'boss2-victory' };
        delete actors[target.id];
        const unlockedFloorByActorId = { ...runtime.unlockedFloorByActorId };
        for (const participant of rewardPlan.accessGrantedTo) unlockedFloorByActorId[participant] = rewardPlan.accessGrantedFloor!;
        const randomDraws = [...schedule.randomDraws, rewardDraw, mementoDraw];
        const event: WorldEvent = {
          eventId: `action-${sequence}-${actor.id}`, sequence, worldTimeT: schedule.timeT, actorId: actor.id, nodeId: actor.nodeId,
          kind: 'boss2-retreated', visibility: 'public',
          payload: {
            bossActorId: target.id, breakthroughs: breakthrough.breakthroughs, lastHitActorId: actor.id,
            accessGrantedTo: rewardPlan.accessGrantedTo, accessGrantedFloor: rewardPlan.accessGrantedFloor,
            rewardItemIds: rewardItems, rewardObjectIds, movedResidentsTo: nextStartLocation, timeCostT: action.costT,
          },
          randomDraws,
        };
        return {
          ok: true,
          state: {
            ...state, sequence, worldTimeT: schedule.timeT, rngState: rewardRandom.stateHex, actors, objects,
            dungeonRuntime: { ...runtime, activeFloor: nextFloor, cellByActorId: { ...runtime.cellByActorId, ...Object.fromEntries(rewardPlan.accessGrantedTo.map((id) => [id, DUNGEON_ENTRY_CELL_ID])) }, unlockedFloorByActorId },
          },
          event,
          randomDraws,
        };
      }
      const updatedResident = { ...actor, nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id };
      const updatedBoss = { ...target, boss2Breakthroughs: breakthrough.breakthroughs };
      const event: WorldEvent = {
        eventId: `action-${sequence}-${actor.id}`, sequence, worldTimeT: schedule.timeT, actorId: actor.id, nodeId: actor.nodeId,
        kind: breakthroughAdded > 0 ? 'boss2-defense-breakthrough' : 'resident-attacked', visibility: 'public',
        payload: {
          targetActorId: target.id, targetType: 'monster', attack: actor.attack, breakthroughAdded,
          breakthroughs: breakthrough.breakthroughs, timeCostT: action.costT,
        },
        randomDraws: schedule.randomDraws,
      };
      return {
        ok: true,
        state: { ...state, sequence, worldTimeT: schedule.timeT, actors: { ...state.actors, [actor.id]: updatedResident, [target.id]: updatedBoss } },
        event,
        randomDraws: schedule.randomDraws,
      };
    }
    if (target === undefined || !target.alive || (target.actorType !== 'resident' && target.actorType !== 'monster') || target.nodeId !== actor.nodeId || target.defense === undefined || target.hitPoints === undefined || actor.attack === undefined) {
      return { ok: false, state, unresolved: [`Attack target for ${action.id} is no longer a valid same-Node resident or monster.`] };
    }
    const targetHitPointsBefore = target.hitPoints;
    const damage = playerDamageOnHit(actor.attack, target.defense);
    const struck = applyDamage(target.hitPoints, damage);
    const sequence = state.sequence + 1;
    const attackRandom = new SeededRandom(schedule.rngState);
    let randomDraws = [...schedule.randomDraws];
    let reflection: ReturnType<typeof resolveSlimeRetaliation> | null = null;
    if (target.actorType === 'monster' && target.name === '熔岩史萊姆') {
      if (actionContent?.attackDistributions === undefined || actor.hitPoints === undefined || actor.defense === undefined) {
        return { ok: false, state, unresolved: ['Lava slime reflection requires the source attack distribution and complete resident HP/DEF.'] };
      }
      reflection = resolveSlimeRetaliation({
        slimeHitPoints: target.hitPoints, slimeDefense: target.defense, incomingRawDamage: actor.attack,
        recipientHitPoints: actor.hitPoints, recipientDefense: actor.defense,
        reflectionDistribution: actionContent.attackDistributions, random: attackRandom,
        sourceId: `monster-reflection.${sequence}.${target.id}`,
      });
      randomDraws.push(...reflection.randomDraws);
    }
    let rewardItemId: string | null = null;
    let rewardObjectId: string | null = null;
    let uniqueHeroItemId: string | null = null;
    let objects = state.objects;
    let privateLifeData = state.privateLifeData;
    let attackerInventory = actor.inventory ?? [];
    const surfaceDropRule = target.actorType === 'monster' && target.dungeonLocation == null
      ? actionContent?.surfaceMonsterDrops?.find((row) => row.monster === target.name)
      : undefined;
    if (!struck.alive && surfaceDropRule !== undefined) {
      const itemId = surfaceDropRule.item_id?.trim();
      const dropChancePercent = Number(surfaceDropRule.drop_chance_percent);
      if (!itemId || !Number.isFinite(dropChancePercent) || dropChancePercent < 0 || dropChancePercent > 100) {
        return { ok: false, state, unresolved: [`Surface monster drop rule for ${target.name ?? target.id} is incomplete or invalid.`] };
      }
      const dropDraw = dropChancePercent === 100 ? null : attackRandom.next(`surface-monster-drop.${sequence}.${target.name}`);
      if (dropDraw !== null) randomDraws.push(dropDraw);
      if (dropChancePercent === 100 || dropDraw!.value < dropChancePercent / 100) {
        rewardItemId = itemId;
        if (attackerInventory.length < 10) {
          attackerInventory = [...attackerInventory, itemId];
        } else if (actor.nodeId !== null) {
          rewardObjectId = `surface-monster-drop-${sequence}-${target.id}`;
          objects = {
            ...objects,
            [rewardObjectId]: { ...createDropObject({ id: rewardObjectId, itemId, nodeId: actor.nodeId, generatedAtT: schedule.timeT }), objectType: 'item' },
          };
        }
      }
    }
    if (!struck.alive && target.actorType === 'monster' && actionContent?.monsterBonusDrops !== undefined) {
      const sourceDrop = actionContent.monsterBonusDrops.find((row) => row.monster === target.name);
      if (sourceDrop !== undefined) {
        const drop = drawMonsterBonusDrop({ monster: target.name ?? '', rows: actionContent.monsterBonusDrops, random: attackRandom });
        randomDraws.push(drop.randomDraw);
        if (drop.item !== null) {
          rewardItemId = drop.item;
          if (attackerInventory.length < 10) {
            attackerInventory = [...attackerInventory, drop.item];
          } else if (actor.nodeId !== null) {
            rewardObjectId = `monster-drop-${sequence}-${target.id}`;
            objects = {
              ...objects,
              [rewardObjectId]: { ...createDropObject({ id: rewardObjectId, itemId: drop.item, nodeId: actor.nodeId, generatedAtT: schedule.timeT }), objectType: 'item' },
            };
          }
        }
      }
    }
    let uniqueOwnerByItemId = { ...(state.uniqueOwnerByItemId ?? {}) };
    if (!struck.alive && target.actorType === 'monster' && target.name === '火蜥蜴') {
      const heldUniqueItems = Object.values(state.actors).flatMap((resident) => [
        ...(resident.inventory ?? []),
        ...Object.values(resident.equipment ?? {}).filter((item): item is string => item !== null),
      ]);
      if (canRespawnUniqueItem('勇者劍', Object.values(objects), heldUniqueItems, schedule.timeT)) {
        uniqueHeroItemId = '勇者劍';
        if (attackerInventory.length < 10) {
          attackerInventory = [...attackerInventory, uniqueHeroItemId];
          uniqueOwnerByItemId[uniqueHeroItemId] = actor.id;
        } else if (actor.nodeId !== null) {
          const uniqueDropId = `unique-hero-sword-${sequence}-${target.id}`;
          objects = {
            ...objects,
            [uniqueDropId]: { ...createDropObject({ id: uniqueDropId, itemId: uniqueHeroItemId, nodeId: actor.nodeId, generatedAtT: schedule.timeT, unique: true }), objectType: 'item' },
          };
          delete uniqueOwnerByItemId[uniqueHeroItemId];
        }
      }
    }
    const dragonVictoryReward = !struck.alive && target.actorType === 'monster' && target.name === '巨龍'
      ? planBossVictoryRewards({
        boss: 'dragon', lastHitActorId: actor.id,
        participants: Object.values(state.actors)
          .filter((participant) => participant.actorType === 'resident' && participant.alive && participant.nodeId === target.nodeId)
          .map(({ id, alive }) => ({ id, alive })),
      })
      : null;
    let dungeonRuntime = state.dungeonRuntime;
    let boss1RewardItems: string[] = [];
    let boss1RewardObjectIds: string[] = [];
    let boss1MovedParticipantIds: readonly string[] = [];
    if (!struck.alive && target.actorType === 'monster' && target.name === '大金剛鸚鵡') {
      const equipmentRows = actionContent?.equipment;
      if (dungeonRuntime === undefined || equipmentRows === undefined || actor.nodeId === null) {
        return { ok: false, state, unresolved: ['Boss 1 victory requires dungeon runtime and the equipment source table for atomic access and rewards.'] };
      }
      const armorRows = equipmentRows.filter((row) => row.tier === 'iron' && row.category !== 'weapon' && row.name_zh !== undefined);
      if (armorRows.length === 0) return { ok: false, state, unresolved: ['Iron armor source rows are unavailable for the Boss 1 victory reward.'] };
      const participants = Object.values(state.actors)
        .filter((candidate) => candidate.actorType === 'resident' && candidate.alive && sameCombatLocation(candidate, target))
        .map(({ id, alive }) => ({ id, alive }));
      const rewardPlan = planBossVictoryRewards({ boss: 'parrot', lastHitActorId: actor.id, participants });
      const armorDraw = attackRandom.next(`boss1-victory.${sequence}.iron-armor`);
      const armorItemId = armorRows[Math.floor(armorDraw.value * armorRows.length)]!.name_zh!;
      const mementoDraw = attackRandom.next(`boss1-victory.${sequence}.glass-bead-color`);
      const mementoItemId = selectMementoItemVariant(rewardPlan.mementoItemId!, mementoDraw.value);
      randomDraws.push(armorDraw, mementoDraw);
      boss1RewardItems = [armorItemId, mementoItemId];
      const rewardObjects = { ...objects };
      const nextFloor = target.dungeonLocation!.floor + 1;
      const nextStartLocation = { tripId: target.dungeonLocation!.tripId, floor: nextFloor, cellId: DUNGEON_ENTRY_CELL_ID };
      for (const [index, itemId] of boss1RewardItems.entries()) {
        if (attackerInventory.length < 10) attackerInventory = [...attackerInventory, itemId];
        else {
          const objectId = `boss1-reward-${sequence}-${index + 1}`;
          rewardObjects[objectId] = { ...createDropObject({ id: objectId, itemId, nodeId: actor.nodeId, generatedAtT: schedule.timeT }), objectType: 'item', dungeonLocation: nextStartLocation };
          boss1RewardObjectIds.push(objectId);
        }
      }
      objects = rewardObjects;
      const unlockedFloorByActorId = { ...dungeonRuntime.unlockedFloorByActorId };
      for (const participant of rewardPlan.accessGrantedTo) unlockedFloorByActorId[participant] = rewardPlan.accessGrantedFloor!;
      boss1MovedParticipantIds = rewardPlan.accessGrantedTo;
      dungeonRuntime = { ...dungeonRuntime, activeFloor: nextFloor, cellByActorId: { ...dungeonRuntime.cellByActorId, ...Object.fromEntries(rewardPlan.accessGrantedTo.map((id) => [id, DUNGEON_ENTRY_CELL_ID])) }, unlockedFloorByActorId };
    }
    const dragonBloodHealing = dragonVictoryReward?.lastHitHealing?.actorId === actor.id ? dragonVictoryReward.lastHitHealing.amount : 0;
    const attackerHitPoints = reflection?.recipientHitPointsAfter ?? actor.hitPoints;
    const attackerHitPointsAfterReward = attackerHitPoints === undefined ? undefined : attackerHitPoints + dragonBloodHealing;
    const attacker = {
      ...actor, inventory: attackerInventory, ...(attackerHitPointsAfterReward === undefined ? {} : { hitPoints: attackerHitPointsAfterReward }),
      ...(boss1MovedParticipantIds.includes(actor.id) ? { dungeonLocation: { tripId: target.dungeonLocation!.tripId, floor: target.dungeonLocation!.floor + 1, cellId: DUNGEON_ENTRY_CELL_ID }, dungeonRouteHistory: [] } : {}),
      ...(attackerHitPointsAfterReward !== undefined && attackerHitPointsAfterReward <= 0 ? { alive: false, diedAtT: schedule.timeT, nodeId: null, inventory: [], equipment: {}, sleeping: false, sleepingSinceT: null } : {}),
      nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id,
    };
    if (attackerHitPoints !== undefined && attackerHitPoints <= 0) {
      const corpseId = `corpse-${actor.id}-${sequence}`;
      objects = {
        ...objects,
        [corpseId]: { id: corpseId, itemId: null, objectType: 'corpse', remainsActorId: actor.id, ownerActorId: null, nodeId: actor.nodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: false, provisional: false },
        ...Object.fromEntries([
          ...attackerInventory,
          ...Object.values(actor.equipment ?? {}).filter((item): item is string => item !== null),
        ].map((itemId, index) => {
          const objectId = `corpse-loot-${actor.id}-${sequence}-${index + 1}`;
          return [objectId, { id: objectId, itemId, objectType: 'item' as const, corpseId, ownerActorId: null, nodeId: actor.nodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: isUniqueHeroItem(itemId), provisional: false }];
        })),
      };
      privateLifeData = { ...privateLifeData, [actor.id]: { intents: privateLifeData?.[actor.id]?.intents ?? [], biographyStatus: 'pending' } };
    }
    if (!struck.alive && target.actorType === 'resident') {
      const corpseId = `corpse-${target.id}-${sequence}`;
      const droppedItems = [...(target.inventory ?? []), ...Object.values(target.equipment ?? {}).filter((value): value is string => value !== null)];
      objects = {
        ...objects,
        [corpseId]: { id: corpseId, itemId: null, objectType: 'corpse', remainsActorId: target.id, ownerActorId: null, nodeId: target.nodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: false, provisional: false },
        ...Object.fromEntries(droppedItems.map((itemId, index) => {
          const objectId = `corpse-loot-${target.id}-${sequence}-${index + 1}`;
          return [objectId, { id: objectId, itemId, objectType: 'item' as const, corpseId, ownerActorId: null, nodeId: target.nodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: isUniqueHeroItem(itemId), provisional: false }];
        })),
      };
      privateLifeData = { ...privateLifeData, [target.id]: { intents: privateLifeData?.[target.id]?.intents ?? [], biographyStatus: 'pending' } };
    }
    const updatedTarget = {
      ...applyActorHit(target, struck.hitPoints, schedule.timeT),
    };
    let actorsAfterAction: Record<string, WorldActor> = { ...state.actors, [actor.id]: attacker, [target.id]: updatedTarget };
    if (boss1MovedParticipantIds.length > 0 && dungeonRuntime !== undefined) {
      const nextFloor = target.dungeonLocation!.floor + 1;
      for (const participantId of boss1MovedParticipantIds) {
        if (participantId === actor.id) continue;
        const participant = actorsAfterAction[participantId];
        if (participant?.alive === true) actorsAfterAction[participantId] = { ...participant, dungeonLocation: { tripId: target.dungeonLocation!.tripId, floor: nextFloor, cellId: DUNGEON_ENTRY_CELL_ID }, dungeonRouteHistory: [], lastActionResult: 'boss1-victory-next-floor' };
      }
    }
    let summonedMonsterId: string | null = null;
    if (target.actorType === 'monster' && struck.alive && !target.isSummonedCompanion && target.encounterId !== undefined && (target.name === '綠矮人' || target.name === '火翼蝙蝠') && actionContent?.monsters !== undefined) {
      const sourceMonster = actionContent.monsters.find((row) => row.name === target.name);
      const stats = sourceMonster === undefined ? null : monsterStatsFromSource(sourceMonster);
      const summonAlreadyUsed = Object.values(state.actors).some((candidate) => candidate.actorType === 'monster' && candidate.encounterId === target.encounterId && candidate.isSummonedCompanion === true);
      if (stats?.hitPoints !== null && stats?.hitPoints !== undefined && stats.speed !== null && stats.speed !== undefined && stats.defense !== null && stats.defense !== undefined && shouldSummonCompanion({ hitPoints: struck.hitPoints, maxHitPoints: stats.hitPoints, alreadySummoned: summonAlreadyUsed })) {
        summonedMonsterId = `summoned-${sequence}-${target.id}`;
        actorsAfterAction[summonedMonsterId] = {
          id: summonedMonsterId, actorType: 'monster', alive: true, nodeId: target.nodeId,
          nextActionAtT: schedule.timeT, spawnedAtSequence: sequence, speed: stats.speed, unsafeEntryAtT: schedule.timeT,
          travel: null, sleeping: false, hitPoints: stats.hitPoints, attack: 0,
          defense: stats.defense, name: stats.name, encounterId: target.encounterId, isSummonedCompanion: true,
        };
      }
    }
    const stateAfter = {
      ...state,
      sequence,
      worldTimeT: schedule.timeT,
      rngState: attackRandom.stateHex,
      actors: actorsAfterAction,
      objects,
      uniqueOwnerByItemId,
      ...(dungeonRuntime === undefined ? {} : { dungeonRuntime }),
      ...(privateLifeData === undefined ? {} : { privateLifeData }),
      ...(proposal.intent === undefined ? {} : { privateLifeData: { ...privateLifeData, [actor.id]: { intents: [...(privateLifeData?.[actor.id]?.intents ?? []), proposal.intent], biographyStatus: attackerHitPoints !== undefined && attackerHitPoints <= 0 ? 'pending' as const : 'active' as const } } }),
    };
    const event: WorldEvent = {
      eventId: `action-${sequence}-${actor.id}`, sequence, worldTimeT: schedule.timeT, actorId: actor.id, nodeId: actor.nodeId,
      kind: boss1RewardItems.length > 0 || boss1RewardObjectIds.length > 0 ? 'boss1-defeated' : 'resident-attacked', visibility: 'public', payload: { targetActorId: target.id, targetType: target.actorType, ...(target.name === undefined ? {} : { targetName: target.name }), damage, targetHitPointsBefore, hitPointsAfter: struck.hitPoints, killed: !struck.alive, timeCostT: action.costT, ...(boss1RewardItems.length === 0 ? {} : { rewardItemIds: boss1RewardItems, accessGrantedFloor: 2, accessGrantedTo: Object.entries(dungeonRuntime?.unlockedFloorByActorId ?? {}).filter(([, floor]) => floor === 2).map(([id]) => id), movedResidentsTo: { tripId: target.dungeonLocation!.tripId, floor: target.dungeonLocation!.floor + 1, cellId: DUNGEON_ENTRY_CELL_ID } }), ...(boss1RewardObjectIds.length === 0 ? {} : { rewardObjectIds: boss1RewardObjectIds }), ...(reflection === null ? {} : { reflectionRawDamage: reflection.rawReflectionDamage, reflectionDamage: reflection.appliedReflectionDamage, reflectionHitPointsBefore: actor.hitPoints, reflectionHitPointsAfter: reflection.recipientHitPointsAfter, reflectionOnLethalHit: !struck.alive }), ...(rewardItemId === null ? {} : { rewardItemId, rewardObjectId }), ...(uniqueHeroItemId === null ? {} : { uniqueHeroItemId }), ...(summonedMonsterId === null ? {} : { summonedMonsterId, ...(actorsAfterAction[summonedMonsterId]?.name === undefined ? {} : { summonedMonsterName: actorsAfterAction[summonedMonsterId]!.name }) }), ...(dragonBloodHealing === 0 ? {} : { dragonBloodHealing }) }, randomDraws,
    };
    return { ok: true, state: stateAfter, event, randomDraws: event.randomDraws };
  }

  if (action.type === 'scavenge-corpse' || action.type === 'carry-corpse' || action.type === 'drop-corpse') {
    const objectId = readObjectId(action.payload);
    const object = objectId === null ? undefined : state.objects[objectId];
    if (object === undefined) return { ok: false, state, unresolved: [`Corpse interaction object for ${action.id} is missing.`] };
    const actors = { ...state.actors };
    const objects = { ...state.objects };
    let kind: string;
    let eventNodeId: string | null = actor.nodeId;
    let payload: JsonValue;
    if (action.type === 'scavenge-corpse') {
      if (object.objectType !== 'item' || object.corpseId === null || object.corpseId === undefined || object.nodeId !== actor.nodeId || object.ownerActorId !== null || object.itemId === null) {
        return { ok: false, state, unresolved: [`Corpse loot ${objectId} is no longer available at the resident's Node.`] };
      }
      const inventory = actor.inventory ?? [];
      if (inventory.length >= 10) return { ok: false, state, unresolved: [`Resident ${actorId} has no free inventory slot.`] };
      delete objects[object.id];
      actors[actorId] = { ...actor, inventory: [...inventory, object.itemId], nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id };
      kind = 'corpse-item-scavenged';
      payload = { corpseId: object.corpseId, objectId: object.id, itemId: object.itemId, timeCostT: action.costT };
    } else if (action.type === 'carry-corpse') {
      if (object.objectType !== 'corpse' || object.nodeId !== actor.nodeId || object.ownerActorId !== null) return { ok: false, state, unresolved: [`Corpse ${objectId} is no longer available at the resident's Node.`] };
      objects[object.id] = { ...object, nodeId: null, ownerActorId: actor.id };
      for (const loot of Object.values(state.objects)) {
        if (loot.corpseId === object.id && loot.ownerActorId === null) objects[loot.id] = { ...loot, nodeId: null, ownerActorId: actor.id };
      }
      actors[actorId] = { ...actor, nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id };
      kind = 'corpse-carried';
      payload = { corpseId: object.id, timeCostT: action.costT };
    } else {
      if (object.objectType !== 'corpse' || object.ownerActorId !== actor.id || actor.nodeId === null) return { ok: false, state, unresolved: [`Resident ${actorId} does not carry corpse ${objectId} at a Node.`] };
      objects[object.id] = { ...object, nodeId: actor.nodeId, ownerActorId: null };
      for (const loot of Object.values(state.objects)) {
        if (loot.corpseId === object.id && loot.ownerActorId === actor.id) objects[loot.id] = { ...loot, nodeId: actor.nodeId, ownerActorId: null };
      }
      actors[actorId] = { ...actor, nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id };
      kind = 'corpse-dropped';
      payload = { corpseId: object.id, timeCostT: action.costT };
    }
    const sequence = state.sequence + 1;
    const event: WorldEvent = {
      eventId: `action-${sequence}-${actorId}`, sequence, worldTimeT: schedule.timeT, actorId, nodeId: eventNodeId,
      kind, visibility: 'public', payload, randomDraws: schedule.randomDraws,
    };
    return {
      ok: true,
      state: {
        ...state, sequence, worldTimeT: schedule.timeT, rngState: schedule.rngState, actors, objects,
        ...(proposal.intent === undefined ? {} : { privateLifeData: {
          ...state.privateLifeData,
          [actorId]: { intents: [...(state.privateLifeData?.[actorId]?.intents ?? []), proposal.intent], biographyStatus: 'active' as const },
        } }),
      },
      event, randomDraws: schedule.randomDraws,
    };
  }

  if (action.type === 'dungeon-exit') {
    if (actor === undefined || actor.dungeonLocation == null || !['A1', 'B1', 'C1'].includes(actor.dungeonLocation.cellId) || action.costT !== 3) {
      return { ok: false, state, unresolved: ['Leaving the dungeon requires a living resident in one of the three branch starting cells and a 3T action.'] };
    }
    const fromCellId = actor.dungeonLocation.cellId;
    const sequence = state.sequence + 1;
    const entranceNodeId = findClassifiedNodeId(state, 'dungeonEntrance');
    if (entranceNodeId === null) return { ok: false, state, unresolved: ['No Node has the dungeon-entrance classification.'] };
    const actors = { ...state.actors, [actorId]: { ...actor, nodeId: entranceNodeId, dungeonLocation: null, dungeonRouteHistory: [], nextActionAtT: schedule.timeT + 3, lastActionId: action.id, lastActionResult: 'dungeon-exited' } };
    const cellByActorId = { ...(state.dungeonRuntime?.cellByActorId ?? {}) };
    delete cellByActorId[actorId];
    const event: WorldEvent = { eventId: `action-${sequence}-${actorId}`, sequence, worldTimeT: schedule.timeT, actorId, nodeId: entranceNodeId, kind: 'dungeon-resident-exited', visibility: 'public', payload: { fromCellId, toNodeId: entranceNodeId, timeCostT: 3 }, randomDraws: schedule.randomDraws };
    return { ok: true, state: { ...state, sequence, worldTimeT: schedule.timeT, rngState: schedule.rngState, actors, ...(state.dungeonRuntime === undefined ? {} : { dungeonRuntime: { ...state.dungeonRuntime, cellByActorId } }) }, event, randomDraws: schedule.randomDraws };
  }
  if (action.type === 'dungeon-enter' || action.type === 'dungeon-move' || action.type === 'dungeon-retreat' || action.type === 'dungeon-advance-floor') {
    if (actor === undefined || actor.nodeId === null || !hasNodeClassificationBehavior(state.nodes[actor.nodeId]?.surfaceTerrain, 'dungeonEntrance') || actionContent?.dungeonEvents === undefined) {
      return { ok: false, state, unresolved: ['Dungeon movement requires a resident at a dungeon-entrance classified Node and the source event table.'] };
    }
    const entering = action.type === 'dungeon-enter';
    const advancing = action.type === 'dungeon-advance-floor';
    const retreating = action.type === 'dungeon-retreat';
    const toCellId = readString(action.payload, 'toCellId');
    const fromCellId = entering || advancing ? '' : readString(action.payload, 'fromCellId');
    if (toCellId === null || fromCellId === null || action.costT !== 3) {
      return { ok: false, state, unresolved: ['Dungeon movement must have a legal cell target and cost 3T.'] };
    }
    const baseRuntime = state.dungeonRuntime ?? {
      schemaVersion: 1 as const,
      tripId: `dungeon-trip-${state.sequence + 1}`,
      activeFloor: 1,
      cellByActorId: {},
      unlockedFloorByActorId: { [actorId]: 1 },
      visitedCells: [],
      activeEncounterByCell: {},
    };
    const rawToFloor = typeof action.payload === 'object' && action.payload !== null && !Array.isArray(action.payload)
      ? (action.payload as { readonly [key: string]: JsonValue }).toFloor
      : undefined;
    const toFloor = typeof rawToFloor === 'number' && Number.isSafeInteger(rawToFloor) ? rawToFloor : null;
    if (advancing) {
      const actorDungeon = actor.dungeonLocation;
      const priorBoss = actorDungeon === null || actorDungeon === undefined ? undefined : state.actors[`boss-${actorDungeon.tripId}-floor-${actorDungeon.floor}`];
      if (toFloor === null || actorDungeon === undefined || actorDungeon === null || actorDungeon.cellId !== 'E' || toFloor !== actorDungeon.floor + 1 || toFloor > (baseRuntime.unlockedFloorByActorId[actorId] ?? actorDungeon.floor) || priorBoss?.alive !== false) {
        return { ok: false, state, unresolved: ['Advancing floors requires a defeated Boss, the E cell, and the resident unlocked next floor.'] };
      }
    }
    const runtime = advancing
      ? { ...baseRuntime, activeFloor: toFloor!, cellByActorId: Object.fromEntries(Object.entries(baseRuntime.cellByActorId).filter(([id]) => id !== actorId)) }
      : baseRuntime;
    const bossName = toCellId === 'E' ? ({ 1: '大金剛鸚鵡', 2: '大貓爪', 3: '巨龍' } as const)[runtime.activeFloor as 1 | 2 | 3] : null;
    const bossSource = bossName === null ? undefined : actionContent.monsters?.find((row) => row.name === bossName);
    const bossStats = bossSource === undefined ? null : monsterStatsFromSource(bossSource);
    const bossId = bossName === null ? null : `boss-${runtime.tripId}-floor-${runtime.activeFloor}`;
    if (bossName !== null && bossStats === null) return { ok: false, state, unresolved: [`Boss source row ${bossName} is unavailable.`] };
    const random = new SeededRandom(schedule.rngState);
    const result = resolveDungeonRuntimeStep({
      state: runtime,
      actorId,
      worldTimeT: schedule.timeT,
      action: { kind: 'enter-cell', fromCellId, toCellId, isBossCell: toCellId === 'E', otherLivingResidentPresent: Object.values(state.actors).some((candidate) => candidate.id !== actorId && candidate.actorType === 'resident' && candidate.alive && candidate.dungeonLocation?.tripId === runtime.tripId && candidate.dungeonLocation.floor === runtime.activeFloor && candidate.dungeonLocation.cellId === toCellId), isRetreat: retreating },
      events: actionContent.dungeonEvents,
      random,
      ids: { eventId: `action-${state.sequence + 1}-${actorId}:dungeon`, encounterId: `dungeon-encounter-${state.sequence + 1}-${actorId}` },
    });
    if (result.unresolved.length > 0) return { ok: false, state, unresolved: result.unresolved.map(({ detail }) => detail) };
    const sequence = state.sequence + 1;
    const splashEvent = result.eventDrafts.find(({ kind, payload }) => kind === 'dungeon-cell-event' && readString(payload, 'event') === '大型熔岩飛濺');
    let lavaSplashDamage: number | null = null;
    let lavaHitPointsAfter = actor.hitPoints;
    let lavaSurvivor = actor.alive;
    const draws = [...schedule.randomDraws, ...result.randomDraws];
    if (splashEvent !== undefined) {
      if (actor.hitPoints === undefined) return { ok: false, state, unresolved: ['Lava splash requires the entering resident current HP.'] };
      const damageDraw = random.next(`dungeon.lava-splash.${sequence}.damage`);
      draws.push(damageDraw);
      lavaSplashDamage = 4 + Math.floor(damageDraw.value * 3);
      lavaHitPointsAfter = Math.max(0, actor.hitPoints - lavaSplashDamage);
      lavaSurvivor = lavaHitPointsAfter > 0;
    }
    const dungeonStateAfter = lavaSurvivor
      ? result.nextDungeonState
      : { ...result.nextDungeonState, cellByActorId: Object.fromEntries(Object.entries(result.nextDungeonState.cellByActorId).filter(([id]) => id !== actorId)) };
    const nextActor: WorldActor = {
      ...actor,
      ...(lavaSplashDamage === null ? {} : { hitPoints: lavaHitPointsAfter, alive: lavaSurvivor }),
      dungeonLocation: lavaSurvivor ? { tripId: runtime.tripId, floor: runtime.activeFloor, cellId: toCellId } : null,
      ...(lavaSurvivor ? {} : { diedAtT: schedule.timeT, nodeId: null, inventory: [], equipment: {}, sleeping: false, sleepingSinceT: null }),
      dungeonRouteHistory: advancing ? [] : result.nextDungeonState.routeByActorId?.[actorId] ?? actor.dungeonRouteHistory ?? [],
      nextActionAtT: schedule.timeT + action.costT,
      lastActionId: action.id,
      lastActionResult: lavaSplashDamage === null ? `dungeon-cell:${toCellId}` : `大型熔岩飛濺造成受傷，餘命減少 ${lavaSplashDamage}`,
    };
    const createdObjects: Record<string, WorldObject> = Object.fromEntries(result.createdObjects.map((object) => [object.id, object]));
    if (!lavaSurvivor && splashEvent !== undefined) {
      const corpseId = `corpse-${actorId}-${sequence}`;
      createdObjects[corpseId] = { id: corpseId, itemId: null, objectType: 'corpse', remainsActorId: actorId, ownerActorId: null, nodeId: actor.nodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: false, provisional: false };
      [...(actor.inventory ?? []), ...Object.values(actor.equipment ?? {}).filter((item): item is string => item !== null)].forEach((itemId, index) => {
        const objectId = `corpse-loot-${actorId}-${sequence}-${index + 1}`;
        createdObjects[objectId] = { id: objectId, itemId, objectType: 'item', remainsActorId: null, corpseId, ownerActorId: null, nodeId: actor.nodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: isUniqueHeroItem(itemId), provisional: false };
      });
    }
    const bossSpawned = bossId !== null && state.actors[bossId] === undefined && bossStats !== null;
    const bossActor: WorldActor | null = bossSpawned && bossStats !== null && bossName !== null
      && bossStats.speed !== null && bossStats.defense !== null
      ? {
        id: bossId!, actorType: 'monster', alive: true, nodeId: actor.nodeId,
        nextActionAtT: schedule.timeT, spawnedAtSequence: sequence, speed: bossStats.speed, unsafeEntryAtT: schedule.timeT,
        travel: null, sleeping: false, defense: bossStats.defense, name: bossName,
        encounterId: `${runtime.tripId}-floor-${runtime.activeFloor}`,
        dungeonLocation: { tripId: runtime.tripId, floor: runtime.activeFloor, cellId: 'E' },
        ...(bossStats.hitPoints === null ? { boss2Breakthroughs: 0 } : { hitPoints: bossStats.hitPoints }),
      }
      : null;
    const event: WorldEvent = {
      eventId: `action-${sequence}-${actorId}`, sequence, worldTimeT: schedule.timeT, actorId, nodeId: actor.nodeId,
      kind: retreating ? 'dungeon-resident-retreated' : bossSpawned ? 'dungeon-boss-encounter-started' : splashEvent !== undefined ? 'dungeon-lava-splash-settled' : 'dungeon-action-settled', visibility: 'public',
      payload: {
        actionId: action.id, timeCostT: action.costT, tripId: runtime.tripId, floor: runtime.activeFloor,
        fromCellId: fromCellId === '' ? null : fromCellId, toCellId,
        ...(bossActor === null ? {} : { bossActorId: bossActor.id, bossName: bossActor.name }),
        dungeonEvents: result.eventDrafts.map(({ kind, payload }) => ({ kind, payload })),
        ...(lavaSplashDamage === null ? {} : { lavaSplashDamage, hitPointsAfter: lavaHitPointsAfter, killed: !lavaSurvivor }),
      },
      randomDraws: draws,
    };
    const nextState: WorldState = {
      ...state, sequence, worldTimeT: schedule.timeT, rngState: random.stateHex,
      actors: { ...state.actors, [actorId]: nextActor, ...(bossActor === null ? {} : { [bossActor.id]: bossActor }) },
      objects: { ...state.objects, ...createdObjects },
      dungeonRuntime: dungeonStateAfter,
      ...(!lavaSurvivor && splashEvent !== undefined ? { privateLifeData: { ...state.privateLifeData, [actorId]: { intents: state.privateLifeData?.[actorId]?.intents ?? [], biographyStatus: 'pending' as const } } } : {}),
      ...(proposal.intent === undefined ? {} : { privateLifeData: {
        ...state.privateLifeData,
        [actorId]: { intents: [...(state.privateLifeData?.[actorId]?.intents ?? []), proposal.intent], biographyStatus: 'active' as const },
      } }),
    };
    return { ok: true, state: nextState, event, randomDraws: draws };
  }

  if (actor === undefined || actor.nodeId === null) return { ok: false, state, unresolved: [`Resident ${actorId} has no valid current Node.`] };
  const fromNodeId = actor.nodeId;
  const moving = action.type === 'move' || action.type === 'retreat';
  const toNodeId = moving ? readTargetNode(action.payload) : fromNodeId;
  const adjacent = graph.edges.some(({ source, target }) => (source === fromNodeId && target === toNodeId) || (source === toNodeId && target === fromNodeId));
  if (toNodeId === null || (moving && !adjacent)) {
    return { ok: false, state, unresolved: [`Move target for ${proposal.actionId} is not an adjacent Node.`] };
  }
  if (action.type === 'retreat') {
    if (actor.routeHistory?.at(-1) !== toNodeId) return { ok: false, state, unresolved: ['Retreat target is not the most recent prior Node on this resident route.'] };
  }
  if (moving) {
    const sequence = state.sequence + 1;
    const arrivesAtT = schedule.timeT + action.costT;
    const transitActor: WorldActor = {
      ...actor,
      nodeId: null,
      ...(action.type === 'retreat' ? { routeHistory: (actor.routeHistory ?? []).slice(0, -1) } : { routeHistory: [...(actor.routeHistory ?? []), fromNodeId] }),
      unsafeEntryAtT: null,
      travel: { fromNodeId, toNodeId, arrivesAtT },
      nextActionAtT: arrivesAtT,
      lastActionId: action.id,
    };
    const objects = Object.fromEntries(Object.values(state.objects).map((object) =>
      object.ownerActorId === actorId && (object.objectType === 'corpse' || object.corpseId !== null && object.corpseId !== undefined)
        ? [object.id, { ...object, nodeId: null }]
        : [object.id, object]));
    const event: WorldEvent = {
      eventId: `action-${sequence}-${actorId}`, sequence, worldTimeT: schedule.timeT, actorId,
      nodeId: null, kind: 'resident-action-settled', visibility: 'public',
      payload: { actionId: action.id, actionType: action.type, timeCostT: action.costT, fromNodeId, toNodeId, inTransit: true, arrivalAtT: arrivesAtT, actorSpeed: actor.speed },
      randomDraws: schedule.randomDraws,
    };
    const nextState: WorldState = {
      ...state, sequence, worldTimeT: schedule.timeT, rngState: schedule.rngState,
      actors: { ...state.actors, [actorId]: transitActor }, objects,
    };
    return { ok: true, state: clearCreaturesFromNodesEmptiedByPlayers(state, nextState, fromNodeId), event, randomDraws: schedule.randomDraws };
  }
  const sleeping = action.type === 'sleep';
  const wakeAtT = sleeping ? readWakeTime(action.payload) : null;
  const settledActor: WorldActor = {
    ...actor,
    nodeId: toNodeId,
    ...(action.type === 'retreat' ? { routeHistory: (actor.routeHistory ?? []).slice(0, -1) } : moving ? { routeHistory: [...(actor.routeHistory ?? []), fromNodeId] } : actor.routeHistory === undefined ? {} : { routeHistory: actor.routeHistory }),
    unsafeEntryAtT: moving ? schedule.timeT : actor.unsafeEntryAtT,
    travel: null,
    nextActionAtT: wakeAtT ?? schedule.timeT + action.costT,
    sleeping,
    sleepingSinceT: sleeping ? schedule.timeT : null,
    sleepRecoveryBlocks: 0,
    lastActionId: action.id,
  };
  const sequence = state.sequence + 1;
  const emptyOfResidents = !Object.values(state.actors).some((candidate) => candidate.id !== actorId && candidate.alive && candidate.actorType === 'resident' && candidate.nodeId === toNodeId);
  const isNightMove = moving && emptyOfResidents && dayPhaseAt(schedule.timeT) === 'night';
  const protectedByCampfire = isNightMove && isNodeCampfireProtected(state, toNodeId, schedule.timeT, actor.dungeonLocation != null);
  const destinationNode = state.nodes[toNodeId];
  const nightCheck = isNightMove && !protectedByCampfire
    ? resolveNightEncounterCheck({ node: state.nodes[toNodeId], actorId, worldTimeT: schedule.timeT, randomState: schedule.rngState })
    : null;
  const nightEncounter = nightCheck?.encounter === true;
  const terrain = environmentTerrainForClassification(state.nodes[toNodeId]?.surfaceTerrain);
  const daytimeEntryAllowed = dayPhaseAt(schedule.timeT) !== 'day' || allowsDaySurfaceEntryEvents(state.nodes[toNodeId]?.surfaceTerrain);
  const canResolveSurfaceEntry = moving && emptyOfResidents && !protectedByCampfire && !nightEncounter && (nightCheck === null || nightCheck.unresolved === null);
  const surfaceEntry = canResolveSurfaceEntry && daytimeEntryAllowed && terrain !== null && terrain !== 'unclassified' && actionContent?.surfaceEntryEvents !== undefined
    ? resolveSurfaceEntry({ terrain, phase: dayPhaseAt(schedule.timeT), rows: actionContent.surfaceEntryEvents, actorId, nodeId: toNodeId, worldTimeT: schedule.timeT, randomState: nightCheck?.rngStateAfter ?? schedule.rngState })
    : null;
  const surfaceEntryRow = surfaceEntry?.outcome;
  const surfaceEntryEffect = surfaceEntryRow?.effect ?? '';
  const forcedMoveChoices = surfaceEntryEffect === 'force_move' ? [...(state.nodes[toNodeId]?.neighbors ?? [])].sort() : [];
  const forcedMoveRandom = forcedMoveChoices.length > 0 && surfaceEntry !== null
    ? new SeededRandom(surfaceEntry.rngStateAfter).next(`surface.entry.force-move.${toNodeId}.${actorId}.${schedule.timeT}`)
    : null;
  const forcedMoveToNodeId = forcedMoveRandom === null ? null : forcedMoveChoices[Math.floor(forcedMoveRandom.value * forcedMoveChoices.length)] ?? null;
  const nightEnemy = nightEncounter && nightCheck !== null
    ? selectNightEnemy(nightCheck.rngStateAfter, toNodeId, actorId, schedule.timeT)
    : null;
  const nightMonsterRow = nightEnemy === null ? undefined : nightEnemySourceRow(actionContent?.monsters, nightEnemy.name);
  const nightMonsterStats = nightMonsterRow === undefined ? null : monsterStatsFromSource(nightMonsterRow);
  const monsterRow = surfaceEntryRow?.monster_name
    ? actionContent?.monsters?.find((row) => row.name === surfaceEntryRow.monster_name)
    : undefined;
  const monsterStats = monsterRow === undefined ? null : monsterStatsFromSource(monsterRow);
  const surfaceMonster: WorldActor | null = monsterStats !== null && monsterStats.hitPoints !== null && monsterStats.defense !== null && monsterStats.speed !== null
    ? {
      id: `monster-${sequence}-${toNodeId}`,
      actorType: 'monster',
      alive: true,
      nodeId: toNodeId,
      nextActionAtT: schedule.timeT,
      spawnedAtSequence: sequence,
      speed: monsterStats.speed,
      unsafeEntryAtT: schedule.timeT,
      travel: null,
      sleeping: false,
      hitPoints: monsterStats.hitPoints,
      attack: 0,
      defense: monsterStats.defense,
      name: monsterStats.name,
      encounterId: `encounter-${sequence}-${actorId}`,
    }
    : null;
  const nightMonster: WorldActor | null = nightMonsterStats !== null && nightMonsterStats.hitPoints !== null && nightMonsterStats.defense !== null && nightMonsterStats.speed !== null
    ? { id: `night-monster-${sequence}-${toNodeId}`, actorType: 'monster', alive: true, nodeId: toNodeId, nextActionAtT: schedule.timeT, spawnedAtSequence: sequence, speed: nightMonsterStats.speed, unsafeEntryAtT: schedule.timeT, travel: null, sleeping: false, hitPoints: nightMonsterStats.hitPoints, attack: 0, defense: nightMonsterStats.defense, name: nightMonsterStats.name, encounterId: `encounter-${sequence}-${actorId}` }
    : null;
  const spawnedMonster = surfaceMonster ?? nightMonster;
  const eventDraws = [...schedule.randomDraws, ...(nightCheck?.randomDraw === null || nightCheck?.randomDraw === undefined ? [] : [nightCheck.randomDraw]), ...(nightEnemy === null ? [] : [nightEnemy.randomDraw]), ...(surfaceEntry?.randomDraws ?? []), ...(forcedMoveRandom === null ? [] : [forcedMoveRandom])];
  const entryHitPointChange = surfaceEntryEffect.includes('hp-1') ? -1 : 0;
  const entrySleepChange = surfaceEntryEffect.includes('sleep-1') ? -1 : 0;
  const resolvedHitPoints = Math.max(0, (actor.hitPoints ?? 0) - (nightEncounter ? 1 : 0) + entryHitPointChange);
  const nightDamageDeath = resolvedHitPoints <= 0 && (nightEncounter || entryHitPointChange < 0);
  const unresolvedEntry = [
    ...(nightCheck?.unresolved === null || nightCheck === null ? [] : [nightCheck.unresolved]),
    ...(canResolveSurfaceEntry && terrain === null ? [`Node ${toNodeId} has no source-backed terrain classification for a surface entry event.`] : []),
    ...(canResolveSurfaceEntry && actionContent?.surfaceEntryEvents === undefined ? ['The active surface entry outcome table was not loaded.'] : []),
    ...(surfaceEntryEffect === 'force_move' && forcedMoveToNodeId === null ? [`急流事件在Node ${toNodeId}没有可到达的相邻Node。`] : []),
    ...(nightEncounter && !nightDamageDeath && nightMonster === null ? [`Night enemy ${nightEnemy?.name ?? 'unknown'} could not be materialized from the existing monsters source row with complete HP/DEF/SPD.`] : []),
  ];
  const movedObjects = moving
    ? Object.fromEntries(Object.values(state.objects)
      .filter((object) => object.ownerActorId === actorId && (object.objectType === 'corpse' || object.corpseId !== null && object.corpseId !== undefined))
      .map((object) => [object.id, { ...object, nodeId: toNodeId }]))
    : {};
  const surfaceObjects = surfaceEntryRow?.effect === 'create_object' && surfaceEntryRow.item_id
    ? { [`surface-entry-${sequence}-${actorId}`]: {
      id: `surface-entry-${sequence}-${actorId}`, itemId: surfaceEntryRow.item_id,
      objectType: surfaceEntryRow.object_type === 'container' ? 'container' as const : 'item' as const,
      ...(surfaceEntryRow.object_type === 'container' ? { containerSourceId: '地表漂流木箱' } : {}),
      ownerActorId: null, nodeId: toNodeId, generatedAtT: schedule.timeT,
      expiresAtT: schedule.timeT + 72, unique: false, provisional: false,
    } } : {};
  const nightCorpseId = nightDamageDeath ? `corpse-${actorId}-${sequence}` : null;
  const nightDeathObjects = nightCorpseId === null ? {} : Object.fromEntries([
    [nightCorpseId, { id: nightCorpseId, itemId: null, objectType: 'corpse' as const, remainsActorId: actorId, ownerActorId: null, nodeId: toNodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: false, provisional: false }],
    ...[...(actor.inventory ?? []), ...new Set(Object.values(actor.equipment ?? {}).filter((item): item is string => item !== null))]
      .map((itemId, index) => [`corpse-loot-${actorId}-${sequence}-${index + 1}`, { id: `corpse-loot-${actorId}-${sequence}-${index + 1}`, itemId, objectType: 'item' as const, corpseId: nightCorpseId, ownerActorId: null, nodeId: toNodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: isUniqueHeroItem(itemId), provisional: false }]),
  ]);
  const event: WorldEvent = {
    eventId: `action-${sequence}-${actorId}`,
    sequence,
    worldTimeT: schedule.timeT,
    actorId,
    nodeId: toNodeId,
    kind: 'resident-action-settled',
    visibility: 'public',
    payload: {
      actionId: action.id,
      actionType: action.type,
      timeCostT: action.costT,
      fromNodeId,
      toNodeId,
      inTransit: false,
      ...(surfaceEntry === null ? {} : { surfaceEntry: {
        terrain: surfaceEntry.terrain,
        triggered: surfaceEntry.triggered,
        triggerPercent: surfaceEntry.triggerPercent,
        overallOutcomePercent: surfaceEntry.overallOutcomePercent,
        outcomeId: surfaceEntryRow?.outcome ?? null,
        forcedMoveToNodeId,
        spawnedMonsterId: spawnedMonster?.id ?? null,
      } }),
      ...(nightCheck === null ? {} : { nightEncounter: {
        terrain: nightCheck.terrain,
        probabilityPercent: nightCheck.probabilityPercent,
        encountered: nightEncounter,
        hitPointChange: nightEncounter ? -1 : 0,
        enemyName: nightEnemy?.name ?? null,
        spawnedMonsterId: nightMonster?.id ?? null,
      } }),
      sleepingUntilT: wakeAtT,
      actorSpeed: actor.speed,
    },
    randomDraws: eventDraws,
  };
  const nextState: WorldState = {
    ...state,
    sequence,
    worldTimeT: schedule.timeT,
    rngState: forcedMoveRandom?.stateAfter ?? surfaceEntry?.rngStateAfter ?? nightEnemy?.rngStateAfter ?? nightCheck?.rngStateAfter ?? schedule.rngState,
    actors: { ...state.actors, [actorId]: nightEncounter || entryHitPointChange !== 0 || entrySleepChange !== 0 || forcedMoveToNodeId !== null ? {
      ...settledActor,
      ...(nightEncounter || entryHitPointChange !== 0 ? { hitPoints: resolvedHitPoints, alive: resolvedHitPoints > 0 } : {}),
      ...(entrySleepChange !== 0 ? { sleep: Math.max(0, (actor.sleep ?? 0) + entrySleepChange) } : {}),
      ...(forcedMoveToNodeId === null ? {} : { nodeId: forcedMoveToNodeId, routeHistory: [...(settledActor.routeHistory ?? []), toNodeId] }),
      ...(nightDamageDeath ? { diedAtT: schedule.timeT, nodeId: null, sleeping: false, inventory: [], equipment: {} } : {}),
    } : settledActor, ...(spawnedMonster === null ? {} : { [spawnedMonster.id]: spawnedMonster }) },
    objects: { ...state.objects, ...movedObjects, ...surfaceObjects, ...nightDeathObjects },
    ...(nightDamageDeath ? { privateLifeData: { ...state.privateLifeData, [actorId]: { intents: state.privateLifeData?.[actorId]?.intents ?? [], biographyStatus: 'pending' as const } } } : {}),
    ...(unresolvedEntry.length === 0 ? {} : { unresolved: [...(state.unresolved ?? []), ...unresolvedEntry.map((detail) => ({ sourceId: nightEncounter ? 'surface-night-encounter' : 'surface-entry', detail }))] }),
    ...(proposal.intent === undefined ? {} : {
      privateLifeData: {
        ...state.privateLifeData,
        [actorId]: {
          intents: [...(state.privateLifeData?.[actorId]?.intents ?? []), proposal.intent],
          biographyStatus: 'active' as const,
        },
      },
    }),
  };
  return { ok: true, state: nextState, event, randomDraws: eventDraws };
}

function clearCreaturesFromNodesEmptiedByPlayers(previous: WorldState, next: WorldState, eventNodeId: string | null): WorldState {
  const occupiedBefore = new Set(Object.values(previous.actors)
    .filter((actor) => actor.actorType === 'resident' && actor.alive && actor.nodeId !== null)
    .map((actor) => actor.nodeId as string));
  const occupiedAfter = new Set(Object.values(next.actors)
    .filter((actor) => actor.actorType === 'resident' && actor.alive && actor.nodeId !== null)
    .map((actor) => actor.nodeId as string));
  const emptiedNodeIds = new Set([...occupiedBefore].filter((nodeId) => !occupiedAfter.has(nodeId)));
  for (const oldActor of Object.values(previous.actors)) {
    const newActor = next.actors[oldActor.id];
    if (oldActor.actorType === 'resident' && oldActor.alive && newActor !== undefined && !newActor.alive) {
      if (oldActor.nodeId !== null) emptiedNodeIds.add(oldActor.nodeId);
      if (newActor.nodeId !== null) emptiedNodeIds.add(newActor.nodeId);
      if (eventNodeId !== null && !occupiedAfter.has(eventNodeId)) emptiedNodeIds.add(eventNodeId);
    }
  }
  const dungeonCellKey = (actor: WorldActor): string | null => {
    const location = actor.dungeonLocation;
    return location == null ? null : `${location.tripId}|${location.floor}|${location.cellId}`;
  };
  const occupiedDungeonCellsBefore = new Set(Object.values(previous.actors)
    .filter((actor) => actor.actorType === 'resident' && actor.alive && actor.dungeonLocation != null)
    .map((actor) => dungeonCellKey(actor) as string));
  const occupiedDungeonCellsAfter = new Set(Object.values(next.actors)
    .filter((actor) => actor.actorType === 'resident' && actor.alive && actor.dungeonLocation != null)
    .map((actor) => dungeonCellKey(actor) as string));
  const emptiedDungeonCellKeys = new Set([...occupiedDungeonCellsBefore].filter((cellKey) => !occupiedDungeonCellsAfter.has(cellKey)));
  const actors = Object.fromEntries(Object.entries(next.actors).filter(([, actor]) => {
    if (actor.actorType !== 'monster' && actor.actorType !== 'animal') return true;
    if (actor.dungeonLocation != null) {
      const location = actor.dungeonLocation;
      const isDungeonBoss = actor.id === `boss-${location.tripId}-floor-${location.floor}`;
      return !isDungeonBoss || !emptiedDungeonCellKeys.has(dungeonCellKey(actor) as string);
    }
    return actor.nodeId === null || !emptiedNodeIds.has(actor.nodeId);
  }));
  if (Object.keys(actors).length === Object.keys(next.actors).length) return next;
  return { ...next, actors };
}

export function settleNextAction(state: WorldState, proposal: ActionProposal, graph: IslandGraph, corpseCosts: CorpseActionCosts = CORPSE_ACTION_COSTS, actionContent?: SimulationActionContent): ActionSettlement {
  const result = settleNextActionCore(state, proposal, graph, corpseCosts, actionContent);
  return result.ok ? {
    ...result,
    state: clearCreaturesFromNodesEmptiedByPlayers(state, result.state, result.event.nodeId),
    event: recordResidentHpChanges(state, result.state, result.event),
  } : result;
}

/** Ref14 Q11: a malformed model reply consumes one small action and leaves a fixed result for its next prompt. */
export function settleNextInvalidReply(state: WorldState, actorId: string, graph: IslandGraph): ActionSettlement {
  void graph;
  const scheduled = nextWorldEvent(state);
  if (scheduled.kind !== 'resident-action') {
    return { ok: false, state, unresolved: [`World timer ${scheduled.kind} at T=${scheduled.timeT} must settle before a malformed reply.`] };
  }
  if (scheduled.unresolved.length > 0) return { ok: false, state, unresolved: scheduled.unresolved };
  if (scheduled.actorIds[0] !== actorId) return { ok: false, state, unresolved: [`Malformed reply actor ${actorId} is not the next scheduled resident (${scheduled.actorIds[0] ?? 'none'}).`] };
  const actor = state.actors[actorId];
  if (actor === undefined || !actor.alive || actor.sleeping) return { ok: false, state, unresolved: [`Resident ${actorId} cannot receive a malformed-reply settlement now.`] };
  const sequence = state.sequence + 1;
  const nextActor = { ...actor, nextActionAtT: scheduled.timeT + 1, lastActionId: null, lastActionResult: '動作格式錯誤' };
  const event: WorldEvent = {
    eventId: `action-${sequence}-${actorId}`,
    sequence,
    worldTimeT: scheduled.timeT,
    actorId,
    nodeId: actor.nodeId,
    kind: 'resident-action-format-error',
    visibility: 'public',
    payload: { result: '動作格式錯誤', hesitationText: '你剛剛似乎愣神了一下。', timeCostT: 1 },
    randomDraws: scheduled.randomDraws,
  };
  return {
    ok: true,
    state: {
      ...state,
      sequence,
      worldTimeT: scheduled.timeT,
      rngState: scheduled.rngState,
      actors: { ...state.actors, [actorId]: nextActor },
    },
    event,
    randomDraws: scheduled.randomDraws,
  };
}

function settleNextTimerEventCore(state: WorldState, modelAssignmentsBySlot: Readonly<Record<number, ModelBinding | null>> = {}, options: SimulationTimerOptions = {}): ActionSettlement {
  const eventToSettle = nextWorldEvent(state);
  if (eventToSettle.kind === 'resident-action') return { ok: false, state, unresolved: ['The next world event is a resident action, not a timer.'] };
  if ('unresolved' in eventToSettle && eventToSettle.unresolved.length > 0) return { ok: false, state, unresolved: eventToSettle.unresolved };
  if (eventToSettle.kind === 'monster-action') {
    if (eventToSettle.unresolved.length > 0) return { ok: false, state, unresolved: eventToSettle.unresolved };
    const monster = state.actors[eventToSettle.monsterId];
    if (monster === undefined || !monster.alive || monster.actorType !== 'monster' || monster.nodeId === null) {
      return { ok: false, state, unresolved: [`Scheduled monster ${eventToSettle.monsterId} is missing, dead, or outside a Node.`] };
    }
    const source = options.monsters?.find((row) => row.name === monster.name);
    if (source === undefined || options.attackDistributions === undefined) {
      return { ok: false, state, unresolved: [`Monster ${monster.name ?? monster.id} requires source monster and attack-distribution rows.`] };
    }
    const targets = Object.values(state.actors)
      .filter((actor) => actor.actorType === 'resident' && actor.alive
        && (monster.dungeonLocation != null
          ? isSameDungeonLocation(monster, actor)
          : actor.nodeId === monster.nodeId)
        && actor.hitPoints !== undefined && actor.defense !== undefined)
      .map((actor) => ({ id: actor.id, hitPoints: actor.hitPoints!, defense: actor.defense! }));
    const priorityDraws = eventToSettle.randomDraws ?? [];
    const random = new SeededRandom(eventToSettle.rngState ?? state.rngState);
    const result = resolveScheduledMonsterTurn({
      monster: source,
      worldTimeT: eventToSettle.timeT,
      nextActionAtT: monster.nextActionAtT,
      combatRoundCount: monster.combatRoundCount ?? 0,
      targets,
      distribution: options.attackDistributions,
      random,
      sourceId: `monster-action.${monster.id}.${eventToSettle.timeT}`,
    });
    if (result.unresolved.length > 0) return { ok: false, state, unresolved: result.unresolved };
    const sequence = state.sequence + 1;
    const actors: Record<string, WorldActor> = { ...state.actors };
    for (const [targetId, hitPoints] of Object.entries(result.targetHitPointsAfter)) {
      const target = actors[targetId];
      if (target === undefined) continue;
      const alive = hitPoints > 0;
      const damageThisAction = result.hits.filter((hit) => hit.targetId === targetId).reduce((sum, hit) => sum + hit.appliedDamage, 0);
      const wasHit = result.hits.some((hit) => hit.targetId === targetId);
      actors[targetId] = {
        ...applyActorHit(target, hitPoints, eventToSettle.timeT, wasHit),
        lastActionResult: `${monster.name ?? monster.id} ${result.action}${damageThisAction > 0 ? `造成${damageThisAction}點傷害` : ''}${alive ? '' : '；你倒下了'}`,
      };
    }
    actors[monster.id] = {
      ...monster,
      speed: result.speed,
      nextActionAtT: result.nextActionAtT,
      combatRoundCount: result.combatRoundCount,
      sleeping: result.action === 'sleep',
      lastActionResult: result.action,
      taunted: result.taunts,
      invulnerableUntilT: result.invulnerable ? eventToSettle.timeT + 1 : null,
    };
    const event: WorldEvent = {
      eventId: `monster-action-${sequence}-${monster.id}`,
      sequence,
      worldTimeT: eventToSettle.timeT,
      actorId: monster.id,
      nodeId: monster.nodeId,
      kind: 'monster-action-settled',
      visibility: 'public',
      payload: {
        monsterId: monster.id,
        monsterName: monster.name ?? monster.id,
        action: result.action,
        nextActionAtT: result.nextActionAtT,
        invulnerable: result.invulnerable,
        taunts: result.taunts,
        hits: result.hits.map((hit) => ({ targetId: hit.targetId, appliedDamage: hit.appliedDamage, ...(state.actors[hit.targetId]?.hitPoints === undefined ? {} : { targetHitPointsBefore: state.actors[hit.targetId]!.hitPoints! }), hitPointsAfter: hit.hitPointsAfter, killed: hit.killed })),
      },
      randomDraws: [...priorityDraws, ...result.randomDraws],
    };
    return {
      ok: true,
      state: { ...state, sequence, worldTimeT: eventToSettle.timeT, rngState: result.rngStateAfter, actors },
      event,
      randomDraws: [...priorityDraws, ...result.randomDraws],
    };
  }
  const sequence = state.sequence + 1;
  let nextState: WorldState = { ...state, worldTimeT: eventToSettle.timeT, sequence };
  let kind: string;
  let actorId: string | null = null;
  let nodeId: string | null = null;
  let payload: JsonValue;
  const timerRandomDraws: RandomDraw[] = [];
  if (eventToSettle.kind === 'personal-sleep-risk-unresolved') {
    const actors: Record<string, WorldActor> = { ...state.actors };
    const objects = { ...state.objects };
    const privateLifeData: Record<string, PrivateLifeRecord> = { ...state.privateLifeData };
    const checks: Array<{ readonly actorId: string; readonly category: string | null; readonly outcomeId: string | null; readonly terrain: string | null; readonly probabilityPercent: number | null; readonly hitPointChange: number; readonly woke: boolean; readonly enemyName: string | null; readonly spawnedMonsterId: string | null; readonly unresolved: readonly string[] }> = [];
    let rngState = state.rngState;
    for (const sleeper of Object.values(state.actors).filter((candidate) => candidate.alive && candidate.actorType === 'resident' && candidate.sleeping && candidate.nodeId !== null && !isNodeCampfireProtected(state, candidate.nodeId, eventToSettle.timeT, candidate.dungeonLocation != null) && candidate.unsafeEntryAtT !== null && nextPersonalUnsafeNightRiskAt(candidate.unsafeEntryAtT, eventToSettle.timeT - 3, true, true) === eventToSettle.timeT).sort((left, right) => left.id.localeCompare(right.id))) {
      const nodeId = sleeper.nodeId as string;
      const risk = resolveNightEncounterCheck({ node: state.nodes[nodeId], actorId: sleeper.id, worldTimeT: eventToSettle.timeT, randomState: rngState });
      rngState = risk.rngStateAfter;
      if (risk.randomDraw !== null) timerRandomDraws.push(risk.randomDraw);
      let enemyName: string | null = null;
      let spawnedMonsterId: string | null = null;
      let unresolved: string[] = risk.unresolved === null ? [] : [risk.unresolved];
      let updated = sleeper;
      if (risk.encounter) {
        const hitPoints = Math.max(0, (sleeper.hitPoints ?? 0) - 1);
        const alive = hitPoints > 0;
        updated = { ...sleeper, hitPoints, alive, sleeping: false, sleepingSinceT: null, sleepRecoveryBlocks: 0, ...(alive ? { nextActionAtT: eventToSettle.timeT } : { diedAtT: eventToSettle.timeT, nodeId: null, inventory: [], equipment: {} }) };
        if (alive) {
          const selection = selectNightEnemy(rngState, nodeId, sleeper.id, eventToSettle.timeT);
          rngState = selection.rngStateAfter;
          timerRandomDraws.push(selection.randomDraw);
          enemyName = selection.name;
          const row = nightEnemySourceRow(options.monsters, selection.name);
          const stats = row === undefined ? null : monsterStatsFromSource(row);
          if (stats !== null && stats.hitPoints !== null && stats.defense !== null && stats.speed !== null) {
            spawnedMonsterId = `night-monster-${sequence}-${sleeper.id}`;
            actors[spawnedMonsterId] = { id: spawnedMonsterId, actorType: 'monster', alive: true, nodeId, nextActionAtT: eventToSettle.timeT, spawnedAtSequence: sequence, speed: stats.speed, unsafeEntryAtT: eventToSettle.timeT, travel: null, sleeping: false, hitPoints: stats.hitPoints, attack: 0, defense: stats.defense, name: stats.name, encounterId: `encounter-${sequence}-${sleeper.id}` };
          } else {
            unresolved.push(`Night enemy ${selection.name} could not be materialized from the existing monsters source row with complete HP/DEF/SPD.`);
          }
        }
        if (!alive) {
          const corpseId = `corpse-${sleeper.id}-${sequence}`;
          const possessions = [...(sleeper.inventory ?? []), ...new Set(Object.values(sleeper.equipment ?? {}).filter((item): item is string => item !== null))];
          objects[corpseId] = { id: corpseId, itemId: null, objectType: 'corpse', remainsActorId: sleeper.id, ownerActorId: null, nodeId, generatedAtT: eventToSettle.timeT, expiresAtT: null, unique: false, provisional: false };
          possessions.forEach((itemId, index) => {
            const objectId = `corpse-loot-${sleeper.id}-${sequence}-${index + 1}`;
            objects[objectId] = { id: objectId, itemId, objectType: 'item', corpseId, ownerActorId: null, nodeId, generatedAtT: eventToSettle.timeT, expiresAtT: null, unique: isUniqueHeroItem(itemId), provisional: false };
          });
          privateLifeData[sleeper.id] = { intents: state.privateLifeData?.[sleeper.id]?.intents ?? [], biographyStatus: 'pending' };
        }
      }
      actors[sleeper.id] = updated;
      checks.push({ actorId: sleeper.id, category: risk.encounter ? 'encounter' : 'no-encounter', outcomeId: risk.encounter ? 'night-enemy' : null, terrain: risk.terrain, probabilityPercent: risk.probabilityPercent, hitPointChange: risk.encounter ? -1 : 0, woke: risk.encounter && updated.alive, enemyName, spawnedMonsterId, unresolved });
    }
    kind = 'personal-sleep-risk-settled';
    payload = { checks, sourceRule: 'unsafe-sleep-night-encounter-current-node-rate-every-three-T-campfire-protected-node-skipped-fixed-one-HP-before-wake' };
    nextState = {
      ...nextState,
      rngState,
      actors,
      objects,
      privateLifeData,
      unresolved: [...(state.unresolved ?? []), ...checks.flatMap(({ unresolved: issues }) => issues.map((detail) => ({ sourceId: 'sleep-risk', detail })))],
    };
  } else if (eventToSettle.kind === 'sleep-recovery') {
    const sleeper = state.actors[eventToSettle.actorId];
    if (sleeper === undefined || !sleeper.alive || !sleeper.sleeping || sleeper.sleepingSinceT == null || sleeper.sleep === undefined) {
      return { ok: false, state, unresolved: ['Sleep recovery timer has no matching sleeping resident.'] };
    }
    const completedBlocks = Math.floor((eventToSettle.timeT - sleeper.sleepingSinceT) / 8);
    const completedNow = Math.max(0, completedBlocks - (sleeper.sleepRecoveryBlocks ?? 0));
    if (completedNow === 0) return { ok: false, state, unresolved: ['Sleep recovery timer fired before a complete 8T rest block.'] };
    const sleep = Math.min(3, sleeper.sleep + completedNow);
    const recovered = sleep - sleeper.sleep;
    actorId = sleeper.id;
    nodeId = sleeper.nodeId;
    kind = 'resident-sleep-recovered';
    payload = { completedBlocks, recovered, sleepBefore: sleeper.sleep, sleepAfter: sleep, rule: 'one-sleep-per-eight-consecutive-T-max-three' };
    nextState = { ...nextState, actors: { ...state.actors, [sleeper.id]: {
      ...sleeper, sleep, sleepRecoveryBlocks: completedBlocks, sleepRecoveryDay: Math.floor((eventToSettle.timeT - 1) / 72),
    } } };
  } else if (eventToSettle.kind === 'travel-arrival') {
    const actor = state.actors[eventToSettle.actorId];
    if (actor === undefined || actor.travel === undefined || actor.travel === null) return { ok: false, state, unresolved: ['Travel arrival timer has no matching resident transit state.'] };
    actorId = actor.id;
    nodeId = actor.travel.toNodeId;
    kind = 'resident-arrived';
    const fromNodeId = actor.travel.fromNodeId;
    const targetNodeId = actor.travel.toNodeId;
    const targetWasOccupied = Object.values(state.actors).some((candidate) => candidate.id !== actor.id
      && candidate.alive && candidate.actorType === 'resident' && candidate.nodeId === targetNodeId);
    const protectedByCampfire = !targetWasOccupied
      && isNodeCampfireProtected(state, targetNodeId, eventToSettle.timeT, actor.dungeonLocation != null);
    const destinationNode = state.nodes[targetNodeId];
    const nightCheck = !targetWasOccupied && !protectedByCampfire && dayPhaseAt(eventToSettle.timeT) === 'night'
      ? resolveNightEncounterCheck({ node: state.nodes[targetNodeId], actorId: actor.id, worldTimeT: eventToSettle.timeT, randomState: state.rngState })
      : null;
    const nightEncounter = nightCheck?.encounter === true;
    const terrain = environmentTerrainForClassification(state.nodes[targetNodeId]?.surfaceTerrain);
    const daytimeEntryAllowed = dayPhaseAt(eventToSettle.timeT) !== 'day' || allowsDaySurfaceEntryEvents(state.nodes[targetNodeId]?.surfaceTerrain);
    const entry = !targetWasOccupied && !protectedByCampfire && !nightEncounter && (nightCheck?.unresolved == null)
      && daytimeEntryAllowed && terrain !== null && terrain !== 'unclassified' && options.surfaceEntryEvents !== undefined
      ? resolveSurfaceEntry({ terrain, phase: dayPhaseAt(eventToSettle.timeT), rows: options.surfaceEntryEvents, actorId: actor.id, nodeId: targetNodeId, worldTimeT: eventToSettle.timeT, randomState: nightCheck?.rngStateAfter ?? state.rngState })
      : null;
    const entryEffect = entry?.outcome?.effect ?? '';
    const forcedMoveChoices = entryEffect === 'force_move' ? [...(state.nodes[targetNodeId]?.neighbors ?? [])].sort() : [];
    const forcedMoveRandom = forcedMoveChoices.length > 0 && entry !== null
      ? new SeededRandom(entry.rngStateAfter).next(`surface.entry.force-move.${targetNodeId}.${actor.id}.${eventToSettle.timeT}`)
      : null;
    const forcedMoveToNodeId = forcedMoveRandom === null ? null : forcedMoveChoices[Math.floor(forcedMoveRandom.value * forcedMoveChoices.length)] ?? null;
    const hitPoints = Math.max(0, (actor.hitPoints ?? 0) - (nightEncounter ? 1 : 0) - (entryEffect.includes('hp-1') ? 1 : 0) - (entryEffect.includes('hp-2') ? 2 : 0));
    const died = hitPoints === 0 && (nightEncounter || entryEffect.includes('hp-'));
    const arrivalActor: WorldActor = {
      ...actor,
      nodeId: died ? null : forcedMoveToNodeId ?? targetNodeId,
      ...(forcedMoveToNodeId === null || died ? {} : { routeHistory: [...(actor.routeHistory ?? []), targetNodeId] }),
      travel: null,
      unsafeEntryAtT: died || targetWasOccupied ? null : eventToSettle.timeT,
      nextActionAtT: eventToSettle.timeT,
      ...(nightEncounter || entryEffect.includes('hp-') ? { hitPoints, alive: !died } : {}),
      ...(entryEffect.includes('sleep-1') && actor.sleep !== undefined ? { sleep: Math.max(0, actor.sleep - 1) } : {}),
      ...(died ? { diedAtT: eventToSettle.timeT, sleeping: false, inventory: [], equipment: {} } : {}),
    };
    const objects = { ...state.objects };
    for (const object of Object.values(state.objects)) {
      if ((object.objectType === 'corpse' || object.corpseId !== null && object.corpseId !== undefined) && object.ownerActorId === actor.id) objects[object.id] = { ...object, ownerActorId: died ? null : actor.id, nodeId: died ? targetNodeId : forcedMoveToNodeId ?? targetNodeId };
    }
    const actors: Record<string, WorldActor> = { ...state.actors, [actor.id]: arrivalActor };
    const nightSelection = nightEncounter && nightCheck !== null ? selectNightEnemy(nightCheck.rngStateAfter, targetNodeId, actor.id, eventToSettle.timeT) : null;
    const monsterName = (nightSelection?.name ?? entry?.outcome?.monster_name) || null;
    const monsterRow = monsterName === null ? undefined : options.surfaceMonsters?.find((row) => row.name === monsterName) ?? options.monsters?.find((row) => row.name === monsterName);
    const monsterStats = monsterRow === undefined ? null : monsterStatsFromSource(monsterRow);
    let spawnedMonsterId: string | null = null;
    if (!died && monsterStats?.hitPoints != null && monsterStats.defense != null && monsterStats.speed != null) {
      spawnedMonsterId = `${nightSelection === null ? 'monster' : 'night-monster'}-${sequence}-${targetNodeId}`;
      actors[spawnedMonsterId] = { id: spawnedMonsterId, actorType: 'monster', alive: true, nodeId: targetNodeId, nextActionAtT: eventToSettle.timeT, spawnedAtSequence: sequence, speed: monsterStats.speed, unsafeEntryAtT: eventToSettle.timeT, travel: null, sleeping: false, hitPoints: monsterStats.hitPoints, attack: 0, defense: monsterStats.defense, name: monsterStats.name, encounterId: `encounter-${sequence}-${actor.id}` };
    }
    const createdObjects: Record<string, WorldObject> = {};
    if (!died && entryEffect === 'create_object' && entry?.outcome?.item_id) {
      const objectId = `surface-entry-${sequence}-${actor.id}`;
      createdObjects[objectId] = { id: objectId, itemId: entry.outcome.item_id, objectType: entry.outcome.object_type === 'container' ? 'container' : 'item', ...(entry.outcome.object_type === 'container' ? { containerSourceId: '地表漂流木箱' } : {}), ownerActorId: null, nodeId: targetNodeId, generatedAtT: eventToSettle.timeT, expiresAtT: eventToSettle.timeT + 72, unique: false, provisional: false };
    }
    if (died) {
      const corpseId = `corpse-${actor.id}-${sequence}`;
      createdObjects[corpseId] = { id: corpseId, itemId: null, objectType: 'corpse', remainsActorId: actor.id, ownerActorId: null, nodeId: targetNodeId, generatedAtT: eventToSettle.timeT, expiresAtT: null, unique: false, provisional: false };
      [...(actor.inventory ?? []), ...new Set(Object.values(actor.equipment ?? {}).filter((item): item is string => item !== null))].forEach((itemId, index) => {
        const objectId = `corpse-loot-${actor.id}-${sequence}-${index + 1}`;
        createdObjects[objectId] = { id: objectId, itemId, objectType: 'item', corpseId, ownerActorId: null, nodeId: targetNodeId, generatedAtT: eventToSettle.timeT, expiresAtT: null, unique: isUniqueHeroItem(itemId), provisional: false };
      });
    }
    const randomDraws = [
      ...(nightCheck?.randomDraw === null || nightCheck?.randomDraw === undefined ? [] : [nightCheck.randomDraw]),
      ...(nightSelection === null ? [] : [nightSelection.randomDraw]),
      ...(entry?.randomDraws ?? []),
      ...(forcedMoveRandom === null ? [] : [forcedMoveRandom]),
    ];
    const nextRngState = forcedMoveRandom?.stateAfter ?? entry?.rngStateAfter ?? nightSelection?.rngStateAfter ?? nightCheck?.rngStateAfter ?? state.rngState;
    const unresolved = [
      ...(nightCheck?.unresolved == null ? [] : [nightCheck.unresolved]),
      ...(!targetWasOccupied && !protectedByCampfire && !nightEncounter && terrain === null ? [`Node ${targetNodeId} has no source-backed terrain classification for a surface entry event.`] : []),
      ...(!targetWasOccupied && !protectedByCampfire && !nightEncounter && terrain !== null && terrain !== 'unclassified' && options.surfaceEntryEvents === undefined ? ['The active surface entry outcome table was not loaded.'] : []),
      ...(entryEffect === 'force_move' && forcedMoveToNodeId === null ? [`急流事件在Node ${targetNodeId}没有可到达的相邻Node。`] : []),
      ...(!died && monsterName !== null && spawnedMonsterId === null ? [`Encounter creature ${monsterName} could not be materialized from its source row with complete HP/DEF/SPD.`] : []),
    ];
    payload = {
      fromNodeId, toNodeId: targetNodeId, targetWasOccupied,
      ...(nightCheck === null ? {} : { nightEncounter: { terrain: nightCheck.terrain, probabilityPercent: nightCheck.probabilityPercent, encountered: nightEncounter, hitPointChange: nightEncounter ? -1 : 0, enemyName: nightSelection?.name ?? null, spawnedMonsterId: nightEncounter ? spawnedMonsterId : null } }),
      ...(entry === null ? {} : { surfaceEntry: { terrain: entry.terrain, triggered: entry.triggered, triggerPercent: entry.triggerPercent, overallOutcomePercent: entry.overallOutcomePercent, outcomeId: entry.outcome?.outcome ?? null, forcedMoveToNodeId, spawnedMonsterId: entry.outcome?.monster_name ? spawnedMonsterId : null } }),
      spawnedMonsterId,
    };
    nextState = {
      ...nextState,
      rngState: nextRngState,
      actors: { ...actors },
      objects: { ...objects, ...createdObjects },
      ...(unresolved.length === 0 ? {} : { unresolved: [...(state.unresolved ?? []), ...unresolved.map((detail) => ({ sourceId: nightEncounter ? 'surface-night-encounter' : 'surface-entry', detail }))] }),
    };
    timerRandomDraws.push(...randomDraws);
  } else if (eventToSettle.kind === 'object-expiry') {
    const { [eventToSettle.objectId]: expired, ...objects } = state.objects;
    if (expired === undefined) return { ok: false, state, unresolved: ['Object expiry timer has no matching object.'] };
    kind = 'world-object-expired';
    payload = { objectId: eventToSettle.objectId, itemId: expired.itemId };
    nodeId = expired.nodeId;
    nextState = { ...nextState, objects };
  } else {
    kind = 'daily-survival-settled';
    const actors: Record<string, WorldActor> = { ...state.actors };
    const objects = { ...state.objects };
    const privateLifeData: Record<string, PrivateLifeRecord> = { ...state.privateLifeData };
    const deaths: Array<{ readonly actorId: string; readonly corpseId: string; readonly droppedObjectIds: readonly string[] }> = [];
    for (const actor of Object.values(state.actors)) {
      if (!actor.alive || actor.actorType !== 'resident' || actor.hunger === undefined || actor.sleep === undefined || actor.hitPoints === undefined) continue;
      const hunger = Math.max(0, actor.hunger - 1);
      const sleep = actor.sleepRecoveryDay === Math.floor((eventToSettle.timeT - 1) / 72)
        ? actor.sleep ?? 0 : Math.max(0, actor.sleep - 1);
      const hitPoints = Math.max(0, actor.hitPoints - (hunger <= 0 ? 3 : 0) - (sleep <= 0 ? 3 : 0));
      const diedNow = hitPoints === 0;
      const droppedObjectIds: string[] = [];
      const corpseId = `corpse-${actor.id}`;
      if (diedNow) {
        objects[corpseId] = {
          id: corpseId, itemId: null, objectType: 'corpse', remainsActorId: actor.id,
          ownerActorId: null, nodeId: actor.nodeId, generatedAtT: eventToSettle.timeT, expiresAtT: null,
          unique: false, provisional: false,
        };
        droppedObjectIds.push(corpseId);
        for (const carried of Object.values(objects).filter((object) => (object.objectType === 'corpse' || object.corpseId !== null && object.corpseId !== undefined) && object.ownerActorId === actor.id)) {
          objects[carried.id] = { ...carried, ownerActorId: null, nodeId: actor.nodeId };
        }
        const possessions = [
          ...(actor.inventory ?? []),
          ...Object.values(actor.equipment ?? {}).filter((item): item is string => item !== null),
        ];
        possessions.forEach((itemId, index) => {
          const objectId = `corpse-loot-${actor.id}-${index + 1}`;
          objects[objectId] = {
            id: objectId, itemId, objectType: 'item', corpseId, ownerActorId: null, nodeId: actor.nodeId,
            generatedAtT: eventToSettle.timeT, expiresAtT: null, unique: isUniqueHeroItem(itemId), provisional: false,
          };
          droppedObjectIds.push(objectId);
        });
        deaths.push({ actorId: actor.id, corpseId, droppedObjectIds });
        privateLifeData[actor.id] = {
          intents: state.privateLifeData?.[actor.id]?.intents ?? [],
          biographyStatus: 'pending',
        };
      }
      actors[actor.id] = {
        ...actor, hunger, sleep, hitPoints, alive: hitPoints > 0,
        diedAtT: hitPoints > 0 ? actor.diedAtT ?? null : actor.diedAtT ?? eventToSettle.timeT,
        ...(diedNow ? { inventory: [], equipment: {} } : {}),
        sleeping: false, sleepingSinceT: null, sleepRecoveryBlocks: 0, nextActionAtT: eventToSettle.timeT,
      };
    }
    const rng = new SeededRandom(state.rngState);
    const born: Array<{ readonly slotId: string; readonly actorId: string; readonly generation: number; readonly nodeId: string }> = [];
    const residentCount = state.residentCount ?? 10;
    const livingResidents = () => Object.values(actors).filter((actor) => actor.actorType === 'resident' && actor.alive).length;
    for (let slotIndex = 0; slotIndex < residentCount && livingResidents() < residentCount; slotIndex += 1) {
      const slotId = String(slotIndex);
      const slotActors = Object.values(actors).filter((actor) => actor.actorType === 'resident' && actor.slotId === slotId);
      if (slotActors.some((actor) => actor.alive)) continue;
      const mostRecent = slotActors.reduce<WorldActor | undefined>((latest, actor) => (actor.generation ?? 0) > (latest?.generation ?? 0) ? actor : latest, undefined);
      if (mostRecent !== undefined && mostRecent.diedAtT !== undefined && mostRecent.diedAtT !== null && mostRecent.diedAtT >= eventToSettle.timeT) continue;
      const generation = (mostRecent?.generation ?? 0) + 1;
      const id = `resident-${slotId}.${generation}`;
      const modelSlotId = mostRecent?.modelSlotId ?? slotIndex + 1;
      const modelAssignment = mostRecent?.modelAssignment ?? modelAssignmentsBySlot[modelSlotId] ?? null;
      const draw = rng.next(`resident-generation-${generation}-start:${id}`);
      const startNodeIds = startingLocationNodeIds(Object.values(state.nodes));
      const spawnNodeId = startNodeIds[Math.floor(draw.value * startNodeIds.length)];
      if (spawnNodeId === undefined) return { ok: false, state, unresolved: ['Starting beach list is empty.'] };
      timerRandomDraws.push(draw);
      const vitals = createInitialVitals();
      const actor: WorldActor = {
        id, actorType: 'resident', alive: true, nodeId: spawnNodeId, nextActionAtT: eventToSettle.timeT,
        speed: 3, unsafeEntryAtT: eventToSettle.timeT, travel: null, sleeping: false, sleepingSinceT: null,
        hitPoints: vitals.hitPoints, hunger: vitals.hunger, sleep: vitals.sleep, attack: 0, defense: 0,
        modelId: modelAssignment === null || modelAssignment.provider === null || modelAssignment.model === null
          ? null : `${modelAssignment.provider}/${modelAssignment.model}`,
        modelAssignment, modelSizeB: modelAssignment?.modelSizeB ?? null,
        sizeAtLeast8BConfirmed: modelAssignment?.sizeAtLeast8BConfirmed ?? false,
        styleDescription: modelAssignment?.styleDescription ?? null,
        generation, slotId, modelSlotId, diedAtT: null, inventory: [], equipment: {},
        aiMemory: { processedThroughSequence: state.sequence, entries: [] },
      };
      actors[id] = actor;
      born.push({ slotId, actorId: id, generation, nodeId: spawnNodeId });
    }
    nextState = { ...nextState, rngState: rng.stateHex, actors };
    payload = { dayNumber: Math.floor(eventToSettle.timeT / 72), rule: 'daily-hunger-sleep-decay-and-zero-resource-hp-loss', deaths, newGenerations: born };
    nextState = { ...nextState, actors, objects, privateLifeData };
    const activeCapabilities = createActiveSurfaceCapabilities(Object.values(state.nodes).map((node) => ({
      node_id: node.id, node_label: node.label ?? '', label_status: node.labelStatus,
      surface_terrain: node.surfaceTerrain ?? '',
    })));
    const dayNumber = Math.floor(eventToSettle.timeT / 72);
    const previousStocks = state.surfaceStocks ?? {
      schemaVersion: 1 as const,
      byNode: { ...activeCapabilities.coconut.initialStockByNode },
      advancedThroughDay: dayNumber,
    };
    const elapsedIslandDays = Math.max(0, dayNumber - previousStocks.advancedThroughDay);
    const production = advanceCoconutBeachStocks({
      beachNodeIds: activeCapabilities.coconut.nodeIds,
      stockByNode: previousStocks.byNode,
      elapsedIslandDays,
    });
    nextState = {
      ...nextState,
      surfaceStocks: { ...previousStocks, byNode: production.stocks, advancedThroughDay: dayNumber },
      unresolved: [
        ...(nextState.unresolved ?? []),
        ...(state.surfaceStocks === undefined ? [{ sourceId: 'legacy-coconut-stock-init', detail: 'Legacy snapshot had no persisted coconut stocks; initialized current stocks to zero without retroactive production.' }] : []),
        ...production.unresolved.map(({ sourceId, detail }) => ({ sourceId, detail })),
      ],
    };
    payload = {
      ...(payload as { readonly [key: string]: JsonValue }),
      coconutStocks: production.stocks,
      coconutProductionDays: elapsedIslandDays,
    };
  }
  const event: WorldEvent = {
    eventId: `timer-${sequence}-${eventToSettle.kind}`,
    sequence,
    worldTimeT: eventToSettle.timeT,
    actorId,
    nodeId,
    kind,
    visibility: 'public',
    payload,
    randomDraws: timerRandomDraws,
  };
  return { ok: true, state: nextState, event, randomDraws: timerRandomDraws };
}

export function settleNextTimerEvent(state: WorldState, modelAssignmentsBySlot: Readonly<Record<number, ModelBinding | null>> = {}, options: SimulationTimerOptions = {}): ActionSettlement {
  const result = settleNextTimerEventCore(state, modelAssignmentsBySlot, options);
  return result.ok ? {
    ...result,
    state: clearCreaturesFromNodesEmptiedByPlayers(state, result.state, result.event.nodeId),
    event: recordResidentHpChanges(state, result.state, result.event),
  } : result;
}

export function settleResidentBiography(state: WorldState, actorId: string, text: string): ActionSettlement {
  const actor = state.actors[actorId];
  const record = state.privateLifeData?.[actorId];
  if (actor === undefined || actor.alive || record?.biographyStatus !== 'pending') {
    return { ok: false, state, unresolved: [`Resident ${actorId} has no pending death biography.`] };
  }
  if (text.trim().length === 0) return { ok: false, state, unresolved: ['Death biography text must not be empty.'] };
  const sequence = state.sequence + 1;
  const event: WorldEvent = {
    eventId: `biography-${sequence}-${actorId}`,
    sequence,
    worldTimeT: state.worldTimeT,
    actorId,
    nodeId: null,
    kind: 'biography',
    visibility: 'player-only',
    payload: { residentId: actorId, displayName: actor.name ?? actorId, generation: actor.generation ?? null, text },
    randomDraws: [],
  };
  const updated: PrivateLifeRecord = { intents: [], biographyStatus: 'complete' };
  return {
    ok: true,
    state: { ...state, sequence, privateLifeData: { ...state.privateLifeData, [actorId]: updated } },
    event,
    randomDraws: [],
  };
}

export function settleAndCommitResidentBiography(store: SQLiteWorldStore, actorId: string, text: string): ActionSettlement {
  const state = store.readSnapshot();
  if (state === null) return { ok: false, state: emptyState(), unresolved: ['World snapshot is not initialized.'] };
  const result = settleResidentBiography(state, actorId, text);
  if (!result.ok) return result;
  store.commit(state.sequence, result.state, [result.event]);
  return result;
}

export function settleAndCommitNextTimerEvent(store: SQLiteWorldStore, modelAssignmentsBySlot: Readonly<Record<number, ModelBinding | null>> = {}, options: SimulationTimerOptions = {}): ActionSettlement {
  const state = store.readSnapshot();
  if (state === null) return { ok: false, state: emptyState(), unresolved: ['World snapshot is not initialized.'] };
  const result = settleNextTimerEvent(state, modelAssignmentsBySlot, options);
  if (!result.ok) return result;
  store.commit(state.sequence, result.state, [result.event]);
  return result;
}

export function settleAndCommitNextAction(
  store: SQLiteWorldStore,
  proposal: ActionProposal,
  graph: IslandGraph,
  corpseCosts: CorpseActionCosts = CORPSE_ACTION_COSTS,
  actionContent?: SimulationActionContent,
): ActionSettlement {
  const state = store.readSnapshot();
  if (state === null) return { ok: false, state: emptyState(), unresolved: ['World snapshot is not initialized.'] };
  const result = settleNextAction(state, proposal, graph, corpseCosts, actionContent);
  if (!result.ok) return result;
  const nextState = proposal.intent === undefined ? result.state : {
    ...result.state,
    privateEventIntents: { ...state.privateEventIntents, [result.event.eventId]: proposal.intent },
  };
  store.commit(state.sequence, nextState, [result.event]);
  return { ...result, state: nextState };
}

export function settleAndCommitNextInvalidReply(store: SQLiteWorldStore, actorId: string, graph: IslandGraph): ActionSettlement {
  const state = store.readSnapshot();
  if (state === null) return { ok: false, state: emptyState(), unresolved: ['World snapshot is not initialized.'] };
  const result = settleNextInvalidReply(state, actorId, graph);
  if (!result.ok) return result;
  store.commit(state.sequence, result.state, [result.event]);
  return result;
}

function toReadyActor(actor: WorldActor): { readonly id: string; readonly speed: number; readonly nextActionAtT: number; readonly alive: boolean } {
  if (actor.speed === null || actor.speed === undefined) throw new Error(`Resident ${actor.id} has unresolved speed.`);
  return { id: actor.id, speed: actor.speed, nextActionAtT: actor.nextActionAtT, alive: actor.alive };
}

function settleActionRecord(
  state: WorldState,
  schedule: Extract<ScheduledWorldEvent, { readonly kind: 'resident-action' }>,
  actor: WorldActor,
  updatedActor: WorldActor,
  actionId: string,
  kind: string,
  payload: JsonValue,
  objects: Readonly<Record<string, WorldState['objects'][string]>> = state.objects,
  intent?: string,
  destroyedNoticeKey?: string,
): ActionSettlement {
  const sequence = state.sequence + 1;
  const event: WorldEvent = {
    eventId: `action-${sequence}-${actor.id}`,
    sequence,
    worldTimeT: schedule.timeT,
    actorId: actor.id,
    nodeId: actor.nodeId,
    kind,
    visibility: 'public',
    payload,
    randomDraws: schedule.randomDraws,
  };
  return {
    ok: true,
    state: {
      ...state,
      sequence,
      worldTimeT: schedule.timeT,
      rngState: schedule.rngState,
      actors: { ...state.actors, [actor.id]: { ...updatedActor, lastActionResult: null } },
      objects,
      ...(destroyedNoticeKey === undefined ? {} : {
        destroyedNodeNoticeKeys: [...new Set([...(state.destroyedNodeNoticeKeys ?? []), destroyedNoticeKey])],
      }),
      ...(intent === undefined ? {} : {
        privateLifeData: {
          ...state.privateLifeData,
          [actor.id]: { intents: [...(state.privateLifeData?.[actor.id]?.intents ?? []), intent], biographyStatus: 'active' as const },
        },
      }),
    },
    event,
    randomDraws: schedule.randomDraws,
  };
}

function readFoodEffect(row: CsvRow): { readonly itemId: string; readonly hungerChange: number; readonly hitPointChange: number; readonly sleepChange: number; readonly edible: boolean } | null {
  const hungerChange = Number(row['fullness_change']);
  const hitPointChange = Number(row['hp_change']);
  const sleepChange = Number(row['sleep_change']);
  if (row['name'] === undefined || !Number.isFinite(hungerChange) || !Number.isFinite(hitPointChange) || !Number.isFinite(sleepChange)) return null;
  return { itemId: row['name'], hungerChange, hitPointChange, sleepChange, edible: row['name'] !== '龍血' };
}

interface EquipmentEffect {
  readonly itemId: string;
  readonly slot: string;
  readonly attack: number;
  readonly defense: number;
  readonly speedModifier: number;
}

function findEquipment(content: SimulationActionContent, itemId: string): CsvRow | null {
  return content.equipment.find((row) => row['name_zh'] === canonicalInventoryItemId(itemId)) ?? null;
}

const EQUIPMENT_UPGRADE_TIER: Readonly<Record<string, number>> = {
  wood: 1, simple: 1, cloth: 1, basic: 1,
  iron: 2, chain: 2, mid: 2,
  knight: 3,
};

function readEquipmentUpgrade(content: SimulationActionContent, itemId: string): EquipmentEffect | null {
  const nextItemId = nextEquipmentUpgrade(itemId);
  if (nextItemId === null) return null;
  const source = findEquipment(content, itemId);
  const target = findEquipment(content, nextItemId);
  const sourceEffect = readEquipmentEffect(source);
  const targetEffect = readEquipmentEffect(target);
  if (source === null || target === null || sourceEffect === null || targetEffect === null
    || source['category'] === undefined || source['category'] !== target['category']
    || sourceEffect.slot !== targetEffect.slot || target['unique'] !== 'false') return null;
  const sourceTier = EQUIPMENT_UPGRADE_TIER[source['tier'] ?? ''];
  const targetTier = EQUIPMENT_UPGRADE_TIER[target['tier'] ?? ''];
  return sourceTier !== undefined && targetTier === sourceTier + 1 ? targetEffect : null;
}

function isEquippedInSlot(actor: WorldActor, slot: string, itemId: string, sourceSlot: string): boolean {
  if (actor.equipment?.[slot] !== itemId) return false;
  if (sourceSlot === 'both_hands') return slot === 'main_hand' && actor.equipment['off_hand'] === itemId;
  return equipmentSlot(sourceSlot) === slot;
}

function isUniqueHeroItem(itemId: string): boolean {
  return HERO_UNIQUE_ITEM_IDS.includes(itemId as (typeof HERO_UNIQUE_ITEM_IDS)[number]);
}

function readEquipmentEffect(row: CsvRow | null): EquipmentEffect | null {
  if (row === null) return null;
  const itemId = row['name_zh'];
  const slot = row['slot'];
  const attack = Number(row['attack']);
  const defense = Number(row['defense']);
  const speedModifier = Number(row['speed_modifier']);
  if (itemId === undefined || slot === undefined || !Number.isFinite(attack) || !Number.isFinite(defense) || !Number.isFinite(speedModifier)) return null;
  if (equipmentSlot(slot) === null && slot !== 'both_hands') return null;
  return { itemId, slot, attack, defense, speedModifier };
}

function equipmentSlot(sourceSlot: string): string | null {
  if (sourceSlot === 'one_hand') return 'main_hand';
  if (sourceSlot === 'off_hand') return 'off_hand';
  if (sourceSlot === 'top') return 'top';
  if (sourceSlot === 'bottom') return 'bottom';
  return null;
}

function readString(payload: JsonValue, key: string): string | null {
  if (!isJsonObject(payload)) return null;
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

function tieBreakMetrics(actor: WorldActor): TieBreakMetrics {
  return {
    id: actor.id,
    hitPoints: actor.hitPoints ?? null,
    hunger: actor.hunger ?? null,
    sleep: actor.sleep ?? null,
    attack: actor.attack ?? null,
    defense: actor.defense ?? null,
    emptySlots: actor.inventory === undefined || actor.inventory.length > 10 ? null : 10 - actor.inventory.length,
  };
}

function readTargetNode(payload: JsonValue): string | null {
  if (!isJsonObject(payload)) return null;
  const target = payload['toNodeId'];
  return typeof target === 'string' ? target : null;
}

function readWakeTime(payload: JsonValue): number | null {
  if (!isJsonObject(payload)) return null;
  const wakeAtT = payload['wakeAtT'];
  return typeof wakeAtT === 'number' && Number.isSafeInteger(wakeAtT) ? wakeAtT : null;
}

function fixedReadablePoolForItem(itemId: string | null): ReadableDocumentPool | null {
  if (itemId === '書籍') return 'book';
  if (itemId === '漂流瓶') return 'drift-bottle';
  if (itemId === '告示牌') return 'signboard';
  return null;
}

function mappedReadableTextForItem(
  actionContent: SimulationActionContent | undefined, itemId: string | null, textId: string,
): string | undefined {
  if (itemId === '告示牌' && !actionContent?.readableDocuments?.some((row) => row.document_id === textId && row.pool_type === 'signboard')) return undefined;
  return actionContent?.readableTexts?.[textId];
}

function readablePoolDocuments(
  actionContent: SimulationActionContent | undefined,
  pool: ReadableDocumentPool,
): readonly { readonly id: string; readonly pool: ReadableDocumentPool; readonly text: string }[] {
  return (actionContent?.readableDocuments ?? []).flatMap((row) => {
    const id = row.document_id;
    const text = row.text;
    return row.pool_type === pool && typeof id === 'string' && id.length > 0 && typeof text === 'string' && text.trim().length > 0
      ? [{ id, pool, text }]
      : [];
  });
}

function readObjectId(payload: JsonValue): string | null {
  if (!isJsonObject(payload)) return null;
  const objectId = payload['objectId'];
  return typeof objectId === 'string' ? objectId : null;
}

function isJsonObject(payload: JsonValue): payload is { readonly [key: string]: JsonValue } {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload);
}

function findClassifiedNodeId(state: WorldState, behavior: 'dungeonEntrance' | 'coconutBeach' | 'monumentValley'): string | null {
  return Object.values(state.nodes)
    .filter((node) => hasNodeClassificationBehavior(node.surfaceTerrain, behavior))
    .map((node) => node.id)
    .sort((left, right) => Number(left) - Number(right))[0] ?? null;
}

function hasPermanentCampfire(state: WorldState, nodeId: string, isDungeonLocation = false): boolean {
  if (isDungeonLocation) return false;
  return Object.values(state.objects).some((object) => object.itemId === '營火'
    && object.nodeId === nodeId
    && object.dungeonLocation == null
    && object.lit === true
    && object.expiresAtT === null);
}

function sameCombatLocation(left: WorldActor, right: WorldActor): boolean {
  const leftDungeon = left.dungeonLocation;
  const rightDungeon = right.dungeonLocation;
  if (leftDungeon != null || rightDungeon != null) {
    return leftDungeon != null && rightDungeon != null && leftDungeon.tripId === rightDungeon.tripId
      && leftDungeon.floor === rightDungeon.floor && leftDungeon.cellId === rightDungeon.cellId;
  }
  return left.nodeId !== null && left.nodeId === right.nodeId;
}

/** A landed hit wakes a sleeping resident immediately; HP has already been clamped by its damage resolver. */
function applyActorHit(actor: WorldActor, hitPointsAfter: number, timeT: number, wasHit = true): WorldActor {
  const alive = hitPointsAfter > 0;
  return {
    ...actor,
    hitPoints: hitPointsAfter,
    alive,
    ...(alive && wasHit && actor.actorType === 'resident' && actor.sleeping
       ? { sleeping: false, sleepingSinceT: null, sleepRecoveryBlocks: 0, nextActionAtT: timeT }
      : {}),
    ...(!alive ? { sleeping: false, sleepingSinceT: null, sleepRecoveryBlocks: 0 } : {}),
  };
}

function isSameDungeonLocation(left: WorldActor, right: WorldActor): boolean {
  const leftDungeon = left.dungeonLocation;
  const rightDungeon = right.dungeonLocation;
  return leftDungeon != null && rightDungeon != null && leftDungeon.tripId === rightDungeon.tripId
    && leftDungeon.floor === rightDungeon.floor && leftDungeon.cellId === rightDungeon.cellId;
}

function sameJson(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function timerPriority(kind: ScheduledWorldEvent['kind']): number {
  if (kind === 'sleep-recovery') return -1;
  if (kind === 'travel-arrival') return 0;
  if (kind === 'personal-sleep-risk-unresolved') return 0;
  if (kind === 'object-expiry') return 1;
  if (kind === 'day-boundary') return 2;
  return 3;
}

function emptyState(): WorldState {
  return {
    schemaVersion: 2, sequence: 0, contentVersion: '', worldTimeT: 0, seed: '', rngState: '00000001',
    actors: {}, nodes: {}, objects: {},
  };
}
