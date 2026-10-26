import type { WorldEvent, WorldState } from '../domain/model.ts';
import { describeWorldEvent } from '../domain/event-narrative.ts';
import { canonicalInventoryItemId } from '../domain/item-identity.ts';
import type { IslandGraph } from '../content/island.ts';
import { formatNodeLocationReference, locationNameForNode } from '../content/location-names.ts';
import { dayPhaseAt } from '../engine/clock.ts';
import { DUNGEON_CELL_IDS, dungeonCellNeighbors } from '../engine/dungeon-runtime.ts';
import { projectWorld } from '../engine/world.ts';
import type { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import type { ObserverReadPort, ObserverResidentIntent, ObserverSnapshot } from './observer.ts';

export interface RuntimeControlPort {
  getState(): { readonly paused: boolean; readonly speedMultiplier: number; readonly status?: string };
  pause(): void | Promise<void>;
  resume(): void | Promise<void>;
}

export interface ObserverLifecyclePort {
  read(): NonNullable<ObserverSnapshot['lifecycle']> | null;
  setNextResidentCount?(residentCount: number): void;
  setSetupMapId?(mapId: string): void;
  startNew(name?: string, mapId?: string): Promise<void>;
  save(name: string): Promise<void>;
  end(): Promise<void>;
  load(saveId: string): Promise<void>;
}

export interface ObserverRuntimeConfig {
  readonly control?: RuntimeControlPort;
  readonly lifecycle?: ObserverLifecyclePort;
  readonly sourceGraph?: IslandGraph;
  readonly surfaceEntryEvents?: readonly {
    readonly outcome?: string;
    readonly effect?: string;
    readonly object_type?: string;
    readonly item_id?: string;
    readonly monster_name?: string;
  }[];
}

export class SQLiteObserverPort implements ObserverReadPort {
  private readonly store: SQLiteWorldStore;
  private readonly config: ObserverRuntimeConfig;

  constructor(
    store: SQLiteWorldStore,
    config: ObserverRuntimeConfig = {},
  ) {
    this.store = store;
    this.config = config;
  }

  async readSnapshot(): Promise<ObserverSnapshot> {
    const state = this.store.readSnapshot();
    const events = this.store.readEvents(Math.max(0, (state?.sequence ?? 0) - 500), 500);
    const lifecycle = this.config.lifecycle?.read() ?? undefined;
    if (!state) return { ...emptySnapshot(events, this.config), ...(lifecycle ? { lifecycle } : {}) };
    const intentEvents: WorldEvent[] = [];
    let cursor = 0;
    for (;;) {
      const page = this.store.readEvents(cursor, 5000);
      intentEvents.push(...page);
      const last = page.at(-1);
      if (!last || page.length < 5000) break;
      cursor = last.sequence;
    }
    return { ...projectSnapshot(state, events, this.config, intentEvents), ...(lifecycle ? { lifecycle } : {}) };
  }

  async requestControl(request: { readonly kind: 'pause' | 'resume' }): Promise<void> {
    const runtime = this.config.control;
    if (!runtime) throw new Error('模擬執行控制器尚未連接。');
    if (request.kind === 'pause') return runtime.pause();
    return runtime.resume();
  }
}

export function projectSnapshot(state: WorldState, events: readonly WorldEvent[], config: ObserverRuntimeConfig, intentEvents: readonly WorldEvent[] = events): ObserverSnapshot {
  const projection = projectWorld(state);
  const nodes = projection.nodes;
  const sourceNodes = new Map((config.sourceGraph?.nodes ?? []).map((node) => [node.id, node]));
  const coordinates = new Map(nodes.map((node) => {
    const position = node.mapPosition ?? sourceNodes.get(node.id)?.approximateImagePosition;
    if (position?.x !== null && position?.x !== undefined && position.y !== null) {
      return [node.id, { x: position.x, y: position.y }];
    }
    return [node.id, { x: 0, y: 0 }];
  }));
  const residents = projection.actors.filter((actor) => actor.actorType === 'resident');
  const monsters = projection.actors.filter((actor) => actor.actorType === 'monster' && actor.alive && actor.nodeId !== null);
  const dungeonFloorLabels = [
    { number: 1, label: '第一層 · 雨林' },
    { number: 2, label: '第二層 · 溫泉下水道' },
    { number: 3, label: '第三層 · 火山洞窟' },
  ] as const;
  const dungeonResidentLocations = residents.flatMap((resident) => {
    const runtimeCell = state.dungeonRuntime?.cellByActorId[resident.id];
    const floor = resident.dungeonLocation?.floor ?? (runtimeCell ? state.dungeonRuntime?.activeFloor : undefined);
    const cellId = resident.dungeonLocation?.cellId ?? runtimeCell;
    if (floor === undefined || cellId === undefined || !DUNGEON_CELL_IDS.includes(cellId as typeof DUNGEON_CELL_IDS[number])) return [];
    return [{ actorId: resident.id, floor, cellId }];
  });
  const nodeResidents = new Map<string, string[]>();
  for (const resident of residents) {
    if (resident.alive && resident.nodeId) nodeResidents.set(resident.nodeId, [...(nodeResidents.get(resident.nodeId) ?? []), resident.id]);
  }
  const nodeObjects = new Map<string, { label: string; type: 'item' | 'corpse' | 'container' | 'unknown' }[]>();
  for (const object of projection.objects) {
    if (!object.nodeId) continue;
    const type = object.objectType ?? (object.itemId ? 'item' : 'unknown');
    const remainsName = object.remainsActorId ? state.actors[object.remainsActorId]?.name?.trim() : undefined;
    const label = type === 'corpse' ? (remainsName ? `${remainsName} 的遺體` : '遺體殘骸')
      : type === 'container' ? (object.itemId ? `${itemDisplayName(object.itemId)}（容器）` : '容器')
        : object.itemId ? itemDisplayName(object.itemId) : '未分類物件';
    nodeObjects.set(object.nodeId, [...(nodeObjects.get(object.nodeId) ?? []), { label, type }]);
  }
  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const projectedEvents = events.filter(isObserverEvent).map((event) => {
    const eventNodeId = observerEventNodeId(event);
    const eventActor = event.actorId === null ? undefined : state.actors[event.actorId];
    const eventNodeLabel = eventNodeId
      ? locationNameForNode(eventNodeId, state.nodes[eventNodeId]?.label ?? sourceNodes.get(eventNodeId)?.label)
      : undefined;
    return {
      id: event.eventId,
      sequence: event.sequence,
      kind: event.kind,
      day: Math.floor(event.worldTimeT / 72) + 1,
      timeT: event.worldTimeT % 72,
      ...(eventNodeId ? { nodeId: eventNodeId } : {}),
      ...(eventNodeLabel ? { nodeLabel: eventNodeLabel } : {}),
      ...(event.actorId && !isMonsterIdentifier(event.actorId) && (!eventActor || eventActor.actorType === 'resident') ? { actorId: event.actorId } : {}),
      participantIds: collectResidentParticipantIds(event, state),
      description: describeObserverEvent(event, state, config),
      ...(state.privateEventIntents?.[event.eventId] === undefined ? {} : { intent: state.privateEventIntents[event.eventId] }),
      interaction: describeEventInteraction(event, state),
      ...(event.visibility === 'public' && event.kind === 'public-message-sent' && typeof (isRecord(event.payload) ? event.payload.text : undefined) === 'string' && typeof (isRecord(event.payload) ? event.payload.recipientId : undefined) === 'string' ? {
        publicMessage: {
          sender: event.actorId ? describeParticipant(event.actorId, state) : '居民',
          recipient: describeParticipant((event.payload as Record<string, unknown>).recipientId as string, state),
          text: (event.payload as Record<string, unknown>).text as string,
        },
      } : {}),
      visibility: event.visibility === 'public' ? 'public' as const : 'observer' as const,
    };
  });
  const residentIntents = new Map<string, ObserverResidentIntent[]>();
  for (const event of intentEvents) {
    if (!isObserverEvent(event) || !event.actorId) continue;
    const intent = state.privateEventIntents?.[event.eventId];
    if (typeof intent !== 'string') continue;
    if (state.actors[event.actorId]?.actorType !== 'resident') continue;
    const nodeId = observerEventNodeId(event);
    const nodeLabel = nodeId
      ? locationNameForNode(nodeId, state.nodes[nodeId]?.label ?? sourceNodes.get(nodeId)?.label)
      : undefined;
    const record: ObserverResidentIntent = {
      eventId: event.eventId,
      sequence: event.sequence,
      day: Math.floor(event.worldTimeT / 72) + 1,
      timeT: event.worldTimeT % 72,
      intent,
      description: describeObserverEvent(event, state, config, describeResidentIntentActor(event)),
      ...(nodeId ? { nodeId } : {}),
      ...(nodeLabel ? { nodeLabel } : {}),
    };
    residentIntents.set(event.actorId, [...(residentIntents.get(event.actorId) ?? []), record]);
  }
  const previousSceneByNode = new Map<string, { readonly worldTimeT: number; readonly events: typeof projectedEvents }>();
  for (const event of projectedEvents) {
    if (!event.nodeId) continue;
    const worldTimeT = (event.day - 1) * 72 + event.timeT;
    const previous = previousSceneByNode.get(event.nodeId);
    if (!previous || worldTimeT > previous.worldTimeT) {
      previousSceneByNode.set(event.nodeId, { worldTimeT, events: [event] });
    } else if (worldTimeT === previous.worldTimeT) {
      previousSceneByNode.set(event.nodeId, { worldTimeT, events: [...previous.events, event] });
    }
  }
  const biographies = events.filter((event) => event.visibility === 'player-only' && event.kind === 'biography').flatMap((event) => {
    const payload = isRecord(event.payload) ? event.payload : {};
    const text = typeof payload.text === 'string' ? payload.text : undefined;
    const residentId = event.actorId ?? (typeof payload.residentId === 'string' ? payload.residentId : undefined);
    if (!text || !residentId) return [];
    return [{ residentId, displayName: typeof payload.displayName === 'string' ? payload.displayName : residentId, text }];
  });
  const unresolved = [...(state.unresolved ?? []).map((item) => `${item.sourceId}：${toChineseUnresolved(item.sourceId, item.detail)}`)];
  if (residents.some((resident) => resident.modelId === null)) unresolved.push('居民模型尚未配置；觀察台不會推定供應商或模型名稱。');
  if (nodes.length === 0) unresolved.push('世界地圖 Node 尚未提供。');
  if (!events.some((event) => event.visibility === 'player-only' && event.kind === 'biography')) unresolved.push('尚無來源定義的傳記事件資料。');
  const control = config.control?.getState();
  const timeT = projection.worldTimeT;
  return {
    initialized: true,
    ...(unresolved.length ? { unresolved } : {}),
    worldTime: { day: Math.floor(timeT / 72) + 1, timeT: timeT % 72, phase: dayPhaseAt(timeT) === 'day' ? '白天' : '夜晚' },
    simulation: { running: control ? !control.paused : false, speedLabel: control ? `牆鐘速度 ${control.speedMultiplier} 倍` : '執行控制器尚未連接', freshAt: new Date().toISOString(), controllable: control !== undefined && config.control !== undefined, ...(control?.status ? { status: control.status } : {}) },
    map: {
      nodes: nodes.map((node) => ({
        id: node.id,
        label: locationNameForNode(node.id, node.label ?? sourceNodes.get(node.id)?.label) ?? '',
        labelStatus: node.labelStatus,
        surfaceTerrain: node.surfaceTerrain ?? null,
        regionDescription: node.regionDescription ?? sourceNodes.get(node.id)?.regionDescription ?? '來源未提供區域描述',
        ...(coordinates.get(node.id) ?? { x: 0, y: 0 }),
        residents: nodeResidents.get(node.id) ?? [],
        objects: nodeObjects.get(node.id) ?? [],
        monsters: monsters.filter((monster) => monster.nodeId === node.id).map((monster) => ({ name: monster.name?.trim() || null })),
        ...(previousSceneByNode.has(node.id) ? {
          previousScene: {
            day: Math.floor(previousSceneByNode.get(node.id)!.worldTimeT / 72) + 1,
            timeT: previousSceneByNode.get(node.id)!.worldTimeT % 72,
            events: previousSceneByNode.get(node.id)!.events,
          },
        } : {}),
      })),
      edges: nodes.flatMap((node) => node.neighbors.filter((neighborId) => nodeIdSet.has(neighborId) && node.id < neighborId).map((neighborId) => ({ fromId: node.id, toId: neighborId }))),
    },
    dungeonMap: {
      activeFloor: state.dungeonRuntime?.activeFloor ?? dungeonResidentLocations.find(({ actorId }) => residents.find((resident) => resident.id === actorId)?.alive)?.floor ?? null,
      floors: dungeonFloorLabels,
      cells: DUNGEON_CELL_IDS.map((id) => ({ id, neighbors: dungeonCellNeighbors(1, id) })),
      residents: dungeonResidentLocations.filter(({ actorId }) => residents.find((resident) => resident.id === actorId)?.alive === true),
    },
    residents: residents.map((resident) => {
      const dungeonLocation = dungeonResidentLocations.find(({ actorId }) => actorId === resident.id);
      return ({
      id: resident.id,
      generation: resident.generation ?? null,
      model: resident.modelId ?? null,
      modelSlotId: resident.modelSlotId ?? null,
      nodeId: resident.nodeId,
      ...(resident.travel ? { movingToNodeId: resident.travel.toNodeId } : {}),
      alive: resident.alive,
      ...(dungeonLocation === undefined ? {} : {
        dungeonFloor: dungeonLocation.floor,
        dungeonCellId: dungeonLocation.cellId,
      }),
      ...(typeof resident.hitPoints === 'number' ? { remainingLife: resident.hitPoints } : {}),
      ...(typeof resident.hunger === 'number' ? { hunger: resident.hunger } : {}),
      ...(typeof resident.sleep === 'number' ? { sleep: resident.sleep } : {}),
      inventory: (resident.inventory ?? []).map(canonicalInventoryItemId),
      equipment: Object.entries(resident.equipment ?? {}).flatMap(([slot, item]) => item ? [`${slot}：${canonicalInventoryItemId(item)}`] : []),
      lastAction: resident.lastActionId ?? '',
      lastActionResult: resident.lastActionResult ?? '',
      intents: residentIntents.get(resident.id) ?? [],
      });
    }),
    events: projectedEvents,
    biographies,
  };
}

function itemDisplayName(itemId: string): string {
  itemId = canonicalInventoryItemId(itemId);
  const names: Readonly<Record<string, string>> = {
    '紙筆': '紙筆', '告示牌': '告示牌', '炸彈': '一次性炸彈', '營火': '營火',
    '漂流瓶': '漂流瓶', '空白紙條': '空白紙條', '探險者筆記': '探險者筆記', '書籍': '書籍',
    '椰子': '椰子', '魚': '魚', '肉': '肉', '破損木劍': '破木劍', '鐵劍': '鐵劍',
    '布衣': '布上裝', '布下裝': '布下裝', '簡易盾': '簡易盾牌', '鐵矛': '鐵槍',
    '騎士劍': '騎士劍', '鐵盾': '鐵盾', '鎖甲上衣': '鎖甲上裝',
    '鎖甲下裝': '鎖甲下裝', '騎士級雙手武器': '騎士雙手劍', '騎士盾': '騎士盾',
    '騎士上裝': '騎士上裝', '騎士下裝': '騎士下裝', '騎士重甲上衣': '騎士重甲上裝',
    '騎士重甲下衣': '騎士重甲下裝',
  };
  if (names[itemId]) return names[itemId]!;
  return /^[a-z0-9][a-z0-9_-]*$/i.test(itemId) ? '名稱未記錄的物品' : itemId;
}

function emptySnapshot(events: readonly WorldEvent[], config?: ObserverRuntimeConfig): ObserverSnapshot {
  return {
    initialized: false,
    worldTime: { day: 1, timeT: 0, phase: '尚未初始化' },
    simulation: { running: false, speedLabel: '世界快照尚未建立', freshAt: new Date().toISOString(), controllable: false },
    map: { nodes: [], edges: [] },
    residents: [],
    events: events.filter(isObserverEvent).map((event) => {
      const nodeId = observerEventNodeId(event);
      const sourceLabel = nodeId ? config?.sourceGraph?.nodes.find((node) => node.id === nodeId)?.label : undefined;
      const nodeLabel = nodeId ? locationNameForNode(nodeId, sourceLabel) : undefined;
      return {
        id: event.eventId, sequence: event.sequence, kind: event.kind, day: Math.floor(event.worldTimeT / 72) + 1, timeT: event.worldTimeT % 72,
        ...(nodeId ? { nodeId } : {}), ...(nodeLabel ? { nodeLabel } : {}),
        ...(event.actorId && !isMonsterIdentifier(event.actorId) ? { actorId: event.actorId } : {}),
        participantIds: collectResidentParticipantIds(event),
        description: describeObserverEvent(event, undefined, config), interaction: describeEventInteraction(event),
        visibility: event.visibility === 'public' ? 'public' as const : 'observer' as const,
      };
    }),
    biographies: [],
  };
}

function isObserverEvent(event: WorldEvent): boolean {
  return event.visibility === 'public' || event.visibility === 'player-only';
}

function collectResidentParticipantIds(event: WorldEvent, state?: WorldState): readonly string[] {
  const participantIds = new Set<string>();
  const participantFields = new Set([
    'actorId', 'targetActorId', 'targetId', 'residentId', 'giverId', 'recipientId',
    'proposerId', 'receiverId', 'senderId', 'authorActorId', 'bossActorId', 'victimId',
    'fromActorId', 'toActorId', 'ownerId',
  ]);
  const add = (value: unknown): void => {
    if (typeof value !== 'string' || !value) return;
    const actor = state?.actors[value];
    if (actor?.actorType === 'resident' || /^resident-\d+(?:\.\d+)?$/.test(value)) participantIds.add(value);
  };
  add(event.actorId);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (participantFields.has(key) || key.endsWith('ActorId')) add(child);
      if (Array.isArray(child) || isRecord(child)) visit(child);
    }
  };
  visit(event.payload);
  return [...participantIds];
}

