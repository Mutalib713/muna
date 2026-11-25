import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootstrapAdmin, createTestContext } from './helpers.js'

test('admin APIs require a session and persist questions, assessments, and review decisions', async () => {
  const { db, agent } = createTestContext()
  const client = agent()

  const anonymousQuestions = await client.get('/api/questions')
  assert.equal(anonymousQuestions.status, 401)
  const anonymousAssessments = await client.get('/api/assessments')
  assert.equal(anonymousAssessments.status, 401)

  const csrfResponse = await client.get('/api/auth/csrf')
  assert.equal(csrfResponse.status, 200)
  const anonymousCsrf = csrfResponse.body.csrfToken

  const setupStatus = await client.get('/api/auth/status')
  assert.deepEqual(setupStatus.body, { setupRequired: true })

  const wrongSetupCode = await client.post('/api/auth/setup')
    .set('X-CSRF-Token', anonymousCsrf)
    .send({ name: 'Test Admin', email: 'admin@example.test', password: 'test-admin-password-2026', confirmPassword: 'test-admin-password-2026', setupCode: 'wrong-code' })
  assert.equal(wrongSetupCode.status, 403)

  const shortPassword = await client.post('/api/auth/setup')
    .set('X-CSRF-Token', anonymousCsrf)
    .send({ name: 'Test Admin', email: 'admin@example.test', password: 'short', confirmPassword: 'short', setupCode: 'test-setup-code' })
  assert.equal(shortPassword.status, 400)

  const mismatchedPassword = await client.post('/api/auth/setup')
    .set('X-CSRF-Token', anonymousCsrf)
    .send({ name: 'Test Admin', email: 'admin@example.test', password: 'test-admin-password-2026', confirmPassword: 'a-different-password', setupCode: 'test-setup-code' })
  assert.equal(mismatchedPassword.status, 400)

  const setup = await bootstrapAdmin(client, { name: 'Test Admin', email: 'admin@example.test' })
  assert.equal(setup.status, 200)
  assert.equal(setup.body.user.name, 'Test Admin')
  assert.notEqual(db.prepare('SELECT password_hash FROM admin_account').get().password_hash, 'test-admin-password-2026')
  assert.deepEqual((await client.get('/api/auth/status')).body, { setupRequired: false })

  const setupAgain = await client.post('/api/auth/setup')
    .set('X-CSRF-Token', setup.body.csrfToken)
    .send({})
  assert.equal(setupAgain.status, 403)

  await client.post('/api/auth/logout').set('X-CSRF-Token', setup.body.csrfToken)
  const loginCsrf = (await client.get('/api/auth/csrf')).body.csrfToken

  const csrfRejected = await client.post('/api/auth/login').send({ email: 'admin@example.test', password: 'test-admin-password-2026' })
  assert.equal(csrfRejected.status, 403)

  const badLogin = await client.post('/api/auth/login')
    .set('X-CSRF-Token', loginCsrf)
    .send({ email: 'wrong@example.test', password: 'test-admin-password-2026' })
  assert.equal(badLogin.status, 401)

  const login = await client.post('/api/auth/login')
    .set('X-CSRF-Token', loginCsrf)
    .send({ email: 'admin@example.test', password: 'test-admin-password-2026' })
  assert.equal(login.status, 200)
  assert.equal(login.body.user.role, 'admin')
  const csrfToken = login.body.csrfToken
  assert.notEqual(csrfToken, anonymousCsrf)

  const questionList = await client.get('/api/questions')
  assert.equal(questionList.status, 200)
  assert.equal(questionList.body.questions.length, 4)

  const crossOriginWrite = await client.post('/api/questions')
    .set('Origin', 'https://attacker.example')
    .set('X-CSRF-Token', csrfToken)
    .send({ prompt: 'Blocked question', options: ['A', 'B'], correctAnswer: 'A' })
  assert.equal(crossOriginWrite.status, 403)

  const staleCsrfWrite = await client.post('/api/questions')
    .set('X-CSRF-Token', anonymousCsrf)
    .send({ prompt: 'Blocked question', options: ['A', 'B'], correctAnswer: 'A' })
  assert.equal(staleCsrfWrite.status, 403)

  const question = await client.post('/api/questions')
    .set('X-CSRF-Token', csrfToken)
    .send({ prompt: 'What is 2 + 2?', options: ['3', '4'], correctAnswer: '4' })
  assert.equal(question.status, 201)
  assert.equal(question.body.question.correctAnswer, '4')
  const persistedQuestionList = await client.get('/api/questions')
  assert.equal(persistedQuestionList.body.questions.length, 5)

  const mentees = await client.get('/api/mentees')
  assert.equal(mentees.status, 200)
  assert.equal(mentees.body.mentees.length, 5)

  const mentee = await client.post('/api/mentees')
    .set('X-CSRF-Token', csrfToken)
    .send({ name: 'Amara Okafor', email: 'amara@example.test' })
  assert.equal(mentee.status, 201)

  const assessment = await client.post('/api/assessments')
    .set('X-CSRF-Token', csrfToken)
    .send({ title: 'Algebra check-in', questionIds: ['Q-104'], menteeIds: [mentee.body.mentee.id] })
  assert.equal(assessment.status, 201)
  assert.equal(assessment.body.assessment.maxAttempts, 3)
  assert.equal(assessment.body.assessment.status, 'Draft')
  assert.deepEqual(assessment.body.assessment.questionIds, ['Q-104'])
  assert.deepEqual(assessment.body.assessment.menteeIds, [mentee.body.mentee.id])

  const invalidAttemptLimit = await client.post('/api/assessments')
    .set('X-CSRF-Token', csrfToken)
    .send({ title: 'Invalid assessment', questionIds: ['Q-104'], menteeIds: [mentee.body.mentee.id], maxAttempts: 4 })
  assert.equal(invalidAttemptLimit.status, 400)

  const publishAssessment = await client.patch(`/api/assessments/${assessment.body.assessment.id}/status`)
    .set('X-CSRF-Token', csrfToken)
    .send({ status: 'Published' })
  assert.equal(publishAssessment.status, 200)
  assert.equal(publishAssessment.body.assessment.status, 'Published')

  const learnerAttempt = await client.post(`/api/learner/assessments/${assessment.body.assessment.id}/attempts`)
    .send({ menteeId: mentee.body.mentee.id, answers: { 'Q-104': 'Photosynthesis' } })
  assert.equal(learnerAttempt.status, 201)

  const pauseAssessment = await client.patch(`/api/assessments/${assessment.body.assessment.id}/status`)
    .set('X-CSRF-Token', csrfToken)
    .send({ status: 'Paused' })
  assert.equal(pauseAssessment.status, 200)
  assert.equal(pauseAssessment.body.assessment.status, 'Paused')

  const invalidQuestion = await client.post('/api/questions')
    .set('X-CSRF-Token', csrfToken)
    .send({ prompt: 'Invalid key', options: ['A', 'B'], correctAnswer: 'C' })
  assert.equal(invalidQuestion.status, 400)

  const submissions = await client.get('/api/answers')
  assert.equal(submissions.status, 200)
  assert.equal(submissions.body.answers.length, 6)
  const submissionId = submissions.body.answers[0].id

  const review = await client.patch(`/api/answers/${submissionId}/review`)
    .set('X-CSRF-Token', csrfToken)
    .send({ decision: 'Revision requested', feedback: 'Please show your working.' })
  assert.equal(review.status, 200)
  assert.equal(review.body.answer.reviewDecision, 'Revision requested')
  assert.equal(review.body.answer.reviewHistory.length, 1)
  const persistedAnswer = await client.get('/api/answers')
  assert.equal(persistedAnswer.body.answers.find((answer) => answer.id === submissionId).feedback, 'Please show your working.')

  const createdFlag = await client.post('/api/flags')
    .set('X-CSRF-Token', csrfToken)
    .send({ student: 'Amara Okafor', assessment: 'Algebra check-in', signal: 'Repeated answer pattern', detail: 'Needs contextual review.' })
  assert.equal(createdFlag.status, 201)
  const flagReview = await client.patch(`/api/flags/${createdFlag.body.flag.id}/review`)
    .set('X-CSRF-Token', csrfToken)
    .send({ decision: 'Follow-up', note: 'Check the submission context with the student.' })
  assert.equal(flagReview.status, 200)
  assert.equal(flagReview.body.flag.level, 'Follow-up')
  assert.equal(flagReview.body.flag.reviewHistory.length, 1)

  const logout = await client.post('/api/auth/logout').set('X-CSRF-Token', csrfToken)
  assert.equal(logout.status, 200)
  const afterLogout = await client.get('/api/questions')
  assert.equal(afterLogout.status, 401)

  db.close()
})

