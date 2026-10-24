import { SeededRandom } from '../engine/random.ts';
import { SURFACE_USER_RULE_OVERRIDES } from '../content/surface-user-overrides.ts';
import type { RandomDraw, SurfaceTerrainClassification, WorldNode } from './model.ts';
import type { CsvRow } from '../content/csv.ts';
import { environmentTerrainForClassification } from './node-classification.ts';

export interface NightEncounterCheck {
  readonly terrain: SurfaceTerrainClassification | null;
  readonly encounter: boolean;
  readonly probabilityPercent: number | null;
  readonly randomDraw: RandomDraw | null;
  readonly rngStateAfter: string;
  readonly unresolved: string | null;
}

export interface NightEnemySelection {
  readonly name: '夜間蝙蝠' | '夜狼';
  readonly randomDraw: RandomDraw;
  readonly rngStateAfter: string;
}

/** One independent night-enemy check; terrain event pools are evaluated by the caller only on a miss. */
export function resolveNightEncounterCheck(input: {
  readonly node: WorldNode | undefined;
  readonly actorId: string;
  readonly worldTimeT: number;
  readonly randomState: string;
}): NightEncounterCheck {
  if (!input.actorId || !Number.isSafeInteger(input.worldTimeT) || input.worldTimeT < 0) throw new RangeError('Actor and nonnegative integral world time are required.');
  const random = new SeededRandom(input.randomState);
  const terrain = input.node?.surfaceTerrain ?? null;
  const environmentTerrain = environmentTerrainForClassification(terrain);
  if (environmentTerrain === null) return { terrain, encounter: false, probabilityPercent: null, randomDraw: null, rngStateAfter: random.stateHex, unresolved: `Node ${input.node?.id ?? 'unknown'} has no source-backed surface terrain classification for the night encounter rate.` };
  if (environmentTerrain === 'unclassified') return { terrain, encounter: false, probabilityPercent: null, randomDraw: null, rngStateAfter: random.stateHex, unresolved: null };
  const probabilityPercent = SURFACE_USER_RULE_OVERRIDES.nightEncounter.encounterPercentByTerrain[environmentTerrain];
  const randomDraw = random.next(`surface.night-encounter.${environmentTerrain}.${input.node?.id ?? 'unknown'}.${input.actorId}.${input.worldTimeT}`);
  return { terrain, encounter: randomDraw.value < probabilityPercent / 100, probabilityPercent, randomDraw, rngStateAfter: random.stateHex, unresolved: null };
}

/** Selects an enemy only after a successful terrain encounter check. */
export function selectNightEnemy(randomState: string, nodeId: string, actorId: string, worldTimeT: number): NightEnemySelection {
  const random = new SeededRandom(randomState);
  const weights = SURFACE_USER_RULE_OVERRIDES.nightEncounter.enemyWeightByName;
  const draw = random.next(`surface.night-enemy.${nodeId}.${actorId}.${worldTimeT}`);
  const name = draw.value < weights.夜間蝙蝠 / (weights.夜間蝙蝠 + weights.夜狼) ? '夜間蝙蝠' : '夜狼';
  return { name, randomDraw: draw, rngStateAfter: random.stateHex };
}

export function nightEnemySourceRow(rows: readonly CsvRow[] | undefined, name: string): CsvRow | undefined {
  return rows?.find((row) => row.name === name && row.region === 'surface');
}