function observerEventNodeId(event: WorldEvent): string | undefined {
  if (event.nodeId) return event.nodeId;
  const payload = isRecord(event.payload) ? event.payload : {};
  if (typeof payload.nodeId === 'string') return payload.nodeId;
  if (payload.inTransit === true) return typeof payload.fromNodeId === 'string' ? payload.fromNodeId : undefined;
  if (typeof payload.toNodeId === 'string') return payload.toNodeId;
  return typeof payload.fromNodeId === 'string' ? payload.fromNodeId : undefined;
}

function describeObserverEvent(event: WorldEvent, state?: WorldState, config?: ObserverRuntimeConfig, actorOverride?: string): string {
  const payload = isRecord(event.payload) ? event.payload : {};
  const actor = actorOverride ?? describeEventActor(event, state, payload);
  const createdItems = Array.isArray(payload.createdObjectIds)
    ? payload.createdObjectIds.flatMap((objectId) => typeof objectId === 'string' && state?.objects[objectId]?.itemId ? [state.objects[objectId]!.itemId!] : [])
    : [];
  const actionResult = (event.kind === 'surface-action-resolved' || event.kind === 'item-picked-up')
    ? describeWorldEvent(event, {
    actor,
    itemName: itemDisplayName,
    createdItems,
    })
    : undefined;
  if (actionResult !== undefined) return actionResult;
  if (event.kind === 'resident-action-settled') {
    const actionId = typeof payload.actionId === 'string' ? payload.actionId : '';
    const actionType = typeof payload.actionType === 'string' ? payload.actionType : '';
    const effectiveType = actionId === 'wait' ? 'wait' : actionId === 'sleep' || actionId.startsWith('sleep:') ? 'sleep' : actionType;
    const action = describeAction(effectiveType, actionId);
    const isMovement = effectiveType === 'move' || effectiveType === 'retreat'
      || actionId.startsWith('move:') || actionId.startsWith('retreat:');
    const hasDistinctDestination = isMovement && typeof payload.toNodeId === 'string'
      && payload.toNodeId !== payload.fromNodeId;
    const destination = hasDistinctDestination ? `，前往${describeNode(String(payload.toNodeId), state, config)}` : '';
    const details: string[] = [];
    const nightEncounter = isRecord(payload.nightEncounter) ? payload.nightEncounter : undefined;
    if (nightEncounter?.encountered === true) {
      const enemyName = typeof nightEncounter.enemyName === 'string' ? nightEncounter.enemyName : undefined;
      details.push(enemyName && !isMonsterIdentifier(enemyName) ? `遭遇怪物「${enemyName}」` : '發生夜間遭遇（怪物名稱未提供）');
      if (typeof nightEncounter.hitPointChange === 'number' && nightEncounter.hitPointChange < 0) details.push(`餘命減少 ${-nightEncounter.hitPointChange}`);
    }
    const surfaceEntry = isRecord(payload.surfaceEntry) ? payload.surfaceEntry : undefined;
    if (surfaceEntry?.triggered === true) details.push(describeSurfaceEntry(surfaceEntry, config, state));
    const suffix = [destination, ...details.map((detail) => `；${detail}`)].join('');
    return action ? `${actor}${action}${suffix}` : `${actor}行動資料未提供${suffix}`;
  }
  if (event.kind === 'resident-action-format-error') return `${actor}本回合沒有完成行動，因為回覆格式錯誤；居民停頓 1 個時間單位`;
  if (event.kind === 'forest-entry-risk-category') {
    const phase = payload.phase === 'night' ? '夜間' : payload.phase === 'day' ? '白天' : '當時';
    return `${actor}於${phase}進入森林時觸發風險檢查；具體遭遇結果未記錄`;
  }
  if (event.kind === 'gift-transferred') {
    const giver = typeof payload.giverId === 'string' ? describeParticipant(payload.giverId, state) : actor;
    const recipient = typeof payload.recipientId === 'string' ? describeParticipant(payload.recipientId, state) : '居民';
    const item = typeof payload.itemId === 'string' ? payload.itemId : '';
    return item ? `${giver}把「${itemDisplayName(item)}」送給${recipient}` : `${giver}把物品送給${recipient}`;
  }
  if (event.kind === 'gift-dropped') {
    const giver = typeof payload.giverId === 'string' ? describeParticipant(payload.giverId, state) : actor;
    const recipient = typeof payload.recipientId === 'string' ? describeParticipant(payload.recipientId, state) : '居民';
    const item = typeof payload.itemId === 'string' ? `「${itemDisplayName(payload.itemId)}」` : '物品';
    return `${giver}想把${item}送給${recipient}，但對方背包已滿，物品掉在地上，沒有交付`;
  }
  if (event.kind === 'trade-requested' || event.kind === 'trade-accepted' || event.kind === 'trade-rejected') {
    const proposer = typeof payload.proposerId === 'string' ? describeParticipant(payload.proposerId, state) : '居民';
    const receiver = typeof payload.receiverId === 'string' ? describeParticipant(payload.receiverId, state) : '居民';
    const offered = typeof payload.offeredItemId === 'string' ? `「${itemDisplayName(payload.offeredItemId)}」` : '物品';
    const requested = typeof payload.requestedItemId === 'string' ? `「${itemDisplayName(payload.requestedItemId)}」` : '物品';
    const trade = `${proposer}提供${offered}，換取${requested}`;
    if (event.kind === 'trade-requested') return `${proposer}向${receiver}提出交易：${trade}`;
    if (event.kind === 'trade-accepted') return `${receiver}接受${proposer}的交易：${trade}`;
    return `${receiver}拒絕${proposer}的交易：${trade}`;
  }
  if (event.kind === 'resident-attacked') {
    const target = typeof payload.targetActorId === 'string' ? describeEventTarget(payload.targetActorId, state, payload) : '攻擊目標未提供';
    const damage = typeof payload.damage === 'number' ? payload.damage : undefined;
    const combatants = event.actorId === null ? `攻擊者資料未記錄；${target}` : `${actor}攻擊${target}`;
    const rewards = describeRewardItems(payload, state);
    const reflection = typeof payload.reflectionDamage === 'number' && payload.reflectionDamage > 0
      ? `；反傷使${actor}餘命減少 ${payload.reflectionDamage}${typeof payload.reflectionHitPointsAfter === 'number' && payload.reflectionHitPointsAfter <= 0 ? '並離世' : ''}` : '';
    const summon = typeof payload.summonedMonsterName === 'string' && !isMonsterIdentifier(payload.summonedMonsterName)
      ? `；召來${payload.summonedMonsterName}` : '';
    const healing = typeof payload.dragonBloodHealing === 'number' && payload.dragonBloodHealing > 0
      ? `；龍血使${actor}恢復 ${payload.dragonBloodHealing} 點餘命` : '';
    return `${combatants}${damage !== undefined ? `，餘命減少 ${damage}` : '（傷害數值未記錄）'}${payload.killed === true ? '，目標離世' : ''}${reflection}${summon}${healing}${rewards ? `；${rewards}` : ''}`;
  }
  if (event.kind === 'boss1-flying-hit-blocked') return `${actor}攻擊未命中${typeof payload.targetActorId === 'string' ? describeParticipant(payload.targetActorId, state) : '目標資料未記錄'}（目標處於無敵狀態）`;
  if (event.kind === 'boss1-taunt-counterattack') {
    const target = typeof payload.targetActorId === 'string' ? describeParticipant(payload.targetActorId, state) : '受挑釁的怪物資料未記錄';
    const hits = Array.isArray(payload.bossAttacks) ? payload.bossAttacks.filter(isRecord).map((hit) => {
      const victim = typeof hit.targetId === 'string' ? describeParticipant(hit.targetId, state) : '受擊者資料未記錄';
      const dead = hit.killed === true || (typeof hit.targetHitPointsBefore === 'number' && typeof hit.appliedDamage === 'number' && hit.targetHitPointsBefore - hit.appliedDamage <= 0);
      return `${victim}餘命減少 ${typeof hit.appliedDamage === 'number' ? hit.appliedDamage : '數值未記錄'}${dead ? '，倒下了' : ''}`;
    }) : [];
    return `${target}反擊${hits.length ? `：${hits.join('；')}` : '（反擊結果未記錄）'}`;
  }
  if (event.kind === 'boss2-defense-breakthrough') {
    const target = typeof payload.targetActorId === 'string' ? describeParticipant(payload.targetActorId, state) : '首領名稱未記錄';
    const attack = typeof payload.attack === 'number' ? `（攻擊力 ${payload.attack}）` : '';
    return `${actor}${attack}攻擊${target}${typeof payload.breakthroughAdded === 'number' && payload.breakthroughAdded > 0 ? `，新增 ${payload.breakthroughAdded} 次突破` : ''}${typeof payload.breakthroughs === 'number' ? `，累計 ${payload.breakthroughs} 次` : ''}`;
  }
  if (event.kind === 'boss1-defeated' || event.kind === 'boss2-retreated') {
    const bossId = typeof payload.bossActorId === 'string' ? payload.bossActorId : undefined;
    const boss = bossId ? describeParticipant(bossId, state) : '首領名稱未記錄';
    const rewards = describeRewardItems(payload, state);
    const nextFloor = typeof payload.accessGrantedFloor === 'number' ? `，居民獲准前往第 ${payload.accessGrantedFloor} 層` : '';
    const reflection = typeof payload.reflectionDamage === 'number' && payload.reflectionDamage > 0
      ? `；反傷使${actor}餘命減少 ${payload.reflectionDamage}${typeof payload.reflectionHitPointsAfter === 'number' && payload.reflectionHitPointsAfter <= 0 ? '並離世' : ''}` : '';
    const summon = typeof payload.summonedMonsterName === 'string' && !isMonsterIdentifier(payload.summonedMonsterName)
      ? `；召來${payload.summonedMonsterName}` : '';
    const healing = typeof payload.dragonBloodHealing === 'number' && payload.dragonBloodHealing > 0
      ? `；龍血使${actor}恢復 ${payload.dragonBloodHealing} 點餘命` : '';
    const moved = Array.isArray(payload.accessGrantedTo)
      ? payload.accessGrantedTo.filter((id): id is string => typeof id === 'string').map((id) => describeParticipant(id, state)) : [];
    const transport = typeof payload.accessGrantedFloor === 'number' && moved.length
      ? `；同行居民${moved.join('、')}前往第 ${payload.accessGrantedFloor} 層` : '';
    return `${actor}擊敗${boss}${rewards ? `，${rewards}` : ''}${nextFloor}${transport}${reflection}${summon}${healing}`;
  }
  if (event.kind === 'resident-arrived') {
    const destination = typeof payload.toNodeId === 'string' ? describeNode(payload.toNodeId, state, config) : '目的地未提供';
    const details: string[] = [];
    const encounter = isRecord(payload.nightEncounter) ? payload.nightEncounter : undefined;
    if (encounter?.encountered === true) {
      details.push(typeof encounter.enemyName === 'string' && !isMonsterIdentifier(encounter.enemyName) ? `遭遇怪物「${encounter.enemyName}」` : '發生夜間遭遇（怪物名稱未提供）');
      if (typeof encounter.hitPointChange === 'number' && encounter.hitPointChange < 0) details.push(`餘命減少 ${-encounter.hitPointChange}`);
    }
    const entry = isRecord(payload.surfaceEntry) ? payload.surfaceEntry : undefined;
    if (entry?.triggered === true) details.push(describeSurfaceEntry(entry, config, state));
    if (state?.actors[event.actorId ?? '']?.alive === false) details.push('未能活過這次抵達遭遇');
    return `${actor}抵達${destination}${details.map((detail) => `；${detail}`).join('')}`;
  }
  if (event.kind === 'daily-survival-settled') {
    const deaths = Array.isArray(payload.deaths) ? payload.deaths.filter(isRecord).map((death) => typeof death.actorId === 'string' ? describeParticipant(death.actorId, state) : '居民') : [];
    const births = Array.isArray(payload.newGenerations) ? payload.newGenerations.filter(isRecord).map((birth) => typeof birth.actorId === 'string' ? describeParticipant(birth.actorId, state) : '居民') : [];
    return `每日生存結算${deaths.length ? `；離世：${deaths.join('、')}` : ''}${births.length ? `；新生：${births.join('、')}` : ''}${deaths.length || births.length ? '' : '（個別狀態變化未記錄）'}`;
  }
  if (event.kind === 'personal-sleep-risk-settled') return describeSleepRiskEvent(payload, state);
  if (event.kind === 'world-object-expired') {
    const object = typeof payload.objectId === 'string' ? state?.objects[payload.objectId] : undefined;
    const itemId = typeof payload.itemId === 'string' ? payload.itemId : object?.itemId;
    return itemId ? `「${itemDisplayName(itemId)}」已到期移除` : '物件已到期移除';
  }
  if (event.kind === 'dungeon-action-settled' || event.kind === 'dungeon-resident-retreated') {
    const from = typeof payload.fromCellId === 'string' ? payload.fromCellId : undefined;
    const to = typeof payload.toCellId === 'string' ? payload.toCellId : undefined;
    const floor = typeof payload.floor === 'number' ? `地牢第 ${payload.floor} 層` : '地牢樓層資料未記錄';
    const movement = from && to ? `從${dungeonRoomName(from)}前往${dungeonRoomName(to)}` : '移動路線未記錄';
    const dungeonEvents = Array.isArray(payload.dungeonEvents) ? payload.dungeonEvents.filter(isRecord).flatMap((entry) => {
      const entryPayload = isRecord(entry.payload) ? entry.payload : {};
      return typeof entryPayload.event === 'string' && !isInternalIdentifier(entryPayload.event) ? [entryPayload.event] : [];
    }) : [];
    const splash = typeof payload.lavaSplashDamage === 'number' ? `遭大型熔岩飛濺，餘命減少 ${payload.lavaSplashDamage}` : undefined;
    return `${actor}在${floor}${event.kind === 'dungeon-resident-retreated' ? '撤退' : movement}${dungeonEvents.length ? `；遭遇${dungeonEvents.join('、')}` : '；本次沒有觸發地牢事件'}${splash ? `；${splash}` : payload.killed === true ? '；居民已離世' : ''}`;
  }
  if (event.kind === 'dungeon-resident-exited') {
    const destination = typeof payload.toNodeId === 'string' ? describeNode(payload.toNodeId, state, config) : undefined;
    return `${actor}離開地牢${destination ? `，回到${destination}` : ''}`;
  }
  if (event.kind === 'dungeon-cell-event') {
    const floor = typeof payload.floor === 'number' ? `地牢第 ${payload.floor} 層` : '地牢';
    const name = typeof payload.event === 'string' && !isInternalIdentifier(payload.event) ? payload.event : undefined;
    const eventClass = payload.eventClass;
    if (!name) return `${actor}在${floor}遇到一件事，細節未記錄`;
    if (eventClass === 'container') return `${actor}在${floor}發現${name}`;
    if (eventClass === 'monster') return `${actor}在${floor}遭遇${name}`;
    return `${actor}在${floor}遇到${name}`;
  }
  if (event.kind === 'dungeon-encounter-started') return `${actor}在地牢遇到怪物，名稱未記錄`;
  if (event.kind === 'dungeon-boss-encounter-started') return `${actor}在地牢第 ${typeof payload.floor === 'number' ? payload.floor : '未記錄'} 層遇見${typeof payload.bossName === 'string' && !isMonsterIdentifier(payload.bossName) ? `首領「${payload.bossName}」` : '首領（名稱未記錄）'}`;
  if (event.kind === 'monster-action-settled') {
    const action = payload.action === 'sleep' ? '正在休息' : payload.action === 'attack' ? '發動攻擊'
      : payload.action === 'taunt' ? '發出挑釁' : '採取行動';
    const hits = Array.isArray(payload.hits) ? payload.hits.filter(isRecord).map((hit) => {
      const target = typeof hit.targetId === 'string' ? describeParticipant(hit.targetId, state) : '受擊者資料未記錄';
      const damage = typeof hit.appliedDamage === 'number' ? hit.appliedDamage : '數值未記錄';
      return `${target}餘命減少 ${damage}${hit.killed === true ? '並離世' : ''}`;
    }) : [];
    const flags = [payload.taunts === true ? '引來居民注意' : '', payload.invulnerable === true ? '進入無敵狀態' : ''].filter(Boolean);
    return `${actor}${action}${hits.length ? `：${hits.join('；')}` : payload.action === 'attack' ? '（沒有命中居民）' : ''}${flags.length ? `；${flags.join('；')}` : ''}`;
  }
  if (event.kind === 'surface-action-resolved') return describeWorldEvent(event, { actor, itemName: itemDisplayName, createdItems });
  if (event.kind === 'item-picked-up') return `${actor}拾起${typeof payload.itemId === 'string' ? `「${itemDisplayName(payload.itemId)}」` : '一件物品'}`;
  if (event.kind === 'item-dropped') return `${actor}放下${typeof payload.itemId === 'string' ? `「${itemDisplayName(payload.itemId)}」` : '一件物品'}`;
  if (event.kind === 'item-used') return `${actor}用掉一件普通垃圾，沒有產生其他效果`;
  if (event.kind === 'scene-object-destroyed') return `${actor}拆除了${typeof payload.itemId === 'string' ? `「${itemDisplayName(payload.itemId)}」` : '一件放置物'}`;
  if (event.kind === 'resident-ate') return `${actor}吃下${typeof payload.itemId === 'string' ? `「${itemDisplayName(payload.itemId)}」` : '食物'}`;
  if (event.kind === 'item-equipped') return `${actor}穿戴或拿起了${typeof payload.itemId === 'string' ? `「${itemDisplayName(payload.itemId)}」` : '一件裝備'}`;
  if (event.kind === 'item-upgraded') return `${actor}使用魔法石，把${typeof payload.fromItemId === 'string' ? `「${itemDisplayName(payload.fromItemId)}」` : '裝備'}升級為${typeof payload.toItemId === 'string' ? `「${itemDisplayName(payload.toItemId)}」` : '更高階裝備'}`;
  if (event.kind === 'coconut-harvested') return `${actor}採收並取得${typeof payload.itemId === 'string' ? `「${itemDisplayName(payload.itemId)}」` : '椰子'}`;
  if (event.kind === 'container-opened') {
    const item = typeof payload.itemId === 'string' ? itemDisplayName(payload.itemId) : undefined;
    const overflow = typeof payload.overflowObjectId === 'string';
    return `${actor}打開${typeof payload.containerName === 'string' ? `「${payload.containerName}」` : '容器'}${item ? `，${overflow ? `背包已滿，${item}掉在地上` : `取得「${item}」`}` : ''}`;
  }
  if (event.kind === 'object-read') return `${actor}閱讀${typeof payload.itemId === 'string' ? `「${itemDisplayName(payload.itemId)}」` : '一件物品'}${typeof payload.text === 'string' ? `，內容：「${payload.text}」` : ''}`;
  if (event.kind === 'corpse-item-scavenged') return `${actor}從遺體旁取得${typeof payload.itemId === 'string' ? `「${itemDisplayName(payload.itemId)}」` : '一件物品'}`;
  if (event.kind === 'corpse-carried' || event.kind === 'corpse-dropped') {
    const corpse = typeof payload.corpseId === 'string' ? state?.objects[payload.corpseId] : undefined;
    const deceased = corpse?.remainsActorId ? describeParticipant(corpse.remainsActorId, state) : '遺體身分未記錄';
    return `${actor}${event.kind === 'corpse-carried' ? '搬運' : '放下'}${deceased}的遺體`;
  }
  if (event.kind === 'dungeon-lava-splash-settled') return typeof payload.lavaSplashDamage === 'number' ? `${actor}遭大型熔岩飛濺，餘命減少 ${payload.lavaSplashDamage}${payload.killed === true ? '並離世' : ''}` : `${actor}遭大型熔岩飛濺；傷害資料未記錄`;
  if (event.kind === 'monument-inscription-written' || event.kind === 'monument-inscription-read') {
    const payload = isRecord(event.payload) ? event.payload : {};
    if (payload.poolId === 'monument-valley'
      && typeof payload.inscriptionId === 'string'
      && typeof payload.authorActorId === 'string'
      && typeof payload.text === 'string') {
      const action = event.kind === 'monument-inscription-written' ? '留下碑文' : '閱讀碑文';
      return `${actor} 在紀念碑谷${action}（作者 ${describeParticipant(payload.authorActorId, state)}）：「${payload.text}」`;
    }
  }
  if (event.kind === 'public-message-sent') {
    if (typeof payload.recipientId === 'string' && typeof payload.text === 'string') {
      return `${actor} 向 ${describeParticipant(payload.recipientId, state)} 發送公開訊息：「${payload.text}」`;
    }
  }
  if (event.kind === 'biography') return '已完成玩家專屬死亡傳記';
  const subject = typeof payload.itemId === 'string' ? itemDisplayName(payload.itemId)
    : typeof payload.targetId === 'string' ? describeParticipant(payload.targetId, state)
    : typeof payload.nodeId === 'string' ? describeNode(payload.nodeId, state, config) : '';
  const kindStories: Readonly<Record<string, string>> = {
    'resident-died': `${actor}離世`, 'resident-born': `${actor}來到島上`,
    'actor-moved': subject ? `${actor}移動至${subject}` : `${actor}移動；目的地未提供`,
    'sleep-started': `${actor}開始休息`, 'sleep-ended': `${actor}結束休息`,
  };
  return kindStories[event.kind] ?? describeWorldEvent(event, {
    actor,
    itemName: itemDisplayName,
    participantName: (id) => describeParticipant(id, state),
    nodeName: (id) => describeNode(id, state, config),
  });
}

