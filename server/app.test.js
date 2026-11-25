import assert from 'node:assert/strict'
import { test } from 'node:test'
import bcrypt from 'bcryptjs'
import request from 'supertest'
import { createApp } from './app.js'
import { createDatabase } from './db.js'

test('admin APIs require a session and persist questions, assessments, and review decisions', async () => {
  const db = createDatabase(':memory:')
  const passwordHash = await bcrypt.hash('test-admin-password-2026', 4)
  const app = createApp({
    db,
    adminEmail: 'admin@example.test',
    passwordHash,
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

  const csrfRejected = await client.post('/api/auth/login').send({ email: 'admin@example.test', password: 'test-admin-password-2026' })
  assert.equal(csrfRejected.status, 403)

  const badLogin = await client.post('/api/auth/login')
    .set('X-CSRF-Token', anonymousCsrf)
    .send({ email: 'wrong@example.test', password: 'test-admin-password-2026' })
  assert.equal(badLogin.status, 401)

  const login = await client.post('/api/auth/login')
    .set('X-CSRF-Token', anonymousCsrf)
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

  const assessment = await client.post('/api/assessments')
    .set('X-CSRF-Token', csrfToken)
    .send({ title: 'Algebra check-in', questionIds: ['Q-104'], menteeIds: ['M-001'] })
  assert.equal(mentees.body.mentees.length, 0)

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
  assert.deepEqual(assessment.body.assessment.menteeIds, ['M-001'])

  const invalidAttemptLimit = await client.post('/api/assessments')
    .set('X-CSRF-Token', csrfToken)
    .send({ title: 'Invalid assessment', questionIds: ['Q-104'], menteeIds: ['M-001'], maxAttempts: 4 })
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

  const review = await client.patch('/api/answers/A-2381/review')
  const submissions = await client.get('/api/answers')
  assert.equal(submissions.status, 200)
  assert.equal(submissions.body.answers.length, 1)
  const submissionId = submissions.body.answers[0].id

  const review = await client.patch(`/api/answers/${submissionId}/review`)
    .set('X-CSRF-Token', csrfToken)
    .send({ decision: 'Revision requested', feedback: 'Please show your working.' })
  assert.equal(review.status, 200)
  assert.equal(review.body.answer.reviewDecision, 'Revision requested')
  assert.equal(review.body.answer.reviewHistory.length, 1)
  const persistedAnswer = await client.get('/api/answers')
  assert.equal(persistedAnswer.body.answers.find((answer) => answer.id === 'A-2381').feedback, 'Please show your working.')

  const flagReview = await client.patch('/api/flags/F-021/review')
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
