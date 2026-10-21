import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { JsonValue, WorldEvent, WorldState } from '../domain/model.ts';
import { INITIAL_SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts';
import { migrateWorldSnapshot } from './snapshot-migration.ts';

export interface MonthlyCostStatus {
  readonly periodUtc: string;
  readonly settledUsd: number;
  readonly reservedUsd: number;
  readonly committedUsd: number;
  readonly remainingUsd: number;
}

export interface CostReservationRequest {
  readonly requestId: string;
  readonly atIso: string;
  readonly maximumUsd: number;
}

export interface CostReservationResult {
  readonly allowed: boolean;
  readonly reservationId: string | null;
  readonly remainingUsd: number;
}

export interface CostSettlementRequest {
  readonly reservationId: string;
  readonly actualUsd: number;
  readonly record: JsonValue;
}

export interface CostSettlementResult {
  readonly exceededCap: boolean;
  readonly remainingUsd: number;
}

export class SQLiteWorldStore {
  readonly #db: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#db = database;
    this.#db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.#initializeSchema();
  }

  static open(path: string): SQLiteWorldStore {
    return new SQLiteWorldStore(new DatabaseSync(path));
  }

  readSnapshot(): WorldState | null {
    const row = this.#db.prepare('SELECT snapshot_json FROM world_snapshots WHERE world_id = ?').get('world') as { snapshot_json: string } | undefined;
    return row === undefined ? null : migrateWorldSnapshot(JSON.parse(row.snapshot_json) as WorldState);
  }

  readEvents(afterSequence = 0, limit = 500): readonly WorldEvent[] {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new RangeError('Event cursor must be a non-negative safe integer.');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new RangeError('Event page size must be from 1 to 5000.');
    const rows = this.#db.prepare(`
      SELECT sequence, event_id, world_time_t, actor_id, node_id, event_kind, visibility, payload_json, random_draws_json
      FROM world_events WHERE sequence > ? ORDER BY sequence LIMIT ?
    `).all(afterSequence, limit) as unknown as readonly EventRow[];
    return rows.map((row) => ({
      eventId: row.event_id,
      sequence: row.sequence,
      worldTimeT: row.world_time_t,
      actorId: row.actor_id,
      nodeId: row.node_id,
      kind: row.event_kind,
      visibility: row.visibility,
      payload: JSON.parse(row.payload_json) as JsonValue,
      randomDraws: JSON.parse(row.random_draws_json) as WorldEvent['randomDraws'],
    }));
  }

  commit(expectedSequence: number, state: WorldState, events: readonly WorldEvent[]): void {
    if (!Number.isSafeInteger(expectedSequence) || expectedSequence < 0) throw new RangeError('Expected sequence must be a non-negative safe integer.');
    const snapshotJson = stringifyJson(state);
    const finalSequence = expectedSequence + events.length;
    if (state.sequence !== finalSequence) throw new Error(`Snapshot sequence ${state.sequence} does not match expected final sequence ${finalSequence}.`);
    events.forEach((event, index) => {
      if (event.sequence !== expectedSequence + index + 1) throw new Error('Events must use consecutive sequences after the expected sequence.');
      stringifyJson(event.payload);
      stringifyJson(event.randomDraws);
    });

    this.#transaction(() => {
      const current = this.#db.prepare('SELECT sequence FROM world_snapshots WHERE world_id = ?').get('world') as { sequence: number } | undefined;
      const currentSequence = current?.sequence ?? 0;
      if (currentSequence !== expectedSequence) throw new Error(`Sequence conflict: expected ${expectedSequence}, current ${currentSequence}.`);

      const insertEvent = this.#db.prepare(`
        INSERT INTO world_events(sequence, event_id, schema_version, world_time_t, actor_id, node_id, event_kind, visibility, payload_json, random_draws_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const event of events) {
        insertEvent.run(
          event.sequence, event.eventId, SCHEMA_VERSION, event.worldTimeT, event.actorId, event.nodeId,
          event.kind, event.visibility, stringifyJson(event.payload), stringifyJson(event.randomDraws),
        );
      }
      this.#db.prepare(`
        INSERT INTO world_snapshots(world_id, sequence, schema_version, content_version, snapshot_json)
        VALUES ('world', ?, ?, ?, ?)
        ON CONFLICT(world_id) DO UPDATE SET sequence=excluded.sequence, schema_version=excluded.schema_version,
          content_version=excluded.content_version, snapshot_json=excluded.snapshot_json
      `).run(finalSequence, state.schemaVersion, state.contentVersion, snapshotJson);
    });
  }

  reserveCost(request: CostReservationRequest): CostReservationResult {
    const cap = 20;
    assertMoney(request.maximumUsd, 'Maximum cost', true);
    assertMoney(cap, 'Monthly cap');
    const date = new Date(request.atIso);
    if (!Number.isFinite(date.getTime())) throw new Error('Reservation timestamp must be a valid ISO date.');
    const period = date.toISOString().slice(0, 7);
    const reservationId = randomUUID();

    return this.#transaction(() => {
      const row = this.#db.prepare(`
        SELECT COALESCE(SUM(CASE WHEN status = 'reserved' THEN reserved_usd ELSE actual_usd END), 0) AS committed
        FROM cost_reservations WHERE period_utc = ?
      `).get(period) as { committed: number };
      const committed = Number(row.committed);
      const remaining = Math.max(0, cap - committed);
      if (committed + request.maximumUsd > cap + Number.EPSILON) {
        return { allowed: false, reservationId: null, remainingUsd: remaining };
      }
      this.#db.prepare(`
        INSERT INTO cost_reservations(reservation_id, request_id, period_utc, created_at, reserved_usd, status)
        VALUES (?, ?, ?, ?, ?, 'reserved')
      `).run(reservationId, request.requestId, period, date.toISOString(), request.maximumUsd);
      return { allowed: true, reservationId, remainingUsd: Math.max(0, remaining - request.maximumUsd) };
    });
  }

  settleCost(request: CostSettlementRequest): CostSettlementResult {
    assertMoney(request.actualUsd, 'Actual cost', true);
    const recordJson = stringifyJson(request.record);
    return this.#transaction(() => {
      const row = this.#db.prepare(`
        SELECT period_utc, reserved_usd, status FROM cost_reservations WHERE reservation_id = ?
      `).get(request.reservationId) as { period_utc: string; reserved_usd: number; status: string } | undefined;
      if (row === undefined || row.status !== 'reserved') throw new Error('Cost reservation is missing or already settled.');
      const cap = 20;
      const overrun = request.actualUsd > Number(row.reserved_usd) + Number.EPSILON;
      this.#db.prepare(`
        UPDATE cost_reservations SET actual_usd = ?, status = ?, record_json = ? WHERE reservation_id = ?
      `).run(request.actualUsd, overrun ? 'overrun' : 'settled', recordJson, request.reservationId);
      const total = this.#db.prepare(`
        SELECT COALESCE(SUM(CASE WHEN status = 'reserved' THEN reserved_usd ELSE actual_usd END), 0) AS committed
        FROM cost_reservations WHERE period_utc = ?
      `).get(row.period_utc) as { committed: number };
      const committed = Number(total.committed);
      return { exceededCap: committed > cap + Number.EPSILON, remainingUsd: Math.max(0, cap - committed) };
    });
  }

  readMonthlyCost(atIso: string): MonthlyCostStatus {
    const date = new Date(atIso);
    if (!Number.isFinite(date.getTime())) throw new Error('Cost status timestamp must be a valid ISO date.');
    const periodUtc = date.toISOString().slice(0, 7);
    const row = this.#db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status <> 'reserved' THEN actual_usd ELSE 0 END), 0) AS settled_usd,
        COALESCE(SUM(CASE WHEN status = 'reserved' THEN reserved_usd ELSE 0 END), 0) AS reserved_usd
      FROM cost_reservations WHERE period_utc = ?
    `).get(periodUtc) as { settled_usd: number; reserved_usd: number };
    const settledUsd = Number(row.settled_usd);
    const reservedUsd = Number(row.reserved_usd);
    const committedUsd = settledUsd + reservedUsd;
    return { periodUtc, settledUsd, reservedUsd, committedUsd, remainingUsd: Math.max(0, 20 - committedUsd) };
  }

  close(): void {
    this.#db.close();
  }

  #initializeSchema(): void {
    const exists = this.#db.prepare(`SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='schema_migrations'`).get();
    if (exists === undefined) {
      this.#db.exec(INITIAL_SCHEMA_SQL);
      return;
    }
    const row = this.#db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
    if (row.version === 1) {
      this.#db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE cost_reservations RENAME TO cost_reservations_v1;
        CREATE TABLE cost_reservations (
          reservation_id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL UNIQUE,
          period_utc TEXT NOT NULL,
          created_at TEXT NOT NULL,
          reserved_usd REAL NOT NULL CHECK (reserved_usd >= 0),
          status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'overrun')),
          actual_usd REAL CHECK (actual_usd IS NULL OR actual_usd >= 0),
          record_json TEXT CHECK (record_json IS NULL OR json_valid(record_json))
        ) STRICT;
        INSERT INTO cost_reservations SELECT * FROM cost_reservations_v1;
        DROP TABLE cost_reservations_v1;
        INSERT INTO schema_migrations(version, applied_at) VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        COMMIT;
      `);
      return;
    }
    if (row.version !== SCHEMA_VERSION) throw new Error(`Unsupported database schema version ${String(row.version)}.`);
  }

  #transaction<T>(operation: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }
}

interface EventRow {
  readonly sequence: number;
  readonly event_id: string;
  readonly world_time_t: number;
  readonly actor_id: string | null;
  readonly node_id: string | null;
  readonly event_kind: string;
  readonly visibility: WorldEvent['visibility'];
  readonly payload_json: string;
  readonly random_draws_json: string;
}

function stringifyJson(value: unknown): string {
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('Value is not JSON serializable.');
  return result;
}

function assertMoney(amount: number, label: string, allowZero = false): void {
  const minimum = allowZero ? 0 : Number.MIN_VALUE;
  if (!Number.isFinite(amount) || amount < minimum) throw new RangeError(`${label} must be a finite ${allowZero ? 'non-negative' : 'positive'} amount.`);
}
