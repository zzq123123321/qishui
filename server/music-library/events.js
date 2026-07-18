class EventStore {
  constructor(db) {
    this.db = db;
  }

  recordEvent(event) {
    const { event_type, song_id, timestamp, source, duration, context, metadata } = event;
    const now = timestamp || new Date().toISOString().replace('T', ' ').split('.')[0];
    const ctx = typeof context === 'string' ? context : JSON.stringify(context || {});
    const meta = typeof metadata === 'string' ? metadata : JSON.stringify(metadata || {});

    this.db.run(
      `INSERT INTO events (song_id, event_type, timestamp, source, duration, context, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [song_id || '', event_type, now, source || '', duration || 0, ctx, meta]
    );

    this._updatePlayHistory(song_id, event_type, duration, now);
  }

  _updatePlayHistory(songId, eventType, duration, now) {
    const existing = this.db.get(`SELECT * FROM play_history WHERE song_id = ?`, [songId]);

    if (!existing) {
      this.db.run(
        `INSERT INTO play_history (song_id, play_count, skip_count, complete_count, total_listened_ms, last_played, first_played) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          songId,
          eventType === 'play_start' ? 1 : 0,
          eventType === 'skip' ? 1 : 0,
          eventType === 'play_complete' ? 1 : 0,
          eventType === 'skip' || eventType === 'play_complete' ? (duration || 0) : 0,
          now,
          now,
        ]
      );
      return;
    }

    const updates = {
      play_count: existing.play_count + (eventType === 'play_start' || eventType === 'play_complete' ? 1 : 0),
      skip_count: existing.skip_count + (eventType === 'skip' ? 1 : 0),
      complete_count: existing.complete_count + (eventType === 'play_complete' ? 1 : 0),
      total_listened_ms: existing.total_listened_ms + ((eventType === 'skip' || eventType === 'play_complete') ? (duration || 0) : 0),
      last_played: now,
    };

    this.db.run(
      `UPDATE play_history SET play_count=?, skip_count=?, complete_count=?, total_listened_ms=?, last_played=? WHERE song_id=?`,
      [updates.play_count, updates.skip_count, updates.complete_count, updates.total_listened_ms, updates.last_played, songId]
    );
  }

  getEvents(songId, limit) {
    if (songId) {
      return this.db.all(
        `SELECT * FROM events WHERE song_id = ? ORDER BY timestamp DESC LIMIT ?`,
        [songId, limit || 50]
      );
    }
    return this.db.all(
      `SELECT * FROM events ORDER BY timestamp DESC LIMIT ?`,
      [limit || 100]
    );
  }

  getRecentHistory(limit) {
    return this.db.all(
      `SELECT ph.*, s.title, s.artist, s.source
       FROM play_history ph
       LEFT JOIN songs s ON s.id = ph.song_id
       ORDER BY ph.last_played DESC
       LIMIT ?`,
      [limit || 50]
    );
  }

  getTopPlayed(limit) {
    return this.db.all(
      `SELECT ph.*, s.title, s.artist, s.source
       FROM play_history ph
       LEFT JOIN songs s ON s.id = ph.song_id
       ORDER BY ph.play_count DESC
       LIMIT ?`,
      [limit || 50]
    );
  }

  getStats() {
    const totalEvents = this.db.get(`SELECT COUNT(*) as count FROM events`).count;
    const uniqueSongs = this.db.get(`SELECT COUNT(DISTINCT song_id) as count FROM events`).count;
    const eventTypeCounts = this.db.all(
      `SELECT event_type, COUNT(*) as count FROM events GROUP BY event_type ORDER BY count DESC`
    );
    const topSong = this.db.get(
      `SELECT ph.*, s.title, s.artist FROM play_history ph LEFT JOIN songs s ON s.id = ph.song_id ORDER BY ph.play_count DESC LIMIT 1`
    );
    return { totalEvents, uniqueSongs, eventTypeCounts, topSong: topSong || null };
  }
}

module.exports = { EventStore };
