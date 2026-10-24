import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { WorldState } from '../domain/model.ts';
import { SQLiteWorldStore, type MapProfileContent } from '../persistence/sqlite-store.ts';
import { createObserverServer } from './server.ts';
import { readEditorData } from './editor.ts';

test('serves editor page, editor data, and observer API without authentication', async () => {
  const store = SQLiteWorldStore.open(':memory:');
  const server = createObserverServer(store);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const page = await fetch(`${base}/editor`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /輪迴島｜內容工房/);

    const dataResponse = await fetch(`${base}/editor/api/editor/data`);
    assert.equal(dataResponse.status, 200);
    const data = await dataResponse.json() as { nodes: unknown[]; documents: unknown[] };
    assert.ok(data.nodes.length > 0);
    assert.ok(data.documents.length > 0);

    assert.equal((await fetch(`${base}/api/observer`)).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  }
});

test('serves map profile selection, new-session mapId, and save restore over HTTP', async () => {
  const store = SQLiteWorldStore.open(':memory:');
  const defaultProfile = store.ensureDefaultMapProfile({ nodes: [{ node_id: '1', node_label: '預設地圖' }], edges: [], nodeNotices: [] });
  const selectedProfile = store.createMapProfile('選用地圖', {
    nodes: [{ node_id: '1', node_label: '港邊' }], edges: [], nodeNotices: [{ node_id: '1', document_id: 'shared-document' }],
  });
  const initialState: WorldState = {
    schemaVersion: 1, sequence: 0, contentVersion: 'test', worldTimeT: 0, seed: 'seed', rngState: '00000001',
    mapId: defaultProfile.mapId, residentCount: 1, actors: {}, nodes: {}, objects: {},
  };
  store.commit(0, initialState, []);
  store.ensureWorldSession(1);
  let setupMapId = defaultProfile.mapId;
  const lifecycle = {
    read() {
      const session = store.readCurrentWorldSession();
      if (!session) return null;
      return {
        status: session.status, sessionId: session.sessionId, loadedSaveId: session.loadedSaveId,
        loadInstanceId: session.loadInstanceId, sessionName: session.name, residentCount: session.residentCount,
        nextResidentCount: session.residentCount, mapId: store.readSnapshot()?.mapId ?? defaultProfile.mapId,
        setupMapId, mapProfiles: store.listMapProfiles().map(({ mapId, name }) => ({ mapId, name })), saves: store.listWorldSessionSaves(),
        residentTemplateSlots: store.readSetupModelAssignments(session.residentCount),
      };
    },
    setSetupMapId(mapId: string) { if (!store.readMapProfile(mapId)) throw new Error('missing map'); setupMapId = mapId; },
    async startNew(name?: string, mapId?: string) {
      const selected = store.readMapProfile(mapId ?? setupMapId);
      if (!selected) throw new Error('missing map');
      store.startNewWorldSession(name ?? 'HTTP測試局', 1, { ...initialState, mapId: selected.mapId });
    },
    async save(name: string) { store.saveCurrentWorldSession(name); },
    async end() { store.endCurrentWorldSession(); },
    async load(saveId: string) { store.loadWorldSessionSave(saveId); },
  };
  const server = createObserverServer(store, { lifecycle });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const setupBefore = await fetch(`${base}/api/setup`).then((response) => response.json()) as { setupMapId: string; mapProfiles: { mapId: string }[] };
    assert.ok(setupBefore.mapProfiles.some(({ mapId }) => mapId === selectedProfile.mapId));
    assert.equal(setupBefore.setupMapId, defaultProfile.mapId);

    const selectionResponse = await fetch(`${base}/api/setup/map-profile`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mapId: selectedProfile.mapId }),
    });
    assert.equal(selectionResponse.status, 200);
    const setupAfter = await fetch(`${base}/api/setup`).then((response) => response.json()) as { setupMapId: string };
    assert.equal(setupAfter.setupMapId, selectedProfile.mapId);

    const startResponse = await fetch(`${base}/api/lifecycle`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'start', name: 'HTTP地圖局' }),
    });
    assert.equal(startResponse.status, 200);
    const started = await startResponse.json() as { lifecycle: { mapId: string } };
    assert.equal(started.lifecycle.mapId, selectedProfile.mapId);
    assert.equal(store.readSnapshot()?.mapId, selectedProfile.mapId);

    const saveResponse = await fetch(`${base}/api/lifecycle`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'save', name: 'HTTP地圖存檔' }),
    });
    assert.equal(saveResponse.status, 200);
    const saved = await saveResponse.json() as { lifecycle: { saves: { saveId: string; name: string }[] } };
    const save = saved.lifecycle.saves.find(({ name }) => name === 'HTTP地圖存檔');
    assert.ok(save);
    await fetch(`${base}/api/lifecycle`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'end' }),
    });
    const loadResponse = await fetch(`${base}/api/lifecycle`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'load', saveId: save.saveId }),
    });
    assert.equal(loadResponse.status, 200);
    const loaded = await loadResponse.json() as { lifecycle: { mapId: string; loadedSaveId: string | null } };
    assert.equal(loaded.lifecycle.mapId, selectedProfile.mapId);
    assert.equal(loaded.lifecycle.loadedSaveId, save.saveId);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  }
});

