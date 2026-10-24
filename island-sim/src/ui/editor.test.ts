import assert from 'node:assert/strict';
import test from 'node:test';
import { Script } from 'node:vm';
import { copyFile, mkdir, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSimulationActionContent } from '../content/actions.ts';
import { loadIslandGraph } from '../content/island.ts';
import { parseCsv } from '../content/csv.ts';
import { availableActions } from '../engine/simulation.ts';
import { createInitialWorld, syncWorldNodeNotices } from '../engine/world.ts';
import { editorMarkup, editorUiKitMarkup, readEditorData, saveEditorData, saveEditorDocumentChanges, validateData } from './editor.ts';

async function createDocumentSaveRoot(): Promise<{ root: string; documentPath: string }> {
  const root = mkdtempSync(join(tmpdir(), `island-document-save-${process.pid}-`));
  const tablesPath = resolve(root, 'references/tables');
  const documentPath = resolve(tablesPath, 'readable_documents.csv');
  await mkdir(tablesPath, { recursive: true });
  await writeFile(documentPath, [
    'document_id,pool_type,text,status',
    'card-a,book,Original A,approved',
    'card-b,book,Original B,approved',
    'card-keep,book,Keep this row,approved',
    '',
  ].join('\n'), 'utf8');
  return { root, documentPath };
}

async function readSavedDocuments(documentPath: string): Promise<Record<string, string>[]> {
  return [...await parseCsv(await readFile(documentPath, 'utf8'))] as Record<string, string>[];
}

test('editor validates node references and duplicate IDs before CSV persistence', () => {
  const errors = validateData({
    nodes: [
      { node_id: '1', surface_terrain: 'coconut-beach', visual_type: '椰子沙灘', label_status: 'fixture', starting_location: 'true' },
      { node_id: '1', surface_terrain: 'coconut-beach', visual_type: '椰子沙灘', label_status: 'fixture', starting_location: 'false' },
      { node_id: '2', surface_terrain: 'coconut-beach', visual_type: '椰子沙灘', label_status: 'fixture', starting_location: 'false' },
    ],
    edges: [{ source_node: '1', target_node: 'missing' }],
    documents: [{ document_id: 'doc-1', pool_type: 'book', text: '已填寫內容' }],
    pools: [{ pool_type: 'book' }],
    notices: [{ node_id: 'missing', document_id: 'unknown' }],
  });
  assert.equal(errors.length, 3);
  assert.match(errors.join(' '), /Node ID 重複/);
  assert.match(errors.join(' '), /引用不存在的 Node/);
  assert.match(errors.join(' '), /告示綁定/);
});

test('empty document changes do not rewrite the CSV file', async () => {
  const { root, documentPath } = await createDocumentSaveRoot();
  const originalTime = new Date('2001-01-01T00:00:00.000Z');
  await utimes(documentPath, originalTime, originalTime);
  const before = await stat(documentPath);

  await saveEditorDocumentChanges(root, { upsert: [], deleteIds: [] });

  const after = await stat(documentPath);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);
});

test('one document upsert and delete merge the latest CSV while preserving other rows', async () => {
  const { root, documentPath } = await createDocumentSaveRoot();

  await saveEditorDocumentChanges(root, {
    upsert: [{ document_id: 'card-a', pool_type: 'book', text: 'Updated A', status: 'approved' }],
    deleteIds: ['card-b'],
  });

  const documents = await readSavedDocuments(documentPath);
  assert.deepEqual(documents, [
    { document_id: 'card-a', pool_type: 'book', text: 'Updated A', status: 'approved' },
    { document_id: 'card-keep', pool_type: 'book', text: 'Keep this row', status: 'approved' },
  ]);
});

test('parallel writes to different document cards preserve both changes', async () => {
  const { root, documentPath } = await createDocumentSaveRoot();

  await Promise.all([
    saveEditorDocumentChanges(root, {
      upsert: [{ document_id: 'card-a', pool_type: 'book', text: 'Updated A', status: 'approved' }],
      deleteIds: [],
    }),
    saveEditorDocumentChanges(root, {
      upsert: [{ document_id: 'card-b', pool_type: 'book', text: 'Updated B', status: 'approved' }],
      deleteIds: [],
    }),
  ]);

  const documents = await readSavedDocuments(documentPath);
  assert.equal(documents.find((document) => document.document_id === 'card-a')?.text, 'Updated A');
  assert.equal(documents.find((document) => document.document_id === 'card-b')?.text, 'Updated B');
  assert.equal(documents.find((document) => document.document_id === 'card-keep')?.text, 'Keep this row');
});

