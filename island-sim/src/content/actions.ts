import { readCsv, type CsvRow } from './csv.ts';
import { createActiveSurfaceCapabilities, type ActiveSurfaceCapabilities } from './approved-surface-capabilities.ts';

export interface SimulationActionContent {
  readonly foods: readonly CsvRow[];
  readonly equipment: readonly CsvRow[];
  readonly fishing: readonly CsvRow[];
  readonly surface: readonly CsvRow[];
  readonly surfaceEntryEvents: readonly CsvRow[];
  readonly recovered: readonly CsvRow[];
  readonly monsters: readonly CsvRow[];
  readonly attackDistributions: readonly CsvRow[];
  readonly dungeonEvents: readonly CsvRow[];
  readonly monsterBonusDrops: readonly CsvRow[];
  readonly containerCategoryWeights: readonly CsvRow[];
  readonly containerItemSubpools: readonly CsvRow[];
  readonly containerItemIdentities: readonly CsvRow[];
  readonly functionalItems: readonly CsvRow[];
  readonly readableDocumentPools: readonly CsvRow[];
  readonly readableDocuments: readonly CsvRow[];
  readonly nodeNotices: readonly CsvRow[];
  readonly readableTexts: Readonly<Record<string, string>>;
  readonly capabilities: ActiveSurfaceCapabilities;
}

/** Reads authoritative tables as text values; action handlers parse only fields they need and keep blanks unresolved. */
export async function loadSimulationActionContent(directory: URL): Promise<SimulationActionContent> {
  const [foods, equipment, fishing, surface, surfaceEntryEvents, recovered, monsters, attackDistributions, dungeonEvents, monsterBonusDrops, containerCategoryWeights, containerItemSubpools, containerItemIdentities, functionalItems, readableDocumentPools, readableDocuments, nodes, nodeNotices] = await Promise.all([
    readCsv(new URL('food.csv', directory)),
    readCsv(new URL('equipment.csv', directory)),
    readCsv(new URL('fishing_pool.csv', directory)),
    readCsv(new URL('surface_exploration.csv', directory)),
    readCsv(new URL('surface_entry_events.csv', directory)),
    readCsv(new URL('recovered_surface_actions.csv', directory)),
    readCsv(new URL('monsters.csv', directory)),
    readCsv(new URL('attack_distributions.csv', directory)),
    readCsv(new URL('dungeon_events.csv', directory)),
    readCsv(new URL('monster_bonus_drops.csv', directory)),
    readCsv(new URL('container_category_weights.csv', directory)),
    readCsv(new URL('container_item_subpools.csv', directory)),
    readCsv(new URL('container_item_identities.csv', directory)),
    readCsv(new URL('functional_items.csv', directory)),
    readCsv(new URL('readable_document_pools.csv', directory)),
    readCsv(new URL('readable_documents.csv', directory)),
    readCsv(new URL('island_nodes.csv', directory)),
    readCsv(new URL('node_notices.csv', directory)),
  ]);
  const poolTypes = new Set(readableDocumentPools.map((row) => row.pool_type));
  if (!poolTypes.has('book') || !poolTypes.has('drift-bottle')) throw new Error('Readable document pools must define books and reserved drift bottles separately.');
  if (readableDocuments.some((row) => !poolTypes.has(row.pool_type ?? ''))) throw new Error('Readable document references an undefined pool.');
  validateNodeNoticeBindings(nodeNotices, nodes, readableDocuments);
  const readableTexts = Object.fromEntries(readableDocuments.map((row) => [row.document_id ?? '', row.text ?? '']));
  return { foods, equipment, fishing, surface, surfaceEntryEvents, recovered, monsters, attackDistributions, dungeonEvents, monsterBonusDrops, containerCategoryWeights, containerItemSubpools, containerItemIdentities, functionalItems, readableDocumentPools, readableDocuments, nodeNotices, readableTexts, capabilities: createActiveSurfaceCapabilities(nodes) };
}

export function validateNodeNoticeBindings(
  notices: readonly CsvRow[], nodes: readonly CsvRow[], documents: readonly CsvRow[],
): void {
  const nodeIds = new Set(nodes.map((row) => row.node_id));
  const documentsById = new Map(documents.map((row) => [row.document_id ?? '', row]));
  const noticeNodes = new Set<string>();
  for (const notice of notices) {
    const nodeId = notice.node_id ?? '';
    const documentId = notice.document_id ?? '';
    const document = documentsById.get(documentId);
    if (!nodeIds.has(nodeId)) throw new Error(`Node notice references missing Node ${nodeId}.`);
    if (noticeNodes.has(nodeId)) throw new Error(`Node ${nodeId} has more than one notice binding.`);
    if (!document || !(document.text ?? '').trim()) throw new Error(`Node ${nodeId} notice references missing or empty text ${documentId}.`);
    noticeNodes.add(nodeId);
  }
}
