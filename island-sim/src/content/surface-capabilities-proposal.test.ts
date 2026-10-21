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
  assert.deepEqual(proposal.nodes.filter((node) => node.candidates.some((candidate) => candidate.action === 'rock-exploration')).map((node) => node.nodeId), ['6', '19', '22']);
  assert.deepEqual(proposal.nodes.filter((node) => node.candidates.some((candidate) => candidate.action === 'river-exploration')).map((node) => node.nodeId), ['24']);
  assert.deepEqual(proposal.proposedActionNodeIds.fishing, ['2', '10', '14']);
  for (const [action, ids] of Object.entries(proposal.proposedActionNodeIds)) {
    for (const id of ids) {
      const node = proposal.nodes.find((candidate) => candidate.nodeId === id);
      assert.ok(node?.candidates.some((candidate) => candidate.action === action));
    }
  }
  assert.match(proposal.proposalRationale.fishing, /No source identifies fishing spots/);
});

test('coconut proposal keeps source quantities separate from proposed Nodes and initial stock', async () => {
  const nodes = parseCsv(await readFile(new URL('../../references/tables/island_nodes.csv', import.meta.url), 'utf8'));
  const proposal = createSurfaceCapabilitiesProposal(nodes);
  assert.deepEqual(proposal.coconut.candidateBeachNodeIds, ['1', '2', '4', '8', '10', '12', '13', '14', '16']);
  assert.deepEqual(proposal.coconut.proposedSelectedBeachNodeIds, ['1', '8', '13']);
  assert.deepEqual(proposal.coconut.proposedInitialStockByNode, { '1': 0, '8': 0, '13': 0 });
  assert.equal(proposal.coconut.sourceDailyProductionPerBeach, 1);
  assert.equal(proposal.coconut.sourceMaximumStockPerBeach, 3);
  assert.equal(proposal.coconut.sourceNaturalStockExpires, false);
  assert.equal(proposal.coconut.sourceHarvestCostT, 3);
  assert.equal(proposal.coconut.runtimeEnabled, false);
  assert.equal(proposal.coconut.unresolved.length, 3);
});
