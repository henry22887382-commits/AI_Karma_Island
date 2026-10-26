import assert from 'node:assert/strict';
import test from 'node:test';
import { actionContentForMapGraph, loadSimulationActionContent, validateNodeNoticeBindings } from './actions.ts';
import { loadIslandGraph } from './island.ts';
import { availableActions, settleNextAction } from '../engine/simulation.ts';
import { createInitialWorld } from '../engine/world.ts';
import { readableDocumentPoolWeights, selectReadableDocument } from '../domain/document-pools.ts';

test('loads the exact source food and equipment catalogs used by simulation actions', async () => {
  const content = await loadSimulationActionContent(new URL('../../references/tables/', import.meta.url));
  assert.equal(content.foods.find((row) => row.name === '河豚')?.hp_change, '-3');
  assert.equal(content.foods.find((row) => row.name === '龍血')?.note, '回血而非食物;唯一可回血效果');
  assert.equal(content.equipment.find((row) => row.name_zh === '鐵劍')?.attack, '5');
  assert.equal(content.equipment.find((row) => row.name_zh === '木級雙手武器')?.speed_modifier, '0');
  assert.equal(content.fishing.find((row) => row.outcome === '普通魚')?.overall_probability_percent, '25');
  assert.equal(content.surface.find((row) => row.location_action === '河流探索')?.probability_percent, '20');
  assert.equal(content.surfaceEntryEvents.find((row) => row.outcome === '森林野豬')?.probability_percent, '30');
  assert.equal(content.dungeonEvents.find((row) => row.floor === '雨林' && row.event === '巨蟒')?.probability_percent, '17');
  assert.equal(content.monsterBonusDrops.find((row) => row.monster === '巨蟒')?.紙筆_percent, '20');
  assert.equal(content.recovered.find((row) => row.action === '森林採野莓' && row.result_or_hazard === '莓果')?.probability_percent, '19');
  assert.equal(content.capabilities.runtimeEnabled, true);
  assert.equal(content.capabilities.provenanceByAction.fishing, 'user-adopted-supplemental');
  assert.deepEqual(content.readableDocumentPools.map((row) => row.pool_type), ['book', 'drift-bottle', 'monument-valley', 'signboard']);
  assert.equal(content.readableDocuments.length, 44);
  assert.equal(content.readableDocuments.filter((row) => row.pool_type === 'book').length, 24);
  assert.equal(content.readableDocuments.filter((row) => row.pool_type === 'book' && row.text === '').length, 1);
  assert.equal(content.readableTexts['note-1792766963416'], '');
  assert.equal(content.readableDocuments.find((row) => row.document_id === 'starting-beach-remembrance')?.pool_type, 'signboard');
  assert.deepEqual(content.nodeNotices, [
    { node_id: '1', document_id: 'starting-beach-remembrance' },
    { node_id: '8', document_id: 'starting-beach-remembrance' },
    { node_id: '13', document_id: 'starting-beach-remembrance' },
  ]);
  const documents = content.readableDocuments.map((row) => ({
    id: row.document_id!, pool: row.pool_type as 'book' | 'drift-bottle' | 'monument-valley' | 'signboard', text: row.text!,
  }));
  const bookWeights = readableDocumentPoolWeights(documents, 'book');
  assert.ok(bookWeights.every(({ probability }) => probability === 1 / 24));
  assert.equal(selectReadableDocument(documents, 'monument-valley', 0), null);
});

test('validates node notice bindings against real Nodes and nonempty readable cards', () => {
  const nodes = [{ node_id: '1' }];
  const documents = [{ document_id: 'notice-1', pool_type: 'signboard', text: 'A sign' }];
  assert.doesNotThrow(() => validateNodeNoticeBindings([{ node_id: '1', document_id: 'notice-1' }], nodes, documents));
  assert.throws(() => validateNodeNoticeBindings([{ node_id: '2', document_id: 'notice-1' }], nodes, documents), /missing Node 2/);
  assert.throws(() => validateNodeNoticeBindings([{ node_id: '1', document_id: 'empty' }], nodes, documents), /missing or empty text/);
  assert.throws(() => validateNodeNoticeBindings([{ node_id: '1', document_id: 'book-1' }], nodes,
    [...documents, { document_id: 'book-1', pool_type: 'book', text: 'A book' }]), /must reference a signboard text/);
  assert.throws(() => validateNodeNoticeBindings([
    { node_id: '1', document_id: 'notice-1' }, { node_id: '1', document_id: 'notice-1' },
  ], nodes, documents), /more than one notice binding/);
});