function describeResidentIntentActor(event: WorldEvent): string {
  const id = event.actorId;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : '居民';
}

function describeRewardItems(payload: Record<string, unknown>, state?: WorldState): string {
  const itemIds = new Set<string>();
  if (typeof payload.rewardItemId === 'string') itemIds.add(payload.rewardItemId);
  if (typeof payload.uniqueHeroItemId === 'string') itemIds.add(payload.uniqueHeroItemId);
  if (Array.isArray(payload.rewardItemIds)) {
    for (const itemId of payload.rewardItemIds) if (typeof itemId === 'string') itemIds.add(itemId);
  }
  if (Array.isArray(payload.rewardObjectIds)) {
    for (const objectId of payload.rewardObjectIds) {
      if (typeof objectId !== 'string') continue;
      const itemId = state?.objects[objectId]?.itemId;
      if (itemId) itemIds.add(itemId);
    }
  }
  if (itemIds.size > 0) return `取得獎勵：${[...itemIds].map((itemId) => `「${itemDisplayName(itemId)}」`).join('、')}`;
  return '';
}

function describeSleepRiskEvent(payload: Record<string, unknown>, state?: WorldState): string {
  if (!Array.isArray(payload.checks)) return '夜間睡眠檢查結果資料未提供';
  if (payload.checks.length === 0) return '本次夜間睡眠檢查沒有符合檢查條件的居民';
  const checks = payload.checks.filter(isRecord).map((check) => {
    const sleeper = typeof check.actorId === 'string' ? describeParticipant(check.actorId, state) : '居民';
    const terrainLabels: Readonly<Record<string, string>> = { forest: '森林', beach: '海灘', 'coconut-beach': '椰子沙灘', river: '河流', rock: '岩地' };
    const terrain = typeof check.terrain === 'string' ? `（地形：${terrainLabels[check.terrain] ?? '未分類'}）` : '';
    if (check.category === 'no-encounter') return `${sleeper}平安度過夜間${terrain}`;
    if (check.category !== 'encounter') return `${sleeper}的夜間檢查結果未記錄`;
    const enemy = typeof check.enemyName === 'string' && !isMonsterIdentifier(check.enemyName) ? `怪物「${check.enemyName}」` : '怪物（名稱未提供）';
    const change = typeof check.hitPointChange === 'number' && check.hitPointChange < 0 ? `，餘命減少 ${-check.hitPointChange}` : '，餘命變化未記錄';
    const outcome = check.woke === true ? '，受襲後醒來' : check.woke === false ? '，未醒來' : '，醒來狀態未記錄';
    const death = check.hitPointChange === -1 && state?.actors[typeof check.actorId === 'string' ? check.actorId : '']?.alive === false ? '並離世' : '';
    return `${sleeper}睡眠時遭${enemy}襲擊${change}${outcome}${death}${terrain}`;
  });
  return checks.length ? `夜間睡眠遭遇結算：${checks.join('；')}` : '夜間睡眠檢查事件沒有可辨識的居民紀錄';
}

