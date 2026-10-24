import type { CsvRow } from '../content/csv.ts';
import type { RandomDraw } from './model.ts';
import { SeededRandom } from '../engine/random.ts';
import { applyDamage, monsterDamageToResident, playerDamageOnHit } from './combat.ts';

export interface LivingTarget {
  readonly id: string;
  readonly hitPoints: number;
}

export interface TargetSelection {
  readonly target: LivingTarget | null;
  readonly randomDraw: RandomDraw | null;
}

export interface AttackRoll {
  readonly rawDamage: number;
  readonly randomDraw: RandomDraw;
}

export interface MonsterTargetState extends LivingTarget {
  readonly defense: number;
}

export interface MonsterSourceStats {
  readonly region: string;
  readonly name: string;
  readonly hitPoints: number | null;
  readonly defense: number | null;
  readonly speed: number | null;
  readonly certainty: string;
  readonly spawnProbabilityPercent: number | null;
  readonly special: string;
}

export interface MonsterStrikeResult {
  readonly targetId: string;
  readonly rawDamage: number;
  readonly appliedDamage: number;
  readonly hitPointsAfter: number;
  readonly killed: boolean;
}

export interface MonsterAttackActionResult {
  readonly hits: readonly MonsterStrikeResult[];
  readonly randomDraws: readonly RandomDraw[];
  readonly targetHitPointsAfter: Readonly<Record<string, number>>;
  readonly rngStateAfter: string;
}

export interface ScheduledMonsterTurnResult {
  readonly action: 'attack' | 'peck' | 'flying' | 'taunt' | 'sleep' | 'claw' | 'breath';
  readonly speed: number | null;
  readonly actionTimeT: number;
  readonly nextActionAtT: number;
  readonly invulnerable: boolean;
  readonly taunts: boolean;
  readonly combatRoundCount: number;
  readonly hits: readonly MonsterStrikeResult[];
  readonly targetHitPointsAfter: Readonly<Record<string, number>>;
  readonly randomDraws: readonly RandomDraw[];
  readonly rngStateAfter: string;
  readonly unresolved: readonly string[];
}

export type ParrotAction = 'peck' | 'flying' | 'taunt';
export type DungeonBoss = 'parrot' | 'catpaw' | 'dragon';

/** Named cosmetic variants used for dungeon-boss memento rewards. */
export const mementoItemVariants = {
  '彩色玻璃珠': ['紅色玻璃珠', '橙色玻璃珠', '黃色玻璃珠', '綠色玻璃珠', '藍色玻璃珠'],
  '彩色毛球': ['紅色毛線球', '橙色毛線球', '黃色毛線球', '綠色毛線球', '藍色毛線球', '靛色毛線球', '紫色毛線球', '金色毛線球'],
} as const;

export function selectMementoItemVariant(
  mementoItemId: keyof typeof mementoItemVariants,
  randomValue: number,
): (typeof mementoItemVariants)[typeof mementoItemId][number] {
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new Error('Memento variant draw must be in the range [0, 1).');
  }
  const variants = mementoItemVariants[mementoItemId];
  return variants[Math.floor(randomValue * variants.length)]!;
}

export interface ParrotActionResult {
  readonly action: ParrotAction;
  readonly invulnerableForThisAction: boolean;
  readonly tauntsCurrentEncounter: boolean;
  readonly randomDraw: RandomDraw;
}

export interface DragonActionModeResult {
  readonly mode: 'claw' | 'breath';
  readonly randomDraw: RandomDraw;
  readonly unresolvedDamage: string | null;
}

export interface BossVictoryRewardPlan {
  readonly accessGrantedFloor: 2 | 3 | null;
  readonly accessGrantedTo: readonly string[];
  readonly lastHitActorId: string;
  readonly tieredArmorReward: 'iron' | 'knight' | null;
  readonly mementoItemId: '彩色玻璃珠' | '彩色毛球' | null;
  readonly lastHitHealing: { readonly actorId: string; readonly amount: 10 } | null;
}

