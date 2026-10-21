import type { CsvRow } from './csv.ts';
import { createSurfaceCapabilitiesProposal, type SurfaceCapability } from './surface-capabilities-proposal.ts';

export const USER_SELECTED_SURFACE_CAPABILITY_CANDIDATE_NODE_IDS = {
  fishing: ['2', '10', '14'],
  'coconut-harvest': ['1', '8', '13'],
  'forest-berry-gather': ['9', '17', '23'],
  'forest-boar-area': ['9', '17', '23'],
  'rock-exploration': ['6', '19', '22'],
  'goat-hunt-area': ['6', '19', '22'],
  'river-exploration': ['24'],
  'night-river-dive': ['24'],
} as const satisfies Readonly<Record<SurfaceCapability, readonly string[]>>;

export interface SurfaceCapabilitiesPendingImageVerification {
  readonly status: 'user-selected-candidate-pending-direct-image-verification';
  readonly runtimeEnabled: false;
  readonly provenance: {
    readonly selectedAt: '2026-10-20';
    readonly authority: 'user-selected-after-review-question; selection is held because the referenced image has not been inspected in this workspace';
    readonly mapBasis: 'references/tables/island_nodes.csv and references/03A_28Node原圖與鄰接表.md; image-level labels remain unverified';
    readonly boundary: 'do not use these interaction assignments at runtime or claim the original map labels them until direct PNG inspection is completed';
  };
  readonly candidateActionNodeIds: typeof USER_SELECTED_SURFACE_CAPABILITY_CANDIDATE_NODE_IDS;
  readonly coconut: {
    readonly nodeIds: readonly ['1', '8', '13'];
    readonly initialStockByNode: Readonly<Record<'1' | '8' | '13', 0>>;
    readonly productionPerNodePerIslandDay: 1;
    readonly maximumStockPerNode: 3;
    readonly naturalStockExpires: false;
    readonly harvestCostT: 3;
  };
}

export interface ActiveSurfaceCapabilities {
  readonly status: 'active-user-approved';
  readonly runtimeEnabled: true;
  readonly nodeIdsByAction: typeof USER_SELECTED_SURFACE_CAPABILITY_CANDIDATE_NODE_IDS;
  readonly provenanceByAction: Readonly<Record<SurfaceCapability, 'source-group-derived-and-user-adopted' | 'user-adopted-supplemental'> & {
    readonly 'forest-berry-gather': 'source-group-derived-and-user-adopted';
    readonly 'forest-boar-area': 'source-group-derived-and-user-adopted';
    readonly 'rock-exploration': 'source-group-derived-and-user-adopted';
    readonly 'goat-hunt-area': 'source-group-derived-and-user-adopted';
    readonly 'river-exploration': 'source-group-derived-and-user-adopted';
    readonly 'night-river-dive': 'source-group-derived-and-user-adopted';
    readonly fishing: 'user-adopted-supplemental';
    readonly 'coconut-harvest': 'user-adopted-supplemental';
  }>;
  readonly coconut: {
    readonly nodeIds: readonly ['1', '8', '13'];
    readonly initialStockByNode: Readonly<Record<'1' | '8' | '13', 0>>;
    readonly productionPerNodePerIslandDay: 1;
    readonly maximumStockPerNode: 3;
    readonly naturalStockExpires: false;
    readonly harvestCostT: 3;
  };
}

/** Runtime mapping uses the user's adopted crosswalk; provenance distinguishes grouped map evidence from supplemental choices. */
export function createActiveSurfaceCapabilities(nodeRows: readonly CsvRow[]): ActiveSurfaceCapabilities {
  const review = createSurfaceCapabilitiesProposal(nodeRows);
  for (const [action, nodeIds] of Object.entries(USER_SELECTED_SURFACE_CAPABILITY_CANDIDATE_NODE_IDS) as [SurfaceCapability, readonly string[]][]) {
    for (const nodeId of nodeIds) {
      const node = review.nodes.find((row) => row.nodeId === nodeId);
      if (!node?.candidates.some((candidate) => candidate.action === action)) throw new Error(`Approved capability ${action} does not match the source-map candidate at Node ${nodeId}.`);
    }
  }
  return {
    status: 'active-user-approved',
    runtimeEnabled: true,
    nodeIdsByAction: USER_SELECTED_SURFACE_CAPABILITY_CANDIDATE_NODE_IDS,
    provenanceByAction: {
      fishing: 'user-adopted-supplemental', 'coconut-harvest': 'user-adopted-supplemental',
      'forest-berry-gather': 'source-group-derived-and-user-adopted', 'forest-boar-area': 'source-group-derived-and-user-adopted',
      'rock-exploration': 'source-group-derived-and-user-adopted', 'goat-hunt-area': 'source-group-derived-and-user-adopted',
      'river-exploration': 'source-group-derived-and-user-adopted', 'night-river-dive': 'source-group-derived-and-user-adopted',
    },
    coconut: {
      nodeIds: ['1', '8', '13'], initialStockByNode: { '1': 0, '8': 0, '13': 0 },
      productionPerNodePerIslandDay: 1, maximumStockPerNode: 3,
      naturalStockExpires: false, harvestCostT: 3,
    },
  };
}

/** Builds a held candidate mapping. Directly inspect the original referenced image before enabling it in runtime. */
export function createSurfaceCapabilitiesPendingImageVerification(nodeRows: readonly CsvRow[]): SurfaceCapabilitiesPendingImageVerification {
  const review = createSurfaceCapabilitiesProposal(nodeRows);
  for (const [action, nodeIds] of Object.entries(USER_SELECTED_SURFACE_CAPABILITY_CANDIDATE_NODE_IDS) as [SurfaceCapability, readonly string[]][]) {
    for (const nodeId of nodeIds) {
      const node = review.nodes.find((row) => row.nodeId === nodeId);
      if (!node?.candidates.some((candidate) => candidate.action === action)) throw new Error(`Approved capability ${action} does not match the source-map candidate at Node ${nodeId}.`);
    }
  }
  return {
    status: 'user-selected-candidate-pending-direct-image-verification',
    runtimeEnabled: false,
    provenance: {
      selectedAt: '2026-10-20', authority: 'user-selected-after-review-question; selection is held because the referenced image has not been inspected in this workspace',
      mapBasis: 'references/tables/island_nodes.csv and references/03A_28Node原圖與鄰接表.md; image-level labels remain unverified',
      boundary: 'do not use these interaction assignments at runtime or claim the original map labels them until direct PNG inspection is completed',
    },
    candidateActionNodeIds: USER_SELECTED_SURFACE_CAPABILITY_CANDIDATE_NODE_IDS,
    coconut: {
      nodeIds: ['1', '8', '13'], initialStockByNode: { '1': 0, '8': 0, '13': 0 },
      productionPerNodePerIslandDay: 1, maximumStockPerNode: 3,
      naturalStockExpires: false, harvestCostT: 3,
    },
  };
}