function describeEventInteraction(event: WorldEvent, state?: WorldState): string {
  const payload = isRecord(event.payload) ? event.payload : {};
  const actorIds = [event.actorId, payload.giverId, payload.proposerId, payload.senderId]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const targetIds = [payload.targetActorId, payload.recipientId, payload.receiverId]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (Array.isArray(payload.hits)) targetIds.push(...payload.hits.filter(isRecord).flatMap((hit) => typeof hit.targetId === 'string' ? [hit.targetId] : []));
  if (Array.isArray(payload.bossAttacks)) targetIds.push(...payload.bossAttacks.filter(isRecord).flatMap((hit) => typeof hit.targetId === 'string' ? [hit.targetId] : []));
  const people = [...new Set([...actorIds, ...targetIds])];
  const describePerson = (id: string) => id === event.actorId
    ? describeEventActor(event, state, payload)
    : id === payload.targetActorId ? describeEventTarget(id, state, payload)
    : describeParticipant(id, state);
  const actor = people[0] ? describePerson(people[0]) : undefined;
  const object = typeof payload.itemId === 'string' ? itemDisplayName(payload.itemId)
    : typeof payload.objectId === 'string' ? (state?.objects[payload.objectId]?.objectType === 'corpse' ? '遺體' : state?.objects[payload.objectId]?.objectType === 'container' ? '容器' : '一件物件') : undefined;
  if (people.length >= 2) return `涉及對象：${people.map(describePerson).join('、')}`;
  if (actor && object) return `涉及對象：${actor}與${object}`;
  if (actor) return `行動者：${actor}`;
  if (object) return `涉及對象：${object}`;
  return '環境事件';
}