export const unresolvedMonsterMechanics = [
  { sourceId: 'C-07', detail: 'Boss 2 20% hit-rate applicability and resolution order are unavailable.' },
  { sourceId: 'M-04/M-05', detail: 'Surface boar, bat and wolf encounter rates remain unspecified where source rows are blank.' },
] as const;

/** Parse a row from the authoritative monsters.csv without coercing blank values to zero. */
export function monsterStatsFromSource(row: CsvRow): MonsterSourceStats {
  return {
    region: requiredText(row.region, 'region'),
    name: requiredText(row.name, 'name'),
    hitPoints: nullableSourceNumber(row.hp, 'hp'),
    defense: nullableSourceNumber(row.defense, 'defense'),
    speed: nullableSourceNumber(row.speed, 'speed'),
    certainty: requiredText(row.certainty, 'certainty'),
    spawnProbabilityPercent: nullableSourceNumber(row.spawn_probability_percent, 'spawn_probability_percent'),
    special: requiredText(row.special, 'special'),
  };
}

/** Independently choose one living participant for one strike, as specified in Reference 05. */
export function chooseLivingTarget(
  targets: readonly LivingTarget[],
  random: SeededRandom,
  sourceId: string,
): TargetSelection {
  const living = targets.filter((target) => target.hitPoints > 0);
  if (living.length === 0) return { target: null, randomDraw: null };
  const randomDraw = random.next(sourceId);
  const index = Math.floor(randomDraw.value * living.length);
  return { target: living[index] ?? null, randomDraw };
}

/** Draw one raw monster attack from the recovered per-monster distribution. */
export function drawAttack(
  distribution: readonly CsvRow[],
  random: SeededRandom,
  sourceId: string,
  attackType = 'normal',
  monsterName?: string,
): AttackRoll {
  const rows = distribution.filter((row) => row.attack_type === attackType && (monsterName === undefined || row.monster === monsterName));
  const entries = rows.map((row) => ({
    value: parseRequiredNumber(row.raw_damage, 'raw_damage'),
    weight: parseRequiredNumber(row.probability_percent, 'probability_percent'),
  }));
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (entries.length === 0 || Math.abs(total - 100) > 1e-8) {
    throw new Error(`Attack distribution ${attackType} must be present and total 100%.`);
  }
  const randomDraw = random.next(sourceId);
  return { rawDamage: selectWeighted(entries, randomDraw.value), randomDraw };
}

/** Resolve one monster action with independent target and raw-damage draws for every included strike. */
export function resolveMonsterAttackAction(input: {
  readonly distribution: readonly CsvRow[];
  readonly attackType: string;
  readonly hitCount: number;
  readonly monsterName?: string;
  readonly sourceId: string;
  readonly targets: readonly MonsterTargetState[];
  readonly random: SeededRandom;
}): MonsterAttackActionResult {
  if (!Number.isInteger(input.hitCount) || input.hitCount < 1) throw new RangeError('Hit count must be a positive integer.');
  const hitPoints: Record<string, number> = {};
  for (const target of input.targets) {
    if (!Number.isFinite(target.hitPoints) || !Number.isFinite(target.defense)) {
      throw new RangeError('Target hit points and defense must be finite.');
    }
    hitPoints[target.id] = target.hitPoints;
  }
  const draws: RandomDraw[] = [];
  const hits: MonsterStrikeResult[] = [];
  for (let strike = 1; strike <= input.hitCount; strike += 1) {
    const living = input.targets.map((target) => ({ ...target, hitPoints: hitPoints[target.id] ?? 0 }));
    const selection = chooseLivingTarget(living, input.random, `${input.sourceId}.target.${strike}`);
    if (selection.randomDraw === null || selection.target === null) break;
    draws.push(selection.randomDraw);
    const attack = drawAttack(input.distribution, input.random, `${input.sourceId}.damage.${strike}`, input.attackType, input.monsterName);
    draws.push(attack.randomDraw);
    const target = input.targets.find((candidate) => candidate.id === selection.target!.id)!;
    const appliedDamage = monsterDamageToResident(attack.rawDamage, target.defense);
    const after = applyDamage(hitPoints[target.id] ?? 0, appliedDamage);
    hitPoints[target.id] = after.hitPoints;
    hits.push({
      targetId: target.id,
      rawDamage: attack.rawDamage,
      appliedDamage,
      hitPointsAfter: after.hitPoints,
      killed: !after.alive,
    });
  }
  return { hits, randomDraws: draws, targetHitPointsAfter: hitPoints, rngStateAfter: input.random.stateHex };
}

