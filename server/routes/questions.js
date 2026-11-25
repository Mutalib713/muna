import { questionFromRow } from '../db.js'
import { verifyCsrf } from '../middleware/auth.js'
import { normalizeQuestionInput, validateQuestion } from '../question-utils.js'
import { pagination } from '../lib/validation.js'
import { addQuestion } from '../lib/workspaceHelpers.js'

/** Register organisation-scoped question bank routes. */
export function registerQuestionRoutes(router, db) {
  router.get('/questions', (req, res) => {
    const { page, limit, offset } = pagination(req)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const clauses = ['organisation_id = ?']
    const params = [req.org.id]
    if (search) {
      clauses.push('(lower(prompt) LIKE ? OR lower(id) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    const where = `WHERE ${clauses.join(' AND ')}`
    const total = db.prepare(`SELECT COUNT(*) AS count FROM questions ${where}`).get(...params).count
    const rows = db.prepare(`SELECT * FROM questions ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
    res.json({ questions: rows.map(questionFromRow), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } })
  })

  router.post('/questions', verifyCsrf, (req, res) => {
    const validationError = validateQuestion(req.body)
    if (validationError) {
      res.status(400).json({ error: validationError })
      return
    }
    res.status(201).json({ question: addQuestion(db, req.body, req.org.id) })
  })

  router.post('/questions/import', verifyCsrf, (req, res) => {
    const questions = req.body?.questions
    if (!Array.isArray(questions) || questions.length === 0 || questions.length > 500) {
      res.status(400).json({ error: 'Provide between 1 and 500 questions to import.' })
      return
    }
    const invalidIndex = questions.findIndex((question) => validateQuestion(question))
    if (invalidIndex !== -1) {
      res.status(400).json({ error: `Question ${invalidIndex + 1}: ${validateQuestion(questions[invalidIndex])}` })
      return
    }
    const insertQuestions = db.transaction((items) => items.map((item) => addQuestion(db, item, req.org.id)))
    const imported = insertQuestions(questions)
    res.status(201).json({ questions: imported })
  })

  router.patch('/questions/:id', verifyCsrf, (req, res) => {
    const validationError = validateQuestion(req.body)
    if (validationError) {
      res.status(400).json({ error: validationError })
      return
    }
    const existing = db.prepare('SELECT * FROM questions WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
    if (!existing) {
      res.status(404).json({ error: 'Question not found.' })
      return
    }
    const normalized = normalizeQuestionInput(req.body)
    db.prepare(`
      UPDATE questions
      SET type = ?, prompt = ?, options_json = ?, correct_answer = ?,
          points = ?, difficulty = ?, tags_json = ?, config_json = ?, rubric_json = ?,
          status = 'Published'
      WHERE id = ? AND organisation_id = ?
    `).run(
      normalized.type,
      normalized.prompt,
      JSON.stringify(normalized.options),
      normalized.correctAnswer,
      normalized.points,
      normalized.difficulty,
      JSON.stringify(normalized.tags),
      JSON.stringify(normalized.config),
      JSON.stringify(normalized.rubric),
      req.params.id,
      req.org.id,
    )
    const row = db.prepare('SELECT * FROM questions WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
    res.json({ question: questionFromRow(row) })
  })

  router.delete('/questions/:id', verifyCsrf, (req, res) => {
    const existing = db.prepare('SELECT id FROM questions WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
    if (!existing) {
      res.status(404).json({ error: 'Question not found.' })
      return
    }
    const inUse = db.prepare('SELECT COUNT(*) AS count FROM assessment_questions WHERE question_id = ?').get(req.params.id).count
    if (inUse) {
      res.status(409).json({ error: 'This question is used by one or more assessments and cannot be deleted.' })
      return
    }
    db.prepare('DELETE FROM questions WHERE id = ? AND organisation_id = ?').run(req.params.id, req.org.id)
    res.json({ ok: true })
  })
}
