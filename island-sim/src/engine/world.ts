import { LEGACY_START_BEACH_NODE_IDS, type IslandGraph } from '../content/island.ts';
import type { CsvRow } from '../content/csv.ts';
import { createActiveSurfaceCapabilities } from '../content/approved-surface-capabilities.ts';
import type { ModelBinding, MonumentValleyInscription, RandomDraw, UnresolvedIssue, WorldActor, WorldNode, WorldObject, WorldProjection, WorldState } from '../domain/model.ts';
import { createInitialVitals } from '../domain/survival.ts';
import { dayPhaseAt } from './clock.ts';
import { SeededRandom, seedToState } from './random.ts';
import { environmentTerrainForClassification } from '../domain/node-classification.ts';
import { locationNameForNode } from '../content/location-names.ts';
import { advanceCoconutBeachStocks } from '../domain/surface.ts';

/** Legacy default exposed for old snapshots and callers; active spawns use graph data. */
export const START_BEACH_NODE_IDS = LEGACY_START_BEACH_NODE_IDS;
export const CENTRAL_CAMPFIRE_NODE_ID = '25';
export const MIN_RESIDENT_COUNT = 1;
export const DEFAULT_RESIDENT_COUNT = 10;

export interface InitialWorldOptions {
  readonly seed: string;
  readonly contentVersion: string;
  readonly residentCount?: number;
  readonly mapId?: string;
  readonly modelAssignmentsBySlot?: Readonly<Record<number, ModelBinding | null>>;
  readonly modelSlotIdsByResident?: Readonly<Record<number, number>>;
  readonly monumentValleyDefaultDocuments?: readonly { readonly id: string; readonly text: string }[];
}

