import { readCsv } from './csv.ts';

export interface IslandNode {
  readonly id: string;
  readonly visualType: string;
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

export async function loadIslandGraph(directory: URL): Promise<IslandGraph> {
  const [nodeRows, edgeRows, unresolvedRows] = await Promise.all([
    readCsv(new URL('island_nodes.csv', directory)),
    readCsv(new URL('island_edges.csv', directory)),
    readCsv(new URL('values_to_recover.csv', directory)),
  ]);
  const nodes: IslandNode[] = nodeRows.map((row) => ({
    id: required(row, 'node_id'),
    visualType: required(row, 'visual_type'),
    label: row.node_label ? row.node_label : null,
    labelStatus: required(row, 'label_status'),
    regionDescription: required(row, 'region_description'),
    approximateImagePosition: {
      x: parseOptionalNumber(row.image_x_px_approx),
      y: parseOptionalNumber(row.image_y_px_approx),
    },
  }));
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
