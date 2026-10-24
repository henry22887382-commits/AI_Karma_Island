import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseCsv } from '../content/csv.ts';
import { SeededRandom } from '../engine/random.ts';
import { chooseLivingTarget, drawAttack, drawDragonActionMode, parrotCounterattackOnTauntedHit, shouldSummonCompanion, shouldPlantExecute, drawSlimeReflection, resolveMonsterAttackAction, planBossVictoryRewards, monsterStatsFromSource, resolveSlimeRetaliation, recordBoss2Breakthroughs, resolveScheduledMonsterTurn } from './monsters.ts';

const root = new URL('../../references/tables/', import.meta.url);
const attacks = parseCsv(await readFile(new URL('attack_distributions.csv', root), 'utf8'));
const monsterRows = parseCsv(await readFile(new URL('monsters.csv', root), 'utf8'));


test('verified attack distributions for dungeon monsters total 100 percent', () => {
  const dungeonNames = new Set(monsterRows
    .filter((row) => row.region?.startsWith('dungeon') && row.name !== undefined)
    .map((row) => row.name!));
  for (const monster of dungeonNames) {
    const rows = attacks.filter((row) => row.monster === monster);
    assert.ok(rows.length > 0, `${monster} has a source attack distribution`);
    const types = new Set(rows.map((row) => row.attack_type));
    for (const type of types) {
      assert.equal(rows.filter((row) => row.attack_type === type)
        .reduce((sum, row) => sum + Number(row.probability_percent), 0), 100, `${monster}/${type}`);
    }
  }
});

