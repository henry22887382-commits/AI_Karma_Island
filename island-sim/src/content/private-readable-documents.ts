import { readFile } from 'node:fs/promises';
import type { CsvRow } from './csv.ts';

export interface PrivateReadableDocumentOverlay {
  readonly version: 1;
  readonly upserts: readonly CsvRow[];
  readonly deletedIds: readonly string[];
}

export const EMPTY_PRIVATE_READABLE_DOCUMENT_OVERLAY: PrivateReadableDocumentOverlay = {
  version: 1,
  upserts: [],
  deletedIds: [],
};

export async function readPrivateReadableDocumentOverlay(path: string): Promise<PrivateReadableDocumentOverlay> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_PRIVATE_READABLE_DOCUMENT_OVERLAY;
    throw error;
  }

  const parsed: unknown = JSON.parse(text);
  if (!isOverlay(parsed)) throw new Error('私人文本庫格式無效。');
  return parsed;
}

export function mergePrivateReadableDocuments(
  publicDocuments: readonly CsvRow[],
  overlay: PrivateReadableDocumentOverlay,
): CsvRow[] {
  const deletedIds = new Set(overlay.deletedIds);
  const privateById = new Map(overlay.upserts.map((document) => [document.document_id ?? '', document]));
  const seenIds = new Set<string>();
  const merged = publicDocuments.flatMap((document) => {
    const id = document.document_id ?? '';
    if (deletedIds.has(id)) return [];
    seenIds.add(id);
    return [privateById.get(id) ?? document];
  });

  for (const document of overlay.upserts) {
    const id = document.document_id ?? '';
    if (!seenIds.has(id) && !deletedIds.has(id)) merged.push(document);
  }
  return merged;
}

export function createPrivateReadableDocumentOverlay(
  publicDocuments: readonly CsvRow[],
  privateDocuments: readonly CsvRow[],
): PrivateReadableDocumentOverlay {
  const publicById = new Map(publicDocuments.map((document) => [document.document_id ?? '', document]));
  const privateById = new Map(privateDocuments.map((document) => [document.document_id ?? '', document]));
  const upserts = privateDocuments.filter((document) => {
    const publicDocument = publicById.get(document.document_id ?? '');
    return !publicDocument || !sameDocument(publicDocument, document);
  });
  const deletedIds = publicDocuments
    .map((document) => document.document_id ?? '')
    .filter((id) => !privateById.has(id));

  return { version: 1, upserts, deletedIds };
}

function isOverlay(value: unknown): value is PrivateReadableDocumentOverlay {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.upserts) || !Array.isArray(record.deletedIds)) return false;
  if (!record.deletedIds.every((id) => typeof id === 'string' && id.length > 0)) return false;

  const ids = new Set<string>();
  for (const item of record.upserts) {
    if (!item || typeof item !== 'object') return false;
    const document = item as Record<string, unknown>;
    if (typeof document.document_id !== 'string' || !document.document_id ||
      Object.values(document).some((field) => typeof field !== 'string') || ids.has(document.document_id)) return false;
    ids.add(document.document_id);
  }
  return true;
}

function sameDocument(left: CsvRow, right: CsvRow): boolean {
  return ['document_id', 'pool_type', 'text', 'status'].every((column) => (left[column] ?? '') === (right[column] ?? ''));
}
