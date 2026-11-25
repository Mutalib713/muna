import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { bootstrapAdmin, createTestContext } from './helpers.js'

test('secure web mode logs visibility events, surfaces integrity flags, and enforces strict focus-loss termination', async () => {
  const { db, agent } = createTestContext()
  const client = agent()
  const setup = await bootstrapAdmin(client)
  const adminCsrf = setup.body.csrfToken

  const q1 = (await client.post('/api/questions').set('X-CSRF-Token', adminCsrf).send({
    prompt: 'What does TLS protect?',
    options: ['Data in transit', 'Physical CPU'],
    correctAnswer: 'Data in transit',
    points: 4,
  })).body.question
  const q2 = (await client.post('/api/questions').set('X-CSRF-Token', adminCsrf).send({
    prompt: 'HTTP 403 means?',
    options: ['Forbidden', 'Created'],
    correctAnswer: 'Forbidden',
    points: 4,
  })).body.question
  const mentee = (await client.post('/api/mentees').set('X-CSRF-Token', adminCsrf).send({
    name: 'Samir Patel',
    email: 'samir@example.test',
  })).body.mentee

  // Standard web mode logs focus loss and raises a flag without terminating
  const stdAssessment = (await client.post('/api/assessments').set('X-CSRF-Token', adminCsrf).send({
    title: 'Standard Practice',
    questionIds: [q1.id],
    menteeIds: [mentee.id],
    securityMode: 'standard',
    requireFullscreen: true,
  })).body.assessment
  await client.patch(`/api/assessments/${stdAssessment.id}/status`).set('X-CSRF-Token', adminCsrf).send({ status: 'Published' })
  const stdStart = await client.post(`/api/learner/assessments/${stdAssessment.id}/start`).send({ menteeId: mentee.id })
  const stdEvent = await client.post(`/api/learner/attempts/${stdStart.body.attempt.id}/security-events`).send({
    menteeId: mentee.id,
    eventType: 'visibility_hidden',
    detail: 'Switched tab briefly',
  })
  assert.equal(stdEvent.status, 201)
  assert.equal(stdEvent.body.terminated, false)

  // Strict web mode locks & submits last autosaved draft on visibility_hidden
  const strictAssessment = (await client.post('/api/assessments').set('X-CSRF-Token', adminCsrf).send({
    title: 'Strict Security Exam',
    questionIds: [q1.id, q2.id],
    menteeIds: [mentee.id],
    securityMode: 'strict_web',
    requireFullscreen: true,
  })).body.assessment
  await client.patch(`/api/assessments/${strictAssessment.id}/status`).set('X-CSRF-Token', adminCsrf).send({ status: 'Published' })

  const strictStart = await client.post(`/api/learner/assessments/${strictAssessment.id}/start`).send({ menteeId: mentee.id })
  const strictAttemptId = strictStart.body.attempt.id

  await client.put(`/api/learner/attempts/${strictAttemptId}/responses`).send({
    menteeId: mentee.id,
    answers: { [q1.id]: 'Data in transit' },
  })

  const blurEvent = await client.post(`/api/learner/attempts/${strictAttemptId}/security-events`).send({
    menteeId: mentee.id,
    eventType: 'window_blur',
  })
  assert.equal(blurEvent.status, 201)
  assert.equal(blurEvent.body.terminated, false)

  const hiddenEvent = await client.post(`/api/learner/attempts/${strictAttemptId}/security-events`).send({
    menteeId: mentee.id,
    eventType: 'visibility_hidden',
    detail: 'Tab switched',
  })
  assert.equal(hiddenEvent.status, 200)
  assert.equal(hiddenEvent.body.terminated, true)
  assert.equal(hiddenEvent.body.reason, 'focus_lost')
  assert.equal(hiddenEvent.body.attempt.status, 'terminated_focus_lost')
  assert.equal(hiddenEvent.body.attempt.score, '4 / 8')

  const lateSubmit = await client.post(`/api/learner/assessments/${strictAssessment.id}/attempts`).send({
    menteeId: mentee.id,
    attemptId: strictAttemptId,
    answers: { [q1.id]: 'Data in transit', [q2.id]: 'Forbidden' },
  })
  assert.equal(lateSubmit.status, 409)

  const flagsRes = await client.get('/api/flags')
  const strictFlag = flagsRes.body.flags.find((f) => f.attemptId === strictAttemptId)
  assert.ok(strictFlag)
  assert.match(strictFlag.signal, /terminated/i)

  const timelineRes = await client.get(`/api/attempts/${strictAttemptId}/security-events`)
  assert.equal(timelineRes.status, 200)
  assert.equal(timelineRes.body.attempt.status, 'terminated_focus_lost')
  assert.equal(timelineRes.body.events.length, 2)

  db.close()
})