test('map-only save preserves shared CSV and restores it when the profile write fails', async () => {
  const editorRoot = await mkdtemp(join(tmpdir(), 'island-map-save-route-'));
  const databasePath = join(editorRoot, 'world.sqlite');
  const sourceTablesPath = fileURLToPath(new URL('../../references/tables/', import.meta.url));
  const tablesPath = join(editorRoot, 'references', 'tables');
  await mkdir(tablesPath, { recursive: true });
  const sourceEntries = await readdir(sourceTablesPath);
  for (const name of sourceEntries) if (name.endsWith('.csv')) await copyFile(join(sourceTablesPath, name), join(tablesPath, name));

  const store = SQLiteWorldStore.open(databasePath);
  const initialEditorData = await readEditorData(editorRoot);
  const profile = store.ensureDefaultMapProfile({
    nodes: initialEditorData.nodes,
    edges: initialEditorData.edges,
    nodeNotices: initialEditorData.notices,
  } as unknown as MapProfileContent);
  const server = createObserverServer(store, { editorRoot });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const dataResponse = await fetch(`${base}/editor/api/editor/data`);
    assert.equal(dataResponse.status, 200);
    const editorData = await dataResponse.json() as Record<string, unknown> & { documents: Record<string, string>[]; nodes: unknown[]; edges: unknown[]; notices: unknown[] };
    const documentPath = join(tablesPath, 'readable_documents.csv');
    const documentsBefore = await readFile(documentPath);
    const mapOnlyResponse = await fetch(`${base}/editor/api/editor/save`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...editorData, mapId: profile.mapId, mapName: '初始地圖', documentChanges: { upsert: [], deleteIds: [] } }),
    });
    assert.equal(mapOnlyResponse.status, 200);
    assert.deepEqual(await readFile(documentPath), documentsBefore);

    const changedDocument = { ...editorData.documents[0]!, text: '這筆文字只會在重試成功時留下。' };
    const failingPayload = {
      ...editorData,
      mapId: profile.mapId,
      mapName: '拒絕更新',
      nodes: editorData.nodes,
      edges: editorData.edges,
      notices: editorData.notices,
      documentChanges: { upsert: [changedDocument], deleteIds: [] },
    };
    const failureDb = new DatabaseSync(databasePath);
    failureDb.exec(`CREATE TRIGGER reject_profile_update BEFORE UPDATE ON map_profiles WHEN NEW.name = '拒絕更新' BEGIN SELECT RAISE(ABORT, 'injected profile update failure'); END;`);
    failureDb.close();
    const failedSave = await fetch(`${base}/editor/api/editor/save`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(failingPayload),
    });
    assert.equal(failedSave.status, 400);
    assert.match((await failedSave.json() as { error: string }).error, /injected profile update failure/);
    assert.deepEqual(await readFile(documentPath), documentsBefore);
    assert.equal(store.readMapProfile(profile.mapId)?.name, '初始地圖');
    assert.deepEqual(store.readMapProfile(profile.mapId)?.nodes, profile.nodes);

    const removeTriggerDb = new DatabaseSync(databasePath);
    removeTriggerDb.exec('DROP TRIGGER reject_profile_update');
    removeTriggerDb.close();
    const retry = await fetch(`${base}/editor/api/editor/save`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(failingPayload),
    });
    assert.equal(retry.status, 200);
    assert.equal(store.readMapProfile(profile.mapId)?.name, '拒絕更新');
    assert.notDeepEqual(await readFile(documentPath), documentsBefore);
    assert.match((await readFile(documentPath, 'utf8')), /這筆文字只會在重試成功時留下。/);
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    store.close();
    await rm(editorRoot, { recursive: true, force: true });
  }
});

