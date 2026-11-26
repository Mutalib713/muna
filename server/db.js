import Database from 'better-sqlite3'
import { applySchema } from './db/schema.js'
import { runMigrations } from './db/migrations.js'
import { seedDefaultData } from './db/seed.js'

/** Open and initialize the SQLite database with schema, migrations, and default seed data. */
export function createDatabase(filename) {
  const db = new Database(filename)
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  if (filename !== ':memory:') {
    db.pragma('journal_mode = WAL')
  }

  applySchema(db)
  runMigrations(db)
  seedDefaultData(db)

  return db
}

export * from './db/mappers.js'
export { ensureWorkspaceBootstrap } from './db/bootstrap.js'