/** Resolve one automatic source-defined monster action on the shared T schedule. */
export function resolveScheduledMonsterTurn(input: {
  readonly monster: CsvRow;
  readonly worldTimeT: number;
  readonly nextActionAtT: number;
  readonly combatRoundCount?: number;
  readonly targets: readonly MonsterTargetState[];
  readonly distribution: readonly CsvRow[];
  readonly random: SeededRandom;
  readonly sourceId: string;
}): ScheduledMonsterTurnResult {
  const stats = monsterStatsFromSource(input.monster);
  if ((stats.hitPoints === null && stats.name !== '大貓爪') || stats.defense === null || stats.speed === null) {
    return unresolvedScheduledTurn(input, 'Monster HP, defense, and speed must be resolved before scheduling an action.');
  }
  if (!Number.isSafeInteger(input.worldTimeT) || input.worldTimeT < 0 || !Number.isSafeInteger(input.nextActionAtT) || input.nextActionAtT < 0) {
    return unresolvedScheduledTurn(input, 'Monster action times must be non-negative integer T values.');
  }
  const actionTimeT = Math.max(input.worldTimeT, input.nextActionAtT);
  const targets = input.targets.filter((target) => target.hitPoints > 0);
  if (targets.length === 0) return unresolvedScheduledTurn(input, 'A monster action requires at least one living resident target.', actionTimeT);

  let action: ScheduledMonsterTurnResult['action'] = 'attack';
  let invulnerable = false;
  let taunts = false;
  const draws: RandomDraw[] = [];
  const type = stats.name === '大金剛鸚鵡' ? 'parrot' : null;
  const parrot = type === 'parrot' ? drawParrotAction(input.random, `${input.sourceId}.action`) : null;
  const dragon = stats.name === '巨龍' ? drawDragonActionMode(input.random, `${input.sourceId}.action`) : null;
  const combatRoundCount = (input.combatRoundCount ?? 0) + 1;
  if (stats.name === '大大水豚' && combatRoundCount <= 3) {
    action = 'sleep';
  } else if (parrot !== null) {
    action = parrot.action;
    invulnerable = parrot.invulnerableForThisAction;
    taunts = parrot.tauntsCurrentEncounter;
    draws.push(parrot.randomDraw);
  } else if (dragon !== null) {
    action = dragon.mode;
    draws.push(dragon.randomDraw);
  }

  let attackResult: MonsterAttackActionResult | null = null;
  if (dragon !== null && (action === 'claw' || action === 'breath')) {
    attackResult = resolveDragonAction({ mode: dragon.mode, targets, random: input.random, sourceId: input.sourceId });
    draws.push(...attackResult.randomDraws);
  } else if (stats.name === '大貓爪') {
    attackResult = resolveBoss2Attack({ targets, distribution: input.distribution, random: input.random, sourceId: input.sourceId });
    draws.push(...attackResult.randomDraws);
  } else if (action === 'attack' || action === 'peck') {
    const hitCount = input.monster.attack_action?.includes('2 independent hits') ? 2 : 1;
    const attackType = action === 'peck' ? 'peck_if_75pct_action'
      : stats.name === '大大水豚' ? 'awake_normal'
        : hitCount === 2 ? 'per_hit_twice' : 'normal';
    attackResult = resolveMonsterAttackAction({
      distribution: input.distribution,
      attackType,
      hitCount,
      monsterName: stats.name,
      sourceId: input.sourceId,
      targets,
      random: input.random,
    });
    draws.push(...attackResult.randomDraws);
  }
  return {
    action,
    speed: stats.speed,
    actionTimeT,
    nextActionAtT: actionTimeT + 1,
    invulnerable,
    taunts,
    combatRoundCount,
    hits: attackResult?.hits ?? [],
    targetHitPointsAfter: attackResult?.targetHitPointsAfter ?? Object.fromEntries(targets.map((target) => [target.id, target.hitPoints])),
    randomDraws: draws,
    rngStateAfter: input.random.stateHex,
    unresolved: [],
  };
}