function describeEventActor(event: WorldEvent, state: WorldState | undefined, payload: Record<string, unknown>): string {
  if (event.actorId === null) return '環境事件';
  const actor = state?.actors[event.actorId];
  if (actor?.actorType === 'monster') {
    const name = typeof payload.monsterName === 'string' && !isMonsterIdentifier(payload.monsterName) ? payload.monsterName
      : actor.name && !isMonsterIdentifier(actor.name) ? actor.name : undefined;
    return name ? `怪物「${name}」` : '怪物名稱未提供';
  }
  if (actor?.actorType === 'animal') return actor.name ? `動物「${actor.name}」` : '動物名稱未提供';
  if (actor?.actorType === 'resident') return event.actorId;
  if (event.kind === 'monster-action-settled') return typeof payload.monsterName === 'string' && !isMonsterIdentifier(payload.monsterName) ? `怪物「${payload.monsterName}」` : '怪物名稱未提供';
  return describeParticipant(event.actorId, state);
}

function describeParticipant(id: string, state?: WorldState): string {
  const actor = state?.actors[id];
  if (actor?.actorType === 'monster') return actor.name && !isMonsterIdentifier(actor.name) ? `怪物「${actor.name}」` : '怪物名稱未提供';
  if (actor?.actorType === 'animal') return actor.name ? `動物「${actor.name}」` : '動物名稱未提供';
  if (actor?.actorType === 'resident' || id.startsWith('resident-')) return id;
  if (isMonsterIdentifier(id)) return '怪物名稱未提供';
  return '其他參與者';
}