test('map action content follows the selected graph and leaves base-map capabilities unchanged', async () => {
  const tables = new URL('../../references/tables/', import.meta.url);
  const [baseGraph, baseContent] = await Promise.all([
    loadIslandGraph(tables), loadSimulationActionContent(tables),
  ]);
  const selectedGraph = {
    ...baseGraph,
    nodes: baseGraph.nodes.map((node) => ({
      ...node,
      surfaceTerrain: ['18', '22'].includes(node.id) ? 'berry-forest' as const
        : ['9', '11', '17'].includes(node.id) ? 'forest' as const
          : ['3', '10'].includes(node.id) ? 'port' as const
            : node.id === '23' ? 'rock' as const
              : node.id === '5' ? 'forest' as const
                : node.id === '12' ? 'river' as const : node.surfaceTerrain,
    })),
  };
  const selectedContent = actionContentForMapGraph(baseContent, selectedGraph, []);
  assert.deepEqual(selectedContent.capabilities.nodeIdsByAction.fishing, ['3', '10', '15']);
  assert.deepEqual(selectedContent.capabilities.nodeIdsByAction['forest-berry-gather'], ['18', '22']);
  assert.deepEqual(selectedContent.capabilities.nodeIdsByAction['rock-exploration'], ['6', '19', '20', '23']);
  assert.deepEqual(selectedContent.capabilities.nodeIdsByAction['river-exploration'], ['12', '24', '26']);
  assert.deepEqual(selectedContent.capabilities.nodeIdsByAction['forest-boar-area'], ['5', '9', '11', '17', '18', '22', '25', '28']);
  assert.deepEqual(selectedContent.capabilities.nodeIdsByAction['night-river-dive'], ['12', '24', '26']);
  assert.deepEqual(baseContent.capabilities.nodeIdsByAction.fishing, ['15']);
  assert.deepEqual(baseContent.capabilities.nodeIdsByAction['forest-berry-gather'], ['9', '17', '23']);

  const initial = createInitialWorld(selectedGraph, { seed: 'map-action-capabilities', contentVersion: 'test' });
  const actorId = 'resident-01';
  for (const [nodeId, actionId, timeT] of [
    ['3', 'surface:fishing', 0], ['18', 'surface:forest-berry-gather', 0], ['23', 'surface:rock-exploration', 0],
    ['12', 'surface:river-exploration', 0], ['12', 'surface:night-river-dive', 48],
  ] as const) {
    const atSelectedNode = {
      ...initial,
      worldTimeT: timeT,
      actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
        ...actor, nodeId: actor.id === actorId ? nodeId : null, nextActionAtT: actor.id === actorId ? timeT : 100,
      }])) as typeof initial.actors,
    };
    assert.ok(availableActions(atSelectedNode, actorId, selectedGraph, undefined, selectedContent).some(({ id }) => id === actionId), `${nodeId} ${actionId}`);
  }
  const atSelectedPort = {
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor, nodeId: actor.id === actorId ? '3' : null, nextActionAtT: actor.id === actorId ? 0 : 100,
    }])) as typeof initial.actors,
  };
  assert.ok(!availableActions(atSelectedPort, actorId, selectedGraph, undefined, baseContent).some(({ id }) => id === 'surface:fishing'));
  const staleFishing = settleNextAction(atSelectedPort, {
    actorId, actionId: 'surface:fishing', timeCostT: 3, payload: { surfaceAction: 'fishing' },
  }, selectedGraph, undefined, baseContent);
  assert.equal(staleFishing.ok, false);
});
