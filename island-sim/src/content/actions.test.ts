import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSimulationActionContent } from './actions.ts';

test('loads the exact source food and equipment catalogs used by simulation actions', async () => {
  const content = await loadSimulationActionContent(new URL('../../references/tables/', import.meta.url));
  assert.equal(content.foods.find((row) => row.name === '河豚')?.hp_change, '-3');
  assert.equal(content.foods.find((row) => row.name === '龍血')?.note, '回血而非食物;唯一可回血效果');
  assert.equal(content.equipment.find((row) => row.name_zh === '鐵劍')?.attack, '5');
  assert.equal(content.equipment.find((row) => row.name_zh === '木級雙手武器')?.speed_modifier, '');
  assert.equal(content.fishing.find((row) => row.outcome === '普通魚')?.overall_probability_percent, '25');
  assert.equal(content.surface.find((row) => row.location_action === '河流探索')?.probability_percent, '20');
  assert.equal(content.recovered.find((row) => row.action === '森林採野莓' && row.result_or_hazard === '有益野果')?.probability_percent, '80');
  assert.equal(content.capabilities.runtimeEnabled, true);
  assert.equal(content.capabilities.provenanceByAction.fishing, 'user-adopted-supplemental');
});
