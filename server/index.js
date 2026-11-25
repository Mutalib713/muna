import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { createDatabase } from './db.js'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(serverDirectory, '..')
const sessionSecret = process.env.SESSION_SECRET
const setupCode = process.env.SETUP_CODE
const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || '127.0.0.1'
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0)

if (!sessionSecret || !setupCode) {
  throw new Error('Set SESSION_SECRET and SETUP_CODE in your environment or .env file.')
}
if (sessionSecret.length < 32 || sessionSecret === 'replace-with-a-random-secret-at-least-32-characters') {
  throw new Error('SESSION_SECRET must be a unique random value of at least 32 characters.')
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port.')
}
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error('TRUST_PROXY_HOPS must be a non-negative integer.')
}

const configuredDatabasePath = process.env.DATABASE_PATH || './data/muna.sqlite'
const databasePath = configuredDatabasePath === ':memory:'
  ? ':memory:'
  : path.resolve(projectDirectory, configuredDatabasePath)
if (databasePath !== ':memory:') {
  mkdirSync(path.dirname(databasePath), { recursive: true })
}
if (process.env.NODE_ENV === 'production' && databasePath === ':memory:') {
  throw new Error('Production requires a persistent DATABASE_PATH.')
}
const db = createDatabase(databasePath)

const app = createApp({
  db,
  setupCode,
  sessionSecret,
  production: process.env.NODE_ENV === 'production',
  trustProxyHops,
  distPath: path.join(projectDirectory, 'dist'),
})

const server = app.listen(port, host, () => {
  console.log(`Muna server listening on http://${host}:${port}`)
})

function shutdown() {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