test('all 19 source monster rows retain stats and every recorded attack distribution totals 100 percent', () => {
  assert.equal(monsterRows.length, 19);
  for (const row of monsterRows) {
    const parsed = monsterStatsFromSource(row);
    assert.ok(parsed.name.length > 0);
    assert.ok(['surface', 'dungeon1', 'dungeon2', 'dungeon3', 'boss1', 'boss2', 'boss3'].includes(parsed.region));
    assert.ok(parsed.speed === null || Number.isFinite(parsed.speed));
    assert.ok(parsed.spawnProbabilityPercent === null ||
      (parsed.spawnProbabilityPercent >= 0 && parsed.spawnProbabilityPercent <= 100));
  }
  const groups = new Map<string, typeof attacks>();
  for (const row of attacks) {
    const key = `${row.monster ?? ''}\u0000${row.attack_type ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const [key, rows] of groups) {
    assert.equal(rows.reduce((sum, row) => sum + Number(row.probability_percent), 0), 100, key.replace('\u0000', '/'));
  }
});

test('monster stats retain source certainty and preserve blank encounter rates as unknown', () => {
  const boar = monsterRows.find((row) => row.name === '森林野豬');
  assert.ok(boar);
  const stats = monsterStatsFromSource(boar);
  assert.deepEqual({ hp: stats.hitPoints, defense: stats.defense, speed: stats.speed }, { hp: 10, defense: 0, speed: 2 });
  assert.equal(stats.certainty, 'derived_design_from_user_approx_goat');
  assert.equal(stats.spawnProbabilityPercent, null);
});

test('each strike independently selects a living target and preserves RNG draws', () => {
  const rng = new SeededRandom('12345678');
  const targets = [{ id: 'resident-a', hitPoints: 8 }, { id: 'resident-b', hitPoints: 0 }];
  const selected = chooseLivingTarget(targets, rng, 'rat.target.1');
  assert.equal(selected.target?.id, 'resident-a');
  assert.equal(selected.randomDraw?.sourceId, 'rat.target.1');
  assert.equal(chooseLivingTarget(targets.slice(1), rng, 'rat.target.2').target, null);
});

test('attack damage is drawn from the exact source distribution', () => {
  const source = attacks.filter((row) => row.monster === '管道巨鼠');
  const rng = new SeededRandom('12345678');
  const result = drawAttack(source, rng, 'rat.attack.1', 'per_hit_twice');
  assert.ok([4, 5, 6].includes(result.rawDamage));
  assert.equal(result.randomDraw.sourceId, 'rat.attack.1');
});

test('scheduled monster turn uses its source speed time, applies one-turn cooldown, and returns target result', () => {
  const rat = monsterRows.find((row) => row.name === '管道巨鼠');
  assert.ok(rat);
  const result = resolveScheduledMonsterTurn({
    monster: rat, worldTimeT: 6, nextActionAtT: 6,
    targets: [{ id: 'resident-a', hitPoints: 20, defense: 0 }],
    distribution: attacks.filter((row) => row.monster === '管道巨鼠'),
    random: new SeededRandom('12345678'), sourceId: 'rat-turn',
  });
  assert.equal(result.action, 'attack');
  assert.equal(result.speed, 4);
  assert.equal(result.actionTimeT, 6);
  assert.equal(result.nextActionAtT, 7);
  assert.equal(result.hits.length, 2);
  assert.equal(result.targetHitPointsAfter['resident-a'], 20 - result.hits.reduce((sum, hit) => sum + hit.appliedDamage, 0));
  assert.ok(result.randomDraws.length >= 4);
});

test('dragon breath is a scheduled group attack with independent equal-weight damage for every living participant', () => {
  const dragon = monsterRows.find((row) => row.name === '巨龍');
  assert.ok(dragon);
  const seed = '3c6ef362';
  assert.equal(drawDragonActionMode(new SeededRandom(seed)).mode, 'breath');
  const result = resolveScheduledMonsterTurn({
    monster: dragon, worldTimeT: 4, nextActionAtT: 4,
    targets: [{ id: 'resident-a', hitPoints: 30, defense: 18 }, { id: 'resident-b', hitPoints: 25, defense: 8 }],
    distribution: [], random: new SeededRandom(seed), sourceId: 'dragon-test',
  });
  assert.equal(result.action, 'breath');
  assert.equal(result.unresolved.length, 0);
  assert.deepEqual(result.hits.map(({ targetId, rawDamage, appliedDamage }) => ({ targetId, rawDamage, appliedDamage })), [
    { targetId: 'resident-a', rawDamage: 21, appliedDamage: 3 },
    { targetId: 'resident-b', rawDamage: 20, appliedDamage: 12 },
  ]);
  assert.equal(result.nextActionAtT, 5);
});

test('capybara sleeps for three one-T combat actions before attacking', () => {
  const capybara = monsterRows.find((row) => row.name === '大大水豚');
  assert.ok(capybara);
  let combatRoundCount = 0;
  let nextActionAtT = 0;
  for (let round = 1; round <= 4; round += 1) {
    const result = resolveScheduledMonsterTurn({
      monster: capybara,
      worldTimeT: nextActionAtT,
      nextActionAtT,
      combatRoundCount,
      targets: [{ id: 'resident-a', hitPoints: 20, defense: 0 }],
      distribution: attacks.filter((row) => row.monster === '大大水豚'),
      random: new SeededRandom('12345678'),
      sourceId: `capybara-turn-${round}`,
    });
    assert.equal(result.action, round <= 3 ? 'sleep' : 'attack');
    assert.equal(result.actionTimeT, round - 1);
    assert.equal(result.nextActionAtT, round);
    assert.equal(result.combatRoundCount, round);
    if (round <= 3) assert.equal(result.hits.length, 0);
    combatRoundCount = result.combatRoundCount;
    nextActionAtT = result.nextActionAtT;
  }
});

test('scheduled Boss 1 flying and taunt actions consume one T without inventing attacks', () => {
  const boss = monsterRows.find((row) => row.name === '大金剛鸚鵡');
  assert.ok(boss);
  const cases = [
    { seed: '00003000', expected: 'flying' },
    { seed: '00003800', expected: 'taunt' },
  ] as const;
  for (const { seed, expected } of cases) {
    const result = resolveScheduledMonsterTurn({
      monster: boss, worldTimeT: 10, nextActionAtT: 10,
      targets: [{ id: 'resident-a', hitPoints: 20, defense: 0 }],
      distribution: attacks.filter((row) => row.monster === '大金剛鸚鵡'),
      random: new SeededRandom(seed), sourceId: `parrot-${expected}`,
    });
    assert.equal(result.action, expected);
    assert.equal(result.actionTimeT, 10);
    assert.equal(result.nextActionAtT, 11);
    assert.deepEqual(result.hits, []);
    assert.equal(result.invulnerable, expected === 'flying');
    assert.equal(result.taunts, expected === 'taunt');
  }
});

test('Boss 2 acts without an HP field, misses on most attack draws, and uses source 8/9 damage on a hit', () => {
  const boss = monsterRows.find((row) => row.name === '大貓爪');
  assert.ok(boss);
  assert.deepEqual({ hp: monsterStatsFromSource(boss).hitPoints, defense: monsterStatsFromSource(boss).defense }, { hp: null, defense: 4 });
  const sourceAttacks = attacks.filter((row) => row.monster === '大貓爪');
  let hit: ReturnType<typeof resolveScheduledMonsterTurn> | undefined;
  let miss: ReturnType<typeof resolveScheduledMonsterTurn> | undefined;
  let hitCount = 0;
  const sampleCount = 2_000;
  for (let value = 1; value <= sampleCount; value += 1) {
    const result = resolveScheduledMonsterTurn({
      monster: boss, worldTimeT: 10, nextActionAtT: 10,
      targets: [{ id: 'resident-a', hitPoints: 30, defense: 5 }],
      distribution: sourceAttacks,
      random: new SeededRandom(value.toString(16).padStart(8, '0')),
      sourceId: `catpaw-${value}`,
    });
    assert.equal(result.unresolved.length, 0);
    assert.equal(result.speed, 6);
    assert.equal(result.nextActionAtT, 11);
    if (result.hits.length === 0) miss ??= result;
    else {
      hitCount += 1;
      hit ??= result;
    }
  }
  assert.ok(miss, 'Boss 2 must miss on an attack action');
  assert.deepEqual(miss.hits, []);
  assert.ok(hit, 'Boss 2 must hit on an attack action');
  assert.equal(hit.hits.length, 1);
  assert.ok([8, 9].includes(hit.hits[0]!.rawDamage));
  assert.equal(hit.hits[0]!.appliedDamage, Math.max(0, hit.hits[0]!.rawDamage - 5));
  assert.ok(hitCount >= 350 && hitCount <= 450, `expected about 20% hits, got ${hitCount}/${sampleCount}`);
});

test('summon is allowed at or below 30 percent only once while the monster is alive', () => {
  assert.equal(shouldSummonCompanion({ hitPoints: 2, maxHitPoints: 8, alreadySummoned: false }), true);
  assert.equal(shouldSummonCompanion({ hitPoints: 3, maxHitPoints: 8, alreadySummoned: false }), false);
  assert.equal(shouldSummonCompanion({ hitPoints: 0, maxHitPoints: 8, alreadySummoned: false }), false);
  assert.equal(shouldSummonCompanion({ hitPoints: 1, maxHitPoints: 8, alreadySummoned: true }), false);
});

test('plant execution checks the selected target current HP against the strict source threshold', () => {
  assert.equal(shouldPlantExecute(9), true);
  assert.equal(shouldPlantExecute(10), false);
});

test('slime reflection remains an extra draw for every received hit, including lethal hits', () => {
  const source = attacks.filter((row) => row.monster === '熔岩史萊姆');
  const result = drawSlimeReflection(source, new SeededRandom('12345678'), 'slime.reflect.lethal-hit');
  assert.ok([8, 9, 10].includes(result.rawDamage));
  assert.equal(result.randomDraw.sourceId, 'slime.reflect.lethal-hit');
});

test('slime lethal received hit still applies the additional source-weighted reflection', () => {
  const source = attacks.filter((row) => row.monster === '熔岩史萊姆');
  const result = resolveSlimeRetaliation({
    slimeHitPoints: 1,
    slimeDefense: 1,
    incomingRawDamage: 10,
    recipientHitPoints: 10,
    recipientDefense: 0,
    reflectionDistribution: source,
    random: new SeededRandom('12345678'),
    sourceId: 'slime.lethal',
  });
  assert.equal(result.slimeHitPointsAfter, 0);
  assert.equal(result.reflectionWasRolled, true);
  assert.ok([8, 9, 10].includes(result.rawReflectionDamage));
  assert.equal(result.recipientHitPointsAfter, 10 - result.appliedReflectionDamage);
});

test('dragon action weights and equal-weight damage ranges are resolved', () => {
  const modes = new Set<string>();
  const rng = new SeededRandom('12345678');
  for (let index = 0; index < 40; index += 1) {
    const result = drawDragonActionMode(rng, `dragon.mode.${index}`);
    modes.add(result.mode);
    assert.equal(result.unresolvedDamage, null);
  }
  assert.ok(modes.has('claw') && modes.has('breath'));
});

test('parrot taunted hit cancels the resident hit and replaces the ordinary boss action', () => {
  assert.deepEqual(parrotCounterattackOnTauntedHit(true), {
    residentAttackHits: false,
    parrotActsImmediately: true,
    suppressesOrdinaryParrotAction: true,
  });
});

test('multi-hit monster actions draw each target and each strike independently', () => {
  const source = attacks.filter((row) => row.monster === '管道巨鼠');
  const result = resolveMonsterAttackAction({
    distribution: source,
    attackType: 'per_hit_twice',
    hitCount: 2,
    sourceId: 'rat.turn.1',
    targets: [{ id: 'a', hitPoints: 10, defense: 5 }, { id: 'b', hitPoints: 10, defense: 0 }],
    random: new SeededRandom('12345678'),
  });
  assert.equal(result.hits.length, 2);
  assert.equal(result.randomDraws.length, 4);
  assert.deepEqual(result.randomDraws.map((draw) => draw.sourceId), [
    'rat.turn.1.target.1', 'rat.turn.1.damage.1', 'rat.turn.1.target.2', 'rat.turn.1.damage.2',
  ]);
  assert.ok(result.hits.every((hit) => hit.targetId === 'a' || hit.targetId === 'b'));
});

test('boss access is shared with living participants while physical rewards go to the last hitter', () => {
  const result = planBossVictoryRewards({
    boss: 'parrot',
    lastHitActorId: 'resident-a',
    participants: [
      { id: 'resident-a', alive: true },
      { id: 'resident-b', alive: true },
      { id: 'resident-c', alive: false },
    ],
  });
  assert.deepEqual(result.accessGrantedTo, ['resident-a', 'resident-b']);
  assert.equal(result.lastHitActorId, 'resident-a');
  assert.equal(result.tieredArmorReward, 'iron');
  assert.equal(result.mementoItemId, '彩色玻璃珠');
});

test('dragon blood heals only the last hitter by ten and carries no immortal effect', () => {
  const result = planBossVictoryRewards({
    boss: 'dragon',
    lastHitActorId: 'resident-a',
    participants: [{ id: 'resident-a', alive: true }],
  });
  assert.deepEqual(result.lastHitHealing, { actorId: 'resident-a', amount: 10 });
  assert.equal(result.tieredArmorReward, null);
});

test('Boss 2 is defeated at five caller-resolved effective defense breakthroughs', () => {
  assert.deepEqual(recordBoss2Breakthroughs(4, 0), { breakthroughs: 4, defeated: false });
  assert.deepEqual(recordBoss2Breakthroughs(4, 1), { breakthroughs: 5, defeated: true });
});
