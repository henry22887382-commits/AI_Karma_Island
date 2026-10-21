import assert from 'node:assert/strict';
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
  });
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
