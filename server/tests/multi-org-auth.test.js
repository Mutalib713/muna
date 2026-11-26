import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestContext } from './helpers.js'

test('Phase 0 Auth: mentor signup, email verification, multi-org switching, and strict tenant isolation', async () => {
  const sentEmails = []
  const { db, agent } = createTestContext({
    onVerificationEmail: (payload) => sentEmails.push(payload),
  })
  const orgAClient = agent()
  const orgBClient = agent()

  const csrfA1 = (await orgAClient.get('/api/auth/csrf')).body.csrfToken
  const signupA = await orgAClient
    .post('/api/auth/signup')
    .set('X-CSRF-Token', csrfA1)
    .send({
      name: 'Ada Mentor',
      email: 'ada@academy-a.test',
      password: 'password-alpha-2026',
      organisationName: 'Bright Academy',
    })
  assert.equal(signupA.status, 201)
  assert.equal(signupA.body.user.emailVerified, false)
  assert.equal(signupA.body.organisation.slug, 'bright-academy')
  assert.equal(signupA.body.organisation.role, 'Owner')
  assert.ok(signupA.body.verificationToken)

  const blockedQuestions = await orgAClient.get('/api/questions')
  assert.equal(blockedQuestions.status, 403)
  assert.equal(blockedQuestions.body.emailVerificationRequired, true)

  const blockedCreateOrg = await orgAClient
    .post('/api/organisations')
    .set('X-CSRF-Token', signupA.body.csrfToken)
    .send({ name: 'Second Org' })
  assert.equal(blockedCreateOrg.status, 403)
  assert.equal(blockedCreateOrg.body.emailVerificationRequired, true)

  const resend = await orgAClient
    .post('/api/auth/resend-verification')
    .set('X-CSRF-Token', signupA.body.csrfToken)
  assert.equal(resend.status, 200)
  assert.ok(resend.body.verificationToken)

  const verifyBad = await orgAClient
    .post('/api/auth/verify-email')
    .set('X-CSRF-Token', signupA.body.csrfToken)
    .send({ token: 'wrong-token' })
  assert.equal(verifyBad.status, 400)

  const verifyOk = await orgAClient
    .post('/api/auth/verify-email')
    .set('X-CSRF-Token', signupA.body.csrfToken)
    .send({ token: resend.body.verificationToken })
  assert.equal(verifyOk.status, 200)
  assert.equal(verifyOk.body.emailVerified, true)

  const orgAId = signupA.body.organisation.id
  const csrfA = signupA.body.csrfToken

  assert.equal((await orgAClient.get('/api/questions')).status, 200)

  const qA = (await orgAClient.post('/api/questions').set('X-CSRF-Token', csrfA).send({
    type: 'mcq',
    prompt: 'Org A Secret Question',
    options: ['One', 'Two'],
    correctAnswer: 'One',
    difficulty: 'Easy',
  })).body.question
  const menteeA = (await orgAClient.post('/api/mentees').set('X-CSRF-Token', csrfA).send({
    name: 'Learner One',
    email: 'learner1@academy-a.test',
  })).body.mentee
  const assessmentA = (await orgAClient.post('/api/assessments').set('X-CSRF-Token', csrfA).send({
    title: 'Org A Assessment',
    questionIds: [qA.id],
    menteeIds: [menteeA.id],
    securityMode: 'strict_web',
  })).body.assessment
  await orgAClient.patch(`/api/assessments/${assessmentA.id}/status`).set('X-CSRF-Token', csrfA).send({ status: 'Published' })
  const startA = await orgAClient.post(`/api/learner/assessments/${assessmentA.id}/start`).send({ menteeId: menteeA.id })
  await orgAClient.post(`/api/learner/attempts/${startA.body.attempt.id}/security-events`).send({
    menteeId: menteeA.id,
    eventType: 'visibility_hidden',
  })

  const csrfB1 = (await orgBClient.get('/api/auth/csrf')).body.csrfToken
  const signupB = await orgBClient
    .post('/api/auth/signup')
    .set('X-CSRF-Token', csrfB1)
    .send({
      name: 'Bola Owner',
      email: 'bola@academy-b.test',
      password: 'password-bravo-2026',
      organisationName: 'Bright Academy',
    })
  assert.equal(signupB.status, 201)
  assert.equal(signupB.body.organisation.slug, 'bright-academy-2')
  const orgBId = signupB.body.organisation.id
  const csrfB = signupB.body.csrfToken
  await orgBClient.post('/api/auth/verify-email').set('X-CSRF-Token', csrfB).send({ token: signupB.body.verificationToken })

  assert.equal((await orgBClient.get('/api/questions')).body.questions.some((q) => q.id === qA.id), false)
  assert.equal((await orgBClient.get('/api/mentees')).body.mentees.length, 0)
  assert.equal((await orgBClient.get('/api/assessments')).body.assessments.length, 0)
  assert.equal((await orgBClient.get('/api/answers')).body.answers.length, 0)
  assert.equal((await orgBClient.get('/api/flags')).body.flags.length, 0)

  assert.equal((await orgBClient.patch(`/api/questions/${qA.id}`).set('X-CSRF-Token', csrfB).send({
    type: 'mcq', prompt: 'Tampered', options: ['A', 'B'], correctAnswer: 'A', difficulty: 'Easy',
  })).status, 404)
  assert.equal((await orgBClient.get(`/api/assessments/${assessmentA.id}/analytics`)).status, 404)
  assert.equal((await orgBClient.get(`/api/assessments/${assessmentA.id}/export.csv`)).status, 404)
  assert.equal((await orgBClient.get(`/api/mentees/${menteeA.id}/history`)).status, 404)
  assert.equal((await orgBClient.get(`/api/attempts/${startA.body.attempt.id}/security-events`)).status, 404)
  assert.equal((await orgBClient.get('/api/questions').set('X-Organisation-Id', orgAId)).status, 403)
  assert.equal((await orgBClient.get(`/api/organisations/${orgAId}/members`)).status, 403)

  const newOrgRes = await orgAClient
    .post('/api/organisations')
    .set('X-CSRF-Token', csrfA)
    .send({ name: 'Ada Labs' })
  assert.equal(newOrgRes.status, 201)
  assert.equal(newOrgRes.body.organisation.slug, 'ada-labs')

  const orgList = await orgAClient.get('/api/organisations')
  assert.equal(orgList.body.organisations.length, 2)
  assert.equal((await orgAClient.get('/api/assessments')).body.assessments.length, 0)

  const inviteMentor = await orgAClient
    .post(`/api/organisations/${orgAId}/invitations`)
    .set('X-CSRF-Token', csrfA)
    .send({ type: 'email', email: 'peer@academy-a.test', role: 'Mentor', days: 7 })
  assert.equal(inviteMentor.status, 201)

  const peerClient = agent()
  const peerCsrf = (await peerClient.get('/api/auth/csrf')).body.csrfToken
  const acceptPeer = await peerClient
    .post(`/api/invitations/${encodeURIComponent(inviteMentor.body.invitation.token)}/accept`)
    .set('X-CSRF-Token', peerCsrf)
    .send({ name: 'Peer Mentor', email: 'peer@academy-a.test', password: 'password-peer-2026' })
  assert.equal(acceptPeer.status, 201)

  const peerLoginCsrf = (await peerClient.get('/api/auth/csrf')).body.csrfToken
  const peerLogin = await peerClient
    .post('/api/auth/login')
    .set('X-CSRF-Token', peerLoginCsrf)
    .send({ email: 'peer@academy-a.test', password: 'password-peer-2026' })
  assert.equal(peerLogin.status, 200)
  assert.equal((await peerClient.get('/api/assessments')).body.assessments.length, 1)
  const mentorInviteAttempt = await peerClient
    .post(`/api/organisations/${orgAId}/invitations`)
    .set('X-CSRF-Token', peerLogin.body.csrfToken)
    .send({ type: 'link', role: 'Mentee', days: 3, maxUses: 5 })
  assert.equal(mentorInviteAttempt.status, 403)

  const logoutB = await orgBClient.post('/api/auth/logout').set('X-CSRF-Token', csrfB)
  assert.equal(logoutB.status, 200)
  assert.equal((await orgBClient.get('/api/auth/me')).status, 401)
  assert.equal(orgBId !== orgAId, true)
  assert.ok(sentEmails.length >= 2)

  const inviteMentee = await orgAClient
    .post(`/api/organisations/${orgAId}/invitations`)
    .set('X-CSRF-Token', csrfA)
    .send({ type: 'email', email: 'learner1@academy-a.test', role: 'Mentee', days: 7 })
  assert.equal(inviteMentee.status, 201)
  const menteeClient = agent()
  const mCsrf = (await menteeClient.get('/api/auth/csrf')).body.csrfToken
  await menteeClient
    .post(`/api/invitations/${encodeURIComponent(inviteMentee.body.invitation.token)}/accept`)
    .set('X-CSRF-Token', mCsrf)
    .send({ name: 'Learner One', email: 'learner1@academy-a.test', password: 'password-mentee-2026' })
  const mLoginCsrf = (await menteeClient.get('/api/auth/csrf')).body.csrfToken
  const mLogin = await menteeClient
    .post('/api/auth/login')
    .set('X-CSRF-Token', mLoginCsrf)
    .send({ email: 'learner1@academy-a.test', password: 'password-mentee-2026' })
  assert.equal(mLogin.status, 200)
  assert.equal((await menteeClient.get('/api/learner/me')).body.mentees[0].id, menteeA.id)
  assert.equal((await menteeClient.get(`/api/learner/assessments/${menteeA.id}`)).status, 200)
  assert.equal((await menteeClient.get('/api/questions')).status, 403)

  db.close()
})