test('assessment analytics, per-mentee history, formula-safe CSV export, and audit logs work end-to-end', async () => {
  const { db, agent } = createTestContext()
  const client = agent()
  const anonExport = await client.get('/api/assessments/AS-1/export.csv')
  assert.equal(anonExport.status, 401)

  const setup = await bootstrapAdmin(client)
  const adminCsrf = setup.body.csrfToken

  const q1 = (await client.post('/api/questions').set('X-CSRF-Token', adminCsrf).send({
    prompt: '1 + 1 = ?',
    options: ['2', '3'],
    correctAnswer: '2',
    points: 2,
  })).body.question
  const q2 = (await client.post('/api/questions').set('X-CSRF-Token', adminCsrf).send({
    type: 'theory',
    prompt: 'Describe encryption.',
    points: 4,
  })).body.question

  const mentee = (await client.post('/api/mentees').set('X-CSRF-Token', adminCsrf).send({
    name: '=HYPERLINK("https://evil.example","Click")',
    email: 'learner@example.test',
  })).body.mentee

  const assessment = (await client.post('/api/assessments').set('X-CSRF-Token', adminCsrf).send({
    title: 'Security & Math Report',
    questionIds: [q1.id, q2.id],
    menteeIds: [mentee.id],
    feedbackPolicy: 'manual',
  })).body.assessment
  await client.patch(`/api/assessments/${assessment.id}/status`).set('X-CSRF-Token', adminCsrf).send({ status: 'Published' })

  const start = await client.post(`/api/learner/assessments/${assessment.id}/start`).send({ menteeId: mentee.id })
  const attemptId = start.body.attempt.id
  await client.post(`/api/learner/attempts/${attemptId}/security-events`).send({
    menteeId: mentee.id,
    eventType: 'visibility_hidden',
  })
  await client.post(`/api/learner/assessments/${assessment.id}/attempts`).send({
    menteeId: mentee.id,
    attemptId,
    answers: { [q1.id]: '2', [q2.id]: 'Scrambles plaintext with a key.' },
  })

  await client.post(`/api/assessments/${assessment.id}/release-results`).set('X-CSRF-Token', adminCsrf)
  await client.post(`/api/assessments/${assessment.id}/extra-attempts`)
    .set('X-CSRF-Token', adminCsrf)
    .send({ menteeId: mentee.id, extraAttempts: 1, reason: 'Accommodation' })

  const analytics = await client.get(`/api/assessments/${assessment.id}/analytics`)
  assert.equal(analytics.status, 200)
  assert.equal(analytics.body.summary.assignedCount, 1)
  assert.equal(analytics.body.summary.completedCount, 1)
  assert.equal(analytics.body.summary.completionRate, 100)
  assert.equal(analytics.body.summary.securityEventCount, 1)
  assert.equal(analytics.body.itemAnalysis.length, 2)
  assert.equal(analytics.body.itemAnalysis[0].averagePercent, 100)
  assert.equal(analytics.body.itemAnalysis[1].needsReviewCount, 1)

  const history = await client.get(`/api/mentees/${mentee.id}/history`)
  assert.equal(history.status, 200)
  assert.equal(history.body.attempts.length, 1)
  assert.equal(history.body.securityEvents.length, 1)
  assert.equal(history.body.extraAttemptGrants.length, 1)

  const csvRes = await client.get(`/api/assessments/${assessment.id}/export.csv`)
  assert.equal(csvRes.status, 200)
  assert.match(csvRes.headers['content-type'], /text\/csv/)
  assert.ok(csvRes.text.includes("'=HYPERLINK"))

  const auditRes = await client.get('/api/audit-logs')
  assert.equal(auditRes.status, 200)
  const actions = auditRes.body.auditLogs.map((l) => l.action)
  assert.ok(actions.includes('export_csv'))
  assert.ok(actions.includes('release_results'))
  assert.ok(actions.includes('grant_extra_attempts'))

  db.close()
})

