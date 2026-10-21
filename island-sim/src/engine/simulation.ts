import type { IslandGraph } from '../content/island.ts';
import type { CsvRow } from '../content/csv.ts';
import type { ActionDefinition, ActionProposal, JsonValue, ModelBinding, PrivateLifeRecord, RandomDraw, WorldActor, WorldEvent, WorldState } from '../domain/model.ts';
import type { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { applyFood, createInitialVitals } from '../domain/survival.ts';
import { applyDamage, playerDamageOnHit, residentSpeed } from '../domain/combat.ts';
import { orderReadyActorsByPriority, type TieBreakMetrics } from './tie-break.ts';
import { nextPersonalUnsafeNightRiskAt } from './night-risk.ts';
import { dayPhaseAt } from './clock.ts';
import { START_BEACH_NODE_IDS } from './world.ts';
import { SeededRandom } from './random.ts';
import { resolveForestSleepRisk } from '../domain/forest-risk.ts';
import type { AreaRiskEntry } from '../domain/surface.ts';
import { resolveSurfaceAction, harvestCoconut, advanceCoconutBeachStocks, advanceNightExplorationStreak, type SurfaceAction, type SurfaceTables } from '../domain/surface.ts';
import { createActiveSurfaceCapabilities, type ActiveSurfaceCapabilities } from '../content/approved-surface-capabilities.ts';

export type ActionSettlement =
  | { readonly ok: true; readonly state: WorldState; readonly event: WorldEvent; readonly randomDraws: readonly RandomDraw[] }
  | { readonly ok: false; readonly state: WorldState; readonly unresolved: readonly string[] };

export type ScheduledWorldEvent =
  | { readonly kind: 'resident-action'; readonly timeT: number; readonly actorIds: readonly string[]; readonly randomDraws: readonly RandomDraw[]; readonly rngState: string; readonly unresolved: readonly string[] }
  | { readonly kind: 'travel-arrival'; readonly timeT: number; readonly actorId: string }
  | { readonly kind: 'object-expiry'; readonly timeT: number; readonly objectId: string }
  | { readonly kind: 'day-boundary'; readonly timeT: number }
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
  readonly recovered?: readonly CsvRow[];
  readonly monsters?: readonly CsvRow[];
  readonly capabilities?: ActiveSurfaceCapabilities;
  readonly riskTablesByNode?: Readonly<Record<string, readonly AreaRiskEntry[] | null>>;
  readonly forestEntryOutcomesByNode?: Readonly<Record<string, readonly AreaRiskEntry[] | undefined>>;
}

export interface SimulationTimerOptions {
  readonly sleepRiskTableByNode?: Readonly<Record<string, readonly AreaRiskEntry[] | null>>;
  readonly wildernessNodeIds?: readonly string[];
}

