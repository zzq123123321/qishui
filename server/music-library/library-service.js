const path = require('path');
const { MusicDatabase } = require('./database');
const { EventStore } = require('./events');

class LibraryService {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.events = null;
  }

  initialize() {
    const db = new MusicDatabase(this.dbPath);
    db.initialize();
    this.db = db;
    this.events = new EventStore(db);
    return this;
  }

  close() {
    if (this.db) this.db.close();
  }

  async recordEvent(event) {
    return this.events.recordEvent(event);
  }

  async getStats() {
    return this.events.getStats();
  }

  async getEvents(songId, limit) {
    return this.events.getEvents(songId, limit);
  }

  async getRecentHistory(limit) {
    return this.events.getRecentHistory(limit);
  }

  async getTopPlayed(limit) {
    return this.events.getTopPlayed(limit);
  }

  getDb() {
    return this.db;
  }
}

module.exports = { LibraryService };
