import session from 'express-session'

export class SQLiteSessionStore extends session.Store {
  constructor(db) {
    super()
    this.db = db
    this.getStatement = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?')
    this.setStatement = db.prepare(`
      INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires
    `)
    this.deleteStatement = db.prepare('DELETE FROM sessions WHERE sid = ?')
    this.expireStatement = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?')
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now())
  }

  get(sid, callback) {
    try {
      const row = this.getStatement.get(sid)
      if (!row || row.expires <= Date.now()) {
        if (row) this.deleteStatement.run(sid)
        callback(null, null)
        return
      }
      callback(null, JSON.parse(row.data))
    } catch (error) {
      callback(error)
    }
  }

  set(sid, sessionData, callback) {
    try {
      const cookieExpiry = sessionData.cookie.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + (sessionData.cookie.maxAge || 8 * 60 * 60 * 1000)
      this.setStatement.run(sid, JSON.stringify(sessionData), cookieExpiry)
      if (callback) callback(null)
    } catch (error) {
      if (callback) callback(error)
    }
  }

  touch(sid, sessionData, callback) {
    try {
      const cookieExpiry = sessionData.cookie.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + (sessionData.cookie.maxAge || 8 * 60 * 60 * 1000)
      this.expireStatement.run(cookieExpiry, sid)
      if (callback) callback(null)
    } catch (error) {
      if (callback) callback(error)
    }
  }

  destroy(sid, callback) {
    try {
      this.deleteStatement.run(sid)
      if (callback) callback(null)
    } catch (error) {
      if (callback) callback(error)
    }
  }
}