function describeEventTarget(id: string, state: WorldState | undefined, payload: Record<string, unknown>): string {
  const actor = state?.actors[id];
  const isMonster = payload.targetType === 'monster' || actor?.actorType === 'monster' || isMonsterIdentifier(id);
  if (!isMonster) return describeParticipant(id, state);
  const name = typeof payload.targetName === 'string' && !isMonsterIdentifier(payload.targetName) ? payload.targetName
    : actor?.actorType === 'monster' && actor.name && !isMonsterIdentifier(actor.name) ? actor.name : undefined;
  return name ? `怪物「${name}」` : '怪物名稱未提供';
}

function isMonsterIdentifier(value: string): boolean {
  return /^(?:night-)?monster-|^boss(?:-|\d|$)/i.test(value);
}

function describeAction(actionType: string, actionId: string): string {
  const knownActions: Readonly<Record<string, string>> = {
    wait: '稍作等待', sleep: '開始休息', move: '移動', attack: '進行攻擊',
    'carry-corpse': '搬運遺體', 'destroy-placed': '拆除放置物', drop: '放下物品',
    'drop-corpse': '放下遺體', eat: '進食', equip: '整理裝備', gift: '送出物品',
    message: '傳送訊息', pickup: '拾取物品', read: '閱讀物品', retreat: '撤退',
    'dungeon-enter': '進入地牢', 'dungeon-exit': '離開地牢', 'dungeon-move': '深入地牢',
    'dungeon-retreat': '沿路撤退', 'dungeon-advance-floor': '前往下一層',
    'monument-inscribe': '留下碑文', 'monument-read': '閱讀碑文',
    'harvest-coconut': '採集椰子', 'surface': '進行地表活動',
    'scavenge-corpse': '搜尋遺留物品', 'read-object': '閱讀物品', 'open-container': '打開容器',
  };
  if (actionId === 'wait') return '稍作等待';
  if (actionId === 'sleep' || actionId.startsWith('sleep:')) return '開始休息';
  if (actionId.startsWith('container-open:')) return '打開容器';
  if (actionId.startsWith('retreat:')) return '撤退';
  if (knownActions[actionType]) return knownActions[actionType]!;
  if (actionId.startsWith('dungeon-exit:')) return '離開地牢';
  if (actionId.startsWith('dungeon-move:')) return '在地牢中移動';
  if (actionId.startsWith('dungeon-retreat:')) return '沿路撤退';
  if (actionId.startsWith('dungeon-advance-floor:')) return '前往下一層';
  if (actionId.startsWith('attack:')) return '進行攻擊';
  return '';
}