function unresolvedScheduledTurn(
  input: { readonly random: SeededRandom },
  detail: string,
  actionTimeT = 0,
): ScheduledMonsterTurnResult {
  return {
    action: 'attack', speed: null, actionTimeT, nextActionAtT: actionTimeT, invulnerable: false, taunts: false, combatRoundCount: 0,
    hits: [], targetHitPointsAfter: {}, randomDraws: [], rngStateAfter: input.random.stateHex, unresolved: [detail],
  };
}

/** Green dwarf and fire-wing bat summon one full-strength companion once per encounter. */
export function shouldSummonCompanion(input: {
  readonly hitPoints: number;
  readonly maxHitPoints: number;
  readonly alreadySummoned: boolean;
}): boolean {
  if (!Number.isFinite(input.hitPoints) || !Number.isFinite(input.maxHitPoints) || input.maxHitPoints <= 0) {
    throw new RangeError('Monster hit points must be finite and maximum hit points must be positive.');
  }
  return input.hitPoints > 0 && !input.alreadySummoned && input.hitPoints / input.maxHitPoints <= 0.3;
}

/** Boss 1 action weights are source-defined; unresolved damage weights remain separate. */
export function drawParrotAction(random: SeededRandom, sourceId = 'parrot.action'): ParrotActionResult {
  const randomDraw = random.next(sourceId);
  const action = randomDraw.value < 0.75 ? 'peck' : randomDraw.value < 0.875 ? 'flying' : 'taunt';
  return {
    action,
    invulnerableForThisAction: action === 'flying',
    tauntsCurrentEncounter: action === 'taunt',
    randomDraw,
  };
}

/** While taunted, a resident attack is invalid and immediately replaces the parrot's ordinary action. */
export function parrotCounterattackOnTauntedHit(taunted: boolean): {
  readonly residentAttackHits: boolean;
  readonly parrotActsImmediately: boolean;
  readonly suppressesOrdinaryParrotAction: boolean;
} {
  return {
    residentAttackHits: !taunted,
    parrotActsImmediately: taunted,
    suppressesOrdinaryParrotAction: taunted,
  };
}

/** The plant's source threshold is strict: target HP below 10, not at 10. */
export function shouldPlantExecute(targetHitPoints: number): boolean {
  if (!Number.isFinite(targetHitPoints)) throw new RangeError('Target hit points must be finite.');
  return targetHitPoints > 0 && targetHitPoints < 10;
}

/** Slime reflection is a separate roll on every received strike, including the lethal strike. */
export function drawSlimeReflection(
  distribution: readonly CsvRow[],
  random: SeededRandom,
  sourceId: string,
): AttackRoll {
  return drawAttack(distribution, random, sourceId, 'reflect_each_received_hit');
}

