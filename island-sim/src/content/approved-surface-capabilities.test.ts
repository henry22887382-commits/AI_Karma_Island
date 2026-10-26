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
  assert.deepEqual(pending.candidateActionNodeIds.fishing, ['15']);
  assert.deepEqual(pending.candidateActionNodeIds['coconut-harvest'], ['1', '8', '13']);
  assert.deepEqual(pending.candidateActionNodeIds['forest-berry-gather'], ['9', '17', '23']);
  assert.deepEqual(pending.candidateActionNodeIds['rock-exploration'], ['6', '19', '20', '22']);
  assert.deepEqual(pending.candidateActionNodeIds['river-exploration'], ['5', '24', '26']);
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
  assert.deepEqual(active.nodeIdsByAction['rock-exploration'], ['6', '19', '20', '22']);
  assert.deepEqual(active.nodeIdsByAction['river-exploration'], ['5', '24', '26']);
  assert.deepEqual(active.nodeIdsByAction.fishing, ['15']);
  assert.equal(active.provenanceByAction['forest-berry-gather'], 'user-confirmed-terrain-classification');
  assert.equal(active.provenanceByAction.fishing, 'user-adopted-supplemental');
  assert.equal(active.provenanceByAction['coconut-harvest'], 'user-adopted-supplemental');
});

test('active forest boar capability accepts the approved berry-forest Node 23', async () => {
  const nodes = parseCsv(await readFile(new URL('../../references/tables/island_nodes.csv', import.meta.url), 'utf8'));
  const active = createActiveSurfaceCapabilities(nodes);
  assert.deepEqual(active.nodeIdsByAction['forest-boar-area'], ['3', '9', '11', '17', '18', '23', '25', '28']);
});

test('pending and active capability mappings share terrain-derived candidates on the uniform map', async () => {
  const sourceNodes = parseCsv(await readFile(new URL('../../references/tables/island_nodes.csv', import.meta.url), 'utf8'));
  const uniformMap = sourceNodes.map((node) => ({
    ...node,
    surface_terrain: ['18', '22'].includes(node.node_id ?? '') ? 'berry-forest'
      : ['9', '11', '17'].includes(node.node_id ?? '') ? 'forest'
        : ['3', '10'].includes(node.node_id ?? '') ? 'port'
          : node.node_id === '23' ? 'rock' : node.surface_terrain ?? '',
  }));
  const pending = createSurfaceCapabilitiesPendingImageVerification(uniformMap);
  const active = createActiveSurfaceCapabilities(uniformMap);
  assert.deepEqual(pending.candidateActionNodeIds, active.nodeIdsByAction);
  assert.deepEqual(pending.candidateActionNodeIds['forest-berry-gather'], ['18', '22']);
  assert.deepEqual(pending.candidateActionNodeIds['rock-exploration'], ['6', '19', '20', '23']);
  assert.deepEqual(pending.candidateActionNodeIds['river-exploration'], ['5', '24', '26']);
  assert.deepEqual(pending.candidateActionNodeIds['forest-boar-area'], ['9', '11', '17', '18', '22', '25', '28']);
  assert.ok(!pending.candidateActionNodeIds['rock-exploration'].includes('21'));
});
