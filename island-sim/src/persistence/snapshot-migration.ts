import type { WorldActor, WorldState } from '../domain/model.ts';

/** Read-time v1->v2 upgrade; the original JSON is unchanged until the next normal commit. */
export function migrateWorldSnapshot(snapshot: WorldState): WorldState {
  if (snapshot.schemaVersion === 2) return snapshot.mapId ? snapshot : { ...snapshot, mapId: 'default-map' };
  const actors: Record<string, WorldActor> = {};
  for (const [key, actor] of Object.entries(snapshot.actors)) {
    const identity = legacySlotAndGeneration(actor.id);
    const slotId = actor.slotId ?? identity?.slotId ?? null;
    const generation = actor.generation ?? identity?.generation ?? null;
    actors[key] = {
      ...actor,
      ...(slotId === null ? {} : { slotId, modelSlotId: actor.modelSlotId ?? Number(slotId) + 1 }),
      modelAssignment: actor.modelAssignment ?? null,
      ...(generation === null ? {} : { generation }),
      diedAtT: actor.diedAtT ?? null,
    };
  }
  return { ...snapshot, schemaVersion: 2, mapId: snapshot.mapId ?? 'default-map', actors };
}

function legacySlotAndGeneration(actorId: string): { readonly slotId: string; readonly generation: number } | undefined {
  const match = /^(?:resident-)?(\d+)(?:\.(\d+))?$/.exec(actorId);
  const digits = match?.[1];
  if (digits === undefined) return undefined;
  const number = Number(digits);
  if (!Number.isSafeInteger(number)) return undefined;
  const zeroBased = digits === '0' || (match?.[2] !== undefined) || number === 0;
  const slot = zeroBased ? number : number - 1;
  if (slot < 0 || slot > 9) return undefined;
  const generation = Number(match?.[2] ?? 1);
  if (!Number.isSafeInteger(generation) || generation < 1) return undefined;
  return { slotId: String(slot), generation };
}
