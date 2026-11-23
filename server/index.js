import 'dotenv/config'
import { Buffer } from 'node:buffer'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { createApp } from './app.js'
import { createDatabase } from './db.js'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(serverDirectory, '..')
const adminEmail = process.env.ADMIN_EMAIL?.trim()
const adminPassword = process.env.ADMIN_PASSWORD
const sessionSecret = process.env.SESSION_SECRET
const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || '127.0.0.1'
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0)

if (!adminEmail || !adminPassword || !sessionSecret) {
  throw new Error('Set ADMIN_EMAIL, ADMIN_PASSWORD, and SESSION_SECRET in your environment or .env file.')
}
if (adminEmail === 'admin@example.com' || adminPassword === 'replace-with-a-long-unique-password') {
  throw new Error('Replace the example admin email and password before starting the server.')
}
if (adminPassword.length < 14) {
  throw new Error('ADMIN_PASSWORD must be at least 14 characters long.')
}
if (Buffer.byteLength(adminPassword, 'utf8') > 72) {
  throw new Error('ADMIN_PASSWORD must be no more than 72 UTF-8 bytes.')
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
const passwordHash = await bcrypt.hash(adminPassword, 12)
delete process.env.ADMIN_PASSWORD

const app = createApp({
  db,
  adminEmail,
  adminName: process.env.ADMIN_NAME || 'Administrator',
  passwordHash,
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
