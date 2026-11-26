import request from 'supertest'
import { createApp } from '../app.js'
import { createDatabase } from '../db.js'

export function createTestContext(options = {}) {
  const db = createDatabase(':memory:')
  const app = createApp({
    db,
    setupCode: 'test-setup-code',
    sessionSecret: 'test-session-secret-long-enough-for-tests',
    ...options,
  })
  return { db, app, agent: () => request.agent(app) }
}

export async function bootstrapAdmin(client, { name = 'Mentor Lead', email = 'mentor@example.test' } = {}) {
  const csrf = (await client.get('/api/auth/csrf')).body.csrfToken
  const setup = await client.post('/api/auth/setup')
    .set('X-CSRF-Token', csrf)
    .send({
      name,
      email,
      password: 'test-admin-password-2026',
      confirmPassword: 'test-admin-password-2026',
      setupCode: 'test-setup-code',
    })
  return setup
}
