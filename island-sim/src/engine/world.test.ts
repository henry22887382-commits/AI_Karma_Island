import assert from 'node:assert/strict';
import test from 'node:test';
import { loadIslandGraph } from '../content/island.ts';
import { createInitialWorld, projectWorld, startingLocationNodeIds, syncWorldNodeMetadataFromGraph, syncWorldNodeNotices } from './world.ts';

const sourceTables = new URL('../../references/tables/', import.meta.url);

test('creates ten residents at seeded non-adjacent source beach choices and records their placement draws', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const startIds = startingLocationNodeIds(graph.nodes);
  const state = createInitialWorld(graph, { seed: 'run-2026-10-20-a', contentVersion: 'archive-01669CAC' });
  const replay = createInitialWorld(graph, { seed: 'run-2026-10-20-a', contentVersion: 'archive-01669CAC' });
  const residents = Object.values(state.actors);
  assert.equal(residents.length, 10);
  assert.ok(residents.every((resident) => resident.actorType === 'resident' && resident.alive));
  assert.ok(residents.every((resident) => resident.hitPoints === 30 && resident.hunger === 5 && resident.sleep === 3));
  assert.ok(residents.every((resident) => startIds.includes(resident.nodeId ?? '') && resident.modelId === null));
  assert.equal(state.bootstrapRandomDraws?.length, 10);
  assert.deepEqual(state.bootstrapRandomDraws, replay.bootstrapRandomDraws);
  assert.deepEqual(residents.map(({ nodeId }) => nodeId), Object.values(replay.actors).map(({ nodeId }) => nodeId));
  assert.ok(state.unresolved?.every((issue) => issue.sourceId !== 'BOOT-LOCATIONS'));
  assert.ok(state.unresolved?.some((issue) => issue.sourceId === 'D-012'));
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('starts a new game when map Node 23 is rock', async () => {
  const sourceGraph = await loadIslandGraph(sourceTables);
  const graph = {
    ...sourceGraph,
    nodes: sourceGraph.nodes.map((node) => node.id === '23' ? { ...node, surfaceTerrain: 'rock' as const } : node),
  };

  assert.doesNotThrow(() => createInitialWorld(graph, { seed: 'rock-node-23', contentVersion: 'test-source' }));
});

test('starts a new game on the uniform map terrain matrix', async () => {
  const sourceGraph = await loadIslandGraph(sourceTables);
  const graph = {
    ...sourceGraph,
    nodes: sourceGraph.nodes.map((node) => ({
      ...node,
      surfaceTerrain: ['18', '22'].includes(node.id) ? 'berry-forest' as const
        : ['9', '11', '17'].includes(node.id) ? 'forest' as const
          : node.id === '3' ? 'port' as const
            : node.id === '23' ? 'rock' as const : node.surfaceTerrain,
    })),
  };

  assert.doesNotThrow(() => createInitialWorld(graph, { seed: 'uniform-map-terrain', contentVersion: 'test-source' }));
});

test('configured starting location IDs are beach-terrain nodes with no direct edges between them', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const startIds = startingLocationNodeIds(graph.nodes);
  const terrainById = new Map(graph.nodes.map((node) => [node.id, node.surfaceTerrain]));
  assert.ok(startIds.length > 0);
  assert.ok(startIds.every((id) => ['beach', 'coconut-beach'].includes(terrainById.get(id) ?? '')));
  const edges = new Set(graph.edges.map(({ source, target }) => [source, target].sort((a, b) => Number(a) - Number(b)).join(':')));
  for (let left = 0; left < startIds.length; left += 1) {
    for (let right = left + 1; right < startIds.length; right += 1) {
      const a = startIds[left] as string;
      const b = startIds[right] as string;
      assert.equal(edges.has([a, b].sort((x, y) => Number(x) - Number(y)).join(':')), false);
    }
  }
});

test('builds a read-only projection from persisted world state', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const state = createInitialWorld(graph, { seed: 'projection-seed', contentVersion: 'v1' });
  const view = projectWorld(state);
  assert.equal(view.worldTimeT, 0);
  assert.equal(view.phase, 'day');
  assert.equal(view.actors.length, 10);
  assert.equal(view.nodes.length, 28);
  assert.equal(view.actors[0]?.id, 'resident-01');
});

