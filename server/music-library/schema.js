const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS songs (
  id            TEXT PRIMARY KEY,
  file_path     TEXT UNIQUE,
  title         TEXT,
  artist        TEXT,
  album         TEXT,
  source        TEXT,
  source_id     TEXT,
  duration_ms   INTEGER,
  format        TEXT,
  bitrate       INTEGER,
  has_cover     INTEGER DEFAULT 0,
  has_lyrics    INTEGER DEFAULT 0,
  indexed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id       TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  timestamp     TEXT NOT NULL,
  source        TEXT DEFAULT '',
  duration      INTEGER DEFAULT 0,
  context       TEXT DEFAULT '{}',
  metadata      TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_song ON events(song_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);

CREATE TABLE IF NOT EXISTS play_history (
  song_id           TEXT PRIMARY KEY,
  play_count        INTEGER DEFAULT 0,
  skip_count        INTEGER DEFAULT 0,
  complete_count    INTEGER DEFAULT 0,
  total_listened_ms INTEGER DEFAULT 0,
  last_played       TEXT,
  first_played      TEXT
);

CREATE TABLE IF NOT EXISTS library_meta (
  key           TEXT PRIMARY KEY,
  value         TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO library_meta (key, value) VALUES ('schema_version', '1');
`;

module.exports = { SCHEMA_SQL };
