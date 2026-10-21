export type ClockPhase = 'day' | 'night';

export interface ReadyActor {
  readonly id: string;
  readonly speed: number;
  readonly nextActionAtT: number;
  readonly alive: boolean;
}

export interface ReadyActorsResult<T extends ReadyActor> {
  readonly actors: readonly T[];
  readonly unresolved: readonly string[];
}

export type EqualSpeedTiePolicy = (actors: readonly ReadyActor[]) => readonly string[];

export function dayPhaseAt(worldTimeT: number): ClockPhase {
  validateTime(worldTimeT);
  return worldTimeT % 72 < 48 ? 'day' : 'night';
}

export function nextActionTime(currentTimeT: number, actionCostT: 1 | 3): number {
  validateTime(currentTimeT);
  return currentTimeT + actionCostT;
}

export function orderReadyActors<T extends ReadyActor>(
  actors: readonly T[],
  currentTimeT: number,
  tiePolicy?: EqualSpeedTiePolicy,
): ReadyActorsResult<T> {
  validateTime(currentTimeT);
  const ready = actors.filter((actor) => actor.alive && actor.nextActionAtT <= currentTimeT);
  const sameSpeedGroups = new Map<string, T[]>();
  for (const actor of ready) {
    const key = `${actor.nextActionAtT}:${actor.speed}`;
    sameSpeedGroups.set(key, [...(sameSpeedGroups.get(key) ?? []), actor]);
  }

  const collisions = [...sameSpeedGroups.values()].filter((group) => group.length > 1);
  if (collisions.length > 0 && tiePolicy === undefined) {
    return {
      actors: [],
      unresolved: ['C-15: same-time actors with equal speed need an approved tie-break policy'],
    };
  }

  const readyGroups = new Map<number, T[]>();
  for (const actor of ready) readyGroups.set(actor.nextActionAtT, [...(readyGroups.get(actor.nextActionAtT) ?? []), actor]);
  const ordered: T[] = [];
  for (const [timeT, group] of [...readyGroups].sort(([left], [right]) => left - right)) {
    const speedGroups = new Map<number, T[]>();
    for (const actor of group) speedGroups.set(actor.speed, [...(speedGroups.get(actor.speed) ?? []), actor]);
    for (const [, sameSpeed] of [...speedGroups].sort(([left], [right]) => right - left)) {
      if (sameSpeed.length < 2) {
        ordered.push(...sameSpeed);
        continue;
      }
      const ids = tiePolicy?.(sameSpeed) ?? [];
      if (ids.length !== sameSpeed.length || new Set(ids).size !== ids.length || ids.some((id) => !sameSpeed.some((actor) => actor.id === id))) {
        return { actors: [], unresolved: [`Tie-break policy returned an invalid actor order at T=${timeT}.`] };
      }
      const byId = new Map(sameSpeed.map((actor) => [actor.id, actor]));
      ordered.push(...ids.map((id) => byId.get(id) as T));
    }
  }

  return { actors: ordered, unresolved: [] };
}

function validateTime(worldTimeT: number): void {
  if (!Number.isSafeInteger(worldTimeT) || worldTimeT < 0) {
    throw new RangeError('World time must be a non-negative safe integer T.');
  }
}
