import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSimulationActionContent, validateNodeNoticeBindings } from './actions.ts';
import { readableDocumentPoolWeights, selectReadableDocument } from '../domain/document-pools.ts';

test('loads the exact source food and equipment catalogs used by simulation actions', async () => {
  const content = await loadSimulationActionContent(new URL('../../references/tables/', import.meta.url));
  assert.equal(content.foods.find((row) => row.name === '河豚')?.hp_change, '-3');
  assert.equal(content.foods.find((row) => row.name === '龍血')?.note, '回血而非食物;唯一可回血效果');
  assert.equal(content.equipment.find((row) => row.name_zh === '鐵劍')?.attack, '5');
  assert.equal(content.equipment.find((row) => row.name_zh === '木級雙手武器')?.speed_modifier, '');
  assert.equal(content.fishing.find((row) => row.outcome === '普通魚')?.overall_probability_percent, '25');
  assert.equal(content.surface.find((row) => row.location_action === '河流探索')?.probability_percent, '20');
  assert.equal(content.surfaceEntryEvents.find((row) => row.outcome === '森林野豬')?.probability_percent, '50');
  assert.equal(content.dungeonEvents.find((row) => row.floor === '雨林' && row.event === '巨蟒')?.probability_percent, '17');
  assert.equal(content.monsterBonusDrops.find((row) => row.monster === '巨蟒')?.紙筆_percent, '20');
  assert.equal(content.recovered.find((row) => row.action === '森林採野莓' && row.result_or_hazard === '有益野果')?.probability_percent, '80');
  assert.equal(content.capabilities.runtimeEnabled, true);
  assert.equal(content.capabilities.provenanceByAction.fishing, 'user-adopted-supplemental');
  assert.deepEqual(content.readableDocumentPools.map((row) => row.pool_type), ['book', 'drift-bottle']);
  assert.equal(content.readableDocuments.length, 101);
  assert.ok(content.readableDocuments.every((row) => row.pool_type === 'book' && row.text === ''));
  assert.equal(content.readableTexts['book-001'], '');
  assert.equal(content.readableDocuments.some((row) => row.pool_type === 'drift-bottle'), false);
  assert.deepEqual(content.nodeNotices, []);
  const documents = content.readableDocuments.map((row) => ({
    id: row.document_id!, pool: row.pool_type as 'book', text: row.text!,
  }));
  const bookWeights = readableDocumentPoolWeights(documents, 'book');
  assert.ok(bookWeights.every(({ probability }) => probability === 1 / 101));
  assert.equal(selectReadableDocument(documents, 'drift-bottle', 0), null);
});

test('validates node notice bindings against real Nodes and nonempty readable cards', () => {
  const nodes = [{ node_id: '1' }];
  const documents = [{ document_id: 'notice-1', text: 'A sign' }];
  assert.doesNotThrow(() => validateNodeNoticeBindings([{ node_id: '1', document_id: 'notice-1' }], nodes, documents));
  assert.throws(() => validateNodeNoticeBindings([{ node_id: '2', document_id: 'notice-1' }], nodes, documents), /missing Node 2/);
  assert.throws(() => validateNodeNoticeBindings([{ node_id: '1', document_id: 'empty' }], nodes, documents), /missing or empty text/);
  assert.throws(() => validateNodeNoticeBindings([
    { node_id: '1', document_id: 'notice-1' }, { node_id: '1', document_id: 'notice-1' },
  ], nodes, documents), /more than one notice binding/);
});
