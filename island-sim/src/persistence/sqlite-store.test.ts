import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { WorldEvent, WorldState } from '../domain/model.ts';
import { SQLiteWorldStore } from './sqlite-store.ts';

function state(sequence: number): WorldState {
  return {
    schemaVersion: 1,
    sequence,
    contentVersion: 'source-2026-10-20',
    worldTimeT: sequence,
    seed: 'test-seed',
    rngState: '00000001',
    actors: {},
    nodes: {},
    objects: {},
  };
}

function event(sequence: number, eventId: string): WorldEvent {
  return {
    eventId,
    sequence,
    worldTimeT: sequence,
    actorId: null,
    nodeId: null,
    kind: 'test',
    visibility: 'public',
    payload: { sequence },
    randomDraws: [],
  };
}

test('commits a snapshot and its event batch atomically and reads both back', () => {
  const store = new SQLiteWorldStore(new DatabaseSync(':memory:'));
  store.commit(0, state(2), [event(1, 'event-1'), event(2, 'event-2')]);
  assert.equal(store.readSnapshot()?.sequence, 2);
  assert.deepEqual(store.readEvents().map((item) => item.eventId), ['event-1', 'event-2']);
  store.close();
});

test('seeds and manages independent map profiles while protecting the default profile', () => {
  const store = new SQLiteWorldStore(new DatabaseSync(':memory:'));
  const original = {
    nodes: [{ node_id: '1', terrain: 'beach' }],
    edges: [{ source_node: '1', target_node: '2' }],
    nodeNotices: [{ node_id: '1', document_id: 'note-1' }],
  };
  const seeded = store.ensureDefaultMapProfile(original);
  assert.equal(seeded.mapId, 'default-map');
  assert.equal(seeded.name, '初始地圖');
  assert.deepEqual(seeded.nodes, original.nodes);
  assert.deepEqual(seeded.edges, original.edges);
  assert.deepEqual(seeded.nodeNotices, original.nodeNotices);

  const ignoredReseed = store.ensureDefaultMapProfile({ nodes: [], edges: [], nodeNotices: [] }, '替代預設');
  assert.deepEqual(ignoredReseed, seeded);

  const created = store.createMapProfile('測試地圖', { nodes: [{ node_id: '9' }], edges: [], nodeNotices: [] });
  assert.notEqual(created.mapId, 'default-map');
  assert.equal(store.readMapProfile(created.mapId)?.name, '測試地圖');
  assert.deepEqual(store.listMapProfiles().map(({ mapId }) => mapId), ['default-map', created.mapId]);

  const updated = store.updateMapProfile(created.mapId, '更新地圖', {
    nodes: [{ node_id: '10' }], edges: [{ source_node: '10', target_node: '11' }], nodeNotices: [],
  });
  assert.equal(updated.name, '更新地圖');
  assert.deepEqual(store.readMapProfile(created.mapId)?.nodes, [{ node_id: '10' }]);
  assert.deepEqual(store.readMapProfile(created.mapId)?.edges, [{ source_node: '10', target_node: '11' }]);

  store.deleteMapProfile(created.mapId);
  assert.equal(store.readMapProfile(created.mapId), null);
  assert.deepEqual(store.listMapProfiles().map(({ mapId }) => mapId), ['default-map']);
  assert.throws(() => store.deleteMapProfile('default-map'), /不可刪除/);
  store.close();
});