test('syncs only source-backed Node metadata into a snapshot without resetting simulation state', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'node-metadata-sync', contentVersion: 'test-source' });
  const stale = {
    ...initial,
    sequence: 42,
    worldTimeT: 123,
    rngState: '1234abcd',
    actors: { ...initial.actors, 'resident-01': { ...initial.actors['resident-01']!, hitPoints: 17 } },
    nodes: {
      ...initial.nodes,
      '6': { ...initial.nodes['6']!, label: '北岸石堆', labelStatus: '按群組順序對應（請勿視作已逐點命名）' },
      '11': { ...initial.nodes['11']!, label: null, labelStatus: '未逐點命名', surfaceTerrain: null },
      '19': { ...initial.nodes['19']!, label: '石堆', labelStatus: '按群組順序對應（請勿視作已逐點命名）' },
      '20': { ...initial.nodes['20']!, label: '山路', labelStatus: '按群組順序對應（請勿視作已逐點命名）' },
      '22': { ...initial.nodes['22']!, label: '東北石堆', labelStatus: '按群組順序對應（請勿視作已逐點命名）' },
      '25': { ...initial.nodes['25']!, surfaceTerrain: null },
      '26': { ...initial.nodes['26']!, label: '河岸空地', labelStatus: '按群組順序對應（請勿視作已逐點命名）' },
      '15': { ...initial.nodes['15']!, surfaceTerrain: null },
    },
  };

  const result = syncWorldNodeMetadataFromGraph(stale, graph);

  assert.deepEqual(result.changedNodeIds, ['6', '11', '15', '19', '20', '22', '25', '26']);
  assert.equal(result.state.nodes['11']?.label, '河口森林');
  assert.equal(result.state.nodes['11']?.surfaceTerrain, 'forest');
  assert.equal(result.state.nodes['6']?.label, '北岸石堆');
  assert.equal(result.state.nodes['22']?.label, '東北石堆');
  assert.equal(result.state.nodes['6']?.surfaceTerrain, 'rock');
  assert.equal(result.state.nodes['22']?.surfaceTerrain, 'rock');
  assert.equal(result.state.nodes['19']?.label, '西脊石坡');
  assert.equal(result.state.nodes['20']?.label, '北坡石山');
  assert.equal(result.state.nodes['26']?.label, '林畔河灘');
  assert.equal(result.state.nodes['19']?.surfaceTerrain, 'rock');
  assert.equal(result.state.nodes['20']?.surfaceTerrain, 'rock');
  assert.equal(result.state.nodes['26']?.surfaceTerrain, 'river');
  assert.equal(result.state.nodes['25']?.surfaceTerrain, 'forest');
  assert.equal(result.state.nodes['15']?.surfaceTerrain, 'port');
  assert.equal(result.state.nodes['15']?.visualType, '港口');
  assert.deepEqual(result.state.nodes['15']?.neighbors, stale.nodes['15']?.neighbors);
  assert.equal(result.state.sequence, 42);
  assert.equal(result.state.worldTimeT, 123);
  assert.equal(result.state.rngState, '1234abcd');
  assert.equal(result.state.actors['resident-01']?.hitPoints, 17);
  assert.equal(result.state.objects['default-campfire-node-25']?.lit, true);
});

test('syncs node notices into stable persistent placed scene objects', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const initial = createInitialWorld(graph, { seed: 'node-notice-sync', contentVersion: 'test-source' });
  assert.equal(initial.destroyedNodeNoticeKeys, undefined);
  const withNotice = syncWorldNodeNotices(initial, [{ node_id: '1', document_id: 'book-001' }]);
  const notice = withNotice.objects['editor-notice-1'];
  assert.ok(notice);
  assert.equal(notice.itemId, '告示牌');
  assert.equal(notice.readableTextId, 'book-001');
  assert.equal(notice.managedBy, 'node-notices');
  assert.equal(notice.placed, true);
  assert.equal(notice.expiresAtT, null);
  assert.ok(projectWorld(withNotice).objects.some((object) => object.id === notice.id && object.itemId === '告示牌'));
  assert.equal(withNotice.objects['default-campfire-node-25']?.lit, true);
  assert.equal(syncWorldNodeNotices(withNotice, [{ node_id: '1', document_id: 'book-001' }]), withNotice);
  assert.equal(syncWorldNodeNotices(withNotice, []).objects['editor-notice-1'], undefined);
  assert.deepEqual(withNotice.bootstrapRandomDraws, initial.bootstrapRandomDraws);
});
