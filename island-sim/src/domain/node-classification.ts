import type { SurfaceTerrain, SurfaceTerrainClassification } from './model.ts';

export interface NodeClassificationBehavior {
  readonly environmentTerrain: SurfaceTerrain | 'unclassified';
  readonly daySurfaceEntryEvents: boolean;
  readonly coconutBeach: boolean;
  readonly dungeonEntrance: boolean;
  readonly monumentValley: boolean;
}

/** Canonical game classification: location behavior follows this value, not visual_type or a Node ID. */
export const NODE_CLASSIFICATION_BEHAVIOR: Readonly<Record<SurfaceTerrainClassification, NodeClassificationBehavior>> = {
  beach: { environmentTerrain: 'beach', daySurfaceEntryEvents: true, coconutBeach: false, dungeonEntrance: false, monumentValley: false },
  'coconut-beach': { environmentTerrain: 'beach', daySurfaceEntryEvents: true, coconutBeach: true, dungeonEntrance: false, monumentValley: false },
  forest: { environmentTerrain: 'forest', daySurfaceEntryEvents: true, coconutBeach: false, dungeonEntrance: false, monumentValley: false },
  'berry-forest': { environmentTerrain: 'forest', daySurfaceEntryEvents: true, coconutBeach: false, dungeonEntrance: false, monumentValley: false },
  river: { environmentTerrain: 'river', daySurfaceEntryEvents: true, coconutBeach: false, dungeonEntrance: false, monumentValley: false },
  rock: { environmentTerrain: 'rock', daySurfaceEntryEvents: true, coconutBeach: false, dungeonEntrance: false, monumentValley: false },
  'dungeon-entrance': { environmentTerrain: 'rock', daySurfaceEntryEvents: true, coconutBeach: false, dungeonEntrance: true, monumentValley: false },
  port: { environmentTerrain: 'unclassified', daySurfaceEntryEvents: false, coconutBeach: false, dungeonEntrance: false, monumentValley: false },
  'monument-valley': { environmentTerrain: 'unclassified', daySurfaceEntryEvents: false, coconutBeach: false, dungeonEntrance: false, monumentValley: true },
  unclassified: { environmentTerrain: 'unclassified', daySurfaceEntryEvents: false, coconutBeach: false, dungeonEntrance: false, monumentValley: false },
};

export function environmentTerrainForClassification(classification: SurfaceTerrainClassification | null | undefined): SurfaceTerrain | 'unclassified' | null {
  return classification == null ? null : NODE_CLASSIFICATION_BEHAVIOR[classification].environmentTerrain;
}

export function allowsDaySurfaceEntryEvents(classification: SurfaceTerrainClassification | null | undefined): boolean {
  return classification == null ? false : NODE_CLASSIFICATION_BEHAVIOR[classification].daySurfaceEntryEvents;
}

export function hasNodeClassificationBehavior(
  classification: SurfaceTerrainClassification | null | undefined,
  behavior: 'coconutBeach' | 'dungeonEntrance' | 'monumentValley',
): boolean {
  return classification != null && NODE_CLASSIFICATION_BEHAVIOR[classification][behavior];
}

export function visualTypeForClassification(classification: SurfaceTerrainClassification): string | null {
  switch (classification) {
    case 'coconut-beach': return '椰子沙灘';
    case 'berry-forest': return '莓果森林';
    case 'dungeon-entrance': return '地牢入口';
    case 'port': return '港口';
    case 'monument-valley': return '紀念碑谷';
    default: return null;
  }
}