export function createInitialWorld(graph: IslandGraph, options: InitialWorldOptions): WorldState {
  if (options.seed.length === 0) throw new Error('World seed must be supplied explicitly.');
  if (options.contentVersion.length === 0) throw new Error('Content version must be supplied explicitly.');
  const residentCount = options.residentCount ?? DEFAULT_RESIDENT_COUNT;
  if (!Number.isSafeInteger(residentCount) || residentCount < MIN_RESIDENT_COUNT) {
    throw new RangeError(`Resident count must be a positive safe integer.`);
  }
  validateStartBeaches(graph);
  const nodes = toWorldNodes(graph);
  const rng = new SeededRandom(seedToState(options.seed));
  const bootstrapRandomDraws: RandomDraw[] = [];
  const actors = Object.fromEntries(Array.from({ length: residentCount }, (_, index) => {
    const id = `resident-${String(index + 1).padStart(2, '0')}`;
    const vitals = createInitialVitals();
    const spawn = chooseStartBeachNode(graph, rng, `resident-generation-1-start:${id}`);
    const modelSlotId = options.modelSlotIdsByResident?.[index + 1] ?? index + 1;
    const modelAssignment = options.modelAssignmentsBySlot?.[index + 1] ?? null;
    bootstrapRandomDraws.push(spawn.draw);
    const actor: WorldActor = {
      id,
      actorType: 'resident',
      alive: true,
      nodeId: spawn.nodeId,
      nextActionAtT: 0,
      speed: 3,
      unsafeEntryAtT: 0,
      travel: null,
      sleeping: false,
      sleepingSinceT: null,
      hitPoints: vitals.hitPoints,
      hunger: vitals.hunger,
      sleep: vitals.sleep,
      attack: 0,
      defense: 0,
      modelId: modelAssignment === null || modelAssignment.provider === null || modelAssignment.model === null
        ? null : `${modelAssignment.provider}/${modelAssignment.model}`,
      modelAssignment,
      modelSizeB: modelAssignment?.modelSizeB ?? null,
      sizeAtLeast8BConfirmed: modelAssignment?.sizeAtLeast8BConfirmed ?? false,
      styleDescription: modelAssignment?.styleDescription ?? null,
      generation: 1,
      slotId: String(index),
      modelSlotId,
      inventory: [],
      equipment: {},
      aiMemory: { processedThroughSequence: 0, entries: [] },
    };
    return [id, actor] as const;
  }));
  const unresolved: readonly UnresolvedIssue[] = [
    { sourceId: 'D-012', detail: 'Every resident needs a configured model card before the game starts.' },
  ];
  const surfaceCapabilities = createActiveSurfaceCapabilities(graph.nodes.map((node) => ({
    node_id: node.id, node_label: node.label ?? '', label_status: node.labelStatus,
    surface_terrain: node.surfaceTerrain ?? '',
  })));
  const openingCoconutProduction = advanceCoconutBeachStocks({
    beachNodeIds: surfaceCapabilities.coconut.nodeIds,
    stockByNode: surfaceCapabilities.coconut.initialStockByNode,
    elapsedIslandDays: 1,
  });
  const initialCampfireObjects: Record<string, WorldObject> = {};
  for (const nodeId of initialCampfireNodeIds(graph.nodes)) {
    const campfireId = `default-campfire-node-${nodeId}`;
    initialCampfireObjects[campfireId] = {
      id: campfireId, itemId: '營火', objectType: 'item', ownerActorId: null, nodeId,
      generatedAtT: 0, expiresAtT: null, unique: false, provisional: false, lit: true, placed: true,
    };
  }
  return {
    schemaVersion: 2,
    mapId: options.mapId ?? 'default-map',
    sequence: 0,
    contentVersion: options.contentVersion,
    worldTimeT: 0,
    seed: options.seed,
    rngState: rng.stateHex,
    residentCount,
    actors,
    nodes,
    objects: {
      ...initialCampfireObjects,
    },
    monumentValleyInscriptionPool: (options.monumentValleyDefaultDocuments ?? [])
      .filter((document) => document.id.trim().length > 0 && document.text.trim().length > 0)
      .map((document): MonumentValleyInscription => ({
        id: `monument-valley-default:${document.id}`,
        poolId: 'monument-valley',
        text: document.text,
        authorActorId: '工房預設',
        createdAtT: 0,
      })),
    surfaceStocks: { schemaVersion: 1, byNode: { ...openingCoconutProduction.stocks }, advancedThroughDay: 0 },
    bootstrapRandomDraws,
    unresolved: [...unresolved, ...openingCoconutProduction.unresolved.map(({ sourceId, detail }) => ({ sourceId, detail }))],
  };
}

