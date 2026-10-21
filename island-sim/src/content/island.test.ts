import assert from 'node:assert/strict';
import test from 'node:test';
import { loadIslandGraph } from './island.ts';

test('loads the source graph without deriving edges from the drawing', async () => {
  const graph = await loadIslandGraph(new URL('../../references/tables/', import.meta.url));

  assert.equal(graph.nodes.length, 28);
  assert.equal(graph.edges.length, 51);
  assert.equal(graph.nodes.find((node) => node.id === '1')?.label, null);
  assert.equal(graph.nodes.find((node) => node.id === '1')?.labelStatus, '未逐點命名');
  assert.equal(graph.edges.filter((edge) => edge.kind === 'outer_ring').length, 16);
  assert.ok(graph.edges.some((edge) => edge.source === '15' && edge.target === '25'));
  assert.ok(graph.unresolved.some((issue) => issue.sourceId === 'M-01'));
});

test('validates graph connectivity while retaining the source edge count', async () => {
  const graph = await loadIslandGraph(new URL('../../references/tables/', import.meta.url));
  assert.equal(graph.validation.connected, true);
  assert.equal(graph.validation.islandNodeCount, 28);
});
