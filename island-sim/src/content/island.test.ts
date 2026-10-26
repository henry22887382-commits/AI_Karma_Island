import assert from 'node:assert/strict';
import test from 'node:test';
import { loadIslandGraph } from './island.ts';

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
