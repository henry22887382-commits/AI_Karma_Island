import type { CsvRow } from './csv.ts';

export type SurfaceCapability =
  | 'fishing'
  | 'coconut-harvest'
  | 'forest-berry-gather'
  | 'forest-boar-area'
  | 'rock-exploration'
  | 'goat-hunt-area'
  | 'river-exploration'
  | 'night-river-dive';

export type ProposalEvidence = 'port-classification' | 'coconut-beach-classification' | 'grouped-forest-label-candidate' | 'user-confirmed-forest-terrain-candidate' | 'user-selected-rock-terrain-candidate' | 'grouped-river-label-candidate';

export interface SurfaceCapabilityCandidate {
  readonly action: SurfaceCapability;
  readonly evidence: ProposalEvidence;
  readonly basis: string;
}

export interface SurfaceNodeCapabilityProposal {
  readonly nodeId: string;
  readonly surfaceTerrain: string;
  readonly label: string | null;
  readonly labelStatus: string;
  readonly candidates: readonly SurfaceCapabilityCandidate[];
  /** Proposal data only. It is never consumed by runtime action resolution. */
  readonly runtimeEnabled: false;
}

export interface CoconutIslandProposal {
  readonly candidateBeachNodeIds: readonly string[];
  readonly proposedSelectedBeachNodeIds: readonly string[];
  readonly proposedInitialStockByNode: Readonly<Record<string, 0>>;
  readonly sourceDailyProductionPerBeach: 1;
  readonly sourceMaximumStockPerBeach: 3;
  readonly sourceNaturalStockExpires: false;
  readonly sourceHarvestCostT: 3;
  readonly runtimeEnabled: false;
  readonly unresolved: readonly string[];
}

export interface SurfaceCapabilitiesProposal {
  readonly status: 'review-only-not-approved';
  readonly sourceBackedNodeAssignments: readonly [];
  readonly nodes: readonly SurfaceNodeCapabilityProposal[];
  readonly proposedActionNodeIds: Readonly<Record<SurfaceCapability, readonly string[]>>;
  readonly proposalRationale: Readonly<Record<SurfaceCapability, string>>;
  readonly coconut: CoconutIslandProposal;
}