test('observer reflects the session map and a legacy save without mapId falls back to default-map', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'island-observer-map-id-'));
  const databasePath = join(directory, 'world.sqlite');
  const store = SQLiteWorldStore.open(databasePath);
  const defaultProfile = store.ensureDefaultMapProfile({
    nodes: [{ node_id: '1', node_label: '預設地圖地點' }], edges: [], nodeNotices: [],
  });
  const selectedProfile = store.createMapProfile('自訂地圖', {
    nodes: [{ node_id: '1', node_label: '自訂地圖地點' }], edges: [], nodeNotices: [],
  });
  const worldFor = (mapId: string, label: string): WorldState => ({
    schemaVersion: 2, sequence: 0, contentVersion: 'map-id-observer-test', worldTimeT: 0, seed: 'seed', rngState: '00000001',
    mapId, residentCount: 1, actors: {},
    nodes: { '1': { id: '1', label, labelStatus: 'test', visualType: 'beach', surfaceTerrain: 'beach', neighbors: [], safe: false } },
    objects: {},
  });
  const server = createObserverServer(store);
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const observerUrl = `http://127.0.0.1:${address.port}/api/observer`;
  try {
    store.startNewWorldSession('自訂地圖局', 1, worldFor(selectedProfile.mapId, '自訂地圖地點'));
    const selectedMarkup = await fetch(observerUrl).then((response) => response.json()) as { markup: string };
    assert.match(selectedMarkup.markup, /自訂地圖地點/);
    assert.doesNotMatch(selectedMarkup.markup, /預設地圖地點/);
    const selectedSave = store.saveCurrentWorldSession('自訂地圖存檔');
    assert.equal(store.readSnapshot()?.mapId, selectedProfile.mapId);
    assert.equal(store.listWorldSessionSaves().some(({ saveId }) => saveId === selectedSave.saveId), true);

    store.endCurrentWorldSession();
    store.startNewWorldSession('舊格式局', 1, worldFor(defaultProfile.mapId, '預設地圖地點'));
    const legacySave = store.saveCurrentWorldSession('缺 mapId 的舊存檔');
    const legacyDb = new DatabaseSync(databasePath);
    const raw = legacyDb.prepare('SELECT snapshot_json FROM world_session_saves WHERE save_id=?').get(legacySave.saveId) as { snapshot_json: string };
    const legacySnapshot = JSON.parse(raw.snapshot_json) as Record<string, unknown>;
    delete legacySnapshot.mapId;
    legacyDb.prepare('UPDATE world_session_saves SET snapshot_json=? WHERE save_id=?').run(JSON.stringify(legacySnapshot), legacySave.saveId);
    legacyDb.close();

    store.loadWorldSessionSave(legacySave.saveId);
    assert.equal(store.readSnapshot()?.mapId, 'default-map');
    assert.equal(store.readMapProfile(store.readSnapshot()!.mapId!)?.mapId, defaultProfile.mapId);
    const legacyMarkup = await fetch(observerUrl).then((response) => response.json()) as { markup: string };
    assert.match(legacyMarkup.markup, /預設地圖地點/);
    assert.doesNotMatch(legacyMarkup.markup, /自訂地圖地點/);
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