/** Apply a resident hit and the slime's extra reflection in the same atomic result, even if the hit kills it. */
export function resolveSlimeRetaliation(input: {
  readonly slimeHitPoints: number;
  readonly slimeDefense: number;
  readonly incomingRawDamage: number;
  readonly recipientHitPoints: number;
  readonly recipientDefense: number;
  readonly reflectionDistribution: readonly CsvRow[];
  readonly random: SeededRandom;
  readonly sourceId: string;
}): {
  readonly appliedSlimeDamage: number;
  readonly slimeHitPointsAfter: number;
  readonly rawReflectionDamage: number;
  readonly appliedReflectionDamage: number;
  readonly recipientHitPointsAfter: number;
  readonly reflectionWasRolled: true;
  readonly randomDraws: readonly RandomDraw[];
  readonly rngStateAfter: string;
} {
  if (input.slimeHitPoints <= 0) throw new RangeError('Only a living slime can reflect a received hit.');
  const appliedSlimeDamage = playerDamageOnHit(input.incomingRawDamage, input.slimeDefense);
  const slimeAfter = applyDamage(input.slimeHitPoints, appliedSlimeDamage);
  const reflection = drawSlimeReflection(input.reflectionDistribution, input.random, `${input.sourceId}.reflection`);
  const appliedReflectionDamage = monsterDamageToResident(reflection.rawDamage, input.recipientDefense);
  const recipientAfter = applyDamage(input.recipientHitPoints, appliedReflectionDamage);
  return {
    appliedSlimeDamage,
    slimeHitPointsAfter: slimeAfter.hitPoints,
    rawReflectionDamage: reflection.rawDamage,
    appliedReflectionDamage,
    recipientHitPointsAfter: recipientAfter.hitPoints,
    reflectionWasRolled: true,
    randomDraws: [reflection.randomDraw],
    rngStateAfter: input.random.stateHex,
  };
}

/** Dragon mode and per-value damage odds are user-defined, each damage value having equal weight. */
export function drawDragonActionMode(random: SeededRandom, sourceId = 'dragon.action'): DragonActionModeResult {
  const randomDraw = random.next(sourceId);
  const mode = randomDraw.value < 0.6 ? 'claw' : 'breath';
  return {
    mode,
    randomDraw,
    unresolvedDamage: null,
  };
}

function resolveDragonAction(input: {
  readonly mode: 'claw' | 'breath';
  readonly targets: readonly MonsterTargetState[];
  readonly random: SeededRandom;
  readonly sourceId: string;
}): MonsterAttackActionResult {
  const hitPoints: Record<string, number> = Object.fromEntries(input.targets.map((target) => [target.id, target.hitPoints]));
  const draws: RandomDraw[] = [];
  const hits: MonsterStrikeResult[] = [];
  const targets = input.mode === 'claw'
    ? [chooseLivingTarget(input.targets, input.random, `${input.sourceId}.target`)]
    : input.targets.filter((target) => target.hitPoints > 0).map((target) => ({ target, randomDraw: null }));
  for (const selection of targets) {
    const selectedTarget = selection.target;
    if (selectedTarget === null) continue;
    const target = input.targets.find(({ id }) => id === selectedTarget.id);
    if (target === undefined) continue;
    if (selection.randomDraw !== null) draws.push(selection.randomDraw);
    const randomDraw = input.random.next(`${input.sourceId}.${input.mode}.${target.id}`);
    draws.push(randomDraw);
    const rawDamage = (input.mode === 'claw' ? 22 : 20) + Math.floor(randomDraw.value * 3);
    const appliedDamage = monsterDamageToResident(rawDamage, target.defense);
    const after = applyDamage(hitPoints[target.id] ?? 0, appliedDamage);
    hitPoints[target.id] = after.hitPoints;
    hits.push({ targetId: target.id, rawDamage, appliedDamage, hitPointsAfter: after.hitPoints, killed: !after.alive });
  }
  return { hits, randomDraws: draws, targetHitPointsAfter: hitPoints, rngStateAfter: input.random.stateHex };
}

function resolveBoss2Attack(input: {
  readonly targets: readonly MonsterTargetState[];
  readonly distribution: readonly CsvRow[];
  readonly random: SeededRandom;
  readonly sourceId: string;
}): MonsterAttackActionResult {
  const hitPoints: Record<string, number> = Object.fromEntries(input.targets.map((target) => [target.id, target.hitPoints]));
  const draws: RandomDraw[] = [];
  const selection = chooseLivingTarget(input.targets, input.random, `${input.sourceId}.target`);
  if (selection.randomDraw !== null) draws.push(selection.randomDraw);
  const hitRoll = input.random.next(`${input.sourceId}.hit`);
  draws.push(hitRoll);
  if (selection.target !== null && hitRoll.value < 0.2) {
    const target = input.targets.find(({ id }) => id === selection.target!.id);
    if (target === undefined) return { hits: [], randomDraws: draws, targetHitPointsAfter: hitPoints, rngStateAfter: input.random.stateHex };
    const attack = drawAttack(input.distribution, input.random, `${input.sourceId}.damage`, 'normal', '大貓爪');
    draws.push(attack.randomDraw);
    const appliedDamage = monsterDamageToResident(attack.rawDamage, target.defense);
    const after = applyDamage(hitPoints[target.id] ?? 0, appliedDamage);
    hitPoints[target.id] = after.hitPoints;
    return {
      hits: [{ targetId: target.id, rawDamage: attack.rawDamage, appliedDamage, hitPointsAfter: after.hitPoints, killed: !after.alive }],
      randomDraws: draws,
      targetHitPointsAfter: hitPoints,
      rngStateAfter: input.random.stateHex,
    };
  }
  return { hits: [], randomDraws: draws, targetHitPointsAfter: hitPoints, rngStateAfter: input.random.stateHex };
}