function describeNode(nodeId: string, state?: WorldState, config?: ObserverRuntimeConfig): string {
  const sourceLabel = state?.nodes[nodeId]?.label
    ?? config?.sourceGraph?.nodes.find((node) => node.id === nodeId)?.label;
  return formatNodeLocationReference(nodeId, sourceLabel);
}

function describeSurfaceEntry(
  entry: Record<string, unknown>,
  config?: ObserverRuntimeConfig,
  state?: WorldState,
): string {
  const outcomeId = typeof entry.outcomeId === 'string' ? entry.outcomeId : '';
  const row = config?.surfaceEntryEvents?.find((candidate) => candidate.outcome === outcomeId);
  const outcome = row?.outcome && !isInternalIdentifier(row.outcome) ? row.outcome
    : outcomeId && /[\u3400-\u9fff]/u.test(outcomeId) ? outcomeId : undefined;
  if (!outcome) return '遇到地表狀況';
  const details: string[] = [];
  if (row?.effect === 'force_move') {
    details.push(typeof entry.forcedMoveToNodeId === 'string'
      ? `被急流帶往${describeNode(entry.forcedMoveToNodeId, state, config)}` : '被急流帶離原地');
  } else if (row?.effect === 'spawn_monster') {
    const monster = row.monster_name && !isMonsterIdentifier(row.monster_name) ? row.monster_name : undefined;
    details.push(monster ? `遇見${monster}` : `遇到${outcome}`);
  } else if (row?.effect === 'create_object') {
    const objectName = row.item_id && !isInternalIdentifier(row.item_id) ? row.item_id : outcome;
    details.push(row.object_type === 'container' ? `發現${objectName}` : `找到${objectName}`);
  } else if (row?.effect) {
    const hpLoss = /hp-(\d+)/.exec(row.effect)?.[1];
    const sleepLoss = /sleep-(\d+)/.exec(row.effect)?.[1];
    if (hpLoss) details.push(`餘命減少 ${hpLoss}`);
    if (sleepLoss) details.push(`睡眠減少 ${sleepLoss}`);
  }
  if (details.some((detail) => detail.includes(outcome))) return `地表事件：${details.join('，')}`;
  return `地表事件「${outcome}」${details.length ? `，${details.join('，')}` : ''}`;
}

function dungeonRoomName(cellId: string): string {
  return cellId === 'E' ? '首領所在房間' : cellId === 'S' ? '本層入口' : '地牢中的一處房間';
}

function isInternalIdentifier(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(value);
}

function toChineseUnresolved(sourceId: string, detail: string): string {
  if (sourceId === 'D-012') return '尚有居民未分配已完成設定的模型卡。';
  if (sourceId === 'BOOT-START-BEACH') return '起始沙灘設定尚未完成。';
  return detail;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
