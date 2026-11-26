import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootstrapAdmin, createTestContext } from './helpers.js'

test('rich question types, rubrics, vector drawings, and manual grading work end-to-end', async () => {
  const { db, agent } = createTestContext()
  const client = agent()
  const setup = await bootstrapAdmin(client)
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

test('assessment delivery rules: availability windows, start/resume idempotency, autosave, expiry, feedback policy, and extra attempts', async () => {
  const { db, agent } = createTestContext()
  const client = agent()
  const setup = await bootstrapAdmin(client)
  const adminCsrf = setup.body.csrfToken

  const q1 = (await client.post('/api/questions').set('X-CSRF-Token', adminCsrf).send({
    prompt: 'Capital of Ghana?',
    options: ['Accra', 'Kumasi'],
    correctAnswer: 'Accra',
    points: 2,
  })).body.question
  const q2 = (await client.post('/api/questions').set('X-CSRF-Token', adminCsrf).send({
    prompt: '2 + 3 = ?',
    options: ['4', '5'],
    correctAnswer: '5',
    points: 3,
  })).body.question
  const mentee = (await client.post('/api/mentees').set('X-CSRF-Token', adminCsrf).send({
    name: 'Nadia Mensah',
    email: 'nadia@example.test',
  })).body.mentee

  const missingDeadline = await client.post('/api/assessments').set('X-CSRF-Token', adminCsrf).send({
    title: 'Bad feedback rule',
    questionIds: [q1.id],
    menteeIds: [mentee.id],
    feedbackPolicy: 'after_deadline',
  })
  assert.equal(missingDeadline.status, 400)

  const futureStart = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const futureEnd = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  const upcoming = (await client.post('/api/assessments').set('X-CSRF-Token', adminCsrf).send({
    title: 'Upcoming Quiz',
    questionIds: [q1.id],
    menteeIds: [mentee.id],
    availableFrom: futureStart,
    availableUntil: futureEnd,
  })).body.assessment
  await client.patch(`/api/assessments/${upcoming.id}/status`).set('X-CSRF-Token', adminCsrf).send({ status: 'Published' })
  const earlyStart = await client.post(`/api/learner/assessments/${upcoming.id}/start`).send({ menteeId: mentee.id })
  assert.equal(earlyStart.status, 403)

  const openRes = await client.post('/api/assessments').set('X-CSRF-Token', adminCsrf).send({
    title: 'Timed Midterm',
    questionIds: [q1.id, q2.id],
    menteeIds: [mentee.id],
    maxAttempts: 1,
    timeLimitMinutes: 15,
    shuffleQuestions: true,
    shuffleOptions: true,
    navigationMode: 'sequential',
    feedbackPolicy: 'manual',
  })
  assert.equal(openRes.status, 201)
  const openId = openRes.body.assessment.id
  await client.patch(`/api/assessments/${openId}/status`).set('X-CSRF-Token', adminCsrf).send({ status: 'Published' })

  const start1 = await client.post(`/api/learner/assessments/${openId}/start`).send({ menteeId: mentee.id })
  assert.equal(start1.status, 201)
  assert.equal(start1.body.resumed, false)
  assert.ok(start1.body.attempt.expiresAt)

  const start2 = await client.post(`/api/learner/assessments/${openId}/start`).send({ menteeId: mentee.id })
  assert.equal(start2.status, 200)
  assert.equal(start2.body.resumed, true)
  assert.equal(start2.body.attempt.id, start1.body.attempt.id)

  const autosave = await client.put(`/api/learner/attempts/${start1.body.attempt.id}/responses`)
    .send({ menteeId: mentee.id, answers: { [q1.id]: 'Accra' } })
  assert.equal(autosave.status, 200)
  assert.ok(autosave.body.lastSavedAt)

  const learnerView = await client.get(`/api/learner/assessments/${mentee.id}`)
  const openView = learnerView.body.assessments.find((a) => a.id === openId)
  assert.equal(openView.attemptCount, 1)
  assert.deepEqual(openView.activeAttempt.draftAnswers, { [q1.id]: 'Accra' })

  const submit1 = await client.post(`/api/learner/assessments/${openId}/attempts`).send({
    menteeId: mentee.id,
    attemptId: start1.body.attempt.id,
    answers: { [q1.id]: 'Accra', [q2.id]: '5' },
  })
  assert.equal(submit1.status, 201)
  assert.equal(submit1.body.attempt.resultsVisible, false)
  assert.equal(submit1.body.attempt.score, null)

  const blockedStart = await client.post(`/api/learner/assessments/${openId}/start`).send({ menteeId: mentee.id })
  assert.equal(blockedStart.status, 409)

  const missingReason = await client.post(`/api/assessments/${openId}/extra-attempts`)
    .set('X-CSRF-Token', adminCsrf)
    .send({ menteeId: mentee.id, extraAttempts: 1, reason: '' })
  assert.equal(missingReason.status, 400)

  const granted = await client.post(`/api/assessments/${openId}/extra-attempts`)
    .set('X-CSRF-Token', adminCsrf)
    .send({ menteeId: mentee.id, extraAttempts: 1, reason: 'Browser crashed during review' })
  assert.equal(granted.status, 201)
  assert.equal(granted.body.assessment.extraAttemptGrants.length, 1)

  const released = await client.post(`/api/assessments/${openId}/release-results`)
    .set('X-CSRF-Token', adminCsrf)
  assert.equal(released.status, 200)
  assert.equal(released.body.assessment.resultsReleased, true)

  const learnerAfterRelease = await client.get(`/api/learner/assessments/${mentee.id}`)
  const releasedView = learnerAfterRelease.body.assessments.find((a) => a.id === openId)
  assert.equal(releasedView.maxAttempts, 2)
  assert.equal(releasedView.latestSubmission.resultsVisible, true)
  assert.equal(releasedView.latestSubmission.score, '5 / 5')

  const startSecond = await client.post(`/api/learner/assessments/${openId}/start`).send({ menteeId: mentee.id })
  assert.equal(startSecond.status, 201)
  await client.put(`/api/learner/attempts/${startSecond.body.attempt.id}/responses`)
    .send({ menteeId: mentee.id, answers: { [q1.id]: 'Accra' } })
  db.prepare('UPDATE assessment_attempts SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', startSecond.body.attempt.id)

  const lateAutosave = await client.put(`/api/learner/attempts/${startSecond.body.attempt.id}/responses`)
    .send({ menteeId: mentee.id, answers: { [q1.id]: 'Accra', [q2.id]: '5' } })
  assert.equal(lateAutosave.status, 409)
  assert.equal(lateAutosave.body.expired, true)
  assert.equal(lateAutosave.body.attempt.score, '2 / 5')

  db.close()
})