test('persists map profiles and selected mapId across database close, reopen, and save restore', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'island-map-profile-'));
  const databasePath = join(directory, 'world.sqlite');
  try {
    const store = SQLiteWorldStore.open(databasePath);
    const initial = { nodes: [{ node_id: '1', label: '第一張' }], edges: [], nodeNotices: [{ node_id: '1', document_id: 'shared-note' }] };
    store.ensureDefaultMapProfile({ nodes: [{ node_id: '1', label: '預設' }], edges: [], nodeNotices: [] });
    const chosen = store.createMapProfile('獨立地圖', initial);
    const selectedWorld: WorldState = { ...state(0), residentCount: 1, mapId: chosen.mapId };
    store.startNewWorldSession('持久化驗收局', 1, selectedWorld);
    const saved = store.saveCurrentWorldSession('地圖驗收存檔');
    store.close();

    const reopened = SQLiteWorldStore.open(databasePath);
    assert.deepEqual(reopened.readMapProfile(chosen.mapId)?.nodes, initial.nodes);
    assert.deepEqual(reopened.readMapProfile(chosen.mapId)?.nodeNotices, initial.nodeNotices);
    assert.equal(reopened.readSnapshot()?.mapId, chosen.mapId);
    assert.equal(reopened.listWorldSessionSaves().find((item) => item.saveId === saved.saveId)?.name, saved.name);

    reopened.updateMapProfile(chosen.mapId, '編輯後地圖', { ...initial, nodes: [{ node_id: '1', label: '修改後' }] });
    assert.equal(reopened.readSnapshot()?.mapId, chosen.mapId);
    reopened.loadWorldSessionSave(saved.saveId);
    assert.equal(reopened.readSnapshot()?.mapId, chosen.mapId);
    assert.equal(reopened.readCurrentWorldSession()?.loadedSaveId, saved.saveId);
    assert.equal(reopened.readMapProfile('default-map')?.name, '初始地圖');
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rolls back a failed map profile update and keeps other profiles isolated across processes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'island-map-profile-process-'));
  const databasePath = join(directory, 'world.sqlite');
  try {
    const store = SQLiteWorldStore.open(databasePath);
    store.ensureDefaultMapProfile({ nodes: [{ node_id: 'default' }], edges: [], nodeNotices: [] });
    const first = store.createMapProfile('地圖 A', { nodes: [{ node_id: 'A' }], edges: [], nodeNotices: [] });
    const second = store.createMapProfile('地圖 B', { nodes: [{ node_id: 'B' }], edges: [], nodeNotices: [] });
    const triggerDb = new DatabaseSync(databasePath);
    triggerDb.exec(`CREATE TRIGGER reject_profile_update BEFORE UPDATE ON map_profiles WHEN NEW.name = '不應寫入' BEGIN SELECT RAISE(ABORT, 'injected map profile failure'); END;`);
    triggerDb.close();
    assert.throws(() => store.updateMapProfile(first.mapId, '不應寫入', { nodes: [{ node_id: 'broken' }], edges: [], nodeNotices: [] }), /injected map profile failure/);
    assert.equal(store.readMapProfile(first.mapId)?.name, '地圖 A');
    assert.deepEqual(store.readMapProfile(first.mapId)?.nodes, [{ node_id: 'A' }]);
    store.close();

    const moduleUrl = new URL('./sqlite-store.ts', import.meta.url).href;
    const workerSource = `import { SQLiteWorldStore } from ${JSON.stringify(moduleUrl)}; const store = SQLiteWorldStore.open(process.argv[1]); const mapId = process.argv[2]; const name = process.argv[3]; for (let index = 0; index < 12; index += 1) store.updateMapProfile(mapId, name, { nodes: [{ node_id: name, index }], edges: [], nodeNotices: [] }); store.close();`;
    const runWorker = (mapId: string, name: string) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', workerSource, databasePath, mapId, name], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
      child.once('error', reject);
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Profile writer exited ${String(code)}: ${stderr}`)));
    });
    await Promise.all([runWorker(first.mapId, '地圖 A'), runWorker(second.mapId, '地圖 B')]);

    const afterWorkers = SQLiteWorldStore.open(databasePath);
    assert.equal(afterWorkers.readMapProfile(first.mapId)?.name, '地圖 A');
    assert.equal(afterWorkers.readMapProfile(second.mapId)?.name, '地圖 B');
    assert.deepEqual(afterWorkers.readMapProfile(first.mapId)?.nodes, [{ node_id: '地圖 A', index: 11 }]);
    assert.deepEqual(afterWorkers.readMapProfile(second.mapId)?.nodes, [{ node_id: '地圖 B', index: 11 }]);
    afterWorkers.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('retains traded inventory, permanent corpse, expiry state, and public text in persisted facts', () => {
  const store = new SQLiteWorldStore(new DatabaseSync(':memory:'));
  const base = state(1);
  const world: WorldState = {
    ...base,
    actors: {
      giver: { id: 'giver', actorType: 'resident', alive: true, nodeId: '1', nextActionAtT: 1, speed: 1, unsafeEntryAtT: null, sleeping: false, inventory: [] },
      receiver: { id: 'receiver', actorType: 'resident', alive: true, nodeId: '1', nextActionAtT: 2, speed: 1, unsafeEntryAtT: null, sleeping: false, inventory: ['traded-item'] },
    },
    objects: {
      corpse: { id: 'corpse', itemId: null, objectType: 'corpse', remainsActorId: 'dead', ownerActorId: null, nodeId: '1', generatedAtT: 1, expiresAtT: null, unique: false, provisional: false },
      expiring: { id: 'expiring', itemId: 'ordinary-item', objectType: 'item', ownerActorId: null, nodeId: '1', generatedAtT: 1, expiresAtT: 73, unique: false, provisional: false },
    },
  };
  const publicText: WorldEvent = {
    ...event(1, 'inscription-written'), actorId: 'giver', nodeId: '1', kind: 'public-message-sent',
    payload: { text: '永久留存的公開文字', recipientId: 'receiver' },
  };
  store.commit(0, world, [publicText]);
  const reopened = store.readSnapshot();
  assert.deepEqual(reopened?.actors.giver?.inventory, []);
  assert.deepEqual(reopened?.actors.receiver?.inventory, ['traded-item']);
  assert.deepEqual(reopened?.objects, world.objects);
  assert.deepEqual(store.readEvents(), [publicText]);
  store.close();
});

test('rejects stale sequence commits without adding duplicate history', () => {
  const store = new SQLiteWorldStore(new DatabaseSync(':memory:'));
  store.commit(0, state(1), [event(1, 'event-1')]);
  assert.throws(() => store.commit(0, state(1), [event(1, 'event-2')]), /Sequence conflict/);
  assert.deepEqual(store.readEvents().map((item) => item.eventId), ['event-1']);
  store.close();
});

test('rolls back the entire event batch if an event insert conflicts', () => {
  const store = new SQLiteWorldStore(new DatabaseSync(':memory:'));
  store.commit(0, state(1), [event(1, 'event-1')]);
  assert.throws(() => store.commit(1, state(3), [event(2, 'event-2'), event(3, 'event-1')]), /UNIQUE constraint/);
  assert.equal(store.readSnapshot()?.sequence, 1);
  assert.deepEqual(store.readEvents().map((item) => item.eventId), ['event-1']);
  store.close();
});

test('reserves cost against the monthly cap including concurrent outstanding reservations', () => {
  const store = new SQLiteWorldStore(new DatabaseSync(':memory:'));
  const first = store.reserveCost({ requestId: 'r1', atIso: '2026-10-01T00:00:00.000Z', maximumUsd: 12 });
  const second = store.reserveCost({ requestId: 'r2', atIso: '2026-10-12T00:00:00.000Z', maximumUsd: 8.01 });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  const result = store.settleCost({ reservationId: first.reservationId as string, actualUsd: 10, record: { inputTokens: 100 } });
  assert.deepEqual(result, { exceededCap: false, remainingUsd: 10 });
  assert.deepEqual(store.readMonthlyCost('2026-10-20T00:00:00.000Z'), {
    periodUtc: '2026-10', settledUsd: 10, reservedUsd: 0, committedUsd: 10, remainingUsd: 10,
    accountingComplete: true, unknownProviderIds: [],
  });
  store.close();
});

test('persists categorized prompt and output cost records in the reservation settlement', () => {
  const database = new DatabaseSync(':memory:');
  const store = new SQLiteWorldStore(database);
  const reservation = store.reserveCost({ requestId: 'categorized-call', atIso: '2026-10-20T00:00:00.000Z', maximumUsd: 0.001 });
  assert.ok(reservation.reservationId);
  const records = [
    { providerId: 'provider/model', category: 'prompt', inputTokens: 20, outputTokens: 0, costUsd: 0.00002 },
    { providerId: 'provider/model', category: 'output', inputTokens: 0, outputTokens: 10, costUsd: 0.00002 },
  ];
  store.settleCost({ reservationId: reservation.reservationId, actualUsd: 0.00004, record: records });
  const row = database.prepare('SELECT record_json FROM cost_reservations WHERE reservation_id = ?').get(reservation.reservationId) as { record_json: string };
  assert.deepEqual(JSON.parse(row.record_json), records);
  store.close();
});

test('migrates existing cost rows and reserves an exact zero-cost provider call without inventing epsilon spend', () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
    INSERT INTO schema_migrations(version, applied_at) VALUES (1, '2026-10-01T00:00:00.000Z');
    CREATE TABLE cost_reservations (
      reservation_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, period_utc TEXT NOT NULL,
      created_at TEXT NOT NULL, reserved_usd REAL NOT NULL CHECK (reserved_usd > 0),
      status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'overrun')),
      actual_usd REAL CHECK (actual_usd IS NULL OR actual_usd >= 0),
      record_json TEXT CHECK (record_json IS NULL OR json_valid(record_json))
    ) STRICT;
    INSERT INTO cost_reservations VALUES ('old-res', 'old-req', '2026-10', '2026-10-01T00:00:00.000Z', 1.25, 'settled', 1.00, '{"kept":true}');
  `);
  const store = new SQLiteWorldStore(database);
  const migrated = store.readMonthlyCost('2026-10-20T00:00:00.000Z');
  assert.equal(migrated.settledUsd, 1);
  const zero = store.reserveCost({ requestId: 'zero-price', atIso: '2026-10-20T00:00:00.000Z', maximumUsd: 0 });
  assert.equal(zero.allowed, true);
  assert.equal(zero.remainingUsd, 19);
  assert.ok(zero.reservationId);
  const settled = store.settleCost({ reservationId: zero.reservationId!, actualUsd: 0, record: { inputTokens: 12, outputTokens: 2, costUsd: 0 } });
  assert.deepEqual(settled, { exceededCap: false, remainingUsd: 19 });
  assert.equal(store.readMonthlyCost('2026-10-20T00:00:00.000Z').settledUsd, 1);
  store.close();
});
