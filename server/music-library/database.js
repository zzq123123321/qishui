const path = require('path');
const { SCHEMA_SQL } = require('./schema');

class MusicDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  initialize() {
    const dir = path.dirname(this.dbPath);
    if (!require('fs').existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  migrate() {
    const statements = SCHEMA_SQL.split(';').filter(s => s.trim().length > 0);
    for (const stmt of statements) {
      this.db.exec(stmt.trim() + ';');
    }
  }

  run(sql, params) {
    if (params === undefined) return this.db.prepare(sql).run();
    return this.db.prepare(sql).run(params);
  }

  get(sql, params) {
    if (params === undefined) return this.db.prepare(sql).get();
    return this.db.prepare(sql).get(params);
  }

  all(sql, params) {
    if (params === undefined) return this.db.prepare(sql).all();
    return this.db.prepare(sql).all(params);
  }

  close() {
    if (this.db) this.db.close();
  }
}

module.exports = { MusicDatabase };
