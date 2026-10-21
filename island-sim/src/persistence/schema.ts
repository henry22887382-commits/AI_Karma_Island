export const SCHEMA_VERSION = 2;

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
