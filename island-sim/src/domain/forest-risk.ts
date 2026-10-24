import { SeededRandom } from '../engine/random.ts';
import { forestEntryRates, type ForestPhase } from '../content/surface-user-overrides.ts';
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
  readonly payload: Readonly<{ category: 'triggered' | 'no-trigger'; phase: ForestPhase; overallNegativePercent: null; outcomeId: null }>;
  readonly randomDraws: readonly RandomDraw[];
}

export interface ForestRiskResult {
  readonly category: 'triggered' | 'no-trigger' | null;
  readonly selectedOutcome: null;
  readonly timeCostT: 0;
  readonly event: ForestRiskEventDraft | null;
  readonly randomDraws: readonly RandomDraw[];
  readonly rngStateAfter: string;
  readonly unresolved: readonly SurfaceUnresolvedGate[];
}

/** Kept for direct callers; production movement uses the four-terrain CSV entry resolver. */
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
  if (!input.isForestNode || input.otherActorsAtNode.some((actor) => actor.id !== input.actorId && actor.alive && actor.actorType === 'resident')) return empty(random.stateHex);
  if (!input.actorId || !input.nodeId || !Number.isSafeInteger(input.worldTimeT) || input.worldTimeT < 0) throw new RangeError('Actor, Node and nonnegative integral world time are required.');
  const draw = random.next(`forest.entry.trigger.${input.nodeId}.${input.actorId}.${input.worldTimeT}`);
  const category = draw.value < forestEntryRates(input.phase).triggerPercent / 100 ? 'triggered' : 'no-trigger';
  const event = category === 'no-trigger' ? null : {
    kind: 'forest-entry-risk-category' as const, actorId: input.actorId, nodeId: input.nodeId, worldTimeT: input.worldTimeT, visibility: 'public' as const,
    payload: { category, phase: input.phase, overallNegativePercent: null, outcomeId: null } as const, randomDraws: [draw],
  };
  return { category, selectedOutcome: null, timeCostT: 0, event, randomDraws: [draw], rngStateAfter: random.stateHex, unresolved: [] };
}

function empty(rngStateAfter: string): ForestRiskResult {
  return { category: null, selectedOutcome: null, timeCostT: 0, event: null, randomDraws: [], rngStateAfter, unresolved: [] };
}
