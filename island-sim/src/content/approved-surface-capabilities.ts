import type { CsvRow } from './csv.ts';
import { createSurfaceCapabilitiesProposal, type SurfaceCapability } from './surface-capabilities-proposal.ts';

export interface SurfaceCapabilitiesPendingImageVerification {
  readonly status: 'user-selected-candidate-pending-direct-image-verification';
  readonly runtimeEnabled: false;
  readonly provenance: {
    readonly selectedAt: '2026-10-20';
    readonly authority: 'user-selected-after-review-question; selection is held because the referenced image has not been inspected in this workspace';
    readonly mapBasis: 'references/tables/island_nodes.csv and references/03A_28Node原圖與鄰接表.md; image-level labels remain unverified';
    readonly boundary: 'do not use these interaction assignments at runtime or claim the original map labels them until direct PNG inspection is completed';
  };
  readonly candidateActionNodeIds: Readonly<Record<SurfaceCapability, readonly string[]>>;
  readonly coconut: {
    readonly nodeIds: readonly string[];
    readonly initialStockByNode: Readonly<Record<string, 0>>;
    readonly productionPerNodePerIslandDay: 1;
    readonly maximumStockPerNode: 3;
    readonly naturalStockExpires: false;
    readonly harvestCostT: 3;
  };
}

export interface ActiveSurfaceCapabilities {
  readonly status: 'active-user-approved';
  readonly runtimeEnabled: true;
  readonly nodeIdsByAction: Readonly<Record<SurfaceCapability, readonly string[]>>;
  readonly provenanceByAction: Readonly<Record<SurfaceCapability, 'source-group-derived-and-user-adopted' | 'user-adopted-supplemental' | 'user-confirmed-terrain-classification'> & {
    readonly 'forest-berry-gather': 'user-confirmed-terrain-classification';
    readonly 'forest-boar-area': 'source-group-derived-and-user-adopted';
    readonly 'rock-exploration': 'source-group-derived-and-user-adopted';
    readonly 'goat-hunt-area': 'source-group-derived-and-user-adopted';
    readonly 'river-exploration': 'source-group-derived-and-user-adopted';
    readonly 'night-river-dive': 'source-group-derived-and-user-adopted';
    readonly fishing: 'user-adopted-supplemental';
    readonly 'coconut-harvest': 'user-adopted-supplemental';
  }>;
  readonly coconut: {
    readonly nodeIds: readonly string[];
    readonly initialStockByNode: Readonly<Record<string, 0>>;
    readonly productionPerNodePerIslandDay: 1;
    readonly maximumStockPerNode: 3;
    readonly naturalStockExpires: false;
    readonly harvestCostT: 3;
  };
}

/** Runtime mapping uses the user's adopted crosswalk; provenance distinguishes grouped map evidence from supplemental choices. */
export function createActiveSurfaceCapabilities(nodeRows: readonly CsvRow[]): ActiveSurfaceCapabilities {
  const review = createSurfaceCapabilitiesProposal(nodeRows);
  const nodeIdsByAction = review.proposedActionNodeIds;
  const coconutNodeIds = nodeIdsByAction['coconut-harvest'];
  if (coconutNodeIds.length !== 3 || new Set(coconutNodeIds).size !== 3) throw new Error('Exactly three Nodes must use the coconut-beach classification.');
  const initialStockByNode = Object.fromEntries(coconutNodeIds.map((nodeId) => [nodeId, 0])) as Readonly<Record<string, 0>>;
  return {
    status: 'active-user-approved',
    runtimeEnabled: true,
    nodeIdsByAction,
    provenanceByAction: {
      fishing: 'user-adopted-supplemental', 'coconut-harvest': 'user-adopted-supplemental',
      'forest-berry-gather': 'user-confirmed-terrain-classification', 'forest-boar-area': 'source-group-derived-and-user-adopted',
      'rock-exploration': 'source-group-derived-and-user-adopted', 'goat-hunt-area': 'source-group-derived-and-user-adopted',
      'river-exploration': 'source-group-derived-and-user-adopted', 'night-river-dive': 'source-group-derived-and-user-adopted',
    },
    coconut: {
      nodeIds: coconutNodeIds, initialStockByNode,
      productionPerNodePerIslandDay: 1, maximumStockPerNode: 3,
      naturalStockExpires: false, harvestCostT: 3,
    },
  };
}

/** Builds a held candidate mapping. Directly inspect the original referenced image before enabling it in runtime. */
export function createSurfaceCapabilitiesPendingImageVerification(nodeRows: readonly CsvRow[]): SurfaceCapabilitiesPendingImageVerification {
  const review = createSurfaceCapabilitiesProposal(nodeRows);
  return {
    status: 'user-selected-candidate-pending-direct-image-verification',
    runtimeEnabled: false,
    provenance: {
      selectedAt: '2026-10-20', authority: 'user-selected-after-review-question; selection is held because the referenced image has not been inspected in this workspace',
      mapBasis: 'references/tables/island_nodes.csv and references/03A_28Node原圖與鄰接表.md; image-level labels remain unverified',
      boundary: 'do not use these interaction assignments at runtime or claim the original map labels them until direct PNG inspection is completed',
    },
    candidateActionNodeIds: review.proposedActionNodeIds,
    coconut: {
      nodeIds: review.proposedActionNodeIds['coconut-harvest'],
      initialStockByNode: Object.fromEntries(review.proposedActionNodeIds['coconut-harvest'].map((nodeId) => [nodeId, 0])),
      productionPerNodePerIslandDay: 1, maximumStockPerNode: 3,
      naturalStockExpires: false, harvestCostT: 3,
    },
  };
}
