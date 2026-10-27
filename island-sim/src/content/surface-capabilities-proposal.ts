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

export type ProposalEvidence = 'port-classification' | 'coconut-beach-classification' | 'berry-forest-classification' | 'forest-terrain-candidate' | 'rock-terrain-candidate' | 'river-classification';

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
  if (rows.length === 0) throw new Error('地圖 Profile 至少保留一個 Node。');
  const rowIds = rows.map((row) => required(row, 'node_id'));
  if (new Set(rowIds).size !== rowIds.length) throw new Error('地圖 Profile 的 Node ID 重複。');
  const nodes = rows.map((row) => {
    const nodeId = required(row, 'node_id');
    const surfaceTerrain = row.surface_terrain ?? '';
    const label = row.node_label || null;
    const labelStatus = required(row, 'label_status');
    const candidates: SurfaceCapabilityCandidate[] = [];
    if (surfaceTerrain === 'port') candidates.push({ action: 'fishing', evidence: 'port-classification', basis: 'Fishing is available only at Nodes classified as ports.' });
    if (surfaceTerrain === 'coconut-beach') candidates.push({ action: 'coconut-harvest', evidence: 'coconut-beach-classification', basis: 'Coconut harvest follows the Node terrain and gameplay classification.' });
    if (surfaceTerrain === 'berry-forest') candidates.push({ action: 'forest-berry-gather', evidence: 'berry-forest-classification', basis: 'Berry gathering follows the Node berry-forest classification.' });
    if (surfaceTerrain === 'forest' || surfaceTerrain === 'berry-forest') {
      candidates.push({ action: 'forest-boar-area', evidence: 'forest-terrain-candidate', basis: 'Wild-boar areas follow forest and berry-forest classifications; exact spawn placement remains unresolved.' });
    }
    if (surfaceTerrain === 'rock') {
      candidates.push(
        { action: 'rock-exploration', evidence: 'rock-terrain-candidate', basis: 'Rock exploration follows pure rock terrain; dungeon entrances remain a separate classification.' },
        { action: 'goat-hunt-area', evidence: 'rock-terrain-candidate', basis: 'Goat-hunt areas follow pure rock terrain; dungeon entrances remain a separate classification.' },
      );
    }
    if (surfaceTerrain === 'river') {
      candidates.push(
        { action: 'river-exploration', evidence: 'river-classification', basis: 'River exploration follows river classification.' },
        { action: 'night-river-dive', evidence: 'river-classification', basis: 'Night river diving follows river classification; it remains available only at night.' },
      );
    }
    return { nodeId, surfaceTerrain, label, labelStatus, candidates, runtimeEnabled: false as const };
  });

  const beachCandidates = nodes.filter((node) => node.surfaceTerrain === 'coconut-beach').map((node) => node.nodeId);
  const fishingCandidates = nodes.filter((node) => node.surfaceTerrain === 'port').map((node) => node.nodeId);
  const berryForestCandidates = nodes.filter((node) => node.surfaceTerrain === 'berry-forest').map((node) => node.nodeId);
  const selected = nodes.filter((node) => node.candidates.some((candidate) => candidate.action === 'coconut-harvest')).map((node) => node.nodeId);
  if (selected.some((id) => !beachCandidates.includes(id))) throw new Error('Proposed coconut Node candidates must be source beach-type Nodes.');
  return {
    status: 'review-only-not-approved',
    sourceBackedNodeAssignments: [],
    nodes,
    proposedActionNodeIds: {
      fishing: fishingCandidates,
      'coconut-harvest': selected,
      'forest-berry-gather': berryForestCandidates,
      'forest-boar-area': nodes.filter((node) => node.candidates.some((candidate) => candidate.action === 'forest-boar-area')).map((node) => node.nodeId),
      'rock-exploration': nodes.filter((node) => node.candidates.some((candidate) => candidate.action === 'rock-exploration')).map((node) => node.nodeId),
      'goat-hunt-area': nodes.filter((node) => node.candidates.some((candidate) => candidate.action === 'goat-hunt-area')).map((node) => node.nodeId),
      'river-exploration': nodes.filter((node) => node.candidates.some((candidate) => candidate.action === 'river-exploration')).map((node) => node.nodeId),
      'night-river-dive': nodes.filter((node) => node.candidates.some((candidate) => candidate.action === 'night-river-dive')).map((node) => node.nodeId),
    },
    proposalRationale: {
      fishing: 'Fishing is restricted to Nodes classified as ports; the candidate list follows the current map classification.',
      'coconut-harvest': 'Coconut harvest candidates follow the current coconut-beach classifications.',
      'forest-berry-gather': 'Berry gathering follows the editable berry-forest classification on the active map.',
      'forest-boar-area': 'Forest-boar candidates follow forest and berry-forest classifications; exact spawn placement remains unspecified.',
      'rock-exploration': 'Rock-exploration candidates follow pure rock classification; dungeon entrances remain separate.',
      'goat-hunt-area': 'Goat-hunt candidates follow pure rock classification; exact spawn placement remains unspecified.',
      'river-exploration': 'River-exploration candidates follow river classification.',
      'night-river-dive': 'Night-dive candidates follow river classification and the action remains night-only.',
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
        'Coconut candidates follow the current map classification; their runtime assignments are still subject to the existing approval boundary.',
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