test('Safe Exam Browser (SEB) mode generates config on publish and rejects ordinary browsers (FR-12)', async () => {
  const { db, agent } = createTestContext()
  const client = agent()
  const setup = await bootstrapAdmin(client, { name: 'Admin', email: 'admin@example.test' })
  const adminCsrf = setup.body.csrfToken

  const q = (await client.post('/api/questions').set('X-CSRF-Token', adminCsrf).send({
    type: 'mcq',
    prompt: 'What enforces OS-level exam lockdown?',
    options: ['Plain browser', 'Safe Exam Browser'],
    correctAnswer: 'Safe Exam Browser',
    difficulty: 'Easy',
  })).body.question
  const mentee = (await client.post('/api/mentees').set('X-CSRF-Token', adminCsrf).send({
    name: 'Kofi Exam',
    email: 'kofi@example.test',
  })).body.mentee

  const customBek = 'a'.repeat(64)
  const draft = (await client.post('/api/assessments').set('X-CSRF-Token', adminCsrf).send({
    title: 'SEB Final Exam',
    questionIds: [q.id],
    menteeIds: [mentee.id],
    securityMode: 'seb',
    sebBrowserExamKey: customBek,
  })).body.assessment
  assert.equal(draft.sebConfigReady, false)

  const draftSeb = await client.get(`/api/assessments/${draft.id}/seb-config`)
  assert.equal(draftSeb.status, 409)

  const pub = await client.patch(`/api/assessments/${draft.id}/status`).set('X-CSRF-Token', adminCsrf).send({ status: 'Published' })
  assert.equal(pub.status, 200)
  assert.equal(pub.body.assessment.sebConfigReady, true)

  const sebMeta = await client.get(`/api/assessments/${draft.id}/seb-config?format=json`)
  assert.equal(sebMeta.status, 200)
  assert.match(sebMeta.body.sebConfigKey, /^[a-f0-9]{64}$/)

  const sebFile = await client.get(`/api/learner/assessments/${draft.id}/seb-config?menteeId=${mentee.id}`)
  assert.equal(sebFile.status, 200)
  assert.ok(sebFile.text.includes('<key>sendBrowserExamKey</key>'))
  assert.ok(sebFile.text.includes(`<string>${sebMeta.body.sebConfigKey}</string>`))

  const ordinaryStart = await client
    .post(`/api/learner/assessments/${draft.id}/start`)
    .set('User-Agent', 'Mozilla/5.0 SEB/3.7.0')
    .send({ menteeId: mentee.id })
  assert.equal(ordinaryStart.status, 403)
  assert.equal(ordinaryStart.body.sebRequired, true)

  const ordinaryCheck = await client.get(`/api/learner/assessments/${draft.id}/seb-check?menteeId=${mentee.id}`)
  assert.equal(ordinaryCheck.status, 200)
  assert.equal(ordinaryCheck.body.sebVerified, false)

  function sebRequestHash(path, key) {
    return createHash('sha256').update(`http://127.0.0.1:80${path}${key}`).digest('hex')
  }

  const startPath = `/api/learner/assessments/${draft.id}/start`
  const sebCheckValid = await client
    .get(`/api/learner/assessments/${draft.id}/seb-check?menteeId=${mentee.id}`)
    .set('Host', '127.0.0.1:80')
    .set('X-SafeExamBrowser-ConfigKeyHash', sebRequestHash(`/api/learner/assessments/${draft.id}/seb-check?menteeId=${mentee.id}`, sebMeta.body.sebConfigKey))
  assert.equal(sebCheckValid.status, 200)
  assert.equal(sebCheckValid.body.sebVerified, true)

  const validStart = await client
    .post(startPath)
    .set('Host', '127.0.0.1:80')
    .set('X-SafeExamBrowser-ConfigKeyHash', sebRequestHash(startPath, sebMeta.body.sebConfigKey))
    .send({ menteeId: mentee.id })
  assert.equal(validStart.status, 201)
  const attemptId = validStart.body.attempt.id

  const blockedSave = await client
    .put(`/api/learner/attempts/${attemptId}/responses`)
    .send({ menteeId: mentee.id, answers: { [q.id]: 'Safe Exam Browser' } })
  assert.equal(blockedSave.status, 403)

  const savePath = `/api/learner/attempts/${attemptId}/responses`
  const validSave = await client
    .put(savePath)
    .set('Host', '127.0.0.1:80')
    .set('X-SafeExamBrowser-RequestHash', sebRequestHash(savePath, customBek))
    .send({ menteeId: mentee.id, answers: { [q.id]: 'Safe Exam Browser' } })
  assert.equal(validSave.status, 200)

  const submitPath = `/api/learner/assessments/${draft.id}/attempts`
  const validSubmit = await client
    .post(submitPath)
    .set('Host', '127.0.0.1:80')
    .set('X-SafeExamBrowser-ConfigKeyHash', sebRequestHash(submitPath, sebMeta.body.sebConfigKey))
    .send({ menteeId: mentee.id, attemptId, answers: { [q.id]: 'Safe Exam Browser' } })
  assert.equal(validSubmit.status, 201)
  assert.equal(validSubmit.body.attempt.score, '1 / 1')

  db.close()
})
