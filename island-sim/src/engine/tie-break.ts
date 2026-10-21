import type { RandomDraw } from '../domain/model.ts';
import { orderReadyActors, type ReadyActor } from './clock.ts';
import { SeededRandom } from './random.ts';

export interface TieBreakMetrics {
  readonly id: string;
  readonly hitPoints: number | null;
  readonly hunger: number | null;
  readonly sleep: number | null;
  readonly attack: number | null;
  readonly defense: number | null;
  readonly emptySlots: number | null;
}

export interface SameSpeedComparison {
  readonly winnerId: string | null;
  readonly unresolved: string | null;
  readonly tied: boolean;
}

export interface TieGroupResult<T extends { readonly id: string }> {
  readonly actors: readonly T[];
  readonly draws: readonly RandomDraw[];
  readonly rngState: string;
  readonly unresolved: readonly string[];
}

export interface PriorityScheduleResult<T extends ReadyActor> {
  readonly actors: readonly T[];
  readonly draws: readonly RandomDraw[];
  readonly rngState: string;
  readonly unresolved: readonly string[];
}

export function compareSameSpeed(left: TieBreakMetrics, right: TieBreakMetrics): SameSpeedComparison {
  const criteria: readonly (keyof Omit<TieBreakMetrics, 'id'>)[] = [
    'hitPoints', 'hunger', 'sleep', 'attack', 'defense', 'emptySlots',
  ];
  for (const criterion of criteria) {
    const leftValue = left[criterion];
    const rightValue = right[criterion];
    if (leftValue === null || rightValue === null || !Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      return { winnerId: null, unresolved: `Same-speed ${criterion} value is missing; priority cannot be determined`, tied: false };
    }
    if (leftValue !== rightValue) return { winnerId: leftValue > rightValue ? left.id : right.id, unresolved: null, tied: false };
  }
  return { winnerId: null, unresolved: null, tied: true };
}

export function resolveSameSpeedGroup<T extends { readonly id: string }>(
  actors: readonly T[],
  metricsByActorId: ReadonlyMap<string, TieBreakMetrics>,
  rngState: string,
  randomSource = 'same-speed-priority-final-draw',
): TieGroupResult<T> {
  if (actors.length < 2) return { actors, draws: [], rngState, unresolved: [] };
  const metrics = actors.map((actor) => metricsByActorId.get(actor.id));
  if (metrics.some((entry) => entry === undefined)) {
    return { actors: [], draws: [], rngState, unresolved: ['Same-speed priority metrics missing for one or more actors.'] };
  }

  const typedMetrics = metrics as TieBreakMetrics[];
  for (let leftIndex = 0; leftIndex < typedMetrics.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < typedMetrics.length; rightIndex += 1) {
      const comparison = compareSameSpeed(typedMetrics[leftIndex] as TieBreakMetrics, typedMetrics[rightIndex] as TieBreakMetrics);
      if (comparison.unresolved !== null) {
        return { actors: [], draws: [], rngState, unresolved: [comparison.unresolved] };
      }
    }
  }
  const ranked = [...actors].sort((left, right) => {
    const leftMetrics = metricsByActorId.get(left.id);
    const rightMetrics = metricsByActorId.get(right.id);
    if (leftMetrics === undefined || rightMetrics === undefined) return left.id.localeCompare(right.id);
    const comparison = compareSameSpeed(leftMetrics, rightMetrics);
    if (comparison.winnerId === left.id) return -1;
    if (comparison.winnerId === right.id) return 1;
    return 0;
  });

  const groups: T[][] = [];
  for (const actor of ranked) {
    const existing = groups.at(-1);
    const previous = existing?.at(-1);
    const previousMetrics = previous === undefined ? undefined : metricsByActorId.get(previous.id);
    const actorMetrics = metricsByActorId.get(actor.id);
    if (existing !== undefined && previousMetrics !== undefined && actorMetrics !== undefined && compareSameSpeed(previousMetrics, actorMetrics).tied) {
      existing.push(actor);
    } else {
      groups.push([actor]);
    }
  }

  const rng = new SeededRandom(rngState);
  const draws: RandomDraw[] = [];
  for (const group of groups) {
    for (let index = group.length - 1; index > 0; index -= 1) {
      const draw = rng.next(randomSource);
      draws.push(draw);
      const swapIndex = Math.floor(draw.value * (index + 1));
      [group[index], group[swapIndex]] = [group[swapIndex] as T, group[index] as T];
    }
  }
  return { actors: groups.flat(), draws, rngState: rng.stateHex, unresolved: [] };
}

/** Applies the approved same-speed policy to each ready group and returns replay material. */
export function orderReadyActorsByPriority<T extends ReadyActor>(
  actors: readonly T[],
  currentTimeT: number,
  metricsByActorId: ReadonlyMap<string, TieBreakMetrics>,
  initialRngState: string,
): PriorityScheduleResult<T> {
  let rngState = initialRngState;
  const draws: RandomDraw[] = [];
  let unresolved: readonly string[] = [];
  const ordered = orderReadyActors(actors, currentTimeT, (group) => {
    const result = resolveSameSpeedGroup(group, metricsByActorId, rngState);
    if (result.unresolved.length > 0) {
      unresolved = result.unresolved;
      return [];
    }
    draws.push(...result.draws);
    rngState = result.rngState;
    return result.actors.map((actor) => actor.id);
  });
  return {
    actors: ordered.actors,
    draws,
    rngState,
    unresolved: unresolved.length > 0 ? unresolved : ordered.unresolved,
  };
}
