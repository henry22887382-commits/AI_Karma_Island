import { dayPhaseAt } from './clock.ts';

/** Returns the next personal check, anchored to the resident's unsafe-area entry. */
export function nextPersonalUnsafeNightRiskAt(
  unsafeEntryAtT: number,
  currentTimeT: number,
  isUnsafe: boolean,
  isSleeping: boolean,
): number | null {
  if (!isUnsafe || !isSleeping || currentTimeT < unsafeEntryAtT) return null;
  const periods = Math.max(1, Math.floor((currentTimeT - unsafeEntryAtT) / 3) + 1);
  for (let index = periods; index < periods + 25; index += 1) {
    const candidate = unsafeEntryAtT + index * 3;
    if (!isNightCheckT(candidate)) continue;
    const nightStartT = candidate % 72 === 0 ? candidate - 24 : Math.floor(candidate / 72) * 72 + 48;
    const firstCheckIndex = Math.max(1, Math.ceil((nightStartT - unsafeEntryAtT) / 3));
    const firstCheckT = unsafeEntryAtT + firstCheckIndex * 3;
    const checksThisNight = Math.floor((candidate - firstCheckT) / 3) + 1;
    if (checksThisNight <= 8) return candidate;
  }
  return null;
}

/** A check exactly 24T after night starts belongs to that completed night. */
export function isNightCheckT(timeT: number): boolean {
  return dayPhaseAt(timeT) === 'night' || (timeT > 0 && timeT % 72 === 0);
}
