export const SCHEMA_VERSION = 8;

export const INITIAL_SCHEMA_SQL = `
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE world_snapshots (
  world_id TEXT PRIMARY KEY CHECK (world_id = 'world'),
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  schema_version INTEGER NOT NULL,
  content_version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
) STRICT;

CREATE TABLE world_events (
  sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
  event_id TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL,
  world_time_t INTEGER NOT NULL CHECK (world_time_t >= 0),
  actor_id TEXT,
  node_id TEXT,
  event_kind TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private', 'player-only')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  random_draws_json TEXT NOT NULL CHECK (json_valid(random_draws_json))
) STRICT;

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

INSERT INTO schema_migrations(version, applied_at) VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`;

export const LIFECYCLE_SCHEMA_SQL = `
CREATE TABLE world_sessions (
  session_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('setup', 'in-progress', 'ended')),
  resident_count INTEGER NOT NULL CHECK (resident_count BETWEEN 1 AND 10),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE active_world_session (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  session_id TEXT NOT NULL REFERENCES world_sessions(session_id)
) STRICT;

CREATE TABLE world_session_saves (
  save_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES world_sessions(session_id),
  name TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  events_json TEXT NOT NULL CHECK (json_valid(events_json))
) STRICT;

CREATE TABLE setup_model_assignments (
  session_id TEXT NOT NULL REFERENCES world_sessions(session_id) ON DELETE CASCADE,
  resident_index INTEGER NOT NULL CHECK (resident_index BETWEEN 1 AND 10),
  template_slot INTEGER NOT NULL CHECK (template_slot BETWEEN 1 AND 10),
  PRIMARY KEY (session_id, resident_index)
) STRICT;

CREATE INDEX world_session_saves_by_session ON world_session_saves(session_id, saved_at DESC);
INSERT INTO schema_migrations(version, applied_at) VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`;
