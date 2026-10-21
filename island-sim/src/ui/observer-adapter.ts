import type { WorldEvent, WorldState } from '../domain/model.ts';
import type { IslandGraph } from '../content/island.ts';
import { dayPhaseAt } from '../engine/clock.ts';
import { projectWorld } from '../engine/world.ts';
import type { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import type { ObserverReadPort, ObserverSnapshot } from './observer.ts';

export interface RuntimeControlPort {
  getState(): { readonly paused: boolean; readonly speedMultiplier: number; readonly status?: string };
  pause(): void | Promise<void>;
  resume(): void | Promise<void>;
  setSpeed(multiplier: number): void | Promise<void>;
}

export interface ObserverRuntimeConfig {
  readonly speedOptions: readonly { readonly id: string; readonly label: string; readonly multiplier: number }[];
  readonly control?: RuntimeControlPort;
  readonly sourceGraph?: IslandGraph;
}

export class SQLiteObserverPort implements ObserverReadPort {
  private readonly store: SQLiteWorldStore;
  private readonly config: ObserverRuntimeConfig;

  constructor(
    store: SQLiteWorldStore,
    config: ObserverRuntimeConfig = { speedOptions: [] },
  ) {
    this.store = store;
    this.config = config;
  }

  async readSnapshot(): Promise<ObserverSnapshot> {
    const state = this.store.readSnapshot();
    const events = this.store.readEvents(0, 500);
    if (!state) return emptySnapshot(events);
    return projectSnapshot(state, events, this.config);
  }

  async requestControl(request: { readonly kind: 'pause' | 'resume' } | { readonly kind: 'speed'; readonly speedId: string }): Promise<void> {
    const runtime = this.config.control;
    if (!runtime) throw new Error('模擬執行控制器尚未連接。');
    if (request.kind === 'pause') return runtime.pause();
    if (request.kind === 'resume') return runtime.resume();
    if (request.kind !== 'speed') return;
    const option = this.config.speedOptions.find((candidate) => candidate.id === request.speedId);
    if (!option || !Number.isFinite(option.multiplier) || option.multiplier <= 0) throw new Error('此調速選項未由執行環境設定。');
    return runtime.setSpeed(option.multiplier);
  }
}

export function projectSnapshot(state: WorldState, events: readonly WorldEvent[], config: ObserverRuntimeConfig): ObserverSnapshot {
  const projection = projectWorld(state);
  const nodes = projection.nodes;
  const sourceNodes = new Map((config.sourceGraph?.nodes ?? []).map((node) => [node.id, node]));
  const coordinates = new Map(nodes.map((node) => {
    const position = sourceNodes.get(node.id)?.approximateImagePosition;
    if (position?.x !== null && position?.x !== undefined && position.y !== null) {
      return [node.id, { x: position.x, y: position.y }];
    }
    return [node.id, { x: 0, y: 0 }];
  }));
  const residents = projection.actors.filter((actor) => actor.actorType === 'resident');
  const nodeResidents = new Map<string, string[]>();
  for (const resident of residents) {
    if (resident.nodeId) nodeResidents.set(resident.nodeId, [...(nodeResidents.get(resident.nodeId) ?? []), resident.id]);
  }
  const nodeObjects = new Map<string, string[]>();
  for (const object of projection.objects) {
    if (object.nodeId) nodeObjects.set(object.nodeId, [...(nodeObjects.get(object.nodeId) ?? []), object.itemId ?? object.id]);
  }
  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const projectedEvents = events.filter(isObserverEvent).map((event) => ({
    id: event.eventId,
    sequence: event.sequence,
    day: Math.floor(event.worldTimeT / 72) + 1,
    timeT: event.worldTimeT % 72,
    ...(event.nodeId && nodeIdSet.has(event.nodeId) ? { nodeId: event.nodeId } : {}),
    ...(event.actorId ? { actorId: event.actorId } : {}),
    description: `已結算事件（${event.kind}）`,
    visibility: event.visibility === 'public' ? 'public' as const : 'observer' as const,
  }));
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
        label: node.label ?? '',
        labelStatus: node.labelStatus,
        regionDescription: sourceNodes.get(node.id)?.regionDescription ?? '來源未提供區域描述',
        ...(coordinates.get(node.id) ?? { x: 0, y: 0 }),
        residents: nodeResidents.get(node.id) ?? [],
        objects: nodeObjects.get(node.id) ?? [],
      })),
      edges: nodes.flatMap((node) => node.neighbors.filter((neighborId) => nodeIdSet.has(neighborId) && node.id < neighborId).map((neighborId) => ({ fromId: node.id, toId: neighborId }))),
    },
    residents: residents.map((resident) => ({
      id: resident.id,
      generation: resident.generation ?? null,
      model: resident.modelId ?? null,
      nodeId: resident.nodeId,
      ...(resident.nodeId === null ? {} : {}),
      ...(typeof resident.hitPoints === 'number' ? { hp: resident.hitPoints } : {}),
      ...(typeof resident.hunger === 'number' ? { hunger: resident.hunger } : {}),
      ...(typeof resident.sleep === 'number' ? { sleep: resident.sleep } : {}),
      inventory: resident.inventory ?? [],
      equipment: Object.entries(resident.equipment ?? {}).flatMap(([slot, item]) => item ? [`${slot}：${item}`] : []),
      lastAction: resident.lastActionId ?? '',
    })),
    events: projectedEvents,
    biographies,
    availableSpeedOptions: config.speedOptions.map(({ id, label }) => ({ id, label })),
  };
}

function emptySnapshot(events: readonly WorldEvent[]): ObserverSnapshot {
  return {
    initialized: false,
    worldTime: { day: 1, timeT: 0, phase: '尚未初始化' },
    simulation: { running: false, speedLabel: '世界快照尚未建立', freshAt: new Date().toISOString(), controllable: false },
    map: { nodes: [], edges: [] },
    residents: [],
    events: events.filter(isObserverEvent).map((event) => ({
      id: event.eventId, sequence: event.sequence, day: Math.floor(event.worldTimeT / 72) + 1, timeT: event.worldTimeT % 72,
      ...(event.nodeId ? { nodeId: event.nodeId } : {}), ...(event.actorId ? { actorId: event.actorId } : {}),
      description: `已結算事件（${event.kind}）`, visibility: event.visibility === 'public' ? 'public' : 'observer',
    })),
    biographies: [],
    availableSpeedOptions: [],
  };
}

function isObserverEvent(event: WorldEvent): boolean {
  return event.visibility === 'public' || event.visibility === 'player-only';
}

function toChineseUnresolved(sourceId: string, detail: string): string {
  if (sourceId === 'D-012') return '十名居民的不同主模型與目前供應商設定尚未完成。';
  if (sourceId === 'BOOT-START-BEACH') return '起始沙灘設定尚未完成。';
  return detail;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