export function syncWorldNodeMetadataFromGraph(state: WorldState, graph: IslandGraph): {
  readonly state: WorldState;
  readonly changedNodeIds: readonly string[];
  readonly changedFieldsByNode: readonly { readonly nodeId: string; readonly fields: readonly string[] }[];
} {
  const graphNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const activeSurfaceCapabilities = createActiveSurfaceCapabilities(graph.nodes.map((node) => ({
    node_id: node.id, node_label: node.label ?? '', label_status: node.labelStatus,
    surface_terrain: node.surfaceTerrain ?? '',
  })));
  const changedFieldsByNode: Array<{ readonly nodeId: string; readonly fields: readonly string[] }> = [];
  const nodes: Record<string, WorldNode> = { ...state.nodes };
  for (const [nodeId, existing] of Object.entries(state.nodes)) {
    const source = graphNodes.get(nodeId);
    if (source === undefined) throw new Error(`Current island source is missing snapshot Node ${nodeId}.`);
    const fields = [
      ...(existing.label !== locationNameForNode(nodeId, source.label) ? ['label'] : []),
      ...(existing.labelStatus !== source.labelStatus ? ['labelStatus'] : []),
      ...(existing.visualType !== source.visualType ? ['visualType'] : []),
      ...(existing.surfaceTerrain !== source.surfaceTerrain ? ['surfaceTerrain'] : []),
      ...(existing.daySurfaceEntryEventsEnabled !== source.daySurfaceEntryEventsEnabled ? ['daySurfaceEntryEventsEnabled'] : []),
      ...(existing.isStartingLocation !== (source.isStartingLocation ?? false) ? ['isStartingLocation'] : []),
      ...(existing.regionDescription !== source.regionDescription ? ['regionDescription'] : []),
      ...(JSON.stringify(existing.mapPosition) !== JSON.stringify(source.approximateImagePosition) ? ['mapPosition'] : []),
    ];
    if (fields.length === 0) continue;
    nodes[nodeId] = {
      ...existing,
      label: locationNameForNode(nodeId, source.label),
      labelStatus: source.labelStatus,
      visualType: source.visualType,
      surfaceTerrain: source.surfaceTerrain,
      daySurfaceEntryEventsEnabled: source.daySurfaceEntryEventsEnabled ?? true,
      isStartingLocation: source.isStartingLocation ?? false,
      regionDescription: source.regionDescription,
      mapPosition: source.approximateImagePosition,
    };
    changedFieldsByNode.push({ nodeId, fields });
  }
  const desiredCoconutNodeIds = activeSurfaceCapabilities.coconut.nodeIds;
  const priorStocks = state.surfaceStocks;
  const reconciledStocks = Object.fromEntries(desiredCoconutNodeIds.map((nodeId) => [
    nodeId,
    priorStocks?.byNode[nodeId] ?? 0,
  ]));
  const stocksChanged = priorStocks === undefined
    || desiredCoconutNodeIds.length !== Object.keys(priorStocks.byNode).length
    || desiredCoconutNodeIds.some((nodeId) => priorStocks.byNode[nodeId] === undefined);
  const surfaceStocks = stocksChanged
    ? { schemaVersion: 1 as const, byNode: reconciledStocks, advancedThroughDay: priorStocks?.advancedThroughDay ?? Math.floor(state.worldTimeT / 72) }
    : priorStocks;
  const stateChanged = changedFieldsByNode.length > 0 || stocksChanged;
  return {
    state: stateChanged ? { ...state, ...(changedFieldsByNode.length === 0 ? {} : { nodes }), surfaceStocks } : state,
    changedNodeIds: changedFieldsByNode.map(({ nodeId }) => nodeId),
    changedFieldsByNode,
  };
}

export function syncWorldNodeNotices(state: WorldState, notices: readonly CsvRow[]): WorldState {
  const desired = new Map<string, string>();
  for (const notice of notices) {
    const nodeId = notice.node_id ?? '';
    const documentId = notice.document_id ?? '';
    if (!state.nodes[nodeId]) throw new Error(`Node notice references missing snapshot Node ${nodeId}.`);
    if (!nodeId || !documentId || desired.has(nodeId)) throw new Error(`Node notice binding is invalid or duplicated for Node ${nodeId}.`);
    desired.set(nodeId, documentId);
  }

  const objects: Record<string, WorldState['objects'][string]> = { ...state.objects };
  let changed = false;
  for (const object of Object.values(state.objects)) {
    if (object.id.startsWith('default-starting-notice-node-')) {
      delete objects[object.id];
      changed = true;
      continue;
    }
    if (object.managedBy !== 'node-notices') continue;
    if (object.nodeId === null || desired.get(object.nodeId) !== object.readableTextId) {
      delete objects[object.id];
      changed = true;
    }
  }
  for (const [nodeId, documentId] of desired) {
    const id = `editor-notice-${nodeId}`;
    const managedNoticeKey = `${nodeId}:${documentId}`;
    if (state.destroyedNodeNoticeKeys?.includes(managedNoticeKey)) continue;
    const existing = objects[id];
    if (existing?.managedBy === 'node-notices'
      && existing.nodeId === nodeId && existing.readableTextId === documentId && existing.itemId === '告示牌'
      && existing.placed === true && existing.expiresAtT === null && existing.ownerActorId === null
      && existing.managedNoticeKey === managedNoticeKey) continue;
    objects[id] = {
      id, itemId: '告示牌', objectType: 'item', readableTextId: documentId, managedBy: 'node-notices', managedNoticeKey,
      ownerActorId: null, nodeId, generatedAtT: 0, expiresAtT: null, unique: false, provisional: false, placed: true,
    };
    changed = true;
  }
  return changed ? { ...state, objects } : state;
}

