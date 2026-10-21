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

export type ParrotAction = 'peck' | 'flying' | 'taunt';
export type DungeonBoss = 'parrot' | 'catpaw' | 'dragon';

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
  { sourceId: 'C-05', detail: 'Dragon claw and breath damage inner-value weights are unavailable.' },
  { sourceId: 'C-07', detail: 'Boss 2 20% hit-rate applicability and resolution order are unavailable.' },
  { sourceId: 'C-08', detail: 'Boss 1 flying invulnerability window has no verified scheduler mapping.' },
  { sourceId: 'C-09', detail: 'Capybara three-sleeping-interaction duration has no verified 72T mapping.' },
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
): AttackRoll {
  const rows = distribution.filter((row) => row.attack_type === attackType);
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
    const attack = drawAttack(input.distribution, input.random, `${input.sourceId}.damage.${strike}`, input.attackType);
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

/** Dragon action odds are known; the source does not define the per-value damage weights. */
export function drawDragonActionMode(random: SeededRandom, sourceId = 'dragon.action'): DragonActionModeResult {
  const randomDraw = random.next(sourceId);
  const mode = randomDraw.value < 0.6 ? 'claw' : 'breath';
  return {
    mode,
    randomDraw,
    unresolvedDamage: mode === 'claw'
      ? 'C-05: dragon claw 22-24 internal weights are unresolved.'
      : 'C-05: dragon breath 20-22 internal weights are unresolved.',
  };
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
