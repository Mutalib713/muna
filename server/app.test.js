import assert from 'node:assert/strict'
import { test } from 'node:test'
import request from 'supertest'
import { createApp } from './app.js'
import { createDatabase } from './db.js'

test('admin APIs require a session and persist questions, assessments, and review decisions', async () => {
  const db = createDatabase(':memory:')
  const app = createApp({
    db,
    setupCode: 'test-setup-code',
    sessionSecret: 'test-session-secret-long-enough-for-tests',
  })
  const client = request.agent(app)

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

  const setup = await client.post('/api/auth/setup')
    .set('X-CSRF-Token', anonymousCsrf)
    .send({ name: 'Test Admin', email: 'admin@example.test', password: 'test-admin-password-2026', confirmPassword: 'test-admin-password-2026', setupCode: 'test-setup-code' })
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
  const db = createDatabase(':memory:')
  const app = createApp({
    db,
    setupCode: 'test-setup-code',
    sessionSecret: 'test-session-secret-long-enough-for-tests',
    orgName: 'Bright Minds',
    orgSlug: 'bright-minds',
  })
  const adminClient = request.agent(app)
  const inviteeClient = request.agent(app)

  assert.equal((await inviteeClient.get('/api/members')).status, 401)
  assert.equal((await inviteeClient.get('/api/invitations')).status, 401)

  const adminCsrfRes = await adminClient.get('/api/auth/csrf')
  const setupRes = await adminClient.post('/api/auth/setup')
    .set('X-CSRF-Token', adminCsrfRes.body.csrfToken)
    .send({
      name: 'Alex Owner',
      email: 'owner@example.test',
      password: 'test-admin-password-2026',
      confirmPassword: 'test-admin-password-2026',
      setupCode: 'test-setup-code',
    })
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

test('rich question types, rubrics, vector drawings, and manual grading work end-to-end', async () => {
  const db = createDatabase(':memory:')
  const app = createApp({
    db,
    setupCode: 'test-setup-code',
    sessionSecret: 'test-session-secret-long-enough-for-tests',
  })
  const client = request.agent(app)
  const csrf = (await client.get('/api/auth/csrf')).body.csrfToken
  const setup = await client.post('/api/auth/setup')
    .set('X-CSRF-Token', csrf)
    .send({
      name: 'Mentor Lead',
      email: 'mentor@example.test',
      password: 'test-admin-password-2026',
      confirmPassword: 'test-admin-password-2026',
      setupCode: 'test-setup-code',
    })
  assert.equal(setup.status, 200)
  const adminCsrf = setup.body.csrfToken

  // Create multi-select (partial credit), true/false, short answer (auto), theory (rubric), and drawing (rubric)
  const msRes = await client.post('/api/questions').set('X-CSRF-Token', adminCsrf).send({
    type: 'multi_select',
    prompt: 'Select prime numbers.',
    options: ['2', '3', '4', '5'],
    correctAnswers: ['2', '3', '5'],
    partialCredit: true,
    points: 3,
    difficulty: 'Easy',
    tags: ['math'],
  })
  assert.equal(msRes.status, 201)
  const msId = msRes.body.question.id

  const tfRes = await client.post('/api/questions').set('X-CSRF-Token', adminCsrf).send({
    type: 'true_false',
    prompt: 'SEB is a desktop kiosk browser.',
    correctAnswer: 'True',
    points: 2,
  })
  assert.equal(tfRes.status, 201)
  const tfId = tfRes.body.question.id

  const saRes = await client.post('/api/questions').set('X-CSRF-Token', adminCsrf).send({
    type: 'short_answer',
    prompt: 'Abbreviation for Safe Exam Browser?',
    acceptedAnswers: ['SEB', 'Safe Exam Browser'],
    points: 2,
  })
  assert.equal(saRes.status, 201)
  const saId = saRes.body.question.id

  const theoryRes = await client.post('/api/questions').set('X-CSRF-Token', adminCsrf).send({
    type: 'theory',
    prompt: 'Explain server-side grading.',
    points: 5,
    rubric: [{ criterion: 'Boundary', points: 5, description: 'Covers client untrustworthiness.' }],
  })
  assert.equal(theoryRes.status, 201)
  const theoryId = theoryRes.body.question.id

  const drawRes = await client.post('/api/questions').set('X-CSRF-Token', adminCsrf).send({
    type: 'drawing',
    prompt: 'Draw the attempt state diagram.',
    points: 4,
    rubric: [{ criterion: 'States', points: 4, description: 'Active and Submitted states.' }],
  })
  assert.equal(drawRes.status, 201)
  const drawId = drawRes.body.question.id

  // Build and publish assessment with all 5 rich questions (max points = 16)
  const menteeRes = await client.post('/api/mentees').set('X-CSRF-Token', adminCsrf).send({
    name: 'Kofi Mensah',
    email: 'kofi@example.test',
  })
  const menteeId = menteeRes.body.mentee.id

  const assessmentRes = await client.post('/api/assessments').set('X-CSRF-Token', adminCsrf).send({
    title: 'Mixed Interactive Exam',
    questionIds: [msId, tfId, saId, theoryId, drawId],
    menteeIds: [menteeId],
  })
  assert.equal(assessmentRes.status, 201)
  const assessmentId = assessmentRes.body.assessment.id

  await client.patch(`/api/assessments/${assessmentId}/status`).set('X-CSRF-Token', adminCsrf).send({ status: 'Published' })

  // Learner view strips answer keys
  const learnerFetch = await client.get(`/api/learner/assessments/${menteeId}`)
  assert.equal(learnerFetch.status, 200)
  const loadedQuestions = learnerFetch.body.assessments[0].questions
  assert.equal(loadedQuestions.length, 5)
  loadedQuestions.forEach((q) => {
    assert.equal(q.correctAnswer, undefined)
    assert.equal(q.correctAnswers, undefined)
    assert.equal(q.acceptedAnswers, undefined)
  })

  // Empty drawing without strokes or altText is rejected
  const invalidSubmit = await client.post(`/api/learner/assessments/${assessmentId}/attempts`).send({
    menteeId,
    answers: {
      [msId]: ['2', '3'],
      [tfId]: 'True',
      [saId]: 'seb',
      [theoryId]: 'Client code can be inspected.',
      [drawId]: { strokes: [], altText: '' },
    },
  })
  assert.equal(invalidSubmit.status, 400)

  // Valid mixed submission: multi_select gets 2/3 pts, tf gets 2/2, sa gets 2/2 -> auto = 6 / 16
  const validSubmit = await client.post(`/api/learner/assessments/${assessmentId}/attempts`).send({
    menteeId,
    answers: {
      [msId]: ['2', '3'],
      [tfId]: 'True',
      [saId]: 'seb',
      [theoryId]: 'Client code is untrusted so grading runs on the server.',
      [drawId]: {
        strokes: [{ color: '#0F5C8C', width: 2, erase: false, points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.7 }] }],
        altText: 'Active transitions to Submitted.',
      },
    },
  })
  assert.equal(validSubmit.status, 201)
  assert.equal(validSubmit.body.attempt.earnedPoints, 6)
  assert.equal(validSubmit.body.attempt.maxPoints, 16)
  assert.equal(validSubmit.body.attempt.needsManualGrading, true)

  // Mentor grades manual theory (4/5) + drawing (3/4) -> total becomes 13 / 16
  const answersRes = await client.get('/api/answers')
  const submitted = answersRes.body.answers.find((a) => a.attemptId === validSubmit.body.attempt.id)
  assert.ok(submitted)
  assert.equal(submitted.items.length, 5)

  const invalidGrade = await client.patch(`/api/answers/${submitted.id}/review`)
    .set('X-CSRF-Token', adminCsrf)
    .send({
      decision: 'Approved',
      feedback: 'Good work',
      itemGrades: [{ questionId: theoryId, earnedPoints: 99 }],
    })
  assert.equal(invalidGrade.status, 400)

  const graded = await client.patch(`/api/answers/${submitted.id}/review`)
    .set('X-CSRF-Token', adminCsrf)
    .send({
      decision: 'Approved',
      feedback: 'Clear reasoning and diagram.',
      itemGrades: [
        { questionId: theoryId, earnedPoints: 4, comment: 'Good boundary explanation.' },
        { questionId: drawId, earnedPoints: 3, comment: 'Add Terminated state next time.' },
      ],
    })
  assert.equal(graded.status, 200)
  assert.equal(graded.body.answer.score, '13 / 16')
  assert.equal(graded.body.answer.earnedPoints, 13)
  assert.equal(graded.body.answer.items.find((i) => i.questionId === drawId).comment, 'Add Terminated state next time.')

  db.close()
})

test('only one concurrent setup request can create the admin account', async () => {
  const db = createDatabase(':memory:')
  const app = createApp({
    db,
    setupCode: 'test-setup-code',
    sessionSecret: 'test-session-secret-long-enough-for-tests',
  })
  const clients = [request.agent(app), request.agent(app)]
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