export function availableActions(state: WorldState, actorId: string, graph: IslandGraph, corpseCosts: CorpseActionCosts = CORPSE_ACTION_COSTS, actionContent?: SimulationActionContent): readonly ActionDefinition[] {
  const actor = state.actors[actorId];
  if (actor === undefined || !actor.alive || actor.actorType !== 'resident' || actor.nodeId === null || actor.sleeping) return [];
  const actions: ActionDefinition[] = [{
    id: 'wait', type: 'wait', name: '等待', costT: 1, requiresText: false, payload: {}, payloadSchemaKey: 'empty',
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
  if (actionContent !== undefined) {
    const inventory = actor.inventory ?? [];
    if ((actor.hunger ?? 5) < 5) {
      for (const itemId of inventory) {
        const food = actionContent.foods.find((row) => row.name === itemId);
        if (food === undefined || food.name === '龍血' || readFoodEffect(food) === null) continue;
        actions.push({ id: `eat:${itemId}`, type: 'eat', name: `食用${itemId}`, costT: 1, requiresText: false, payload: { itemId }, payloadSchemaKey: 'inventory-item-id' });
      }
    }
    if (actor.attack !== undefined) {
      for (const itemId of inventory) {
        if (readEquipmentEffect(findEquipment(actionContent, itemId)) !== null) {
          actions.push({ id: `equip:${itemId}`, type: 'equip', name: `裝備${itemId}`, costT: 1, requiresText: false, payload: { itemId }, payloadSchemaKey: 'inventory-item-id' });
        }
      }
    }
  }
  if ((actor.inventory?.length ?? 0) < 10) {
    for (const object of Object.values(state.objects).filter((candidate) => candidate.objectType !== 'corpse' && candidate.itemId !== null && candidate.nodeId === actor.nodeId && candidate.ownerActorId === null && (candidate.corpseId === undefined || candidate.corpseId === null))) {
      actions.push({ id: `pickup:${object.id}`, type: 'pickup', name: `拾取${object.itemId}`, costT: 1, requiresText: false, payload: { objectId: object.id }, payloadSchemaKey: 'world-object-id' });
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
    const approvedNodes = capabilities.nodeIdsByAction as Readonly<Record<string, readonly string[]>>;
    for (const [capability, surfaceAction, label] of nodeActions) {
      if ((approvedNodes[capability] ?? []).includes(actor.nodeId)) {
        actions.push({ id: `surface:${surfaceAction}`, type: 'surface', name: label, costT: 3, requiresText: false, payload: { surfaceAction }, payloadSchemaKey: 'surface-action' });
      }
    }
    if (dayPhaseAt(decisionTimeT) === 'night' && approvedNodes['night-river-dive']?.includes(actor.nodeId)) {
      actions.push({ id: 'surface:night-river-dive', type: 'surface', name: '夜間河流潛水', costT: 3, requiresText: false, payload: { surfaceAction: 'night-river-dive' }, payloadSchemaKey: 'surface-action' });
    }
    if (approvedNodes['coconut-harvest']?.includes(actor.nodeId) && (state.surfaceStocks?.byNode[actor.nodeId] ?? 0) > 0) {
      actions.push({ id: 'harvest-coconut', type: 'harvest-coconut', name: '採集椰子', costT: capabilities.coconut.harvestCostT, requiresText: false, payload: { nodeId: actor.nodeId }, payloadSchemaKey: 'current-node' });
    }
  }
  if (actor.attack !== undefined) {
    for (const target of Object.values(state.actors).filter((candidate) => candidate.id !== actor.id && candidate.alive && candidate.actorType === 'resident' && candidate.nodeId === actor.nodeId && candidate.defense !== undefined && candidate.hitPoints !== undefined)) {
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
    actions.push({
      id: `move:${targetNodeId}`, type: 'move', name: `移動至 Node ${targetNodeId}`, costT: 3,
      requiresText: false, payload: { toNodeId: targetNodeId }, payloadSchemaKey: 'move-target',
    });
  }
  return actions;
}

export function orderNextResidents(state: WorldState): {
  readonly actionTimeT: number | null;
  readonly actorIds: readonly string[];
  readonly randomDraws: readonly RandomDraw[];
  readonly rngState: string;
  readonly unresolved: readonly string[];
} {
  const living = Object.values(state.actors).filter((actor) => actor.actorType === 'resident' && actor.alive);
  if (living.length === 0) return { actionTimeT: null, actorIds: [], randomDraws: [], rngState: state.rngState, unresolved: ['No living residents are available to act.'] };
  const actionTimeT = Math.max(state.worldTimeT, Math.min(...living.map((actor) => actor.nextActionAtT)));
  const metrics = new Map<string, TieBreakMetrics>();
  const unresolved: string[] = [];
  for (const actor of living) if (actor.speed === null || actor.speed === undefined) unresolved.push(`Resident ${actor.id} has unresolved current speed.`);
  for (const actor of living) {
    const metric = tieBreakMetrics(actor);
    if (metric === null) unresolved.push(`Resident ${actor.id} lacks required same-speed priority stats.`);
    else metrics.set(actor.id, metric);
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
  const timers: Array<Extract<ScheduledWorldEvent, { readonly kind: 'travel-arrival' | 'object-expiry' | 'day-boundary' | 'personal-sleep-risk-unresolved' }>> = [];
  for (const actor of Object.values(state.actors)) {
    if (actor.alive && actor.travel !== undefined && actor.travel !== null) {
      timers.push({ kind: 'travel-arrival', timeT: actor.travel.arrivesAtT, actorId: actor.id });
    }
  }
  for (const object of Object.values(state.objects)) {
    if (object.expiresAtT !== null) timers.push({ kind: 'object-expiry', timeT: object.expiresAtT, objectId: object.id });
  }
  const nextDayBoundary = (Math.floor(state.worldTimeT / 72) + 1) * 72;
  timers.push({ kind: 'day-boundary', timeT: nextDayBoundary });
  for (const actor of Object.values(state.actors)) {
    if (!actor.alive || actor.actorType !== 'resident' || actor.unsafeEntryAtT === null || !actor.sleeping || actor.nodeId === null || state.nodes[actor.nodeId]?.safe !== false) continue;
    const dueAtT = nextPersonalUnsafeNightRiskAt(actor.unsafeEntryAtT, state.worldTimeT, true, true);
    if (dueAtT === null) continue;
    const unresolved = ['C-12: sleep risk must reuse the area-entry table; if this Node has no supplied table, record the gate and do not substitute another event pool.'];
    timers.push({ kind: 'personal-sleep-risk-unresolved', timeT: dueAtT, actorId: actor.id, unresolved });
  }
  const firstTimer = timers.sort((left, right) => left.timeT - right.timeT || timerPriority(left.kind) - timerPriority(right.kind))[0];
  if (firstTimer !== undefined && (residentTime === null || firstTimer.timeT <= residentTime)) return firstTimer;
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

export function settleNextAction(state: WorldState, proposal: ActionProposal, graph: IslandGraph, corpseCosts: CorpseActionCosts = CORPSE_ACTION_COSTS, actionContent?: SimulationActionContent): ActionSettlement {
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
  if (action === undefined) return { ok: false, state, unresolved: [`Action ${proposal.actionId} is not currently legal for ${actorId}.`] };
  if (proposal.timeCostT !== action.costT || !sameJson(proposal.payload, action.payload)) {
    return { ok: false, state, unresolved: [`Action proposal for ${proposal.actionId} does not match the current action definition.`] };
  }
  if (proposal.intent !== undefined && Array.from(proposal.intent).length > 30) {
    return { ok: false, state, unresolved: ['Action intent exceeds the source 30-character limit.'] };
  }
  const actor = state.actors[actorId];
  if (actor === undefined) return { ok: false, state, unresolved: [`Resident ${actorId} is missing from the world snapshot.`] };

  if (action.type === 'surface') {
    const surfaceAction = readString(action.payload, 'surfaceAction');
    const nodeId = actor.nodeId;
    if (surfaceAction === null || nodeId === null || actionContent?.capabilities?.runtimeEnabled !== true
      || actionContent.fishing === undefined || actionContent.surface === undefined || actionContent.recovered === undefined) {
      return { ok: false, state, unresolved: ['Surface action requires the active node crosswalk and complete source action tables.'] };
    }
    if (!isSurfaceAction(surfaceAction)) return { ok: false, state, unresolved: [`Unsupported surface action ${surfaceAction}.`] };
    const tables: SurfaceTables = {
      fishing: actionContent.fishing, surface: actionContent.surface, recovered: actionContent.recovered,
      ...(actionContent.monsters === undefined ? {} : { monsters: actionContent.monsters }),
    };
    const objectId = `surface-item-${state.sequence + 1}-${actor.id}`;
    const existingUniqueItems = Object.values(state.objects).filter((object) => object.unique && object.itemId !== null).map((object) => object.itemId as string);
    const result = resolveSurfaceAction({
      action: surfaceAction,
      actor: { id: actor.id, hitPoints: actor.hitPoints ?? 0, hunger: actor.hunger ?? 0, sleep: actor.sleep ?? 0, inventory: actor.inventory ?? [] },
      nodeId,
      worldTimeT: schedule.timeT,
      phase: dayPhaseAt(schedule.timeT),
      actionAvailableAtNode: (actionContent.capabilities.nodeIdsByAction as Readonly<Record<string, readonly string[]>>)[surfaceAction]?.includes(nodeId) ?? false,
      randomState: schedule.rngState,
      tables,
      existingUniqueItems,
      objectId,
    });
    if (result.timeCostT !== action.costT) return { ok: false, state, unresolved: result.unresolved.map(({ detail }) => detail).concat(`Surface action resolved with ${result.timeCostT}T but its legal definition costs ${action.costT}T.`) };
    const sequence = state.sequence + 1;
    const newObjects = { ...state.objects, ...Object.fromEntries(result.createdObjects.map((object) => [object.id, object])) };
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
        newObjects[droppedId] = { id: droppedId, itemId, objectType: 'item', corpseId, ownerActorId: null, nodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: false, provisional: false };
      });
      privateLifeData = { ...state.privateLifeData, [actor.id]: { intents: state.privateLifeData?.[actor.id]?.intents ?? [], biographyStatus: 'pending' } };
    }
    const payload: JsonValue = {
      action: surfaceAction, outcome: result.outcome, actorDelta: result.actorDelta,
      uniqueItemAlreadyExists: result.uniqueItemAlreadyExists, unresolved: result.unresolved.map(({ sourceId, detail }) => ({ sourceId, detail })),
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
      actors: { ...state.actors, [actor.id]: updatedActor }, objects: newObjects,
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

  if (action.type === 'eat') {
    const itemId = readString(action.payload, 'itemId');
    const food = itemId === null ? undefined : actionContent?.foods.find((row) => row.name === itemId);
    const effect = food === undefined ? null : readFoodEffect(food);
    if (itemId === null || effect === null || itemId === '龍血') return { ok: false, state, unresolved: [`Food item for ${action.id} is not available from the current source catalog.`] };
    const inventory = actor.inventory ?? [];
    const itemIndex = inventory.indexOf(itemId);
    if (itemIndex < 0) return { ok: false, state, unresolved: [`Resident ${actorId} no longer carries ${itemId}.`] };
    const foodResult = applyFood({ hitPoints: actor.hitPoints ?? 0, hunger: actor.hunger ?? 5, sleep: actor.sleep ?? 0, inventory: [] }, effect);
    if (!foodResult.accepted) return { ok: false, state, unresolved: [`Resident ${actorId} cannot eat ${itemId} in the current state.`] };
    const nextInventory = inventory.filter((_, index) => index !== itemIndex);
    const updatedActor = {
      ...actor,
      hitPoints: foodResult.vitals.hitPoints,
      hunger: foodResult.vitals.hunger,
      sleep: foodResult.vitals.sleep,
      inventory: nextInventory,
      nextActionAtT: schedule.timeT + action.costT,
      lastActionId: action.id,
    };
    return settleActionRecord(state, schedule, actor, updatedActor, action.id, 'resident-ate', { itemId, timeCostT: action.costT }, undefined, proposal.intent);
  }

  if (action.type === 'pickup') {
    const objectId = readObjectId(action.payload);
    const object = objectId === null ? undefined : state.objects[objectId];
    const inventory = actor.inventory ?? [];
    if (object === undefined || object.objectType === 'corpse' || object.itemId === null || object.nodeId !== actor.nodeId || object.ownerActorId !== null || (object.corpseId !== undefined && object.corpseId !== null)) {
      return { ok: false, state, unresolved: [`Ground item ${objectId ?? '(missing)'} is no longer available at the resident's Node.`] };
    }
    if (inventory.length >= 10) return { ok: false, state, unresolved: [`Resident ${actorId} has no free inventory slot.`] };
    const objects = { ...state.objects };
    delete objects[object.id];
    const updatedActor = { ...actor, inventory: [...inventory, object.itemId], nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id };
    return settleActionRecord(state, schedule, actor, updatedActor, action.id, 'item-picked-up', { objectId: object.id, itemId: object.itemId, timeCostT: action.costT }, objects, proposal.intent);
  }

  if (action.type === 'equip') {
    const itemId = readString(action.payload, 'itemId');
    const equipmentRows = actionContent?.equipment;
    const itemCatalog = { foods: [], equipment: equipmentRows ?? [] };
    const item = itemId === null ? null : findEquipment(itemCatalog, itemId);
    const effect = readEquipmentEffect(item);
    if (itemId === null || effect === null) return { ok: false, state, unresolved: [`Equipment item for ${action.id} is not available with complete source combat values.`] };
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
        nextEquipment[slot] = itemId;
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
      nextEquipment[slot] = itemId;
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
    return settleActionRecord(state, schedule, actor, updatedActor, action.id, 'item-equipped', { itemId, attack, defense, speed, timeCostT: action.costT }, undefined, proposal.intent);
  }

  if (action.type === 'attack') {
    const targetId = readString(action.payload, 'targetActorId');
    const target = targetId === null ? undefined : state.actors[targetId];
    if (target === undefined || !target.alive || target.actorType !== 'resident' || target.nodeId !== actor.nodeId || target.defense === undefined || target.hitPoints === undefined || actor.attack === undefined) {
      return { ok: false, state, unresolved: [`Attack target for ${action.id} is no longer a valid same-Node resident.`] };
    }
    const damage = playerDamageOnHit(actor.attack, target.defense);
    const struck = applyDamage(target.hitPoints, damage);
    const sequence = state.sequence + 1;
    const attacker = { ...actor, nextActionAtT: schedule.timeT + action.costT, lastActionId: action.id };
    let objects = state.objects;
    let privateLifeData = state.privateLifeData;
    if (!struck.alive) {
      const corpseId = `corpse-${target.id}-${sequence}`;
      const droppedItems = [...(target.inventory ?? []), ...Object.values(target.equipment ?? {}).filter((value): value is string => value !== null)];
      objects = {
        ...objects,
        [corpseId]: { id: corpseId, itemId: null, objectType: 'corpse', remainsActorId: target.id, ownerActorId: null, nodeId: target.nodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: false, provisional: false },
        ...Object.fromEntries(droppedItems.map((itemId, index) => {
          const objectId = `corpse-loot-${target.id}-${sequence}-${index + 1}`;
          return [objectId, { id: objectId, itemId, objectType: 'item' as const, corpseId, ownerActorId: null, nodeId: target.nodeId, generatedAtT: schedule.timeT, expiresAtT: null, unique: false, provisional: false }];
        })),
      };
      privateLifeData = { ...privateLifeData, [target.id]: { intents: privateLifeData?.[target.id]?.intents ?? [], biographyStatus: 'pending' } };
    }
    const wokeFromAttack = struck.alive && target.sleeping;
    const updatedTarget = {
      ...target,
      hitPoints: struck.hitPoints,
      alive: struck.alive,
      ...(wokeFromAttack ? { sleeping: false, sleepingSinceT: null, nextActionAtT: schedule.timeT } : {}),
      ...(!struck.alive ? { diedAtT: schedule.timeT, nodeId: null, inventory: [], equipment: {}, sleeping: false, sleepingSinceT: null } : {}),
    };
    const stateAfter = {
      ...state,
      sequence,
      worldTimeT: schedule.timeT,
      rngState: schedule.rngState,
      actors: { ...state.actors, [actor.id]: attacker, [target.id]: updatedTarget },
      objects,
      ...(privateLifeData === undefined ? {} : { privateLifeData }),
      ...(proposal.intent === undefined ? {} : { privateLifeData: { ...privateLifeData, [actor.id]: { intents: [...(privateLifeData?.[actor.id]?.intents ?? []), proposal.intent], biographyStatus: 'active' as const } } }),
    };
    const event: WorldEvent = {
      eventId: `action-${sequence}-${actor.id}`, sequence, worldTimeT: schedule.timeT, actorId: actor.id, nodeId: actor.nodeId,
      kind: 'resident-attacked', visibility: 'public', payload: { targetActorId: target.id, damage, hitPointsAfter: struck.hitPoints, killed: !struck.alive, timeCostT: action.costT }, randomDraws: schedule.randomDraws,
    };
    return { ok: true, state: stateAfter, event, randomDraws: schedule.randomDraws };
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

  if (actor === undefined || actor.nodeId === null) return { ok: false, state, unresolved: [`Resident ${actorId} has no valid current Node.`] };
  const fromNodeId = actor.nodeId;
  const toNodeId = action.type === 'move' ? readTargetNode(action.payload) : fromNodeId;
  const adjacent = graph.edges.some(({ source, target }) => (source === fromNodeId && target === toNodeId) || (source === toNodeId && target === fromNodeId));
  if (toNodeId === null || (action.type === 'move' && !adjacent)) {
    return { ok: false, state, unresolved: [`Move target for ${proposal.actionId} is not an adjacent Node.`] };
  }
  const moving = action.type === 'move';
  const sleeping = action.type === 'sleep';
  const wakeAtT = sleeping ? readWakeTime(action.payload) : null;
  const settledActor: WorldActor = {
    ...actor,
    nodeId: moving ? null : toNodeId,
    travel: moving ? { fromNodeId, toNodeId, arrivesAtT: schedule.timeT + action.costT } : null,
    nextActionAtT: wakeAtT ?? schedule.timeT + action.costT,
    sleeping,
    sleepingSinceT: sleeping ? schedule.timeT : null,
    lastActionId: action.id,
  };
  const sequence = state.sequence + 1;
  const event: WorldEvent = {
    eventId: `action-${sequence}-${actorId}`,
    sequence,
    worldTimeT: schedule.timeT,
    actorId,
    nodeId: moving ? null : toNodeId,
    kind: 'resident-action-settled',
    visibility: 'public',
    payload: {
      actionId: action.id,
      actionType: action.type,
      timeCostT: action.costT,
      fromNodeId,
      toNodeId,
      inTransit: moving,
      sleepingUntilT: wakeAtT,
      actorSpeed: actor.speed,
    },
    randomDraws: schedule.randomDraws,
  };
  const nextState: WorldState = {
    ...state,
    sequence,
    worldTimeT: schedule.timeT,
    rngState: schedule.rngState,
    actors: { ...state.actors, [actorId]: settledActor },
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
  return { ok: true, state: nextState, event, randomDraws: schedule.randomDraws };
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

export function settleNextTimerEvent(state: WorldState, modelAssignmentsBySlot: Readonly<Record<number, ModelBinding | null>> = {}, options: SimulationTimerOptions = {}): ActionSettlement {
  const eventToSettle = nextWorldEvent(state);
  if (eventToSettle.kind === 'resident-action') return { ok: false, state, unresolved: ['The next world event is a resident action, not a timer.'] };
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
    const checks: Array<{ readonly actorId: string; readonly category: string | null; readonly outcomeId: string | null; readonly unresolved: readonly string[] }> = [];
    let rngState = state.rngState;
    for (const sleeper of Object.values(state.actors).filter((candidate) => candidate.alive && candidate.actorType === 'resident' && candidate.sleeping && candidate.nodeId !== null && state.nodes[candidate.nodeId]?.safe === false && candidate.unsafeEntryAtT !== null && nextPersonalUnsafeNightRiskAt(candidate.unsafeEntryAtT, eventToSettle.timeT - 3, true, true) === eventToSettle.timeT).sort((left, right) => left.id.localeCompare(right.id))) {
      const nodeId = sleeper.nodeId as string;
      const risk = resolveForestSleepRisk({
        actorId: sleeper.id,
        nodeId,
        worldTimeT: eventToSettle.timeT,
        isSafeNode: false,
        isWilderness: options.wildernessNodeIds?.includes(nodeId) ?? false,
        table: options.sleepRiskTableByNode?.[nodeId] ?? null,
        randomState: rngState,
      });
      rngState = risk.rngStateAfter;
      timerRandomDraws.push(...risk.randomDraws);
      let unresolved = risk.unresolved.map(({ sourceId, detail }) => `${sourceId}: ${detail}`);
      let updated = sleeper;
      const selected = risk.selectedOutcome;
      if (selected?.polarity === 'negative') {
        const delta = readRiskDelta(selected.payload);
        if (delta === null) unresolved = [...unresolved, `C-12: negative sleep-risk row ${selected.id} has no supported HP/sleep effect fields.`];
        else {
          const hitPoints = Math.max(0, (sleeper.hitPoints ?? 0) + delta.hitPointChange);
          const sleep = Math.max(0, (sleeper.sleep ?? 0) + delta.sleepChange);
          const alive = hitPoints > 0;
          updated = { ...sleeper, hitPoints, sleep, alive, ...(alive ? {} : { diedAtT: eventToSettle.timeT, nodeId: null, sleeping: false, sleepingSinceT: null, inventory: [], equipment: {} }) };
          if (!alive) {
            const corpseId = `corpse-${sleeper.id}-${sequence}`;
            const possessions = [...(sleeper.inventory ?? []), ...new Set(Object.values(sleeper.equipment ?? {}).filter((item): item is string => item !== null))];
            objects[corpseId] = { id: corpseId, itemId: null, objectType: 'corpse', remainsActorId: sleeper.id, ownerActorId: null, nodeId, generatedAtT: eventToSettle.timeT, expiresAtT: null, unique: false, provisional: false };
            possessions.forEach((itemId, index) => {
              const objectId = `corpse-loot-${sleeper.id}-${sequence}-${index + 1}`;
              objects[objectId] = { id: objectId, itemId, objectType: 'item', corpseId, ownerActorId: null, nodeId, generatedAtT: eventToSettle.timeT, expiresAtT: null, unique: false, provisional: false };
            });
            privateLifeData[sleeper.id] = { intents: state.privateLifeData?.[sleeper.id]?.intents ?? [], biographyStatus: 'pending' };
          }
        }
      }
      actors[sleeper.id] = updated;
      checks.push({ actorId: sleeper.id, category: risk.category, outcomeId: selected?.id ?? null, unresolved });
    }
    kind = 'personal-sleep-risk-settled';
    payload = { checks, sourceRule: 'unsafe-sleep-uses-area-entry-risk-table-directly-every-three-T-maximum-eight-per-night' };
    nextState = {
      ...nextState,
      rngState,
      actors,
      objects,
      privateLifeData,
      unresolved: [...(state.unresolved ?? []), ...checks.flatMap(({ unresolved: issues }) => issues.map((detail) => ({ sourceId: 'sleep-risk', detail })))],
    };
  } else if (eventToSettle.kind === 'travel-arrival') {
    const actor = state.actors[eventToSettle.actorId];
    if (actor === undefined || actor.travel === undefined || actor.travel === null) return { ok: false, state, unresolved: ['Travel arrival timer has no matching resident transit state.'] };
    actorId = actor.id;
    nodeId = actor.travel.toNodeId;
    kind = 'resident-arrived';
    payload = { fromNodeId: actor.travel.fromNodeId, toNodeId: actor.travel.toNodeId };
    const objects = { ...state.objects };
    for (const object of Object.values(state.objects)) {
      if ((object.objectType === 'corpse' || object.corpseId !== null && object.corpseId !== undefined) && object.ownerActorId === actor.id) objects[object.id] = { ...object, nodeId };
    }
    nextState = {
      ...nextState,
      actors: { ...state.actors, [actor.id]: { ...actor, nodeId, travel: null, unsafeEntryAtT: eventToSettle.timeT } },
      objects,
    };
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
      const completedFullNight = actor.sleeping && actor.sleepingSinceT !== undefined && actor.sleepingSinceT !== null && actor.sleepingSinceT <= eventToSettle.timeT - 24;
      const sleep = completedFullNight ? 3 : Math.max(0, actor.sleep - 1);
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
            generatedAtT: eventToSettle.timeT, expiresAtT: null, unique: false, provisional: false,
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
        sleeping: false, sleepingSinceT: null, nextActionAtT: eventToSettle.timeT,
      };
    }
    const rng = new SeededRandom(state.rngState);
    const born: Array<{ readonly slotId: string; readonly actorId: string; readonly generation: number; readonly nodeId: string }> = [];
    for (let slotIndex = 0; slotIndex < 10; slotIndex += 1) {
      const slotId = String(slotIndex);
      const slotActors = Object.values(actors).filter((actor) => actor.actorType === 'resident' && actor.slotId === slotId);
      if (slotActors.some((actor) => actor.alive)) continue;
      const mostRecent = slotActors.reduce<WorldActor | undefined>((latest, actor) => (actor.generation ?? 0) > (latest?.generation ?? 0) ? actor : latest, undefined);
      if (mostRecent !== undefined && mostRecent.diedAtT !== undefined && mostRecent.diedAtT !== null && mostRecent.diedAtT >= eventToSettle.timeT) continue;
      const generation = (mostRecent?.generation ?? 0) + 1;
      const id = `resident-${slotId}.${generation}`;
      const modelSlotId = slotIndex + 1;
      const modelAssignment = modelAssignmentsBySlot[modelSlotId] ?? null;
      const draw = rng.next(`resident-generation-${generation}-start:${id}`);
      const spawnNodeId = START_BEACH_NODE_IDS[Math.floor(draw.value * START_BEACH_NODE_IDS.length)];
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
      };
      actors[id] = actor;
      born.push({ slotId, actorId: id, generation, nodeId: spawnNodeId });
    }
    nextState = { ...nextState, rngState: rng.stateHex, actors };
    payload = { dayNumber: Math.floor(eventToSettle.timeT / 72), rule: 'daily-hunger-sleep-decay-and-zero-resource-hp-loss', deaths, newGenerations: born };
    nextState = { ...nextState, actors, objects, privateLifeData };
    const activeCapabilities = createActiveSurfaceCapabilities(Object.values(state.nodes).map((node) => ({
      node_id: node.id, visual_type: node.visualType, node_label: node.label ?? '', label_status: node.labelStatus,
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
  store.commit(state.sequence, result.state, [result.event]);
  return result;
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
  return content.equipment.find((row) => row['name_zh'] === itemId) ?? null;
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

function tieBreakMetrics(actor: WorldActor): TieBreakMetrics | null {
  if (actor.hitPoints === undefined || actor.hunger === undefined || actor.sleep === undefined || actor.attack === undefined || actor.defense === undefined) return null;
  if (actor.inventory === undefined || actor.inventory.length > 10) return null;
  return {
    id: actor.id,
    hitPoints: actor.hitPoints,
    hunger: actor.hunger,
    sleep: actor.sleep,
    attack: actor.attack,
    defense: actor.defense,
    emptySlots: 10 - actor.inventory.length,
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

function readObjectId(payload: JsonValue): string | null {
  if (!isJsonObject(payload)) return null;
  const objectId = payload['objectId'];
  return typeof objectId === 'string' ? objectId : null;
}

function isJsonObject(payload: JsonValue): payload is { readonly [key: string]: JsonValue } {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload);
}

function readRiskDelta(payload: JsonValue | undefined): { readonly hitPointChange: number; readonly sleepChange: number } | null {
  if (payload === undefined || !isJsonObject(payload)) return null;
  const hitPointChange = payload['hitPointChange'];
  const sleepChange = payload['sleepChange'];
  if ((hitPointChange !== undefined && typeof hitPointChange !== 'number') || (sleepChange !== undefined && typeof sleepChange !== 'number')) return null;
  if (hitPointChange === undefined && sleepChange === undefined) return null;
  return {
    hitPointChange: typeof hitPointChange === 'number' ? hitPointChange : 0,
    sleepChange: typeof sleepChange === 'number' ? sleepChange : 0,
  };
}

function sameJson(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function timerPriority(kind: ScheduledWorldEvent['kind']): number {
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
