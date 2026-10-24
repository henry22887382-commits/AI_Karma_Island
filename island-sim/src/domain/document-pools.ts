export type ReadableDocumentPool = 'book' | 'drift-bottle' | 'monument-valley';

export interface ReadableDocument {
  readonly id: string;
  readonly pool: ReadableDocumentPool;
  readonly text: string;
}

export interface WeightedReadableDocument {
  readonly document: ReadableDocument;
  readonly probability: number;
}

/** Exposes each document in the selected pool with equal probability. */
export function readableDocumentPoolWeights(
  documents: readonly ReadableDocument[],
  pool: ReadableDocumentPool,
): readonly WeightedReadableDocument[] {
  const entries = documents.filter((document) => document.pool === pool);
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) {
    throw new Error(`Readable document IDs must be unique within pool ${pool}.`);
  }
  if (entries.length === 0) return [];
  const probability = 1 / entries.length;
  return entries.map((document) => ({ document, probability }));
}

/** Picks from one pool using a unit interval draw; an empty reserved pool yields no document. */
export function selectReadableDocument(
  documents: readonly ReadableDocument[],
  pool: ReadableDocumentPool,
  drawValue: number,
): ReadableDocument | null {
  if (!Number.isFinite(drawValue) || drawValue < 0 || drawValue >= 1) {
    throw new RangeError('Readable document draw must be in [0, 1).');
  }
  const entries = readableDocumentPoolWeights(documents, pool);
  if (entries.length === 0) return null;
  return entries[Math.floor(drawValue * entries.length)]?.document ?? null;
}