export function chooseStartBeachNode(graph: IslandGraph, rng: SeededRandom, sourceId: string): { readonly nodeId: string; readonly draw: RandomDraw } {
  const draw = rng.next(sourceId);
  const startNodeIds = startingLocationNodeIds(graph.nodes);
  const nodeId = startNodeIds[Math.floor(draw.value * startNodeIds.length)];
  if (nodeId === undefined) throw new Error('Start beach selection produced no Node.');
  return { nodeId, draw };
}

export function startingLocationNodeIds(nodes: readonly Pick<WorldNode, 'id' | 'isStartingLocation'>[]): string[] {
  const configured = nodes.filter((node) => node.isStartingLocation === true).map((node) => node.id);
  if (configured.length > 0) return configured;
  if (nodes.every((node) => node.isStartingLocation === undefined)) {
    return LEGACY_START_BEACH_NODE_IDS.filter((id) => nodes.some((node) => node.id === id));
  }
  return [];
}

export function initialCampfireNodeIds(nodes: readonly {
  readonly id: string;
  readonly isStartingLocation?: boolean;
  readonly initialCampfire?: boolean;
}[]): string[] {
  const explicitSettings = nodes.filter((node) => node.initialCampfire !== undefined);
  if (explicitSettings.length > 0) return explicitSettings.filter((node) => node.initialCampfire === true).map((node) => node.id);
  return [...new Set([...startingLocationNodeIds(nodes), CENTRAL_CAMPFIRE_NODE_ID])];
}

export function projectWorld(state: WorldState): WorldProjection {
  return {
    worldTimeT: state.worldTimeT,
    phase: dayPhaseAt(state.worldTimeT),
    contentVersion: state.contentVersion,
    actors: Object.values(state.actors),
    nodes: Object.values(state.nodes),
    objects: Object.values(state.objects),
    sequence: state.sequence,
  };
}

function toWorldNodes(graph: IslandGraph): Readonly<Record<string, WorldNode>> {
  const neighbors = new Map(graph.nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of graph.edges) {
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
  }
  return Object.fromEntries(graph.nodes.map((node) => [node.id, {
    id: node.id,
    label: locationNameForNode(node.id, node.label),
    labelStatus: node.labelStatus,
    visualType: node.visualType,
    surfaceTerrain: node.surfaceTerrain,
    isStartingLocation: node.isStartingLocation ?? false,
    regionDescription: node.regionDescription,
    mapPosition: node.approximateImagePosition,
    daySurfaceEntryEventsEnabled: node.daySurfaceEntryEventsEnabled ?? true,
    neighbors: [...(neighbors.get(node.id) ?? [])].sort((left, right) => Number(left) - Number(right)),
    safe: false,
  }]));
}

function validateStartBeaches(graph: IslandGraph): void {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const startNodeIds = startingLocationNodeIds(graph.nodes);
  if (startNodeIds.length === 0) throw new Error('At least one starting location must be configured.');
  for (const id of startNodeIds) {
    if (environmentTerrainForClassification(nodes.get(id)?.surfaceTerrain) !== 'beach') throw new Error(`Configured starting Node ${id} must retain beach terrain.`);
  }
  const edges = new Set(graph.edges.map(({ source, target }) => [source, target].sort((left, right) => Number(left) - Number(right)).join(':')));
  for (let left = 0; left < startNodeIds.length; left += 1) {
    for (let right = left + 1; right < startNodeIds.length; right += 1) {
      const a = startNodeIds[left] as string;
      const b = startNodeIds[right] as string;
      if (edges.has([a, b].sort((x, y) => Number(x) - Number(y)).join(':'))) throw new Error(`Configured starting beaches ${a} and ${b} are adjacent.`);
    }
  }
}
