import { readCsv } from './csv.ts';
import type { SurfaceTerrainClassification } from '../domain/model.ts';
import { allowsDaySurfaceEntryEvents, visualTypeForClassification } from '../domain/node-classification.ts';

export const LEGACY_START_BEACH_NODE_IDS = ['1', '8', '13'] as const;

export interface IslandNode {
  readonly id: string;
  readonly visualType: string;
  readonly surfaceTerrain: SurfaceTerrainClassification | null;
  readonly isStartingLocation?: boolean;
  readonly daySurfaceEntryEventsEnabled?: boolean;
  readonly label: string | null;
  readonly labelStatus: string;
  readonly regionDescription: string;
  readonly approximateImagePosition: Readonly<{ x: number | null; y: number | null }>;
}

export interface IslandEdge {
  readonly source: string;
  readonly target: string;
  readonly kind: string;
  readonly evidence: string;
}

export interface IslandGraph {
  readonly nodes: readonly IslandNode[];
  readonly edges: readonly IslandEdge[];
  readonly unresolved: readonly { sourceId: string; detail: string }[];
  readonly validation: Readonly<{ connected: boolean; islandNodeCount: number }>;
}

export function islandGraphFromProfile(
  base: IslandGraph,
  nodeRows: readonly Readonly<Record<string, unknown>>[],
  edgeRows: readonly Readonly<Record<string, unknown>>[],
): IslandGraph {
  const rows = new Map(nodeRows.map((row) => [profileValue(row, 'node_id'), row]));
  if (rows.size !== base.nodes.length || base.nodes.some((node) => !rows.has(node.id))) {
    throw new Error('地圖存檔的 Node 清單與目前遊戲地圖不相容。');
  }
  const nodes = base.nodes.map((original) => {
    const row = rows.get(original.id)!;
    const terrain = parseSurfaceTerrain(profileValue(row, 'surface_terrain'), original.id);
    const starting = profileValue(row, 'starting_location');
    if (starting !== '' && !['true', 'false'].includes(starting)) throw new Error(`Node ${original.id} 出生點設定無效。`);
    return {
      ...original,
      surfaceTerrain: terrain,
      isStartingLocation: starting === '' ? original.isStartingLocation ?? false : starting === 'true',
      visualType: profileValue(row, 'visual_type') || original.visualType,
      label: profileValue(row, 'node_label') || null,
      labelStatus: profileValue(row, 'label_status') || original.labelStatus,
      regionDescription: profileValue(row, 'region_description') || original.regionDescription,
      approximateImagePosition: {
        x: parseOptionalNumber(profileValue(row, 'image_x_px_approx')),
        y: parseOptionalNumber(profileValue(row, 'image_y_px_approx')),
      },
    };
  });
  const edges: IslandEdge[] = edgeRows.map((row) => ({
    source: profileValue(row, 'source_node'), target: profileValue(row, 'target_node'),
    kind: profileValue(row, 'kind') || 'editor_link', evidence: profileValue(row, 'evidence') || 'map-profile',
  }));
  assertUnique(edges.map(({ source, target }) => edgeKey(source, target)), '地圖存檔連線');
  const ids = new Set(nodes.map(({ id }) => id));
  for (const edge of edges) if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error(`地圖連線引用不存在的 Node：${edge.source}-${edge.target}。`);
  return { ...base, nodes, edges, validation: { connected: isConnected(nodes.map(({ id }) => id), edges), islandNodeCount: nodes.length } };
}

function profileValue(row: Readonly<Record<string, unknown>>, key: string): string {
  const value = row[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

export async function loadIslandGraph(directory: URL): Promise<IslandGraph> {
  const [nodeRows, edgeRows, unresolvedRows] = await Promise.all([
    readCsv(new URL('island_nodes.csv', directory)),
    readCsv(new URL('island_edges.csv', directory)),
    readCsv(new URL('values_to_recover.csv', directory)),
  ]);
  const nodes: IslandNode[] = nodeRows.map((row) => {
    const surfaceTerrain = parseSurfaceTerrain(required(row, 'surface_terrain'), row.node_id);
    const nodeId = required(row, 'node_id');
    const isStartingLocation = row.starting_location === undefined
      ? LEGACY_START_BEACH_NODE_IDS.includes(nodeId as typeof LEGACY_START_BEACH_NODE_IDS[number])
      : row.starting_location === 'true';
    if (row.starting_location !== undefined && row.starting_location !== '' && !['true', 'false'].includes(row.starting_location)) {
      throw new Error(`Node ${nodeId} has unsupported starting_location value ${row.starting_location}.`);
    }
    return {
      id: nodeId,
      surfaceTerrain,
      isStartingLocation,
      visualType: visualTypeForClassification(surfaceTerrain ?? 'unclassified') ?? '一般地形',
      daySurfaceEntryEventsEnabled: allowsDaySurfaceEntryEvents(surfaceTerrain),
      label: row.node_label ? row.node_label : null,
      labelStatus: required(row, 'label_status'),
      regionDescription: required(row, 'region_description'),
      approximateImagePosition: {
        x: parseOptionalNumber(row.image_x_px_approx),
        y: parseOptionalNumber(row.image_y_px_approx),
      },
    };
  });
  const edges: IslandEdge[] = edgeRows.map((row) => ({
    source: required(row, 'source_node'),
    target: required(row, 'target_node'),
    kind: required(row, 'kind'),
    evidence: required(row, 'evidence'),
  }));
  const unresolved = unresolvedRows
    .filter((row) => typeof row.missing_value === 'string' && row.missing_value.length > 0)
    .map((row) => ({ sourceId: required(row, 'id'), detail: required(row, 'missing_value') }));

  assertUnique(nodes.map((node) => node.id), 'Node IDs');
  assertUnique(edges.map(({ source, target }) => edgeKey(source, target)), 'Island edges');
  const ids = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error(`Island edge references missing Node: ${edge.source}-${edge.target}.`);
  }
  const connected = isConnected(nodes.map((node) => node.id), edges);

  return { nodes, edges, unresolved, validation: { connected, islandNodeCount: nodes.length } };
}

function parseSurfaceTerrain(value: string, nodeId: string | undefined): SurfaceTerrainClassification | null {
  if (value === '' || value === 'unclassified') return 'unclassified';
  if (['beach', 'forest', 'berry-forest', 'river', 'rock', 'coconut-beach', 'dungeon-entrance', 'port', 'monument-valley'].includes(value)) return value as SurfaceTerrainClassification;
  throw new Error(`Node ${nodeId ?? 'unknown'} has unsupported surface_terrain value ${value}.`);
}

function required(row: Record<string, string>, column: string): string {
  const value = row[column];
  if (value === undefined || value.length === 0) throw new Error(`Required source column ${column} is empty.`);
  return value;
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function edgeKey(left: string, right: string): string {
  return [left, right].sort((a, b) => Number(a) - Number(b)).join(':');
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
}

function isConnected(nodes: readonly string[], edges: readonly IslandEdge[]): boolean {
  if (nodes.length === 0) return false;
  const adjacency = new Map(nodes.map((node) => [node, new Set<string>()]));
  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  const pending = [nodes[0] as string];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const node = pending.pop() as string;
    if (visited.has(node)) continue;
    visited.add(node);
    pending.push(...(adjacency.get(node) ?? []));
  }
  return visited.size === nodes.length;
}
