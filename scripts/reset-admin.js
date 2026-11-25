import 'dotenv/config'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createDatabase } from '../server/db.js'

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configuredDatabasePath = process.env.DATABASE_PATH || './data/muna.sqlite'
const databasePath = configuredDatabasePath === ':memory:'
  ? ':memory:'
  : path.resolve(projectDirectory, configuredDatabasePath)
const db = createDatabase(databasePath)

try {
  const reset = db.transaction(() => {
    const result = db.prepare('DELETE FROM admin_account WHERE id = 1').run()
    db.prepare('DELETE FROM sessions').run()
    return result.changes
  })
  console.log(reset() ? 'Admin account deleted. Use the setup page to create a new account.' : 'No admin account exists.')
} finally {
  db.close()
}
