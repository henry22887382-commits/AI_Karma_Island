import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createInitialWorld } from '../engine/world.ts';
import { SQLiteWorldStore } from '../persistence/sqlite-store.ts';
import { islandGraphFromProfile, loadIslandGraph } from './island.ts';

test('loads the source graph without deriving edges from the drawing', async () => {
  const graph = await loadIslandGraph(new URL('../../references/tables/', import.meta.url));

  assert.equal(graph.nodes.length, 28);
  assert.equal(graph.edges.length, 51);
  assert.equal(graph.nodes.find((node) => node.id === '1')?.label, '西營地・西椰子海灘');
  assert.equal(graph.nodes.find((node) => node.id === '1')?.labelStatus, '未逐點命名');
  assert.equal(graph.edges.filter((edge) => edge.kind === 'outer_ring').length, 16);
  const outerRing = new Set(graph.edges.filter((edge) => edge.kind === 'outer_ring').map(({ source, target }) => [source, target].sort((a, b) => Number(a) - Number(b)).join(':')));
  const expectedRing = Array.from({ length: 16 }, (_, index) => {
    const first = String(index + 1);
    const second = String(index === 15 ? 1 : index + 2);
    return [first, second].sort((a, b) => Number(a) - Number(b)).join(':');
  });
  assert.deepEqual([...outerRing].sort(), expectedRing.sort());
  assert.ok(graph.edges.some((edge) => edge.source === '15' && edge.target === '25'));
  assert.ok(graph.unresolved.some((issue) => issue.sourceId === 'M-01'));
});

test('validates graph connectivity while retaining the source edge count', async () => {
  const graph = await loadIslandGraph(new URL('../../references/tables/', import.meta.url));
  assert.equal(graph.validation.connected, true);
  assert.equal(graph.validation.islandNodeCount, 28);
});

test('ignores legacy region_description values in saved map profiles', async () => {
  const base = await loadIslandGraph(new URL('../../references/tables/', import.meta.url));
  const legacyNodeRows = base.nodes.map((node) => ({
    node_id: node.id,
    visual_type: node.visualType,
    node_label: node.label ?? '',
    label_status: node.labelStatus,
    region_description: '舊地圖存檔中的區域描述',
    image_x_px_approx: node.approximateImagePosition.x ?? '',
    image_y_px_approx: node.approximateImagePosition.y ?? '',
    surface_terrain: node.surfaceTerrain ?? '',
    starting_location: String(node.isStartingLocation ?? false),
  }));
  const graph = islandGraphFromProfile(base, legacyNodeRows, base.edges.map((edge) => ({
    source_node: edge.source,
    target_node: edge.target,
    kind: edge.kind,
    evidence: edge.evidence,
  })));

  assert.equal(graph.nodes.length, base.nodes.length);
  assert.ok(graph.nodes.every((node) => !Object.hasOwn(node, 'regionDescription')));
});

test('loads a connected profile subset and rejects empty, duplicate, or disconnected nodes', () => {
  const base = {
    nodes: ['1', '2', '3', '4'].map((id) => ({
      id, visualType: id === '4' ? '森林' : '椰子沙灘', surfaceTerrain: id === '4' ? 'forest' as const : 'coconut-beach' as const, isStartingLocation: id === '1',
      label: `Node ${id}`, labelStatus: 'fixture', approximateImagePosition: { x: null, y: null },
    })),
    edges: [
      { source: '1', target: '2', kind: 'fixture', evidence: 'fixture' },
      { source: '2', target: '3', kind: 'fixture', evidence: 'fixture' },
      { source: '3', target: '4', kind: 'fixture', evidence: 'fixture' },
    ],
    unresolved: [], validation: { connected: true, islandNodeCount: 4 },
  };
  const profileRows = ['1', '2', '3'].map((id) => ({ node_id: id, surface_terrain: 'coconut-beach', starting_location: id === '1' ? 'true' : 'false' }));
  const profileEdges = [
    { source_node: '1', target_node: '2' },
    { source_node: '2', target_node: '3' },
  ];

  const graph = islandGraphFromProfile(base, profileRows, profileEdges);
  assert.deepEqual(graph.nodes.map((node) => node.id), ['1', '2', '3']);
  assert.equal(graph.validation.connected, true);
  assert.throws(() => islandGraphFromProfile(base, [], []), /至少保留一個 Node/);
  assert.throws(() => islandGraphFromProfile(base, [...profileRows, profileRows[0]!], profileEdges), /Node ID 重複/);
  assert.throws(() => islandGraphFromProfile(base, [...profileRows, profileRows[0]!], profileEdges), /Node ID 重複/);
  assert.throws(() => islandGraphFromProfile(base, profileRows, [{ source_node: '1', target_node: '2' }]), /不連通|必須保持連通/);
});

test('new profile Nodes survive SQLite save and reload and build complete new-world nodes', async () => {
  const base = await loadIslandGraph(new URL('../../references/tables/', import.meta.url));
  const nodeRows = base.nodes.map((node) => ({
    node_id: node.id, visual_type: node.visualType, node_label: node.label ?? '', label_status: node.labelStatus,
    image_x_px_approx: node.approximateImagePosition.x ?? '', image_y_px_approx: node.approximateImagePosition.y ?? '',
    surface_terrain: node.surfaceTerrain ?? 'unclassified', starting_location: String(node.isStartingLocation ?? false),
    initial_campfire: String(node.initialCampfire ?? false),
  }));
  nodeRows.push({
    node_id: '29', visual_type: '未分類', node_label: '新節點29', label_status: '新增節點',
    image_x_px_approx: '123', image_y_px_approx: '456', surface_terrain: 'unclassified',
    starting_location: 'false', initial_campfire: 'false',
  });
  const edgeRows = base.edges.map(({ source, target, kind, evidence }) => ({ source_node: source, target_node: target, kind, evidence }));
  edgeRows.push({ source_node: '28', target_node: '29', kind: 'editor_link', evidence: 'map-profile' });
  const store = new SQLiteWorldStore(new DatabaseSync(':memory:'));
  try {
    const profile = store.createMapProfile('新增節點地圖', { nodes: nodeRows, edges: edgeRows, nodeNotices: [] });
    const loaded = store.readMapProfile(profile.mapId)!;
    const graph = islandGraphFromProfile(base, loaded.nodes as Readonly<Record<string, unknown>>[], loaded.edges as Readonly<Record<string, unknown>>[]);
    const state = createInitialWorld(graph, { seed: 'new-node-profile', contentVersion: 'test' });
    assert.deepEqual(graph.nodes.at(-1)?.approximateImagePosition, { x: 123, y: 456 });
    assert.throws(() => islandGraphFromProfile(base, [...nodeRows, { ...nodeRows.at(-1)!, node_id: 'node-x' }], edgeRows), /正整數/);
    assert.throws(() => islandGraphFromProfile(base, [...nodeRows, { ...nodeRows.at(-1)!, node_id: '30', image_x_px_approx: 'Infinity' }], [...edgeRows, { source_node: '29', target_node: '30' }]), /有限座標/);
    assert.deepEqual(state.nodes['29'], {
      id: '29', label: '新節點29', labelStatus: '新增節點', visualType: '未分類', surfaceTerrain: 'unclassified',
      isStartingLocation: false, mapPosition: { x: 123, y: 456 }, daySurfaceEntryEventsEnabled: false,
      neighbors: ['28'], safe: false,
    });
  } finally {
    store.close();
  }
});
