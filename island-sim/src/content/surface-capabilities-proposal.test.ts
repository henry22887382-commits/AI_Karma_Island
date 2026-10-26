import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseCsv } from './csv.ts';
import { createSurfaceCapabilitiesProposal } from './surface-capabilities-proposal.ts';

test('surface capability proposal enumerates all Nodes but is never runtime-enabled', async () => {
  const nodes = parseCsv(await readFile(new URL('../../references/tables/island_nodes.csv', import.meta.url), 'utf8'));
  const proposal = createSurfaceCapabilitiesProposal(nodes);
  assert.equal(proposal.nodes.length, 28);
  assert.deepEqual(proposal.sourceBackedNodeAssignments, []);
  assert.equal(proposal.status, 'review-only-not-approved');
  assert.equal(proposal.nodes.every((node) => node.runtimeEnabled === false), true);
  assert.deepEqual(proposal.nodes.filter((node) => node.candidates.some((candidate) => candidate.action === 'forest-berry-gather')).map((node) => node.nodeId), ['9', '17', '23']);
  assert.equal(proposal.nodes.find((node) => node.nodeId === '9')?.candidates.find((candidate) => candidate.action === 'forest-berry-gather')?.evidence, 'berry-forest-classification');
  assert.deepEqual(proposal.nodes.filter((node) => node.candidates.some((candidate) => candidate.action === 'rock-exploration')).map((node) => node.nodeId), ['6', '19', '20', '22']);
  assert.equal(proposal.nodes.find((node) => node.nodeId === '19')?.candidates.find((candidate) => candidate.action === 'rock-exploration')?.evidence, 'rock-terrain-candidate');
  assert.deepEqual(proposal.nodes.filter((node) => node.candidates.some((candidate) => candidate.action === 'river-exploration')).map((node) => node.nodeId), ['5', '24', '26']);
  assert.deepEqual(proposal.proposedActionNodeIds.fishing, ['15']);
  for (const [action, ids] of Object.entries(proposal.proposedActionNodeIds)) {
    for (const id of ids) {
      const node = proposal.nodes.find((candidate) => candidate.nodeId === id);
      assert.ok(node?.candidates.some((candidate) => candidate.action === action));
    }
  }
  assert.match(proposal.proposalRationale.fishing, /current map classification/);
});

test('coconut proposal derives selected Nodes and initial stock from coconut-beach terrain', async () => {
  const nodes = parseCsv(await readFile(new URL('../../references/tables/island_nodes.csv', import.meta.url), 'utf8'));
  const proposal = createSurfaceCapabilitiesProposal(nodes);
  assert.deepEqual(proposal.coconut.candidateBeachNodeIds, ['1', '8', '13']);
  assert.deepEqual(proposal.coconut.proposedSelectedBeachNodeIds, ['1', '8', '13']);
  assert.deepEqual(proposal.coconut.proposedInitialStockByNode, { '1': 0, '8': 0, '13': 0 });
  assert.equal(proposal.coconut.sourceDailyProductionPerBeach, 1);
  assert.equal(proposal.coconut.sourceMaximumStockPerBeach, 3);
  assert.equal(proposal.coconut.sourceNaturalStockExpires, false);
  assert.equal(proposal.coconut.sourceHarvestCostT, 3);
  assert.equal(proposal.coconut.runtimeEnabled, false);
  assert.equal(proposal.coconut.unresolved.length, 3);
});

test('uniform-map capability matrix follows current terrain and excludes dungeon entrances from pure rock actions', async () => {
  const source = parseCsv(await readFile(new URL('../../references/tables/island_nodes.csv', import.meta.url), 'utf8'));
  const changed = source.map((row) => ({
    ...row,
    surface_terrain: ['18', '22'].includes(row.node_id ?? '') ? 'berry-forest'
      : ['9', '11', '17'].includes(row.node_id ?? '') ? 'forest'
        : ['3', '10'].includes(row.node_id ?? '') ? 'port'
          : row.node_id === '23' ? 'rock' : row.surface_terrain ?? '',
  }));
  const proposal = createSurfaceCapabilitiesProposal(changed);
  const ids = (action: string) => proposal.proposedActionNodeIds[action as keyof typeof proposal.proposedActionNodeIds];
  assert.deepEqual(ids('forest-berry-gather'), ['18', '22']);
  assert.deepEqual(ids('forest-boar-area'), ['9', '11', '17', '18', '22', '25', '28']);
  assert.deepEqual(ids('rock-exploration'), ['6', '19', '20', '23']);
  assert.deepEqual(ids('goat-hunt-area'), ['6', '19', '20', '23']);
  assert.deepEqual(ids('river-exploration'), ['5', '24', '26']);
  assert.deepEqual(ids('night-river-dive'), ['5', '24', '26']);
  assert.ok(!ids('rock-exploration').includes('21'));
  assert.deepEqual(ids('coconut-harvest'), ['1', '8', '13']);
  assert.deepEqual(ids('fishing'), ['3', '10', '15']);
});