test('members and invitations persist, validate hashed tokens, and handle acceptance idempotently', async () => {
  const { db, agent } = createTestContext({
    orgName: 'Bright Minds',
    orgSlug: 'bright-minds',
  })
  const adminClient = agent()
  const inviteeClient = agent()

  assert.equal((await inviteeClient.get('/api/members')).status, 401)
  assert.equal((await inviteeClient.get('/api/invitations')).status, 401)

  const setupRes = await bootstrapAdmin(adminClient, { name: 'Alex Owner', email: 'owner@example.test' })
  assert.equal(setupRes.status, 200)
  const csrfToken = setupRes.body.csrfToken

  const initialMembers = await adminClient.get('/api/members')
  assert.equal(initialMembers.status, 200)
  assert.equal(initialMembers.body.organisation.name, 'Bright Minds')
  assert.equal(initialMembers.body.members.length, 1)
  const ownerMember = initialMembers.body.members[0]
  assert.equal(ownerMember.role, 'Owner')
  assert.equal(ownerMember.email, 'owner@example.test')

  // Owner cannot be modified or removed
  assert.equal((await adminClient.patch(`/api/members/${ownerMember.id}`).set('X-CSRF-Token', csrfToken).send({ role: 'Mentor' })).status, 403)
  assert.equal((await adminClient.delete(`/api/members/${ownerMember.id}`).set('X-CSRF-Token', csrfToken)).status, 403)

  // Create reusable code invite (maxUses = 2)
  const codeInviteRes = await adminClient.post('/api/invitations')
    .set('X-CSRF-Token', csrfToken)
    .send({ type: 'code', role: 'Mentee', days: 7, maxUses: 2 })
  assert.equal(codeInviteRes.status, 201)
  const codeInvite = codeInviteRes.body.invitation
  assert.ok(codeInvite.token.startsWith('MUNA-'))
  assert.equal(codeInvite.state, 'Active')

  // Admin list never leaks token or token_hash
  const listedInvites = await adminClient.get('/api/invitations')
  assert.equal(listedInvites.status, 200)
  assert.equal(listedInvites.body.invitations.length, 1)
  assert.equal(listedInvites.body.invitations[0].token, undefined)
  assert.equal(listedInvites.body.invitations[0].token_hash, undefined)

  // Public preview works without admin session
  const preview = await inviteeClient.get(`/api/invitations/${codeInvite.token}`)
  assert.equal(preview.status, 200)
  assert.equal(preview.body.invitation.organisationName, 'Bright Minds')
  assert.equal(preview.body.invitation.role, 'Mentee')

  // Public accept requires CSRF and validates inputs
  const inviteeCsrfRes = await inviteeClient.get('/api/auth/csrf')
  const inviteeCsrf = inviteeCsrfRes.body.csrfToken

  const accept1 = await inviteeClient.post(`/api/invitations/${codeInvite.token}/accept`)
    .set('X-CSRF-Token', inviteeCsrf)
    .send({ name: 'Ada Lovelace', email: 'ada@example.test', password: 'password-1234' })
  assert.equal(accept1.status, 201)
  assert.equal(accept1.body.alreadyMember, false)
  assert.equal(accept1.body.member.role, 'Mentee')
  assert.ok(accept1.body.menteeId)

  // Duplicate acceptance is idempotent and does not consume a second use
  const duplicateBadPw = await inviteeClient.post(`/api/invitations/${codeInvite.token}/accept`)
    .set('X-CSRF-Token', inviteeCsrf)
    .send({ name: 'Ada Lovelace', email: 'ada@example.test', password: 'wrong-password' })
  assert.equal(duplicateBadPw.status, 401)

  const duplicateOk = await inviteeClient.post(`/api/invitations/${codeInvite.token}/accept`)
    .set('X-CSRF-Token', inviteeCsrf)
    .send({ name: 'Ada Lovelace', email: 'ada@example.test', password: 'password-1234' })
  assert.equal(duplicateOk.status, 200)
  assert.equal(duplicateOk.body.alreadyMember, true)

  // Second user consumes the 2nd and final use
  const accept2 = await inviteeClient.post(`/api/invitations/${codeInvite.token}/accept`)
    .set('X-CSRF-Token', inviteeCsrf)
    .send({ name: 'Grace Hopper', email: 'grace@example.test', password: 'password-1234' })
  assert.equal(accept2.status, 201)

  // Exhausted code is rejected
  const exhausted = await inviteeClient.post(`/api/invitations/${codeInvite.token}/accept`)
    .set('X-CSRF-Token', inviteeCsrf)
    .send({ name: 'Alan Turing', email: 'alan@example.test', password: 'password-1234' })
  assert.equal(exhausted.status, 410)

  // Email-specific invite rejects mismatched email and accepts matching email
  const emailInviteRes = await adminClient.post('/api/invitations')
    .set('X-CSRF-Token', csrfToken)
    .send({ type: 'email', email: 'mentor@example.test', role: 'Mentor', days: 7 })
  assert.equal(emailInviteRes.status, 201)
  const emailToken = emailInviteRes.body.invitation.token

  const wrongEmail = await inviteeClient.post(`/api/invitations/${emailToken}/accept`)
    .set('X-CSRF-Token', inviteeCsrf)
    .send({ name: 'Wrong User', email: 'other@example.test', password: 'password-1234' })
  assert.equal(wrongEmail.status, 403)

  const rightEmail = await inviteeClient.post(`/api/invitations/${emailToken}/accept`)
    .set('X-CSRF-Token', inviteeCsrf)
    .send({ name: 'Dana Mentor', email: 'mentor@example.test', password: 'password-1234' })
  assert.equal(rightEmail.status, 201)
  assert.equal(rightEmail.body.member.role, 'Mentor')

  // Revoked and expired invites are rejected
  const revokeInviteRes = await adminClient.post('/api/invitations')
    .set('X-CSRF-Token', csrfToken)
    .send({ type: 'code', role: 'Mentee', days: 7, maxUses: 5 })
  const revokeId = revokeInviteRes.body.invitation.id
  const revokeToken = revokeInviteRes.body.invitation.token
  const revoked = await adminClient.delete(`/api/invitations/${revokeId}`).set('X-CSRF-Token', csrfToken)
  assert.equal(revoked.status, 200)
  assert.equal(revoked.body.invitation.state, 'Revoked')
  assert.equal((await inviteeClient.get(`/api/invitations/${revokeToken}`)).status, 410)

  const expiredInviteRes = await adminClient.post('/api/invitations')
    .set('X-CSRF-Token', csrfToken)
    .send({ type: 'code', role: 'Mentee', days: 7, maxUses: 5 })
  const expiredId = expiredInviteRes.body.invitation.id
  const expiredToken = expiredInviteRes.body.invitation.token
  db.prepare('UPDATE invitations SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', expiredId)
  assert.equal((await inviteeClient.get(`/api/invitations/${expiredToken}`)).status, 410)

  // Admin can update role, suspend/restore, and remove members, plus mentees roster synced
  const membersAfter = await adminClient.get('/api/members')
  assert.equal(membersAfter.body.members.length, 4)
  const mentorMember = membersAfter.body.members.find((m) => m.email === 'mentor@example.test')
  const updatedRole = await adminClient.patch(`/api/members/${mentorMember.id}`)
    .set('X-CSRF-Token', csrfToken)
    .send({ role: 'Admin', status: 'Suspended' })
  assert.equal(updatedRole.status, 200)
  assert.equal(updatedRole.body.member.role, 'Admin')
  assert.equal(updatedRole.body.member.status, 'Suspended')

  const removed = await adminClient.delete(`/api/members/${mentorMember.id}`).set('X-CSRF-Token', csrfToken)
  assert.equal(removed.status, 200)
  const membersFinal = await adminClient.get('/api/members')
  assert.equal(membersFinal.body.members.length, 3)

  const menteesList = await adminClient.get('/api/mentees')
  assert.ok(menteesList.body.mentees.some((m) => m.email === 'ada@example.test'))
  assert.ok(menteesList.body.mentees.some((m) => m.email === 'grace@example.test'))

  db.close()
})

test('only one concurrent setup request can create the admin account', async () => {
  const { db, agent } = createTestContext()
  const clients = [agent(), agent()]
  const tokens = await Promise.all(clients.map(async (client) => (await client.get('/api/auth/csrf')).body.csrfToken))
  const responses = await Promise.all(clients.map((client, index) => client.post('/api/auth/setup')
    .set('X-CSRF-Token', tokens[index])
    .send({
      name: `Test Admin ${index}`,
      email: `admin${index}@example.test`,
      password: 'test-admin-password-2026',
      confirmPassword: 'test-admin-password-2026',
      setupCode: 'test-setup-code',
    })))

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 403])
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM admin_account').get().count, 1)
  db.close()
})

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
