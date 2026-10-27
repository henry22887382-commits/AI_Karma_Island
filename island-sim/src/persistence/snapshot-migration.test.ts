import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { WorldState } from '../domain/model.ts';
import { SQLiteWorldStore } from './sqlite-store.ts';
import { migrateWorldSnapshot } from './snapshot-migration.ts';

test('upgrades legacy resident identity fields without mutating the source snapshot', () => {
  const legacy = {
    schemaVersion: 1,
    sequence: 7,
    contentVersion: 'old-content',
    worldTimeT: 144,
    seed: 'legacy',
    rngState: '00000001',
    actors: {
      'resident-01': { id: 'resident-01', actorType: 'resident', alive: true, nodeId: '1', nextActionAtT: 145, speed: 3, unsafeEntryAtT: 0, sleeping: false },
      'resident-2.4': { id: 'resident-2.4', actorType: 'resident', alive: false, nodeId: '8', nextActionAtT: 0, speed: 3, unsafeEntryAtT: 0, sleeping: false },
    },
    nodes: {},
    objects: {},
  } as unknown as WorldState;
  const before = JSON.stringify(legacy);

  const migrated = migrateWorldSnapshot(legacy);

  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.actors['resident-01']?.slotId, '0');
  assert.equal(migrated.actors['resident-01']?.modelSlotId, 1);
  assert.equal(migrated.actors['resident-01']?.generation, 1);
  assert.equal(migrated.actors['resident-01']?.modelAssignment, null);
  assert.equal(migrated.actors['resident-2.4']?.slotId, '2');
  assert.equal(migrated.actors['resident-2.4']?.generation, 4);
  assert.equal(migrated.actors['resident-2.4']?.diedAtT, null);
  assert.equal(JSON.stringify(legacy), before);
});

test('adds the default map ID to legacy snapshots and preserves an existing map ID', () => {
  const legacy = {
    schemaVersion: 1,
    sequence: 0,
    contentVersion: 'legacy-content',
    worldTimeT: 0,
    seed: 'legacy-seed',
    rngState: '00000001',
    actors: {},
    nodes: {},
    objects: {},
  } as unknown as WorldState;
  const upgraded = migrateWorldSnapshot(legacy);
  assert.equal(upgraded.mapId, 'default-map');

  const existing = { ...legacy, schemaVersion: 2 as const, mapId: 'custom-map' } as WorldState;
  assert.equal(migrateWorldSnapshot(existing).mapId, 'custom-map');
});

test('SQLite v1 snapshot stays byte-for-byte unchanged on read and upgrades on its next commit', () => {
  const legacy = {
    schemaVersion: 1,
    sequence: 0,
    contentVersion: 'legacy-content',
    worldTimeT: 0,
    seed: 'legacy-seed',
    rngState: '00000001',
    actors: {
      'resident-01': { id: 'resident-01', actorType: 'resident', alive: true, nodeId: '1', nextActionAtT: 0, speed: 3, unsafeEntryAtT: 0, sleeping: false },
    },
    nodes: { '1': { id: '1', regionDescription: '舊世界快照中的區域描述' } },
    objects: {},
  } as unknown as WorldState;
  const database = new DatabaseSync(':memory:');
  const store = new SQLiteWorldStore(database);
  store.commit(0, legacy, []);
  const rawBefore = database.prepare("SELECT snapshot_json FROM world_snapshots WHERE world_id='world'").get() as { snapshot_json: string };

  const upgraded = store.readSnapshot();

  assert.equal(upgraded?.schemaVersion, 2);
  assert.equal(upgraded?.actors['resident-01']?.slotId, '0');
  assert.equal(upgraded?.nodes['1']?.id, '1');
  const rawAfterRead = database.prepare("SELECT snapshot_json FROM world_snapshots WHERE world_id='world'").get() as { snapshot_json: string };
  assert.equal(rawAfterRead.snapshot_json, rawBefore.snapshot_json);
  store.commit(0, upgraded!, []);
  const rawAfterCommit = database.prepare("SELECT snapshot_json FROM world_snapshots WHERE world_id='world'").get() as { snapshot_json: string };
  assert.equal(JSON.parse(rawAfterCommit.snapshot_json).schemaVersion, 2);
  assert.equal(JSON.parse(rawAfterCommit.snapshot_json).actors['resident-01'].slotId, '0');
  store.close();
});

test('strips legacy region-description keys from returned v2 snapshots without rewriting stored JSON', () => {
  const database = new DatabaseSync(':memory:');
  const store = new SQLiteWorldStore(database);
  const legacySnapshot = {
    schemaVersion: 2,
    sequence: 0,
    contentVersion: 'current-content',
    worldTimeT: 0,
    seed: 'legacy-seed',
    rngState: '00000001',
    actors: {},
    nodes: {
      '1': { id: '1', regionDescription: '舊 camel 欄位', region_description: '舊 Snake 欄位' },
    },
    objects: {},
  } as unknown as WorldState;
  store.commit(0, legacySnapshot, []);
  const rawBefore = database.prepare("SELECT snapshot_json FROM world_snapshots WHERE world_id='world'").get() as { snapshot_json: string };

  const loaded = store.readSnapshot();

  assert.ok(loaded);
  assert.equal(Object.hasOwn(loaded.nodes['1']!, 'regionDescription'), false);
  assert.equal(Object.hasOwn(loaded.nodes['1']!, 'region_description'), false);
  const rawAfter = database.prepare("SELECT snapshot_json FROM world_snapshots WHERE world_id='world'").get() as { snapshot_json: string };
  assert.equal(rawAfter.snapshot_json, rawBefore.snapshot_json);
  store.close();
});
