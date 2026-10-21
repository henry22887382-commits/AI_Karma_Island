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

export type ProposalEvidence = 'beach-visual-type-candidate' | 'grouped-forest-label-candidate' | 'grouped-rock-label-candidate' | 'grouped-river-label-candidate';

export interface SurfaceCapabilityCandidate {
  readonly action: SurfaceCapability;
  readonly evidence: ProposalEvidence;
  readonly basis: string;
}

export interface SurfaceNodeCapabilityProposal {
  readonly nodeId: string;
  readonly visualType: string;
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
    const visualType = required(row, 'visual_type');
    const label = row.node_label || null;
    const labelStatus = required(row, 'label_status');
    const candidates: SurfaceCapabilityCandidate[] = [];
    if (visualType === '海灘類') {
      candidates.push(
        { action: 'fishing', evidence: 'beach-visual-type-candidate', basis: 'The source defines a complete fishing pool for beach/fishing-point locations but does not identify which individual beach Nodes are fishing points.' },
        { action: 'coconut-harvest', evidence: 'beach-visual-type-candidate', basis: 'The source confirms three coconut beaches, but does not map them to individual Node IDs.' },
      );
    }
    if (containsForest(label)) {
      candidates.push(
        { action: 'forest-berry-gather', evidence: 'grouped-forest-label-candidate', basis: 'The source confirms forest berry gathering; this Node name comes from grouped map labels and is not an individually confirmed interaction assignment.' },
        { action: 'forest-boar-area', evidence: 'grouped-forest-label-candidate', basis: 'The source places wild boar in forest Nodes; encounter rate and exact Node assignments remain unresolved.' },
      );
    }
    if (containsRockPile(label)) {
      candidates.push(
        { action: 'rock-exploration', evidence: 'grouped-rock-label-candidate', basis: 'Rock exploration is source-backed, but the source says the exact interaction Nodes are not marked.' },
        { action: 'goat-hunt-area', evidence: 'grouped-rock-label-candidate', basis: 'Goats are source-placed in rocky areas; exact Node mapping is unresolved.' },
      );
    }
    if (label === '河流') {
      candidates.push(
        { action: 'river-exploration', evidence: 'grouped-river-label-candidate', basis: 'The source defines a river exploration pool; the map names this Node River but retains grouped-label uncertainty.' },
        { action: 'night-river-dive', evidence: 'grouped-river-label-candidate', basis: 'Night diving is source-backed; exact usable Node ID and night-bear sequence remain unresolved.' },
      );
    }
    return { nodeId, visualType, label, labelStatus, candidates, runtimeEnabled: false as const };
  });

  const beachCandidates = nodes.filter((node) => node.visualType === '海灘類').map((node) => node.nodeId);
  const selected = ['1', '8', '13'];
  if (nodes.length !== 28 || new Set(nodes.map((node) => node.nodeId)).size !== 28) throw new Error('Surface capability proposal requires the unique 28-Node source map.');
  if (selected.some((id) => !beachCandidates.includes(id))) throw new Error('Proposed coconut Node candidates must be source beach-type Nodes.');
  return {
    status: 'review-only-not-approved',
    sourceBackedNodeAssignments: [],
    nodes,
    proposedActionNodeIds: {
      fishing: ['2', '10', '14'],
      'coconut-harvest': selected,
      'forest-berry-gather': ['9', '17', '23'],
      'forest-boar-area': ['9', '17', '23'],
      'rock-exploration': ['6', '19', '22'],
      'goat-hunt-area': ['6', '19', '22'],
      'river-exploration': ['24'],
      'night-river-dive': ['24'],
    },
    proposalRationale: {
      fishing: 'Propose three separated beach-type Nodes 2/10/14; Node 10 has a beach label, while 2 and 14 have beach visual type only. No source identifies fishing spots.',
      'coconut-harvest': 'Propose 1/8/13 as three separated beach-type candidates; the source confirms three beaches but does not assign IDs.',
      'forest-berry-gather': 'Use forest labels 9/17/23 as candidates; their names retain grouped-map correspondence caveats.',
      'forest-boar-area': 'Use the same forest-labeled candidates 9/17/23; the wild-boar encounter rate and pointwise spawn Nodes remain unspecified.',
      'rock-exploration': 'Use rock-pile labels 6/19/22 as candidates; 6 and 22 are grouped-label correspondences and the source does not mark interaction Nodes.',
      'goat-hunt-area': 'Use the rocky-area labels 6/19/22 as candidates; exact goat-hunt Node IDs remain unspecified.',
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

function containsForest(label: string | null): boolean {
  return (label ?? '').includes('森林');
}

function containsRockPile(label: string | null): boolean {
  return (label ?? '').includes('石堆');
}

function required(row: CsvRow, column: string): string {
  const value = row[column];
  if (value === undefined || value.length === 0) throw new Error(`Missing source field ${column}.`);
  return value;
}
