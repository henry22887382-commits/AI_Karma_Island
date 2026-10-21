import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseCsv } from './csv.ts';
import { createActiveSurfaceCapabilities, createSurfaceCapabilitiesPendingImageVerification } from './approved-surface-capabilities.ts';
import { createSurfaceCapabilitiesProposal } from './surface-capabilities-proposal.ts';

test('user-selected surface candidate map stays runtime-disabled until referenced image is inspected', async () => {
  const nodes = parseCsv(await readFile(new URL('../../references/tables/island_nodes.csv', import.meta.url), 'utf8'));
  const pending = createSurfaceCapabilitiesPendingImageVerification(nodes);
  const history = createSurfaceCapabilitiesProposal(nodes);
  assert.equal(pending.runtimeEnabled, false);
  assert.equal(pending.status, 'user-selected-candidate-pending-direct-image-verification');
  assert.equal('runtimeEnabled' in history, false);
  assert.equal(history.status, 'review-only-not-approved');
  assert.deepEqual(pending.candidateActionNodeIds.fishing, ['2', '10', '14']);
  assert.deepEqual(pending.candidateActionNodeIds['coconut-harvest'], ['1', '8', '13']);
  assert.deepEqual(pending.candidateActionNodeIds['forest-berry-gather'], ['9', '17', '23']);
  assert.deepEqual(pending.candidateActionNodeIds['rock-exploration'], ['6', '19', '22']);
  assert.deepEqual(pending.candidateActionNodeIds['river-exploration'], ['24']);
  assert.match(pending.provenance.boundary, /do not use these interaction assignments at runtime/);
});

test('approved coconut nodes include zero initial stock and source production, cap, and cost', async () => {
  const nodes = parseCsv(await readFile(new URL('../../references/tables/island_nodes.csv', import.meta.url), 'utf8'));
  const config = createSurfaceCapabilitiesPendingImageVerification(nodes);
  assert.deepEqual(config.coconut, {
    nodeIds: ['1', '8', '13'], initialStockByNode: { '1': 0, '8': 0, '13': 0 },
    productionPerNodePerIslandDay: 1, maximumStockPerNode: 3,
    naturalStockExpires: false, harvestCostT: 3,
  });
});

test('active crosswalk separates source-group-derived actions from user-adopted supplemental locations', async () => {
  const nodes = parseCsv(await readFile(new URL('../../references/tables/island_nodes.csv', import.meta.url), 'utf8'));
  const active = createActiveSurfaceCapabilities(nodes);
  assert.equal(active.runtimeEnabled, true);
  assert.deepEqual(active.nodeIdsByAction['forest-berry-gather'], ['9', '17', '23']);
  assert.deepEqual(active.nodeIdsByAction['rock-exploration'], ['6', '19', '22']);
  assert.deepEqual(active.nodeIdsByAction['river-exploration'], ['24']);
  assert.deepEqual(active.nodeIdsByAction.fishing, ['2', '10', '14']);
  assert.equal(active.provenanceByAction['forest-berry-gather'], 'source-group-derived-and-user-adopted');
  assert.equal(active.provenanceByAction.fishing, 'user-adopted-supplemental');
  assert.equal(active.provenanceByAction['coconut-harvest'], 'user-adopted-supplemental');
});
