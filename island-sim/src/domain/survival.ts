export interface Vitals {
  readonly hitPoints: number;
  readonly hunger: number;
  readonly sleep: number;
  readonly inventory: readonly InventoryItem[];
}

export interface InventoryItem {
  readonly objectId: string;
  readonly itemId: string;
}

export interface FoodEffect {
  readonly itemId: string;
  readonly hungerChange: number;
  readonly hitPointChange: number;
  readonly sleepChange: number;
  readonly edible: boolean;
}

export interface FoodResult {
  readonly accepted: boolean;
  readonly vitals: Vitals;
  readonly unresolved: readonly string[];
}

export interface InventoryResult {
  readonly accepted: boolean;
  readonly inventory: readonly InventoryItem[];
}

export function createInitialVitals(): Vitals {
  return { hitPoints: 30, hunger: 5, sleep: 3, inventory: [] };
}

export function applyFood(vitals: Vitals, food: FoodEffect): FoodResult {
  if (!food.edible || vitals.hunger >= 5) return { accepted: false, vitals, unresolved: [] };
  return {
    accepted: true,
    vitals: {
      ...vitals,
      hunger: vitals.hunger + food.hungerChange,
      hitPoints: vitals.hitPoints + food.hitPointChange,
      sleep: vitals.sleep + food.sleepChange,
    },
    unresolved: [],
  };
}

export function applyHealing(vitals: Vitals, hitPointChange: number): Vitals {
  return { ...vitals, hitPoints: vitals.hitPoints + hitPointChange };
}

export function addInventoryItem(inventory: readonly InventoryItem[], item: InventoryItem): InventoryResult {
  if (inventory.some((existing) => existing.objectId === item.objectId)) throw new Error(`Inventory object ${item.objectId} already exists.`);
  if (inventory.length >= 10) return { accepted: false, inventory };
  return { accepted: true, inventory: [...inventory, item] };
}

export type SpoilKind = 'ordinary' | 'coconut' | 'non-food';

export function foodSpoilAtT(createdAtT: number, kind: SpoilKind): { readonly expiresAtT: number | null; readonly unresolved: string | null } {
  if (kind !== 'ordinary') return { expiresAtT: null, unresolved: null };
  if (!Number.isSafeInteger(createdAtT) || createdAtT < 0) throw new RangeError('Food creation time must be a non-negative safe integer T.');
  return { expiresAtT: null, unresolved: 'C-11: three-island-day spoil start event remains unverified' };
}

export type ObjectLifetimeKind = 'ordinary' | 'opened-container' | 'natural-coconut' | 'corpse' | 'inscription' | 'hero-unique';

export function objectExpiresAtT(createdAtT: number, kind: ObjectLifetimeKind): number | null {
  if (!Number.isSafeInteger(createdAtT) || createdAtT < 0) throw new RangeError('Object creation time must be a non-negative safe integer T.');
  return kind === 'ordinary' || kind === 'opened-container' ? createdAtT + 72 : null;
}

export function isExpiredAt(expiresAtT: number | null, currentTimeT: number): boolean {
  if (!Number.isSafeInteger(currentTimeT) || currentTimeT < 0) throw new RangeError('World time must be a non-negative safe integer T.');
  return expiresAtT !== null && currentTimeT >= expiresAtT;
}
