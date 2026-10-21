export function playerDamageOnHit(attack: number, defense: number): number {
  validateFinite(attack, 'Attack');
  validateFinite(defense, 'Defense');
  return Math.max(1, attack - defense);
}

export function monsterDamageToResident(rawDamage: number, totalDefense: number): number {
  validateFinite(rawDamage, 'Raw damage');
  validateFinite(totalDefense, 'Total defense');
  return Math.max(0, rawDamage - totalDefense);
}

export function residentSpeed(
  currentHitPoints: number,
  equippedSpeedModifier: number,
): { readonly speed: number | null; readonly unresolved: string | null } {
  validateFinite(currentHitPoints, 'Current hit points');
  validateFinite(equippedSpeedModifier, 'Equipped speed modifier');
  const raw = currentHitPoints / 10 + equippedSpeedModifier;
  return { speed: Math.round(raw), unresolved: null };
}

export function applyDamage(currentHitPoints: number, amount: number): { readonly hitPoints: number; readonly alive: boolean } {
  validateFinite(currentHitPoints, 'Current hit points');
  validateFinite(amount, 'Damage');
  const hitPoints = Math.max(0, currentHitPoints - amount);
  return { hitPoints, alive: hitPoints > 0 };
}

function validateFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
}