/** Builds an explicit, review-only proposal from the recovered map labels. Never wire as active content. */
export function createSurfaceCapabilitiesProposal(rows: readonly CsvRow[]): SurfaceCapabilitiesProposal {
  const nodes = rows.map((row) => {
    const nodeId = required(row, 'node_id');
    const surfaceTerrain = row.surface_terrain ?? '';
    const label = row.node_label || null;
    const labelStatus = required(row, 'label_status');
    const candidates: SurfaceCapabilityCandidate[] = [];
    if (surfaceTerrain === 'port') candidates.push({ action: 'fishing', evidence: 'port-classification', basis: 'Fishing is available only at Nodes classified as ports.' });
    if (surfaceTerrain === 'coconut-beach') candidates.push({ action: 'coconut-harvest', evidence: 'coconut-beach-classification', basis: 'Coconut harvest follows the Node terrain and gameplay classification.' });
    // Keep the pre-label-edit proposal set (9/11/17/23) bounded while using
    // structured terrain instead of interpreting the editable display name.
    if (['9', '11', '17', '23'].includes(nodeId) && row.surface_terrain === 'forest') {
      const userConfirmedForest = labelStatus.startsWith('使用者確認');
      const evidence = userConfirmedForest ? 'user-confirmed-forest-terrain-candidate' as const : 'grouped-forest-label-candidate' as const;
      const basis = userConfirmedForest
        ? 'The user confirmed this Node is forest; the exact pointwise assignment for this active interaction remains a proposal.'
        : 'The source confirms forest actions; this Node name comes from grouped map labels and is not an individually confirmed interaction assignment.';
      candidates.push(
        { action: 'forest-berry-gather', evidence, basis },
        { action: 'forest-boar-area', evidence, basis: userConfirmedForest ? 'Node terrain is user-confirmed forest; exact wild-boar spawn Node assignments remain unresolved.' : 'The source places wild boar in forest Nodes; encounter rate and exact Node assignments remain unresolved.' },
      );
    }
    const selectedRockTerrainCandidate = ['6', '19', '22'].includes(nodeId) && row.surface_terrain === 'rock';
    if (selectedRockTerrainCandidate) {
      candidates.push(
        { action: 'rock-exploration', evidence: 'user-selected-rock-terrain-candidate', basis: 'This is a user-selected rock-terrain candidate; exact interaction mapping remains bounded to the adopted Node IDs.' },
        { action: 'goat-hunt-area', evidence: 'user-selected-rock-terrain-candidate', basis: 'This is a user-selected rock-terrain candidate; exact goat-hunt mapping remains unresolved.' },
      );
    }
    if (nodeId === '24' && row.surface_terrain === 'river') {
      candidates.push(
        { action: 'river-exploration', evidence: 'grouped-river-label-candidate', basis: 'The source defines a river exploration pool; the map names this Node River but retains grouped-label uncertainty.' },
        { action: 'night-river-dive', evidence: 'grouped-river-label-candidate', basis: 'Night diving is source-backed; exact usable Node ID and night-bear sequence remain unresolved.' },
      );
    }
    return { nodeId, surfaceTerrain, label, labelStatus, candidates, runtimeEnabled: false as const };
  });

  const beachCandidates = nodes.filter((node) => node.surfaceTerrain === 'coconut-beach').map((node) => node.nodeId);
  const fishingCandidates = nodes.filter((node) => node.surfaceTerrain === 'port').map((node) => node.nodeId);
  const selected = rows.filter((row) => row.surface_terrain === 'coconut-beach').map((row) => row.node_id ?? '');
  if (nodes.length !== 28 || new Set(nodes.map((node) => node.nodeId)).size !== 28) throw new Error('Surface capability proposal requires the unique 28-Node source map.');
  if (selected.some((id) => !beachCandidates.includes(id))) throw new Error('Proposed coconut Node candidates must be source beach-type Nodes.');
  return {
    status: 'review-only-not-approved',
    sourceBackedNodeAssignments: [],
    nodes,
    proposedActionNodeIds: {
      fishing: fishingCandidates,
      'coconut-harvest': selected,
      'forest-berry-gather': ['9', '11', '17', '23'],
      'forest-boar-area': ['9', '11', '17', '23'],
      'rock-exploration': ['6', '19', '22'],
      'goat-hunt-area': ['6', '19', '22'],
      'river-exploration': ['24'],
      'night-river-dive': ['24'],
    },
    proposalRationale: {
      fishing: 'Fishing is restricted to Nodes classified as ports; the candidate list follows the current map classification.',
      'coconut-harvest': 'Propose 1/8/13 as three separated beach-type candidates; the source confirms three beaches but does not assign IDs.',
      'forest-berry-gather': 'Use forest labels 9/11/17/23 as candidates; Node 11 terrain is user-confirmed, while the other names retain grouped-map correspondence caveats.',
      'forest-boar-area': 'Use the same forest-labeled candidates 9/11/17/23; Node 11 terrain is user-confirmed, while pointwise wild-boar spawn Nodes remain unspecified.',
      'rock-exploration': 'Use the user-selected, rock-classified Nodes 6/19/22 as candidates; the source does not mark exact interaction Nodes.',
      'goat-hunt-area': 'Use the user-selected, rock-classified Nodes 6/19/22 as candidates; exact goat-hunt Node IDs remain unspecified.',
      'river-exploration': 'Use the Node 24 River label as the single candidate; it retains grouped-label correspondence status.',
      'night-river-dive': 'Use the Node 24 River label as the single candidate; exact dive capability and night-bear pool sequencing remain unresolved.',
    },
    coconut: {
      candidateBeachNodeIds: beachCandidates,
      proposedSelectedBeachNodeIds: selected,
      proposedInitialStockByNode: { '1': 0, '8': 0, '13': 0 },
      sourceDailyProductionPerBeach: 1,
      sourceMaximumStockPerBeach: 3,
      sourceNaturalStockExpires: false,
      sourceHarvestCostT: 3,
      runtimeEnabled: false,
      unresolved: [
        'The selected IDs 1/8/13 are engineering candidates based only on beach type and separation; no source assigns coconut beaches to those Nodes.',
        'Initial coconut stock is not specified by the source; zero is a conservative review proposal, not a recovered rule.',
        'All per-Node action candidates require approval before any runtime capability is enabled.',
      ],
    },
  };
}

function required(row: CsvRow, column: string): string {
  const value = row[column];
  if (value === undefined || value.length === 0) throw new Error(`Missing source field ${column}.`);
  return value;
}
