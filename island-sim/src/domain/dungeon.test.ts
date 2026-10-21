import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseCsv } from '../content/csv.ts';
import { SeededRandom } from '../engine/random.ts';
import { createDropObject, drawContainerItem, drawDungeonEvent, drawMonsterBonusDrop, canRespawnUniqueItem, requiresSlimeWaterwayEncounter } from './dungeon.ts';

const root = new URL('../../references/tables/', import.meta.url);
const events = parseCsv(await readFile(new URL('dungeon_events.csv', root), 'utf8'));
const bonusDrops = parseCsv(await readFile(new URL('monster_bonus_drops.csv', root), 'utf8'));
const categoryWeights = parseCsv(await readFile(new URL('container_category_weights.csv', root), 'utf8'));
const subpools = parseCsv(await readFile(new URL('container_item_subpools.csv', root), 'utf8'));
const effectiveRates = parseCsv(await readFile(new URL('container_effective_item_rates.csv', root), 'utf8'));

test('all three dungeon event pools total 100 percent in the source data', () => {
  const floors = [...new Set(events.map((row) => row.floor ?? '').filter(Boolean))];
  assert.equal(floors.length, 3);
  for (const floor of floors) {
    const rows = events.filter((row) => row.floor === floor);
    assert.equal(rows.reduce((sum, row) => sum + Number(row.probability_percent ?? 0), 0), 100, floor);
  }
  for (const floor of floors) {
    assert.equal(events.filter((row) => row.floor === floor && row.event_class === 'monster')
      .reduce((sum, row) => sum + Number(row.probability_percent ?? 0), 0), 50, `${floor} direct encounters`);
  }
});

test('third-floor volcanic bombs are gated outside A1 B1 C1 without consuming RNG', () => {
  const rng = new SeededRandom('12345678');
  const result = drawDungeonEvent({ floor: '火山洞窟', nodeId: 'A2', events, random: rng });
  assert.equal(result.event, null);
  assert.equal(result.unresolved?.sourceId, 'D-007');
  assert.equal(result.randomDraws.length, 0);
  assert.equal(rng.stateHex, '12345678');
});

test('the three first-row nodes retain the source volcanic bomb event pool', () => {
  for (const nodeId of ['A1', 'B1', 'C1']) {
    const rng = new SeededRandom('12345678');
    const result = drawDungeonEvent({ floor: '火山洞窟', nodeId, events, random: rng });
    assert.equal(result.unresolved, null);
    assert.equal(result.randomDraws.length, 1);
    assert.equal(result.rngStateAfter, rng.stateHex);
  }
});

test('second-floor slippery waterway requires its additional slime encounter', () => {
  const event = events.find((row) => row.event === '濕滑水道');
  assert.equal(event?.probability_percent, '11');
  assert.equal(event?.condition, 'enter_empty_non_boss_node');
  assert.equal(requiresSlimeWaterwayEncounter('濕滑水道'), true);
  assert.equal(requiresSlimeWaterwayEncounter('噴泉'), false);
});

test('nine recovered bonus-drop rows sum to the stated extra-drop rates', () => {
  const monsters = [...new Set(bonusDrops.map((row) => row.monster ?? '').filter(Boolean))];
  assert.equal(monsters.length, 9);
  for (const monster of monsters) {
    const rows = bonusDrops.filter((row) => row.monster === monster);
    const sum = ['紙筆_percent', '告示牌_percent', '炸彈_percent', '營火_percent']
      .reduce((total, column) => total + Number(rows[0]?.[column] ?? 0), 0);
    assert.equal(sum, Number(rows[0]?.extra_drop_total_percent ?? 0), monster);
    assert.equal(sum + Number(rows[0]?.no_extra_drop_percent ?? 0), 100, monster);
  }
});

test('fire lizard bonus drop remains a bomb-or-none pool separate from the guaranteed unique sword', () => {
  const rng = new SeededRandom('12345678');
  const result = drawMonsterBonusDrop({ monster: '火蜥蜴', rows: bonusDrops, random: rng });
  assert.ok(result.item === '炸彈' || result.item === null);
  assert.notEqual(result.item, '勇者劍');
});

test('container category and item weights use both source stages and preserve provisional status', () => {
  const source = '地表漂流木箱';
  assert.equal(categoryWeights.filter((row) => row.source === source)
    .reduce((sum, row) => sum + Number(row.category_percent), 0), 100);
  assert.equal(subpools.filter((row) => row.source === source && row.category === '食物')
    .reduce((sum, row) => sum + Number(row.within_category_percent), 0), 100);
  const result = drawContainerItem({ source, categoryWeights, subpools, random: new SeededRandom('12345678') });
  assert.equal(result.provisional, true);
  assert.ok(['椰子', '魚', '肉'].includes(result.item ?? ''));
  assert.equal(effectiveRates.find((row) => row.source === source && row.item === result.item)?.status, 'derived_from_two_stage_pool');
});

test('all seven container sources have valid category and subpool totals matching 46 effective item rows', () => {
  const sources = [...new Set(categoryWeights.map((row) => row.source ?? '').filter(Boolean))];
  assert.equal(sources.length, 7);
  assert.equal(effectiveRates.length, 46);
  for (const source of sources) {
    const categories = categoryWeights.filter((row) => row.source === source);
    assert.equal(categories.reduce((sum, row) => sum + Number(row.category_percent ?? 0), 0), 100, source);
    for (const category of categories) {
      const items = subpools.filter((row) => row.source === source && row.category === category.category);
      if (Number(category.category_percent) === 0) {
        assert.equal(items.length, 0, `${source}/${category.category} has no zero-weight item rows`);
        continue;
      }
      assert.equal(items.reduce((sum, row) => sum + Number(row.within_category_percent ?? 0), 0), 100, `${source}/${category.category}`);
      for (const item of items) {
        const effective = effectiveRates.find((row) => row.source === source && row.item === item.item);
        assert.ok(effective, `${source}/${item.item} has an effective rate`);
        assert.equal(Number(effective.effective_percent), Number(category.category_percent) * Number(item.within_category_percent) / 100);
      }
    }
  }
});

test('unique hero equipment only returns to its source when no recoverable copy exists', () => {
  assert.equal(canRespawnUniqueItem('勇者劍', [], []), true);
  assert.equal(canRespawnUniqueItem('勇者劍', [{ id: 'sword', itemId: '勇者劍', ownerActorId: null, nodeId: 'C1', generatedAtT: 1, expiresAtT: null, unique: true, provisional: false }], []), false);
  assert.equal(canRespawnUniqueItem('勇者劍', [], ['勇者劍']), false);
});

test('dropped objects expire after 72T, while unique and provisional flags remain explicit', () => {
  assert.deepEqual(createDropObject({ id: 'drop-1', itemId: '炸彈', nodeId: 'A1', generatedAtT: 24 }), {
    id: 'drop-1', itemId: '炸彈', ownerActorId: null, nodeId: 'A1', generatedAtT: 24,
    expiresAtT: 96, unique: false, provisional: false,
  });
  const heroSword = createDropObject({ id: 'drop-2', itemId: '勇者劍', nodeId: 'C1', generatedAtT: 24, unique: true });
  assert.equal(heroSword.expiresAtT, null);
  assert.equal(heroSword.provisional, false);
});
