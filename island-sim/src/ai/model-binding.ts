import type { ModelBinding } from '../domain/model.ts';
import type { WorldActor, WorldState } from '../domain/model.ts';
import type { ModelSlotConfig, ProcessModelSecrets } from './model-settings.ts';
import { isModelSlotReady } from './model-settings.ts';

export type CurrentModelPriceResult =
  | { readonly ok: true; readonly price: ModelPrice | null }
  | { readonly ok: false; readonly unresolved: string };
export type ModelPrice = { readonly inputUsdPerMillion: number; readonly outputUsdPerMillion: number; readonly priceVersion: string };

/** Resolve current prices by a life-bound provider/model identity, never by slot alone. */
export function currentPriceForBinding(binding: ModelBinding | null, slots: readonly ModelSlotConfig[]): CurrentModelPriceResult {
  if (binding === null || binding.provider === null || binding.model === null) {
    return { ok: false, unresolved: 'Model identity is not bound for this resident life.' };
  }
  const matches = slots.filter((slot) => slot.provider === binding.provider && slot.model === binding.model);
  if (matches.length === 0) return { ok: true, price: null };
  const priced = matches.filter((slot) => slot.inputUsdPerMillion !== null && slot.outputUsdPerMillion !== null);
  if (priced.length === 0) return { ok: true, price: null };
  const rates = new Set(priced.map((slot) => `${slot.inputUsdPerMillion}:${slot.outputUsdPerMillion}`));
  if (rates.size > 1) return { ok: true, price: null };
  const latest = priced.reduce((newest, slot) => (slot.updatedAt ?? '') > (newest.updatedAt ?? '') ? slot : newest);
  return {
    ok: true,
    price: {
      inputUsdPerMillion: latest.inputUsdPerMillion!,
      outputUsdPerMillion: latest.outputUsdPerMillion!,
      priceVersion: latest.updatedAt ?? '',
    },
  };
}

export function modelAssignmentsBySlot(slots: readonly ModelSlotConfig[], secrets: ProcessModelSecrets): Readonly<Record<number, ModelBinding | null>> {
  return Object.fromEntries(Array.from({ length: 10 }, (_, index) => {
    const slotId = index + 1;
    const slot = slots.find((candidate) => candidate.slotId === slotId);
    if (slot === undefined || !isModelSlotReady(slot, secrets.has(slot.credentialRef))) return [slotId, null] as const;
    const binding: ModelBinding = {
      slotId,
      provider: slot.provider,
      baseUrl: slot.baseUrl,
      model: slot.model,
      fallbackModels: slot.fallbackModels,
      maxInputTokens: slot.maxInputTokens,
      maxContextCharacters: slot.maxContextCharacters,
      modelSizeB: slot.modelSizeB,
      sizeAtLeast8BConfirmed: slot.sizeAtLeast8BConfirmed,
      styleDescription: slot.styleDescription,
      updatedAt: slot.updatedAt,
      credentialRef: slot.credentialRef,
    };
    return [slotId, binding] as const;
  }));
}

/** Initial residents have not started a life until a first decision is committed. */
export function bindUnstartedInitialResidents(state: WorldState, assignments: Readonly<Record<number, ModelBinding | null>>): WorldState {
  if (state.sequence !== 0) return state;
  const residents = Object.values(state.actors).filter((actor) => actor.actorType === 'resident' && actor.alive);
  if (residents.length !== 10 || residents.some((actor) => actor.lastActionId !== undefined && actor.lastActionId !== null)) return state;
  let changed = false;
  const actors: Record<string, WorldActor> = { ...state.actors };
  for (const actor of residents) {
    const slotId = actor.modelSlotId ?? (actor.slotId === undefined || actor.slotId === null ? undefined : Number(actor.slotId) + 1);
    if (slotId === undefined) continue;
    const assignment = assignments[slotId] ?? null;
    if (sameBinding(actor.modelAssignment ?? null, assignment)) continue;
    const modelId = assignment?.provider && assignment.model ? `${assignment.provider}/${assignment.model}` : null;
    actors[actor.id] = { ...actor, modelAssignment: assignment, modelId };
    changed = true;
  }
  if (!changed) return state;
  const allBound = residents.every((actor) => assignments[actor.modelSlotId ?? Number(actor.slotId) + 1] !== null && assignments[actor.modelSlotId ?? Number(actor.slotId) + 1] !== undefined);
  const unresolved = allBound ? (state.unresolved ?? []).filter((item) => item.sourceId !== 'D-012') : state.unresolved;
  return { ...state, actors, ...(unresolved === undefined ? {} : { unresolved }) };
}

function sameBinding(left: ModelBinding | null, right: ModelBinding | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