/** Count only an already-resolved effective defense break; the ambiguous 20% rule stays upstream. */
export function recordBoss2Breakthroughs(current: number, effectiveBreaks: number): {
  readonly breakthroughs: number;
  readonly defeated: boolean;
} {
  if (!Number.isInteger(current) || current < 0 || !Number.isInteger(effectiveBreaks) || effectiveBreaks < 0) {
    throw new RangeError('Boss 2 breakthrough counts must be non-negative integers.');
  }
  const breakthroughs = current + effectiveBreaks;
  return { breakthroughs, defeated: breakthroughs >= 5 };
}

/** Plan the source-defined shared access and last-hit rewards from an already established boss victory. */
export function planBossVictoryRewards(input: {
  readonly boss: DungeonBoss;
  readonly lastHitActorId: string;
  /** Participants are scoped by the caller to the boss encounter's Node. */
  readonly participants: readonly { readonly id: string; readonly alive: boolean }[];
}): BossVictoryRewardPlan {
  const accessGrantedTo = input.participants.filter((participant) => participant.alive).map((participant) => participant.id);
  if (!accessGrantedTo.includes(input.lastHitActorId)) {
    throw new Error('Boss last hitter must be an alive participant in the resolved victory encounter.');
  }
  if (input.boss === 'parrot') {
    return {
      accessGrantedFloor: 2,
      accessGrantedTo,
      lastHitActorId: input.lastHitActorId,
      tieredArmorReward: 'iron',
      mementoItemId: '彩色玻璃珠',
      lastHitHealing: null,
    };
  }
  if (input.boss === 'catpaw') {
    return {
      accessGrantedFloor: 3,
      accessGrantedTo,
      lastHitActorId: input.lastHitActorId,
      tieredArmorReward: 'knight',
      mementoItemId: '彩色毛球',
      lastHitHealing: null,
    };
  }
  return {
    accessGrantedFloor: null,
    accessGrantedTo: [],
    lastHitActorId: input.lastHitActorId,
    tieredArmorReward: null,
    mementoItemId: null,
    lastHitHealing: { actorId: input.lastHitActorId, amount: 10 },
  };
}

function selectWeighted<T>(entries: readonly { readonly value: T; readonly weight: number }[], value: number): T {
  let boundary = 0;
  for (const entry of entries) {
    if (!Number.isFinite(entry.weight) || entry.weight < 0) throw new RangeError('Weights must be finite and non-negative.');
    boundary += entry.weight / 100;
    if (value < boundary) return entry.value;
  }
  return entries.at(-1)!.value;
}

function parseRequiredNumber(value: string | undefined, column: string): number {
  if (value === undefined || value.trim() === '') throw new Error(`Source column ${column} is unresolved.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Source column ${column} must be finite.`);
  return parsed;
}

function nullableSourceNumber(value: string | undefined, column: string): number | null {
  if (value === undefined || value.trim() === '' || value.trim().toUpperCase() === 'N/A') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Source column ${column} must be finite when present.`);
  return parsed;
}

function requiredText(value: string | undefined, column: string): string {
  if (value === undefined || value.trim() === '') throw new Error(`Source column ${column} is unresolved.`);
  return value;
}
