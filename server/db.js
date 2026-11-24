import Database from 'better-sqlite3'

function submittedAt(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString()
}

export function createDatabase(filename) {
  const db = new Database(filename)
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  if (filename !== ':memory:') {
    db.pragma('journal_mode = WAL')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      options_json TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Published',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      student TEXT NOT NULL,
      initials TEXT NOT NULL,
      assessment TEXT NOT NULL,
      answer TEXT NOT NULL,
      score TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Needs review',
      review_decision TEXT,
      feedback TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS flags (
      id TEXT PRIMARY KEY,
      student TEXT NOT NULL,
      initials TEXT NOT NULL,
      assessment TEXT NOT NULL,
      signal TEXT NOT NULL,
      detail TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'Needs review',
      review_note TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS review_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('answer', 'flag')),
      entity_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      decision TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS review_history_entity_idx
      ON review_history (entity_type, entity_id, created_at);
    CREATE TABLE IF NOT EXISTS mentees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 3),
      status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Published', 'Paused')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assessment_questions (
      assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES questions(id),
      position INTEGER NOT NULL,
      PRIMARY KEY (assessment_id, question_id)
    );
    CREATE TABLE IF NOT EXISTS assessment_assignments (
      assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      mentee_id TEXT NOT NULL REFERENCES mentees(id),
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (assessment_id, mentee_id)
    );
    CREATE TABLE IF NOT EXISTS assessment_attempts (
      id TEXT PRIMARY KEY,
      assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      mentee_id TEXT NOT NULL REFERENCES mentees(id) ON DELETE CASCADE,
      answers_json TEXT NOT NULL,
      score TEXT NOT NULL,
      submitted_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assessment_attempts_lookup_idx
      ON assessment_attempts (assessment_id, mentee_id, submitted_at);
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires);
  `)

  const seed = db.transaction(() => {
    if (db.prepare('SELECT COUNT(*) AS count FROM questions').get().count === 0) {
      const insert = db.prepare(`
        INSERT INTO questions (id, prompt, options_json, correct_answer, status, created_at)
        VALUES (?, ?, ?, ?, 'Published', ?)
      `)
      const questions = [
        ['Q-104', 'Which process converts sunlight into chemical energy?', ['Respiration', 'Photosynthesis', 'Fermentation', 'Transpiration'], 'Photosynthesis'],
        ['Q-103', 'What is the value of x in 3x + 5 = 20?', ['3', '5', '7', '15'], '5'],
        ['Q-102', 'Which layer of the atmosphere contains the ozone layer?', ['Troposphere', 'Stratosphere', 'Mesosphere', 'Thermosphere'], 'Stratosphere'],
        ['Q-101', 'What is the smallest prime number?', ['0', '1', '2', '3'], '2'],
      ]
      questions.forEach(([id, prompt, options, correctAnswer], index) => {
        insert.run(id, prompt, JSON.stringify(options), correctAnswer, submittedAt(index * 24))
      })
    }

    if (db.prepare('SELECT COUNT(*) AS count FROM answers').get().count === 0) {
      const insert = db.prepare(`
        INSERT INTO answers (id, student, initials, assessment, answer, score, submitted_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const answers = [
        ['A-2381', 'Amara Okafor', 'AO', 'Photosynthesis and energy', 'Photosynthesis', '9 / 10', 0, 'Needs review'],
        ['A-2380', 'Daniel Mensah', 'DM', 'Algebra fundamentals', 'x = 5; I subtracted 5 from both sides, then divided by 3.', '8 / 10', 1, 'Needs review'],
        ['A-2379', 'Sofia Chen', 'SC', 'Photosynthesis and energy', 'Photosynthesis', '10 / 10', 2, 'Reviewed'],
        ['A-2378', 'Kwame Boateng', 'KB', 'Earth science review', 'The stratosphere contains most of the ozone layer.', '7 / 10', 3, 'Needs review'],
        ['A-2377', 'Priya Patel', 'PP', 'Algebra fundamentals', '5', '10 / 10', 4, 'Reviewed'],
      ]
      answers.forEach(([id, student, initials, assessment, answer, score, hoursAgo, status]) => {
        insert.run(id, student, initials, assessment, answer, score, submittedAt(hoursAgo), status)
      })
    }

    if (db.prepare('SELECT COUNT(*) AS count FROM flags').get().count === 0) {
      const insert = db.prepare(`
        INSERT INTO flags (id, student, initials, assessment, signal, detail, level)
        VALUES (?, ?, ?, ?, ?, ?, 'Needs review')
      `)
      const flags = [
        ['F-021', 'Jordan Lee', 'JL', 'Algebra fundamentals', 'Unusually similar answer to another submission', 'Submitted 18 seconds apart'],
        ['F-020', 'Fatima Yusuf', 'FY', 'Earth science review', 'Multiple answers submitted in an unusually short time', '4 answers in 22 seconds'],
        ['F-019', 'Ethan Williams', 'EW', 'Photosynthesis and energy', 'Repeated page focus changes during assessment', '12 focus changes recorded'],
      ]
      flags.forEach((flag) => insert.run(...flag))
    }

    if (db.prepare('SELECT COUNT(*) AS count FROM mentees').get().count === 0) {
      const insert = db.prepare('INSERT INTO mentees (id, name, email) VALUES (?, ?, ?)')
      const mentees = [
        ['M-001', 'Amara Okafor', 'amara@example.com'],
        ['M-002', 'Daniel Mensah', 'daniel@example.com'],
        ['M-003', 'Sofia Chen', 'sofia@example.com'],
        ['M-004', 'Kwame Boateng', 'kwame@example.com'],
        ['M-005', 'Priya Patel', 'priya@example.com'],
      ]
      mentees.forEach((mentee) => insert.run(...mentee))
    }
  })

  seed()
  return db
}

export function questionFromRow(row) {
  return {
    id: row.id,
    prompt: row.prompt,
    options: JSON.parse(row.options_json),
    correctAnswer: row.correct_answer,
    status: row.status,
    createdAt: row.created_at,
  }
}

export function answerFromRow(row) {
  return {
    id: row.id,
    student: row.student,
    initials: row.initials,
    question: row.assessment,
    answer: row.answer,
    score: row.score,
    submitted: row.submitted_at,
    status: row.status,
    reviewDecision: row.review_decision,
    feedback: row.feedback,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
  }
}

export function flagFromRow(row) {
  return {
    id: row.id,
    student: row.student,
    initials: row.initials,
    assessment: row.assessment,
    signal: row.signal,
    detail: row.detail,
    level: row.level,
    reviewNote: row.review_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
  }
}

export function menteeFromRow(row) {
  return { id: row.id, name: row.name, email: row.email }
}

export function assessmentFromRow(db, row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    maxAttempts: row.max_attempts,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    questionIds: db.prepare(`
      SELECT question_id FROM assessment_questions
      WHERE assessment_id = ? ORDER BY position
    `).all(row.id).map((question) => question.question_id),
    menteeIds: db.prepare(`
      SELECT mentee_id FROM assessment_assignments
      WHERE assessment_id = ? ORDER BY assigned_at, mentee_id
    `).all(row.id).map((assignment) => assignment.mentee_id),
  }
}
