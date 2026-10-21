import assert from 'node:assert/strict';
import test from 'node:test';
import { loadIslandGraph } from '../content/island.ts';
import { createInitialWorld, projectWorld, START_BEACH_NODE_IDS } from './world.ts';

const sourceTables = new URL('../../references/tables/', import.meta.url);

test('creates ten residents at seeded non-adjacent source beach choices and records their placement draws', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const state = createInitialWorld(graph, { seed: 'run-2026-10-20-a', contentVersion: 'archive-01669CAC' });
  const replay = createInitialWorld(graph, { seed: 'run-2026-10-20-a', contentVersion: 'archive-01669CAC' });
  const residents = Object.values(state.actors);
  assert.equal(residents.length, 10);
  assert.ok(residents.every((resident) => resident.actorType === 'resident' && resident.alive));
  assert.ok(residents.every((resident) => resident.hitPoints === 30 && resident.hunger === 5 && resident.sleep === 3));
  assert.ok(residents.every((resident) => START_BEACH_NODE_IDS.includes(resident.nodeId as typeof START_BEACH_NODE_IDS[number]) && resident.modelId === null));
  assert.equal(state.bootstrapRandomDraws?.length, 10);
  assert.deepEqual(state.bootstrapRandomDraws, replay.bootstrapRandomDraws);
  assert.deepEqual(residents.map(({ nodeId }) => nodeId), Object.values(replay.actors).map(({ nodeId }) => nodeId));
  assert.ok(state.unresolved?.every((issue) => issue.sourceId !== 'BOOT-LOCATIONS'));
  assert.ok(state.unresolved?.some((issue) => issue.sourceId === 'D-012'));
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('selected starting beach IDs are beach nodes with no direct edges between them', async () => {
  const graph = await loadIslandGraph(sourceTables);
  const beaches = new Map(graph.nodes.map((node) => [node.id, node.visualType]));
  assert.ok(START_BEACH_NODE_IDS.every((id) => beaches.get(id) === '海灘類'));
  const edges = new Set(graph.edges.map(({ source, target }) => [source, target].sort((a, b) => Number(a) - Number(b)).join(':')));
  for (let left = 0; left < START_BEACH_NODE_IDS.length; left += 1) {
    for (let right = left + 1; right < START_BEACH_NODE_IDS.length; right += 1) {
      const a = START_BEACH_NODE_IDS[left] as string;
      const b = START_BEACH_NODE_IDS[right] as string;
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
