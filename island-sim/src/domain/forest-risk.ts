import { SeededRandom } from '../engine/random.ts';
import { forestEntryRates, SURFACE_USER_RULE_OVERRIDES, type ForestPhase } from '../content/surface-user-overrides.ts';
import type { AreaRiskEntry, SurfaceUnresolvedGate } from './surface.ts';
import type { RandomDraw } from './model.ts';

export interface ForestRiskActorAtNode {
  readonly id: string;
  readonly actorType: 'resident' | 'monster' | 'animal';
  readonly alive: boolean;
}

export interface ForestRiskEventDraft {
  readonly kind: 'forest-entry-risk-category' | 'forest-sleep-risk-category';
  readonly actorId: string;
  readonly nodeId: string;
  readonly worldTimeT: number;
  readonly visibility: 'public';
  readonly payload: Readonly<{
    category: 'negative' | 'nonnegative' | 'no-trigger';
    phase: ForestPhase;
    overallNegativePercent: number;
    outcomeId: string | null;
    outcomePayload?: AreaRiskEntry['payload'];
  }>;
  readonly randomDraws: readonly RandomDraw[];
}

export interface ForestRiskResult {
  readonly category: 'negative' | 'nonnegative' | 'no-trigger' | null;
  readonly selectedOutcome: AreaRiskEntry | null;
  readonly timeCostT: 0;
  readonly event: ForestRiskEventDraft | null;
  readonly randomDraws: readonly RandomDraw[];
  readonly rngStateAfter: string;
  readonly unresolved: readonly SurfaceUnresolvedGate[];
}

/** Entry uses two draws: whether this empty forest Node triggers, then its conditional outcome category. */
export function resolveForestEntryEvent(input: {
  readonly actorId: string;
  readonly nodeId: string;
  readonly worldTimeT: number;
  readonly phase: ForestPhase;
  readonly isForestNode: boolean;
  readonly otherActorsAtNode: readonly ForestRiskActorAtNode[];
  readonly conditionalOutcomes?: readonly AreaRiskEntry[];
  readonly randomState: string;
}): ForestRiskResult {
  const random = new SeededRandom(input.randomState);
  if (!input.isForestNode) return empty(random.stateHex);
  if (input.otherActorsAtNode.some((actor) => actor.id !== input.actorId && actor.alive && actor.actorType === 'resident')) return empty(random.stateHex);
  validateCall(input.actorId, input.nodeId, input.worldTimeT);
  const rates = forestEntryRates(input.phase);
  const triggerDraw = random.next(`forest.entry.trigger.${input.nodeId}.${input.actorId}.${input.worldTimeT}`);
  if (triggerDraw.value >= rates.triggerPercent / 100) return {
    category: 'no-trigger', selectedOutcome: null, timeCostT: 0, event: null, randomDraws: [triggerDraw], rngStateAfter: random.stateHex, unresolved: [],
  };

  const table = input.conditionalOutcomes;
  if (table !== undefined) {
    validateConditionalRows(table, rates.negativeGivenTriggerPercent);
    const outcomeDraw = random.next(`forest.entry.outcome.${input.nodeId}.${input.actorId}.${input.worldTimeT}`);
    const selected = selectWeighted(table, outcomeDraw.value);
    const category = selected.polarity;
    const event = categoryEvent('forest-entry-risk-category', input.actorId, input.nodeId, input.worldTimeT, input.phase, rates.overallNegativePercent, category, [triggerDraw, outcomeDraw], selected);
    return { category, selectedOutcome: selected, timeCostT: 0, event, randomDraws: [triggerDraw, outcomeDraw], rngStateAfter: random.stateHex, unresolved: [] };
  }

  const categoryDraw = random.next(`forest.entry.category.${input.nodeId}.${input.actorId}.${input.worldTimeT}`);
  const category = categoryDraw.value < rates.negativeGivenTriggerPercent / 100 ? 'negative' : 'nonnegative';
  const event = categoryEvent('forest-entry-risk-category', input.actorId, input.nodeId, input.worldTimeT, input.phase, rates.overallNegativePercent, category, [triggerDraw, categoryDraw], null);
  return {
    category, selectedOutcome: null, timeCostT: 0, event, randomDraws: [triggerDraw, categoryDraw], rngStateAfter: random.stateHex,
    unresolved: [{ sourceId: `${SURFACE_USER_RULE_OVERRIDES.forestEntry.sourceId}:outcome-table`, detail: `The ${category} conditional category is source-backed, but its specific forest encounter rows are not available in this checkout.` }],
  };
}

