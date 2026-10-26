/** Active terrain and surface-action rules supplied directly by the user. */
export const SURFACE_USER_RULE_OVERRIDES = {
  entry: {
    sourceId: 'user-supplied-complete-surface-rules-2026-10-22',
    triggerPercentByTerrain: { beach: 20, forest: 20, river: 20, rock: 20 },
    nightTriggerPercentByTerrain: { beach: 20, forest: 20, river: 20, rock: 20 },
  },
  nightEncounter: {
    sourceId: 'user-supplied-surface-night-encounter-rules-revised-2026-10-21',
    provenance: 'Direct user-provided revised surface night encounter rule on 2026-10-21; supersedes earlier night-risk rates and ordering.',
    active: true,
    encounterPercentByTerrain: { beach: 20, forest: 20, river: 20, rock: 20 },
    enemyWeightByName: { 夜間蝙蝠: 4, 夜狼: 6 },
    damageOnEncounter: 1,
  },
  forestEntry: {
    sourceId: 'user-supplied-complete-surface-rules-2026-10-22',
    provenance: 'Superseded by the direct complete surface rules supplied on 2026-10-22.',
    active: true,
    emptyNodeOnly: true,
    occupiedBy: 'other-alive-residents-only',
    day: { triggerPercent: 20 },
    night: { triggerPercent: 20 },
    nightOrdering: 'runs-only-after-new-terrain-night-encounter-roll-misses',
  },
  forestBerries: {
    sourceId: 'user-confirmed-berry-forest-total-20-2026-10-26',
    provenance: 'User requested the total berry acquisition rate be reduced to about 20% on 2026-10-26; poisonous berries remain 5% of successful berry finds.',
    active: true,
    historicalSource: 'references/07A_找回的詳細掉落表.md:96',
    historicalProbabilities: { 有益野果: 80, 無收穫: 20 },
    activeProbabilities: { 莓果: 19, 無收穫: 80, 毒莓: 1 },
  },
  unsafeSleep: {
    sourceId: 'latest-user-sleep-risk-override-2026-10-20',
    provenance: 'Direct user correction relayed by root on 2026-10-20; later correction supersedes the earlier safe-area once-per-night statement.',
    active: true,
    safeNodeChecksPerNight: 0,
    unsafeCheckEveryT: 3,
    maxChecksPerNight: 8,
    damageOnEncounter: 1,
    applyEncounterDamageBeforeWake: true,
    wakeOnlyIfAliveAfterDamage: true,
    superseded: { safeNodeChecksPerNight: 1, ruleStatus: 'superseded_by_latest_user_correction' },
  },
} as const;

export type ForestPhase = 'day' | 'night';

export function activeForestBerryPool(): readonly { readonly outcome: '莓果' | '無收穫' | '毒莓'; readonly probabilityPercent: number }[] {
  return [
    { outcome: '莓果', probabilityPercent: SURFACE_USER_RULE_OVERRIDES.forestBerries.activeProbabilities.莓果 },
    { outcome: '無收穫', probabilityPercent: SURFACE_USER_RULE_OVERRIDES.forestBerries.activeProbabilities.無收穫 },
    { outcome: '毒莓', probabilityPercent: SURFACE_USER_RULE_OVERRIDES.forestBerries.activeProbabilities.毒莓 },
  ];
}

export function forestEntryRates(phase: ForestPhase): {
  readonly triggerPercent: number;
  readonly overallNegativePercent: null;
} {
  const rates = SURFACE_USER_RULE_OVERRIDES.forestEntry[phase];
  return { triggerPercent: rates.triggerPercent, overallNegativePercent: null };
}
