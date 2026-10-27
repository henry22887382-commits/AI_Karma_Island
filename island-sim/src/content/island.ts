import { readCsv } from './csv.ts';
import type { SurfaceTerrainClassification } from '../domain/model.ts';
import { allowsDaySurfaceEntryEvents } from '../domain/node-classification.ts';

export const LEGACY_START_BEACH_NODE_IDS = ['1', '8', '13'] as const;

export interface IslandNode {
  readonly id: string;
  readonly visualType: string;
  readonly surfaceTerrain: SurfaceTerrainClassification | null;
  readonly isStartingLocation?: boolean;
  /** Optional per-map-profile initial campfire setting; absent preserves legacy defaults. */
  readonly initialCampfire?: boolean;
  readonly daySurfaceEntryEventsEnabled?: boolean;
  readonly label: string | null;
  readonly labelStatus: string;
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
  const rowIds = nodeRows.map((row) => profileValue(row, 'node_id'));
  if (new Set(rowIds).size !== rowIds.length) throw new Error('地圖存檔 Node ID 重複。');
  if (rowIds.length === 0) throw new Error('地圖至少保留一個 Node。');
  const baseNodes = new Map(base.nodes.map((node) => [node.id, node]));
  const rows = new Map(nodeRows.map((row) => [profileValue(row, 'node_id'), row]));
  const nodes = nodeRows.map((row) => {
    const id = profileValue(row, 'node_id');
    const original = baseNodes.get(id);
    if (!original && (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) {
      throw new Error(`新增 Node ID 必須是正整數：${id}。`);
    }
    const terrain = parseSurfaceTerrain(profileValue(row, 'surface_terrain') || (original?.surfaceTerrain ?? 'unclassified'), id);
    const starting = profileValue(row, 'starting_location');
    const initialCampfire = profileValue(row, 'initial_campfire');
    if (starting !== '' && !['true', 'false'].includes(starting)) throw new Error(`Node ${id} 出生點設定無效。`);
    if (initialCampfire !== '' && !['true', 'false'].includes(initialCampfire)) throw new Error(`Node ${id} 營火設定無效。`);
    const label = profileValue(row, 'node_label') || original?.label || null;
    const labelStatus = profileValue(row, 'label_status') || original?.labelStatus || '';
    const visualType = profileValue(row, 'visual_type') || original?.visualType || '未分類';
    const xText = profileValue(row, 'image_x_px_approx'), yText = profileValue(row, 'image_y_px_approx');
    const x = parseOptionalNumber(xText), y = parseOptionalNumber(yText);
    if (!original && (!label?.trim() || !labelStatus.trim() || !visualType.trim() || x === null || y === null)) {
      throw new Error(`新增 Node ${id} 必須有名稱、地點名稱狀態與有限座標。`);
    }
    return {
      ...(original ?? { id, visualType, label, labelStatus, approximateImagePosition: { x, y } }),
      id,
      surfaceTerrain: terrain,
      isStartingLocation: starting === '' ? original?.isStartingLocation ?? false : starting === 'true',
      ...(initialCampfire === '' ? (original?.initialCampfire === undefined ? {} : { initialCampfire: original.initialCampfire }) : { initialCampfire: initialCampfire === 'true' }),
      visualType,
      label,
      labelStatus,
      daySurfaceEntryEventsEnabled: allowsDaySurfaceEntryEvents(terrain),
      approximateImagePosition: {
        x, y,
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
  if (!isConnected(nodes.map(({ id }) => id), edges)) throw new Error('地圖不連通；刪除 Node 後必須保持連通。');
  const startingNodes = nodes.filter((node) => node.isStartingLocation);
  if (startingNodes.length === 0) throw new Error('地圖至少要保留一個新局出生點。');
  for (const node of startingNodes) {
    if (node.surfaceTerrain !== 'beach' && node.surfaceTerrain !== 'coconut-beach') throw new Error(`Node ${node.id} 出生點地形必須是沙灘或椰子沙灘。`);
  }
  for (let left = 0; left < startingNodes.length; left += 1) {
    for (let right = left + 1; right < startingNodes.length; right += 1) {
      const a = startingNodes[left]!.id, b = startingNodes[right]!.id;
      if (edges.some((edge) => edge.source === a && edge.target === b || edge.source === b && edge.target === a)) {
        throw new Error(`出生點 Node ${a} 與 ${b} 不能相鄰。`);
      }
    }
  }
  if (nodes.filter((node) => node.surfaceTerrain === 'coconut-beach').length !== 3) throw new Error('椰子沙灘分類必須恰好指定 3 個 Node。');
  return { ...base, nodes, edges, validation: { connected: true, islandNodeCount: nodes.length } };
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
    const initialCampfire = row.initial_campfire;
    if (row.starting_location !== undefined && row.starting_location !== '' && !['true', 'false'].includes(row.starting_location)) {
      throw new Error(`Node ${nodeId} has unsupported starting_location value ${row.starting_location}.`);
    }
    if (initialCampfire !== undefined && initialCampfire !== '' && !['true', 'false'].includes(initialCampfire)) {
      throw new Error(`Node ${nodeId} has unsupported initial_campfire value ${initialCampfire}.`);
    }
    return {
      id: nodeId,
      surfaceTerrain,
      isStartingLocation,
      initialCampfire: initialCampfire === undefined || initialCampfire === '' ? undefined : initialCampfire === 'true',
      visualType: required(row, 'visual_type'),
      daySurfaceEntryEventsEnabled: allowsDaySurfaceEntryEvents(surfaceTerrain),
      label: row.node_label ? row.node_label : null,
      labelStatus: required(row, 'label_status'),
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
