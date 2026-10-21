/** Latest explicit user rules. Historical CSV/source snapshots remain unchanged for provenance. */
export const SURFACE_USER_RULE_OVERRIDES = {
  forestEntry: {
    sourceId: 'latest-user-recovered-forest-entry-2026-10-20',
    provenance: 'Direct user-provided recovered rule relayed by root on 2026-10-20; source attachment filename is not present in this checkout.',
    active: true,
    emptyNodeOnly: true,
    occupiedBy: 'other-alive-residents-only',
    day: { triggerPercent: 15, negativeGivenTriggerPercent: 35 },
    night: { triggerPercent: 25, negativeGivenTriggerPercent: 70 },
  },
  forestBerries: {
    sourceId: 'latest-user-forest-berries-override-2026-10-20',
    provenance: 'Direct user correction relayed by root on 2026-10-20; active gameplay probabilities supersede the historical recovered CSV values.',
    active: true,
    historicalSource: 'references/tables/recovered_surface_actions.csv:2-3',
    historicalProbabilities: { 有益野果: 80, 無收穫: 20 },
    activeProbabilities: { 有益野果: 90, 無收穫: 10 },
  },
  unsafeSleep: {
    sourceId: 'latest-user-sleep-risk-override-2026-10-20',
    provenance: 'Direct user correction relayed by root on 2026-10-20; later correction supersedes the earlier safe-area once-per-night statement.',
    active: true,
    safeNodeChecksPerNight: 0,
    unsafeCheckEveryT: 3,
    maxChecksPerNight: 8,
    nightNegativeTargetPercent: 17.5,
    applyAttackDamageBeforeWake: true,
    wakeOnlyIfAliveAfterDamage: true,
    superseded: { safeNodeChecksPerNight: 1, ruleStatus: 'superseded_by_latest_user_correction' },
  },
} as const;

export type ForestPhase = 'day' | 'night';

export function activeForestBerryPool(): readonly { readonly outcome: '有益野果' | '無收穫'; readonly probabilityPercent: number }[] {
  return [
    { outcome: '有益野果', probabilityPercent: SURFACE_USER_RULE_OVERRIDES.forestBerries.activeProbabilities.有益野果 },
    { outcome: '無收穫', probabilityPercent: SURFACE_USER_RULE_OVERRIDES.forestBerries.activeProbabilities.無收穫 },
  ];
}

export function forestEntryRates(phase: ForestPhase): {
  readonly triggerPercent: number;
  readonly negativeGivenTriggerPercent: number;
  readonly overallNegativePercent: number;
} {
  const rates = SURFACE_USER_RULE_OVERRIDES.forestEntry[phase];
  return { ...rates, overallNegativePercent: rates.triggerPercent * rates.negativeGivenTriggerPercent / 100 };
}