test('duplicate document IDs in one upsert batch are rejected without writing', async () => {
  const { root, documentPath } = await createDocumentSaveRoot();
  const before = await readFile(documentPath, 'utf8');

  await assert.rejects(saveEditorDocumentChanges(root, {
    upsert: [
      { document_id: 'duplicate-card', pool_type: 'book', text: 'First', status: 'approved' },
      { document_id: 'duplicate-card', pool_type: 'book', text: 'Second', status: 'approved' },
    ],
    deleteIds: [],
  }), /文本卡 ID 重複/);

  assert.equal(await readFile(documentPath, 'utf8'), before);
});

test('a failed document write does not block the next queued write', async () => {
  const invalidRoot = mkdtempSync(join(tmpdir(), `island-document-save-failure-${process.pid}-`));
  const invalidTablesPath = resolve(invalidRoot, 'references/tables');
  await mkdir(resolve(invalidTablesPath, 'readable_documents.csv'), { recursive: true });
  const { root, documentPath } = await createDocumentSaveRoot();

  await assert.rejects(saveEditorDocumentChanges(invalidRoot, {
    upsert: [{ document_id: 'failed-card', pool_type: 'book', text: 'Failure', status: 'approved' }],
    deleteIds: [],
  }));
  await saveEditorDocumentChanges(root, {
    upsert: [{ document_id: 'card-a', pool_type: 'book', text: 'Queue recovered', status: 'approved' }],
    deleteIds: [],
  });

  assert.equal((await readSavedDocuments(documentPath)).find((document) => document.document_id === 'card-a')?.text, 'Queue recovered');
});

test('editor supports a configured reverse-proxy base path and CSV export workflow', () => {
  const html = editorMarkup('/island-tools');
  assert.match(html, /"\/island-tools\/editor"/);
  assert.match(html, /匯出 JSON/);
  assert.match(html, /復原/);
  assert.match(html, /未儲存變更/);
  assert.match(html, /value="beach">沙灘/);
  assert.match(html, /value="forest">森林/);
  assert.match(html, /value="river">河流/);
  assert.match(html, /value="rock">岩石/);
  assert.match(html, /地點名稱/);
  assert.match(html, /地形與遊戲分類/);
  assert.doesNotMatch(html, /地點分類/);
});