/** A sleep check is already triggered by the scheduler: draw the same forest risk distribution once, with no outer trigger. */
export function resolveForestSleepRisk(input: {
  readonly actorId: string;
  readonly nodeId: string;
  readonly worldTimeT: number;
  readonly isSafeNode: boolean;
  readonly isWilderness: boolean;
  readonly table: readonly AreaRiskEntry[] | null;
  readonly randomState: string;
}): ForestRiskResult {
  const random = new SeededRandom(input.randomState);
  if (input.isSafeNode) return empty(random.stateHex);
  validateCall(input.actorId, input.nodeId, input.worldTimeT);
  const target = SURFACE_USER_RULE_OVERRIDES.unsafeSleep.nightNegativeTargetPercent;
  if (input.table === null) return {
    category: null, selectedOutcome: null, timeCostT: 0, event: null, randomDraws: [], rngStateAfter: random.stateHex,
    unresolved: [{ sourceId: `${SURFACE_USER_RULE_OVERRIDES.unsafeSleep.sourceId}:risk-table`, detail: 'Unsafe sleeping is due for a check, but no source-backed area-entry outcome table was supplied.' }],
  };
  let table = input.table;
  if (!input.isWilderness) {
    const scaled = scaleToNegativeTotal(table, target);
    if (scaled.unresolved) return { category: null, selectedOutcome: null, timeCostT: 0, event: null, randomDraws: [], rngStateAfter: random.stateHex, unresolved: [scaled.unresolved] };
    table = scaled.entries;
  } else {
    const sourceNegativePercent = table.filter((entry) => entry.polarity === 'negative').reduce((sum, entry) => sum + entry.weightPercent, 0);
    if (Math.abs(sourceNegativePercent - target) > 1e-8) return {
      category: null, selectedOutcome: null, timeCostT: 0, event: null, randomDraws: [], rngStateAfter: random.stateHex,
      unresolved: [{ sourceId: `${SURFACE_USER_RULE_OVERRIDES.unsafeSleep.sourceId}:wilderness-baseline`, detail: `Wilderness sleep table must already encode the forest overall negative total ${target}%; a conditional 70% category table cannot be used without its outer trigger.` }],
    };
  }
  validateTotal(table);
  const rates = forestEntryRates('night');
  const draw = random.next(`forest.sleep-risk.${input.nodeId}.${input.actorId}.${input.worldTimeT}`);
  const selected = selectWeighted(table, draw.value);
  const category = selected.polarity;
  const event = categoryEvent('forest-sleep-risk-category', input.actorId, input.nodeId, input.worldTimeT, 'night', target, category, [draw], selected);
  return {
    category, selectedOutcome: selected, timeCostT: 0, event, randomDraws: [draw], rngStateAfter: random.stateHex,
    unresolved: category === 'negative' && selected.payload === undefined
      ? [{ sourceId: `${SURFACE_USER_RULE_OVERRIDES.unsafeSleep.sourceId}:negative-effect`, detail: `The risk table selected negative outcome ${selected.id}, but no damage/effect payload is available to apply before checking whether the resident wakes.` }]
      : [],
  };
}

function scaleToNegativeTotal(entries: readonly AreaRiskEntry[], targetNegativePercent: number): { readonly entries: readonly AreaRiskEntry[]; readonly unresolved: SurfaceUnresolvedGate | null } {
  validateTotal(entries);
  if (targetNegativePercent < 0 || targetNegativePercent > 100) throw new RangeError('Target negative probability must be from 0 to 100.');
  const currentNegative = entries.filter((entry) => entry.polarity === 'negative').reduce((sum, entry) => sum + entry.weightPercent, 0);
  if (currentNegative === 0 && targetNegativePercent > 0) return { entries, unresolved: { sourceId: 'forest-sleep-negative-baseline-zero', detail: 'Cannot scale an empty negative category into a nonzero target rate.' } };
  const currentOther = 100 - currentNegative;
  const targetOther = 100 - targetNegativePercent;
  return {
    entries: entries.map((entry) => {
      const current = entry.polarity === 'negative' ? currentNegative : currentOther;
      const target = entry.polarity === 'negative' ? targetNegativePercent : targetOther;
      return { ...entry, weightPercent: current === 0 ? 0 : entry.weightPercent * target / current };
    }),
    unresolved: null,
  };
}

function validateConditionalRows(rows: readonly AreaRiskEntry[], negativePercent: number): void {
  validateTotal(rows);
  const negative = rows.filter((row) => row.polarity === 'negative').reduce((sum, row) => sum + row.weightPercent, 0);
  if (Math.abs(negative - negativePercent) > 1e-8) throw new Error(`Conditional forest outcome rows must total ${negativePercent}% negative.`);
}

function validateTotal(rows: readonly AreaRiskEntry[]): void {
  if (rows.length === 0 || rows.some((row) => !row.id || !Number.isFinite(row.weightPercent) || row.weightPercent < 0)) throw new RangeError('Risk rows must be nonempty with IDs and nonnegative finite weights.');
  const total = rows.reduce((sum, row) => sum + row.weightPercent, 0);
  if (Math.abs(total - 100) > 1e-8) throw new Error(`Risk rows must total 100%; received ${total}.`);
}

function selectWeighted<T extends { readonly weightPercent: number }>(rows: readonly T[], value: number): T {
  let boundary = 0;
  for (const row of rows) {
    boundary += row.weightPercent / 100;
    if (value < boundary) return row;
  }
  return rows.at(-1)!;
}

function categoryEvent(kind: ForestRiskEventDraft['kind'], actorId: string, nodeId: string, worldTimeT: number, phase: ForestPhase, overallNegativePercent: number, category: 'negative' | 'nonnegative', randomDraws: readonly RandomDraw[], outcome: AreaRiskEntry | null): ForestRiskEventDraft {
  return {
    kind, actorId, nodeId, worldTimeT, visibility: 'public',
    payload: { category, phase, overallNegativePercent, outcomeId: outcome?.id ?? null, ...(outcome?.payload === undefined ? {} : { outcomePayload: outcome.payload }) },
    randomDraws,
  };
}

function empty(rngStateAfter: string): ForestRiskResult {
  return { category: null, selectedOutcome: null, timeCostT: 0, event: null, randomDraws: [], rngStateAfter, unresolved: [] };
}

function validateCall(actorId: string, nodeId: string, worldTimeT: number): void {
  if (!actorId || !nodeId || !Number.isSafeInteger(worldTimeT) || worldTimeT < 0) throw new RangeError('Actor, Node and nonnegative integral world time are required.');
}
