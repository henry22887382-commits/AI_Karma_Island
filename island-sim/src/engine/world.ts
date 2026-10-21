import type { IslandGraph } from '../content/island.ts';
import { createActiveSurfaceCapabilities } from '../content/approved-surface-capabilities.ts';
import type { ModelBinding, RandomDraw, UnresolvedIssue, WorldActor, WorldNode, WorldProjection, WorldState } from '../domain/model.ts';
import { createInitialVitals } from '../domain/survival.ts';
import { dayPhaseAt } from './clock.ts';
import { SeededRandom, seedToState } from './random.ts';

export const START_BEACH_NODE_IDS = ['1', '8', '13'] as const;

export interface InitialWorldOptions {
  readonly seed: string;
  readonly contentVersion: string;
  readonly modelAssignmentsBySlot?: Readonly<Record<number, ModelBinding | null>>;
}

export function createInitialWorld(graph: IslandGraph, options: InitialWorldOptions): WorldState {
  if (options.seed.length === 0) throw new Error('World seed must be supplied explicitly.');
  if (options.contentVersion.length === 0) throw new Error('Content version must be supplied explicitly.');
  validateStartBeaches(graph);
  const nodes = toWorldNodes(graph);
  const rng = new SeededRandom(seedToState(options.seed));
  const bootstrapRandomDraws: RandomDraw[] = [];
  const actors = Object.fromEntries(Array.from({ length: 10 }, (_, index) => {
    const id = `resident-${String(index + 1).padStart(2, '0')}`;
    const vitals = createInitialVitals();
    const spawn = chooseStartBeachNode(graph, rng, `resident-generation-1-start:${id}`);
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
      modelSlotId: index + 1,
      inventory: [],
      equipment: {},
    };
    return [id, actor] as const;
  }));
  const unresolved: readonly UnresolvedIssue[] = [
    { sourceId: 'D-012', detail: 'Ten distinct model assignments and current provider configuration are not configured.' },
  ];
  const surfaceCapabilities = createActiveSurfaceCapabilities(graph.nodes.map((node) => ({
    node_id: node.id, visual_type: node.visualType, node_label: node.label ?? '', label_status: node.labelStatus,
  })));
  return {
    schemaVersion: 2,
    sequence: 0,
    contentVersion: options.contentVersion,
    worldTimeT: 0,
    seed: options.seed,
    rngState: rng.stateHex,
    actors,
    nodes,
    objects: {},
    surfaceStocks: { schemaVersion: 1, byNode: { ...surfaceCapabilities.coconut.initialStockByNode }, advancedThroughDay: 0 },
    bootstrapRandomDraws,
    unresolved,
  };
}

export function chooseStartBeachNode(graph: IslandGraph, rng: SeededRandom, sourceId: string): { readonly nodeId: string; readonly draw: RandomDraw } {
  const draw = rng.next(sourceId);
  const nodeId = START_BEACH_NODE_IDS[Math.floor(draw.value * START_BEACH_NODE_IDS.length)];
  if (nodeId === undefined) throw new Error('Start beach selection produced no Node.');
  return { nodeId, draw };
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
    label: node.label,
    labelStatus: node.labelStatus,
    visualType: node.visualType,
    neighbors: [...(neighbors.get(node.id) ?? [])].sort((left, right) => Number(left) - Number(right)),
    safe: false,
  }]));
}

function validateStartBeaches(graph: IslandGraph): void {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const id of START_BEACH_NODE_IDS) {
    if (nodes.get(id)?.visualType !== '海灘類') throw new Error(`Configured starting Node ${id} is not source-labeled as a beach.`);
  }
  const edges = new Set(graph.edges.map(({ source, target }) => [source, target].sort((left, right) => Number(left) - Number(right)).join(':')));
  for (let left = 0; left < START_BEACH_NODE_IDS.length; left += 1) {
    for (let right = left + 1; right < START_BEACH_NODE_IDS.length; right += 1) {
      const a = START_BEACH_NODE_IDS[left] as string;
      const b = START_BEACH_NODE_IDS[right] as string;
      if (edges.has([a, b].sort((x, y) => Number(x) - Number(y)).join(':'))) throw new Error(`Configured starting beaches ${a} and ${b} are adjacent.`);
    }
  }
}