test('workbench keeps three desktop columns and adds scoped mobile workspace tabs without changing the UI Kit', () => {
  const html = editorMarkup();
  const kit = editorUiKitMarkup();
  for (const [id, label] of [['library', '文本清單'], ['editor', '編輯內容'], ['side', '預覽與版本']]) {
    assert.match(html, new RegExp(`data-text-pane-tab="${id}"[^>]*>${label}<`));
    assert.match(html, new RegExp(`id="text-pane-${id}"[^>]*data-text-pane="${id}"`));
  }
  assert.match(html, /<body class="editor-workbench">/);
  assert.match(html, /\.editor-workbench \.text-workspace\[data-text-view="library"\]/);
  assert.match(html, /\.library-pane \{ grid-column: span 3; \}/);
  assert.match(html, /\.editor-pane \{ grid-column: span 6; \}/);
  assert.match(html, /\.side-stack \{ grid-column: span 3;/);
  assert.match(html, /\.editor-workbench \.document-list \{ max-height: none; overflow: visible; \}/);
  assert.match(html, /\.editor-workbench \.text-preview \{ max-height: none; overflow: visible; \}/);
  assert.match(html, /function activateTextPane\(id\)/);
  assert.match(html, /data-text-pane-tab/);
  assert.match(html, /event\.key==='ArrowRight'/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
  assert.doesNotMatch(kit, /<body class="editor-workbench">|\.editor-workbench \.text-mobile-tabs/);
});

test('editor preserves gameplay terrain, named locations, and source-level area descriptions', async () => {
  const data = await readEditorData(fileURLToPath(new URL('../../', import.meta.url)));
  const allocated = data.nodes.filter((node) => node.surface_terrain_source === 'user-allocated-general-terrain');
  assert.deepEqual(allocated.map((node) => [node.node_id, node.surface_terrain]), [
    ['3', 'forest'], ['5', 'river'], ['18', 'forest'], ['20', 'rock'], ['26', 'river'], ['28', 'forest'],
  ]);
  assert.equal(data.nodes.find((node) => node.node_id === '25')?.surface_terrain, 'forest');
  assert.equal(data.nodes.find((node) => node.node_id === '19')?.surface_terrain, 'rock');
  assert.equal(data.nodes.find((node) => node.node_id === '21')?.surface_terrain, 'dungeon-entrance');
  const nodeLabels = data.nodes.map((node) => node.node_label);
  assert.ok(nodeLabels.every((label) => Boolean(label)));
  assert.equal(new Set(nodeLabels).size, nodeLabels.length);
  assert.ok(data.nodes.every((node) => node.node_label !== `Node ${node.node_id}`));
  for (const nodeId of ['6', '19', '20', '22', '26']) {
    const node = data.nodes.find((candidate) => candidate.node_id === nodeId);
    assert.ok(node?.node_label);
    if (['19', '20', '26'].includes(nodeId)) assert.doesNotMatch(node?.region_description ?? '', /石堆|山路|河岸/);
  }
});

test('editor CSV save and reload preserves text CRUD, map edits, and runtime-readable notice binding', async () => {
  const root = mkdtempSync(join(tmpdir(), `island-editor-roundtrip-${process.pid}-`));
  const sourceTablesPath = fileURLToPath(new URL('../../references/tables/', import.meta.url));
  const tablesPath = resolve(root, 'references/tables');
  await mkdir(tablesPath, { recursive: true });
  for (const name of await readdir(sourceTablesPath)) {
    if (name.endsWith('.csv')) await copyFile(resolve(sourceTablesPath, name), resolve(tablesPath, name));
  }

  const data = await readEditorData(root);
  const originalEdgeCount = data.edges.length;
  const originalNotices = [...data.notices];
  const documentToDelete = data.documents.find((document) => !data.notices.some((notice) => notice.document_id === document.document_id));
  assert.ok(documentToDelete);
  const deletedDocumentId = documentToDelete.document_id;
  const cardId = 'editor-roundtrip-card';
  data.documents.push({ document_id: cardId, pool_type: 'book', text: '初稿', status: 'draft' });
  const card = data.documents.find((document) => document.document_id === cardId);
  assert.ok(card);
  Object.assign(card, {
    text: '重載後可讀取的告示內容', status: 'approved',
  });
  data.documents = data.documents.filter((document) => document.document_id !== deletedDocumentId);
  data.notices.push({ node_id: '2', document_id: cardId });
  const node = data.nodes.find((candidate) => candidate.node_id === '1');
  assert.ok(node);
  Object.assign(node, {
    node_label: '編輯器驗收點', region_description: '已保存的區域敘述', image_x_px_approx: '135', image_y_px_approx: '560',
  });
  data.edges.push({ source_node: '1', target_node: '5', bidirectional: 'true', kind: 'editor_link', evidence: 'roundtrip-test' });

  const backup = await saveEditorData(root, data);
  const reloaded = await readEditorData(root);
  assert.equal(reloaded.documents.find((document) => document.document_id === cardId)?.text, '重載後可讀取的告示內容');
  assert.equal(reloaded.documents.find((document) => document.document_id === cardId)?.status, 'approved');
  assert.equal(reloaded.documents.some((document) => document.document_id === deletedDocumentId), false);
  assert.deepEqual(reloaded.notices, [...originalNotices, { node_id: '2', document_id: cardId }]);
  assert.equal(reloaded.nodes.find((node) => node.node_id === '1')?.image_x_px_approx, '135');
  assert.equal(reloaded.nodes.find((node) => node.node_id === '1')?.region_description, '已保存的區域敘述');
  assert.equal(reloaded.edges.length, originalEdgeCount + 1);
  const backedUpDocuments = await parseCsv(await readFile(resolve(backup, 'readable_documents.csv'), 'utf8'));
  assert.ok(backedUpDocuments.some((document) => document.document_id === deletedDocumentId));

  const sourceDirectory = pathToFileURL(`${tablesPath}${sep}`);
  const [graph, runtimeContent] = await Promise.all([
    loadIslandGraph(sourceDirectory), loadSimulationActionContent(sourceDirectory),
  ]);
  assert.equal(runtimeContent.nodeNotices.find((notice) => notice.node_id === '2')?.document_id, cardId);
  assert.equal(runtimeContent.readableTexts[cardId], '重載後可讀取的告示內容');
  const initial = createInitialWorld(graph, { seed: 'editor-runtime-roundtrip', contentVersion: 'editor-test' });
  const residentId = 'resident-01';
  const worldAtNotice = syncWorldNodeNotices({
    ...initial,
    actors: Object.fromEntries(Object.values(initial.actors).map((actor) => [actor.id, {
      ...actor, nodeId: actor.id === residentId ? '2' : actor.nodeId, nextActionAtT: actor.id === residentId ? 0 : 100,
    }])) as typeof initial.actors,
  }, runtimeContent.nodeNotices);
  assert.ok(availableActions(worldAtNotice, residentId, graph, undefined, runtimeContent)
    .some((action) => action.id === 'read:editor-notice-2'));
});

test('map save UI reports failure without clearing edits and permits a successful retry', async () => {
  const markup = editorMarkup();
  const marker = "$('save').onclick=async()=>{";
  const start = markup.indexOf(marker);
  const end = markup.indexOf("};$('export').onclick", start);
  assert.ok(start >= 0 && end > start);
  const handlerBody = markup.slice(start + marker.length, end);
  const elements: Record<string, any> = {
    save: { disabled: false },
    mapName: { value: '地圖 A' },
    errors: { hidden: true, textContent: '' },
    saveFeedback: { textContent: '' },
    state: { textContent: '', className: '' },
    mapProfile: { value: 'profile-a', options: [{ value: 'profile-a' }], append(option: any) { this.options.push(option); } },
  };
  const data = { mapId: 'profile-a', mapName: '地圖 A', mapProfiles: [{ mapId: 'profile-a', name: '地圖 A' }], nodes: [], edges: [], documents: [{ document_id: 'note-a', pool_type: 'book', text: '保留編輯', status: 'draft' }], notices: [] };
  let calls = 0;
  const runSave = new Function('deps', `
    let { data, originalDocuments, dirty, history, future, api, validate, syncActionStates, clone, document } = deps;
    const $ = deps.$;
    return async function save() { ${handlerBody}; return { data, originalDocuments, dirty, history, future }; };
  `)({
    data,
    originalDocuments: JSON.parse(JSON.stringify(data.documents)),
    dirty: true,
    history: ['prior edit'],
    future: [],
    api: async () => {
      calls += 1;
      return calls === 1
        ? { ok: false, json: async () => ({ error: 'profile write failed' }) }
        : { ok: true, json: async () => ({ mapId: 'profile-a', mapName: '地圖 A' }) };
    },
    validate: () => [],
    syncActionStates: () => {},
    clone: (value: unknown) => JSON.parse(JSON.stringify(value)),
    document: { createElement: () => ({}) },
    $: (id: string) => elements[id],
  });

  const failed = await runSave();
  assert.equal(failed.dirty, true);
  assert.equal(failed.data.documents[0]?.text, '保留編輯');
  assert.equal(elements.saveFeedback.textContent, '儲存失敗，編輯仍保留；修正連線後可重試。');
  assert.equal(elements.errors.hidden, false);
  assert.equal(elements.save.disabled, false);

  const retried = await runSave();
  assert.equal(retried.dirty, false);
  assert.deepEqual(retried.history, []);
  assert.equal(elements.state.textContent, '已儲存');
  assert.equal(elements.saveFeedback.textContent, '已儲存地圖：地圖 A');
  assert.equal(elements.errors.hidden, true);
  assert.equal(calls, 2);
});
