import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { JsonValue, WorldEvent, WorldState } from '../domain/model.ts';
import { INITIAL_SCHEMA_SQL, LIFECYCLE_SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts';
import { migrateWorldSnapshot } from './snapshot-migration.ts';

export interface MonthlyCostStatus {
  readonly periodUtc: string;
  readonly settledUsd: number;
  readonly reservedUsd: number;
  readonly committedUsd: number;
  readonly remainingUsd: number | null;
  readonly accountingComplete: boolean;
  readonly unknownProviderIds: readonly string[];
}

export interface CostReservationRequest {
  readonly requestId: string;
  readonly atIso: string;
  readonly maximumUsd: number;
}

export interface CostReservationResult {
  readonly allowed: boolean;
  readonly reservationId: string | null;
  readonly remainingUsd: number | null;
}

export interface CostSettlementRequest {
  readonly reservationId: string;
  readonly actualUsd: number;
  readonly record: JsonValue;
}

export interface CostSettlementResult {
  readonly exceededCap: boolean;
  readonly remainingUsd: number | null;
}

export type WorldSessionStatus = 'setup' | 'in-progress' | 'ended';
export interface WorldSessionSummary {
  readonly sessionId: string;
  readonly loadedSaveId: string | null;
  readonly loadInstanceId: string | null;
  readonly name: string;
  readonly status: WorldSessionStatus;
  readonly residentCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface WorldSessionSaveSummary {
  readonly saveId: string;
  readonly sessionId: string;
  readonly sessionName: string;
  readonly name: string;
  readonly savedAt: string;
  readonly sequence: number;
}

export interface LatestAiFormatError {
  readonly recordedAt: string;
  readonly actorId: string;
  readonly reason: string;
  readonly rawOutput: string;
}

/** Map content is stored per profile so edits to one map cannot overwrite another. */
export interface MapProfileContent {
  readonly nodes: readonly JsonValue[];
  readonly edges: readonly JsonValue[];
  readonly nodeNotices: readonly JsonValue[];
}

export interface MapProfile extends MapProfileContent {
  readonly mapId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface MapProfileRow {
  readonly map_id: string;
  readonly name: string;
  readonly nodes_json: string;
  readonly edges_json: string;
  readonly node_notices_json: string;
  readonly created_at: string;
  readonly updated_at: string;
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

  recordLatestAiFormatError(error: LatestAiFormatError): void {
    this.#db.prepare(`INSERT INTO latest_ai_format_error(singleton_id, recorded_at, actor_id, reason, raw_output)
      VALUES (1, ?, ?, ?, ?) ON CONFLICT(singleton_id) DO UPDATE SET
      recorded_at=excluded.recorded_at, actor_id=excluded.actor_id, reason=excluded.reason, raw_output=excluded.raw_output
      WHERE excluded.recorded_at >= latest_ai_format_error.recorded_at`)
      .run(error.recordedAt, error.actorId, error.reason, error.rawOutput);
  }

  readLatestAiFormatError(): LatestAiFormatError | null {
    const row = this.#db.prepare('SELECT recorded_at, actor_id, reason, raw_output FROM latest_ai_format_error WHERE singleton_id=1')
      .get() as { recorded_at: string; actor_id: string; reason: string; raw_output: string } | undefined;
    return row ? { recordedAt: row.recorded_at, actorId: row.actor_id, reason: row.reason, rawOutput: row.raw_output } : null;
  }

  /** Seed the stable default profile, upgrading only untouched legacy berry Nodes. */
  ensureDefaultMapProfile(content: MapProfileContent, name = '初始地圖'): MapProfile {
    validateMapProfileContent(content);
    this.#transaction(() => {
      const existing = this.#db.prepare('SELECT nodes_json FROM map_profiles WHERE map_id=?').get('default-map') as { nodes_json: string } | undefined;
      if (existing) {
        const nodes = JSON.parse(existing.nodes_json) as unknown;
        if (!Array.isArray(nodes)) return;
        const canonical = new Map(content.nodes.filter(isJsonRecord).map((node) => [node.node_id, node]));
        let changed = false;
        const migrated = nodes.map((node) => {
          if (!isJsonRecord(node) || !['9', '17', '23'].includes(String(node.node_id))) return node;
          const current = canonical.get(node.node_id);
          if (!current || current.surface_terrain !== 'berry-forest') return node;
          const legacy = { ...current, visual_type: '一般地形', surface_terrain: 'forest', surface_terrain_source: 'user-provided-location-group-mapping' };
          if (!sameJsonRecord(node, legacy)) return node;
          changed = true;
          return { ...node, visual_type: current.visual_type, surface_terrain: current.surface_terrain, surface_terrain_source: current.surface_terrain_source };
        });
        if (changed) this.#db.prepare('UPDATE map_profiles SET nodes_json=?, updated_at=? WHERE map_id=?')
          .run(stringifyJson(migrated), new Date().toISOString(), 'default-map');
        return;
      }
      const now = new Date().toISOString();
      this.#db.prepare(`INSERT INTO map_profiles(map_id, name, nodes_json, edges_json, node_notices_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        'default-map', validateMapProfileName(name), stringifyJson(content.nodes), stringifyJson(content.edges), stringifyJson(content.nodeNotices), now, now,
      );
    });
    return this.readMapProfile('default-map')!;
  }

  listMapProfiles(): readonly MapProfile[] {
    const rows = this.#db.prepare('SELECT map_id, name, nodes_json, edges_json, node_notices_json, created_at, updated_at FROM map_profiles ORDER BY created_at, map_id').all() as unknown as readonly MapProfileRow[];
    return rows.map(toMapProfile);
  }

  readMapProfile(mapId: string): MapProfile | null {
    const row = this.#db.prepare('SELECT map_id, name, nodes_json, edges_json, node_notices_json, created_at, updated_at FROM map_profiles WHERE map_id=?').get(mapId) as MapProfileRow | undefined;
    return row ? toMapProfile(row) : null;
  }

  createMapProfile(name: string, content: MapProfileContent): MapProfile {
    validateMapProfileContent(content);
    const mapId = randomUUID();
    const now = new Date().toISOString();
    this.#db.prepare(`INSERT INTO map_profiles(map_id, name, nodes_json, edges_json, node_notices_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      mapId, validateMapProfileName(name), stringifyJson(content.nodes), stringifyJson(content.edges), stringifyJson(content.nodeNotices), now, now,
    );
    return this.readMapProfile(mapId)!;
  }

  updateMapProfile(mapId: string, name: string, content: MapProfileContent): MapProfile {
    validateMapProfileContent(content);
    const result = this.#db.prepare(`UPDATE map_profiles SET name=?, nodes_json=?, edges_json=?, node_notices_json=?, updated_at=? WHERE map_id=?`)
      .run(validateMapProfileName(name), stringifyJson(content.nodes), stringifyJson(content.edges), stringifyJson(content.nodeNotices), new Date().toISOString(), mapId);
    if (Number(result.changes) !== 1) throw new Error('找不到指定地圖存檔。');
    return this.readMapProfile(mapId)!;
  }

  deleteMapProfile(mapId: string): void {
    if (mapId === 'default-map') throw new Error('預設地圖存檔不可刪除。');
    const result = this.#db.prepare('DELETE FROM map_profiles WHERE map_id=?').run(mapId);
    if (Number(result.changes) !== 1) throw new Error('找不到指定地圖存檔。');
  }

  ensureWorldSession(residentCount: number): WorldSessionSummary {
    const current = this.readCurrentWorldSession();
    if (current) return current;
    const snapshot = this.readSnapshot();
    if (!snapshot) throw new Error('無法建立局別記錄：世界快照不存在。');
    const status: WorldSessionStatus = snapshot.sequence > 0 ? 'in-progress' : 'setup';
    const now = new Date().toISOString();
    const session = { sessionId: randomUUID(), loadedSaveId: null, loadInstanceId: randomUUID(), name: '目前遊戲', status, residentCount: snapshot.residentCount ?? residentCount, createdAt: now, updatedAt: now };
    this.#transaction(() => {
      this.#db.prepare('INSERT INTO world_sessions(session_id, name, status, resident_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(session.sessionId, session.name, session.status, session.residentCount, now, now);
      this.#db.prepare('INSERT INTO active_world_session(singleton_id, session_id, load_instance_id) VALUES (1, ?, ?)').run(session.sessionId, session.loadInstanceId);
    });
    return session;
  }

  readCurrentWorldSession(): WorldSessionSummary | null {
    const row = this.#db.prepare(`SELECT s.session_id, a.source_save_id, a.load_instance_id, s.name, s.status, s.resident_count, s.created_at, s.updated_at
      FROM active_world_session a JOIN world_sessions s ON s.session_id=a.session_id WHERE a.singleton_id=1`).get() as SessionRow | undefined;
    return row ? toSessionSummary(row) : null;
  }

  setSetupResidentCount(residentCount: number): void {
    if (!Number.isSafeInteger(residentCount) || residentCount < 1) throw new RangeError('居民人數必須是正整數。');
    this.#transaction(() => {
      const active = this.#db.prepare(`SELECT s.session_id, s.status FROM active_world_session a JOIN world_sessions s ON s.session_id=a.session_id WHERE a.singleton_id=1`).get() as { session_id: string; status: WorldSessionStatus } | undefined;
      if (!active || active.status !== 'setup') throw new Error('目前遊戲已開始；居民人數只能在新局開始前設定。');
      this.#db.prepare('UPDATE world_sessions SET resident_count=?, updated_at=? WHERE session_id=?').run(residentCount, new Date().toISOString(), active.session_id);
    });
  }

  readSetupModelAssignments(residentCount?: number): Readonly<Record<number, number>> {
    const session = this.readCurrentWorldSession();
    if (!session) return {};
    const assignmentCount = residentCount ?? session.residentCount;
    if (!Number.isSafeInteger(assignmentCount) || assignmentCount < 1) throw new RangeError('居民人數必須是正整數。');
    const rows = this.#db.prepare('SELECT resident_index, template_slot FROM setup_model_assignments WHERE session_id=?').all(session.sessionId) as unknown as readonly { resident_index: number; template_slot: number }[];
    const savedAssignments = new Map(rows.map((row) => [row.resident_index, row.template_slot]));
    return Object.fromEntries(Array.from({ length: assignmentCount }, (_, index) => {
      const residentIndex = index + 1;
      return [residentIndex, savedAssignments.get(residentIndex) ?? (residentIndex <= 10 ? residentIndex : 1)];
    }));
  }

  setSetupModelAssignment(residentIndex: number, templateSlot: number, residentCount?: number): void {
    if (!Number.isSafeInteger(residentIndex) || residentIndex < 1 || !Number.isSafeInteger(templateSlot) || templateSlot < 1) {
      throw new RangeError('居民編號與模型卡槽位必須是正整數。');
    }
    const assignmentCount = residentCount;
    if (assignmentCount !== undefined && (!Number.isSafeInteger(assignmentCount) || assignmentCount < 1)) throw new RangeError('居民人數必須是正整數。');
    this.#transaction(() => {
      const active = this.#db.prepare(`SELECT s.session_id, s.status, s.resident_count FROM active_world_session a JOIN world_sessions s ON s.session_id=a.session_id WHERE a.singleton_id=1`).get() as { session_id: string; status: WorldSessionStatus; resident_count: number } | undefined;
      if (!active || (active.status !== 'setup' && active.status !== 'ended')) throw new Error('目前遊戲進行中，無法安排下一局的模型卡。');
      if (residentIndex > (assignmentCount ?? active.resident_count)) throw new Error('指定居民編號超出準備中的新局人數。');
      this.#db.prepare(`INSERT INTO setup_model_assignments(session_id, resident_index, template_slot) VALUES (?, ?, ?)
        ON CONFLICT(session_id, resident_index) DO UPDATE SET template_slot=excluded.template_slot`).run(active.session_id, residentIndex, templateSlot);
    });
  }

  startNewWorldSession(name: string, residentCount: number, state: WorldState, preparedAssignments?: Readonly<Record<number, number>>): WorldSessionSummary {
    if (!name.trim() || name.trim().length > 80) throw new Error('存檔名稱須為 1–80 個字元。');
    if (!Number.isSafeInteger(residentCount) || residentCount < 1) throw new RangeError('居民人數必須是正整數。');
    if (state.residentCount !== residentCount || state.sequence !== 0) throw new Error('新局初始快照的人數或序號不符。');
    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const templateAssignments = preparedAssignments ?? this.readSetupModelAssignments(residentCount);
    this.#transaction(() => {
      const active = this.#db.prepare(`SELECT s.status FROM active_world_session a JOIN world_sessions s ON s.session_id=a.session_id WHERE a.singleton_id=1`).get() as { status: WorldSessionStatus } | undefined;
      if (active?.status === 'in-progress') throw new Error('請先結束目前遊戲，再開始新局。');
      if (active?.status === 'setup') this.#db.prepare(`UPDATE world_sessions SET status='ended', updated_at=? WHERE session_id=(SELECT session_id FROM active_world_session WHERE singleton_id=1)`).run(now);
      this.#db.prepare(`INSERT INTO world_sessions(session_id, name, status, resident_count, created_at, updated_at)
        VALUES (?, ?, 'in-progress', ?, ?, ?)`).run(sessionId, name.trim(), residentCount, now, now);
      this.#db.prepare('INSERT INTO active_world_session(singleton_id, session_id, source_save_id, load_instance_id) VALUES (1, ?, NULL, ?) ON CONFLICT(singleton_id) DO UPDATE SET session_id=excluded.session_id, source_save_id=NULL, load_instance_id=excluded.load_instance_id').run(sessionId, randomUUID());
      const insertAssignment = this.#db.prepare('INSERT INTO setup_model_assignments(session_id, resident_index, template_slot) VALUES (?, ?, ?)');
      for (let residentIndex = 1; residentIndex <= residentCount; residentIndex += 1) insertAssignment.run(sessionId, residentIndex, templateAssignments[residentIndex] ?? (residentIndex <= 10 ? residentIndex : 1));
      this.#db.prepare('DELETE FROM world_events').run();
      this.#writeSnapshot(state);
    });
    return this.readCurrentWorldSession()!;
  }

  markCurrentWorldSessionStarted(): void {
    this.#setActiveSessionStatus('in-progress');
  }

  endCurrentWorldSession(): void {
    const now = new Date().toISOString();
    this.#transaction(() => {
      this.#db.prepare(`UPDATE world_sessions SET status='ended', updated_at=? WHERE session_id=(SELECT session_id FROM active_world_session WHERE singleton_id=1)`).run(now);
    });
  }

  saveCurrentWorldSession(name: string): WorldSessionSaveSummary {
    if (!name.trim() || name.trim().length > 80) throw new Error('存檔名稱須為 1–80 個字元。');
    const row = this.#transaction(() => this.#saveCurrentSession(name.trim(), new Date().toISOString()));
    return row;
  }

  listWorldSessionSaves(): readonly WorldSessionSaveSummary[] {
    const rows = this.#db.prepare(`SELECT v.save_id, v.session_id, s.name AS session_name, v.name, v.saved_at, json_extract(v.snapshot_json, '$.sequence') AS sequence
      FROM world_session_saves v JOIN world_sessions s ON s.session_id=v.session_id ORDER BY v.saved_at DESC`).all() as unknown as SaveRow[];
    return rows.map(toSaveSummary);
  }

  deleteWorldSessionSave(saveId: string): void {
    if (!saveId.trim()) throw new Error('請指定要刪除的存檔。');
    this.#transaction(() => {
      const active = this.#db.prepare('SELECT source_save_id FROM active_world_session WHERE singleton_id=1').get() as { source_save_id: string | null } | undefined;
      if (active?.source_save_id === saveId) throw new Error('這筆存檔是目前當局的載入來源，請先切換或結束並開始新局後再刪除。');
      const result = this.#db.prepare('DELETE FROM world_session_saves WHERE save_id=?').run(saveId);
      if (result.changes !== 1) throw new Error('找不到指定存檔；清單可能已更新。');
    });
  }

  loadWorldSessionSave(saveId: string): void {
    this.#transaction(() => {
      const target = this.#db.prepare(`SELECT v.save_id, v.session_id, v.snapshot_json, v.events_json, s.status, s.resident_count
        FROM world_session_saves v JOIN world_sessions s ON s.session_id=v.session_id WHERE v.save_id=?`).get(saveId) as LoadSaveRow | undefined;
      if (!target) throw new Error('找不到指定存檔。');
      const automaticSave = this.#saveCurrentSession('切換前自動保存', new Date().toISOString());
      const state = migrateWorldSnapshot(JSON.parse(target.snapshot_json) as WorldState);
      const events = JSON.parse(target.events_json) as WorldEvent[];
      if (!Array.isArray(events) || events.some((event, index) => event.sequence !== index + 1) || state.sequence !== events.length) {
        throw new Error('存檔的快照與事件序列不一致，未載入。');
      }
      this.#db.prepare('DELETE FROM world_events').run();
      const insertEvent = this.#db.prepare(`INSERT INTO world_events(sequence, event_id, schema_version, world_time_t, actor_id, node_id, event_kind, visibility, payload_json, random_draws_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const event of events) insertEvent.run(event.sequence, event.eventId, SCHEMA_VERSION, event.worldTimeT, event.actorId, event.nodeId, event.kind, event.visibility, stringifyJson(event.payload), stringifyJson(event.randomDraws));
      this.#writeSnapshot(state);
      const now = new Date().toISOString();
      this.#db.prepare('INSERT INTO active_world_session(singleton_id, session_id, source_save_id, load_instance_id) VALUES (1, ?, ?, ?) ON CONFLICT(singleton_id) DO UPDATE SET session_id=excluded.session_id, source_save_id=excluded.source_save_id, load_instance_id=excluded.load_instance_id').run(target.session_id, target.save_id, randomUUID());
      this.#db.prepare("UPDATE world_sessions SET status='in-progress', resident_count=?, updated_at=? WHERE session_id=?").run(state.residentCount ?? target.resident_count, now, target.session_id);
      this.#pruneAutomaticSaves(automaticSave.sessionId);
    });
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
    assertMoney(request.maximumUsd, 'Maximum cost', true);
    const date = new Date(request.atIso);
    if (!Number.isFinite(date.getTime())) throw new Error('Reservation timestamp must be a valid ISO date.');
    const period = date.toISOString().slice(0, 7);
    const reservationId = randomUUID();

    return this.#transaction(() => {
      this.#db.prepare(`
        INSERT INTO cost_reservations(reservation_id, request_id, period_utc, created_at, reserved_usd, status)
        VALUES (?, ?, ?, ?, ?, 'reserved')
      `).run(reservationId, request.requestId, period, date.toISOString(), request.maximumUsd);
      return { allowed: true, reservationId, remainingUsd: null };
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
      this.#db.prepare(`
        UPDATE cost_reservations SET actual_usd = ?, status = ?, record_json = ? WHERE reservation_id = ?
      `).run(request.actualUsd, 'settled', recordJson, request.reservationId);
      return { exceededCap: false, remainingUsd: null };
    });
  }

  recordUnpricedCost(input: {
    readonly requestId: string;
    readonly providerId: string;
    readonly category: string;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly recordedAt: string;
    readonly reservationId?: string;
  }): void {
    const date = new Date(input.recordedAt);
    if (!Number.isFinite(date.getTime())) throw new Error('Unpriced call timestamp must be a valid ISO date.');
    for (const [name, value] of [['input tokens', input.inputTokens], ['output tokens', input.outputTokens]] as const) {
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new RangeError(`${name} must be a non-negative integer or unknown.`);
    }
    if (!input.requestId || !input.providerId) throw new Error('Unpriced call identity is required.');
    const recordedAt = date.toISOString();
    const period = recordedAt.slice(0, 7);
    this.#transaction(() => {
      if (input.reservationId) {
        const reservation = this.#db.prepare('SELECT status FROM cost_reservations WHERE reservation_id=?').get(input.reservationId) as { status: string } | undefined;
        if (!reservation || reservation.status !== 'reserved') throw new Error('Cost reservation is missing or already settled.');
        this.#db.prepare('DELETE FROM cost_reservations WHERE reservation_id=?').run(input.reservationId);
      }
      this.#db.prepare(`INSERT INTO unpriced_provider_calls
        (request_id, period_utc, recorded_at, provider_id, category, input_tokens, output_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(input.requestId, period, recordedAt, input.providerId, input.category, input.inputTokens, input.outputTokens);
    });
  }

  recordActualCost(input: {
    readonly requestId: string;
    readonly providerId: string;
    readonly category: string;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly costUsd: number;
    readonly recordedAt: string;
  }): { readonly exceededCap: boolean } {
    assertMoney(input.costUsd, 'Actual cost', true);
    for (const [name, value] of [['input tokens', input.inputTokens], ['output tokens', input.outputTokens]] as const) {
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new RangeError(`${name} must be a non-negative integer or unknown.`);
    }
    const date = new Date(input.recordedAt);
    if (!Number.isFinite(date.getTime())) throw new Error('Cost timestamp must be a valid ISO date.');
    const recordedAt = date.toISOString();
    const record: JsonValue = {
      providerId: input.providerId, category: input.category,
      inputTokens: input.inputTokens, outputTokens: input.outputTokens,
      costUsd: input.costUsd, recordedAt,
    } as unknown as JsonValue;
    return this.#transaction(() => {
      const reservationId = randomUUID();
      this.#db.prepare(`INSERT INTO cost_reservations
        (reservation_id, request_id, period_utc, created_at, reserved_usd, status, actual_usd, record_json)
        VALUES (?, ?, ?, ?, ?, 'settled', ?, ?)`)
        .run(reservationId, input.requestId, recordedAt.slice(0, 7), recordedAt, input.costUsd, input.costUsd, stringifyJson(record));
      return { exceededCap: false };
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
    const unknownRows = this.#db.prepare('SELECT DISTINCT provider_id FROM unpriced_provider_calls WHERE period_utc=? ORDER BY provider_id').all(periodUtc) as unknown as readonly { provider_id: string }[];
    const unknownProviderIds = unknownRows.map(({ provider_id }) => provider_id);
    const accountingComplete = unknownProviderIds.length === 0;
    return { periodUtc, settledUsd, reservedUsd, committedUsd, remainingUsd: null, accountingComplete, unknownProviderIds };
  }

  close(): void {
    this.#db.close();
  }

  #initializeSchema(): void {
    const exists = this.#db.prepare(`SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='schema_migrations'`).get();
    if (exists === undefined) {
      this.#db.exec(INITIAL_SCHEMA_SQL);
      this.#initializeSchema();
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
      this.#initializeSchema();
      return;
    }
    if (row.version === 2) {
      this.#db.exec(LIFECYCLE_SCHEMA_SQL);
      this.#initializeSchema();
      return;
    }
    if (row.version === 3) {
      this.#db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE unpriced_provider_calls (
          request_id TEXT PRIMARY KEY,
          period_utc TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          category TEXT NOT NULL,
          input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
          output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0)
        ) STRICT;
        CREATE INDEX unpriced_provider_calls_by_period ON unpriced_provider_calls(period_utc, provider_id);
        INSERT INTO schema_migrations(version, applied_at) VALUES (4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        COMMIT;
      `);
      this.#initializeSchema();
      return;
    }
    if (row.version === 4) {
      this.#db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE latest_ai_format_error (
          singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
          recorded_at TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          raw_output TEXT NOT NULL
        ) STRICT;
        INSERT INTO schema_migrations(version, applied_at) VALUES (5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        COMMIT;
      `);
      this.#initializeSchema();
      return;
    }
    if (row.version === 5) {
      this.#db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE active_world_session ADD COLUMN source_save_id TEXT REFERENCES world_session_saves(save_id);
        INSERT INTO schema_migrations(version, applied_at) VALUES (6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        COMMIT;
      `);
      this.#initializeSchema();
      return;
    }
    if (row.version === 6) {
      this.#db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE active_world_session ADD COLUMN load_instance_id TEXT;
        UPDATE active_world_session SET load_instance_id=lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random()) % 4 + 1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))) WHERE load_instance_id IS NULL;
        INSERT INTO schema_migrations(version, applied_at) VALUES (7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        COMMIT;
      `);
      this.#initializeSchema();
      return;
    }
    if (row.version === 7) {
      this.#db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE map_profiles (
          map_id TEXT PRIMARY KEY,
          name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
          nodes_json TEXT NOT NULL CHECK (json_valid(nodes_json) AND json_type(nodes_json) = 'array'),
          edges_json TEXT NOT NULL CHECK (json_valid(edges_json) AND json_type(edges_json) = 'array'),
          node_notices_json TEXT NOT NULL CHECK (json_valid(node_notices_json) AND json_type(node_notices_json) = 'array'),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX map_profiles_by_updated ON map_profiles(updated_at DESC);
        INSERT INTO schema_migrations(version, applied_at) VALUES (8, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        COMMIT;
      `);
      this.#initializeSchema();
      return;
    }
    if (row.version === 8) {
      // Foreign keys reference world_sessions; rebuild both constrained tables while
      // preserving their primary keys and all rows, then verify every reference.
      this.#db.exec('PRAGMA foreign_keys = OFF;');
      let transactionStarted = false;
      try {
        this.#db.exec('BEGIN IMMEDIATE;');
        transactionStarted = true;
        this.#db.exec(`
          CREATE TABLE world_sessions_new (
            session_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('setup', 'in-progress', 'ended')),
            resident_count INTEGER NOT NULL CHECK (resident_count >= 1),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;
          INSERT INTO world_sessions_new SELECT session_id,name,status,resident_count,created_at,updated_at FROM world_sessions;
          DROP TABLE world_sessions;
          ALTER TABLE world_sessions_new RENAME TO world_sessions;
          CREATE TABLE setup_model_assignments_new (
            session_id TEXT NOT NULL REFERENCES world_sessions(session_id) ON DELETE CASCADE,
            resident_index INTEGER NOT NULL CHECK (resident_index >= 1),
            template_slot INTEGER NOT NULL CHECK (template_slot >= 1),
            PRIMARY KEY (session_id, resident_index)
          ) STRICT;
          INSERT INTO setup_model_assignments_new SELECT session_id,resident_index,template_slot FROM setup_model_assignments;
          DROP TABLE setup_model_assignments;
          ALTER TABLE setup_model_assignments_new RENAME TO setup_model_assignments;
        `);
        const foreignKeyErrors = this.#db.prepare('PRAGMA foreign_key_check').all();
        if (foreignKeyErrors.length > 0) throw new Error('世界存檔遷移的外鍵檢查失敗；未變更原始資料。');
        this.#db.exec("INSERT INTO schema_migrations(version, applied_at) VALUES (9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')); COMMIT;");
        transactionStarted = false;
      } catch (error) {
        if (transactionStarted) this.#db.exec('ROLLBACK;');
        throw error;
      } finally {
        this.#db.exec('PRAGMA foreign_keys = ON;');
      }
      this.#initializeSchema();
      return;
    }
    if (row.version !== SCHEMA_VERSION) throw new Error(`Unsupported database schema version ${String(row.version)}.`);
    this.#db.prepare("UPDATE active_world_session SET load_instance_id=lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random()) % 4 + 1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))) WHERE singleton_id=1 AND load_instance_id IS NULL").run();
  }

  #setActiveSessionStatus(status: WorldSessionStatus): void {
    this.#transaction(() => {
      this.#db.prepare('UPDATE world_sessions SET status=?, updated_at=? WHERE session_id=(SELECT session_id FROM active_world_session WHERE singleton_id=1)')
        .run(status, new Date().toISOString());
    });
  }

  #saveCurrentSession(name: string, savedAt: string): WorldSessionSaveSummary {
    const session = this.readCurrentWorldSession();
    const snapshot = this.readSnapshot();
    if (!session || !snapshot) throw new Error('目前沒有可保存的遊戲。');
    const events: WorldEvent[] = [];
    let cursor = 0;
    for (;;) {
      const batch = this.readEvents(cursor, 5000);
      events.push(...batch);
      const last = batch.at(-1);
      if (!last || batch.length < 5000) break;
      cursor = last.sequence;
    }
    if (events.length !== snapshot.sequence) throw new Error('目前快照與事件數量不一致，拒絕建立不完整存檔。');
    const saveId = randomUUID();
    this.#db.prepare('INSERT INTO world_session_saves(save_id, session_id, name, saved_at, snapshot_json, events_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(saveId, session.sessionId, name, savedAt, stringifyJson(snapshot), stringifyJson(events));
    return { saveId, sessionId: session.sessionId, sessionName: session.name, name, savedAt, sequence: snapshot.sequence };
  }

  #pruneAutomaticSaves(sessionId: string): void {
    this.#db.prepare(`DELETE FROM world_session_saves
      WHERE session_id=? AND name IN ('結束時自動封存', '切換前自動保存')
        AND save_id NOT IN (
          SELECT save_id FROM world_session_saves
          WHERE session_id=? AND name IN ('結束時自動封存', '切換前自動保存')
          ORDER BY saved_at DESC, save_id DESC LIMIT 1
        )
        AND save_id NOT IN (SELECT source_save_id FROM active_world_session WHERE source_save_id IS NOT NULL)`)
      .run(sessionId, sessionId);
  }

  #writeSnapshot(state: WorldState): void {
    const snapshotJson = stringifyJson(state);
    this.#db.prepare(`INSERT INTO world_snapshots(world_id, sequence, schema_version, content_version, snapshot_json)
      VALUES ('world', ?, ?, ?, ?) ON CONFLICT(world_id) DO UPDATE SET sequence=excluded.sequence,
      schema_version=excluded.schema_version, content_version=excluded.content_version, snapshot_json=excluded.snapshot_json`)
      .run(state.sequence, state.schemaVersion, state.contentVersion, snapshotJson);
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

interface SessionRow {
  readonly session_id: string;
  readonly source_save_id: string | null;
  readonly load_instance_id: string | null;
  readonly name: string;
  readonly status: WorldSessionStatus;
  readonly resident_count: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface SaveRow {
  readonly save_id: string;
  readonly session_id: string;
  readonly session_name: string;
  readonly name: string;
  readonly saved_at: string;
  readonly sequence: number;
}

interface LoadSaveRow {
  readonly save_id: string;
  readonly session_id: string;
  readonly snapshot_json: string;
  readonly events_json: string;
  readonly status: WorldSessionStatus;
  readonly resident_count: number;
}

function toSessionSummary(row: SessionRow): WorldSessionSummary {
  return { sessionId: row.session_id, loadedSaveId: row.source_save_id, loadInstanceId: row.load_instance_id, name: row.name, status: row.status, residentCount: row.resident_count, createdAt: row.created_at, updatedAt: row.updated_at };
}

function toSaveSummary(row: SaveRow): WorldSessionSaveSummary {
  return { saveId: row.save_id, sessionId: row.session_id, sessionName: row.session_name, name: row.name, savedAt: row.saved_at, sequence: row.sequence };
}

function toMapProfile(row: MapProfileRow): MapProfile {
  return {
    mapId: row.map_id,
    name: row.name,
    nodes: JSON.parse(row.nodes_json) as JsonValue[],
    edges: JSON.parse(row.edges_json) as JsonValue[],
    nodeNotices: JSON.parse(row.node_notices_json) as JsonValue[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateMapProfileContent(content: MapProfileContent): void {
  for (const [label, value] of [['nodes', content.nodes], ['edges', content.edges], ['node notices', content.nodeNotices]] as const) {
    if (!Array.isArray(value)) throw new TypeError(`Map profile ${label} must be an array.`);
    stringifyJson(value);
  }
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJsonRecord(left: Record<string, JsonValue>, right: Record<string, JsonValue>): boolean {
  const keys = Object.keys(right);
  return Object.keys(left).length === keys.length && keys.every((key) => left[key] === right[key]);
}

function validateMapProfileName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 80) throw new Error('地圖名稱須為 1–80 個字元。');
  return normalized;
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
