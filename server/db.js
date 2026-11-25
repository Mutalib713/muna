import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'

function submittedAt(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString()
}

export function initialsFor(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'MU'
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
      organisation_id TEXT NOT NULL DEFAULT 'ORG-DEFAULT',
      type TEXT NOT NULL DEFAULT 'mcq',
      prompt TEXT NOT NULL,
      options_json TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      points REAL NOT NULL DEFAULT 1,
      difficulty TEXT NOT NULL DEFAULT 'Medium',
      tags_json TEXT NOT NULL DEFAULT '[]',
      config_json TEXT NOT NULL DEFAULT '{}',
      rubric_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'Published',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL DEFAULT 'ORG-DEFAULT',
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
      reviewed_at TEXT,
      attempt_id TEXT,
      items_json TEXT NOT NULL DEFAULT '[]',
      earned_points REAL,
      max_points REAL
    );
    CREATE TABLE IF NOT EXISTS flags (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL DEFAULT 'ORG-DEFAULT',
      student TEXT NOT NULL,
      initials TEXT NOT NULL,
      assessment TEXT NOT NULL,
      signal TEXT NOT NULL,
      detail TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'Needs review',
      review_note TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      attempt_id TEXT,
      created_at TEXT
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
      organisation_id TEXT NOT NULL DEFAULT 'ORG-DEFAULT',
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      UNIQUE (organisation_id, email)
    );
    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL DEFAULT 'ORG-DEFAULT',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 3),
      time_limit_minutes INTEGER,
      available_from TEXT,
      available_until TEXT,
      shuffle_questions INTEGER NOT NULL DEFAULT 0 CHECK (shuffle_questions IN (0, 1)),
      shuffle_options INTEGER NOT NULL DEFAULT 0 CHECK (shuffle_options IN (0, 1)),
      navigation_mode TEXT NOT NULL DEFAULT 'free' CHECK (navigation_mode IN ('free', 'sequential')),
      feedback_policy TEXT NOT NULL DEFAULT 'immediate' CHECK (feedback_policy IN ('immediate', 'after_deadline', 'manual')),
      results_released INTEGER NOT NULL DEFAULT 0 CHECK (results_released IN (0, 1)),
      security_mode TEXT NOT NULL DEFAULT 'standard' CHECK (security_mode IN ('standard', 'strict_web')),
      require_fullscreen INTEGER NOT NULL DEFAULT 0 CHECK (require_fullscreen IN (0, 1)),
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
      grading_status TEXT NOT NULL DEFAULT 'Graded',
      earned_points REAL NOT NULL DEFAULT 0,
      max_points REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('in_progress', 'submitted', 'expired', 'terminated_focus_lost')),
      termination_reason TEXT,
      started_at TEXT,
      expires_at TEXT,
      draft_answers_json TEXT NOT NULL DEFAULT '{}',
      question_order_json TEXT NOT NULL DEFAULT '[]',
      option_orders_json TEXT NOT NULL DEFAULT '{}',
      last_saved_at TEXT,
      submitted_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assessment_attempts_lookup_idx
      ON assessment_attempts (assessment_id, mentee_id, submitted_at);
    CREATE TABLE IF NOT EXISTS security_events (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
      assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      mentee_id TEXT NOT NULL REFERENCES mentees(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK (event_type IN (
        'fullscreen_entered',
        'fullscreen_exited',
        'visibility_hidden',
        'visibility_visible',
        'window_blur',
        'window_focus'
      )),
      detail TEXT NOT NULL DEFAULT '',
      client_timestamp TEXT,
      server_timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS security_events_attempt_idx
      ON security_events (attempt_id, server_timestamp);
    CREATE INDEX IF NOT EXISTS security_events_mentee_idx
      ON security_events (mentee_id, server_timestamp);
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL DEFAULT 'ORG-DEFAULT',
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_logs_created_idx
      ON audit_logs (created_at);
    CREATE TABLE IF NOT EXISTS extra_attempt_grants (
      id TEXT PRIMARY KEY,
      assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      mentee_id TEXT NOT NULL REFERENCES mentees(id) ON DELETE CASCADE,
      extra_attempts INTEGER NOT NULL DEFAULT 1 CHECK (extra_attempts BETWEEN 1 AND 5),
      reason TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS extra_attempt_grants_lookup_idx
      ON extra_attempt_grants (assessment_id, mentee_id, created_at);
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires);
    CREATE TABLE IF NOT EXISTS admin_account (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS organisations (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT,
      email_verified_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('Owner', 'Admin', 'Mentor', 'Mentee')),
      status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended')),
      joined_at TEXT NOT NULL,
      UNIQUE (user_id, organisation_id)
    );
    CREATE INDEX IF NOT EXISTS memberships_org_idx
      ON memberships (organisation_id, joined_at);
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('code', 'email')),
      email TEXT,
      role TEXT NOT NULL CHECK (role IN ('Admin', 'Mentor', 'Mentee')),
      token_hash TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 100),
      uses INTEGER NOT NULL DEFAULT 0,
      revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1))
    );
    CREATE INDEX IF NOT EXISTS invitations_org_idx
      ON invitations (organisation_id, created_at);
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS email_verification_user_idx
      ON email_verification_tokens (user_id);
  `)

  function ensureColumn(table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all()
    if (!columns.some((col) => col.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  ensureColumn('questions', 'organisation_id', "TEXT NOT NULL DEFAULT 'ORG-DEFAULT'")
  ensureColumn('answers', 'organisation_id', "TEXT NOT NULL DEFAULT 'ORG-DEFAULT'")
  ensureColumn('flags', 'organisation_id', "TEXT NOT NULL DEFAULT 'ORG-DEFAULT'")
  ensureColumn('assessments', 'organisation_id', "TEXT NOT NULL DEFAULT 'ORG-DEFAULT'")
  ensureColumn('audit_logs', 'organisation_id', "TEXT NOT NULL DEFAULT 'ORG-DEFAULT'")
  ensureColumn('questions', 'type', "TEXT NOT NULL DEFAULT 'mcq'")
  ensureColumn('questions', 'points', 'REAL NOT NULL DEFAULT 1')
  ensureColumn('questions', 'difficulty', "TEXT NOT NULL DEFAULT 'Medium'")
  ensureColumn('questions', 'tags_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('questions', 'config_json', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn('questions', 'rubric_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('answers', 'attempt_id', 'TEXT')
  ensureColumn('answers', 'items_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('answers', 'earned_points', 'REAL')
  ensureColumn('answers', 'max_points', 'REAL')
  ensureColumn('assessment_attempts', 'grading_status', "TEXT NOT NULL DEFAULT 'Graded'")
  ensureColumn('assessment_attempts', 'earned_points', 'REAL NOT NULL DEFAULT 0')
  ensureColumn('assessment_attempts', 'max_points', 'REAL NOT NULL DEFAULT 0')
  ensureColumn('assessment_attempts', 'status', "TEXT NOT NULL DEFAULT 'submitted'")
  ensureColumn('assessment_attempts', 'started_at', 'TEXT')
  ensureColumn('assessment_attempts', 'expires_at', 'TEXT')
  ensureColumn('assessment_attempts', 'draft_answers_json', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn('assessment_attempts', 'question_order_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('assessment_attempts', 'option_orders_json', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn('assessment_attempts', 'last_saved_at', 'TEXT')
  ensureColumn('assessments', 'time_limit_minutes', 'INTEGER')
  ensureColumn('assessments', 'available_from', 'TEXT')
  ensureColumn('assessments', 'available_until', 'TEXT')
  ensureColumn('assessments', 'shuffle_questions', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('assessments', 'shuffle_options', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('assessments', 'navigation_mode', "TEXT NOT NULL DEFAULT 'free'")
  ensureColumn('assessments', 'feedback_policy', "TEXT NOT NULL DEFAULT 'immediate'")
  ensureColumn('assessments', 'results_released', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('assessments', 'security_mode', "TEXT NOT NULL DEFAULT 'standard'")
  ensureColumn('assessments', 'require_fullscreen', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('assessment_attempts', 'termination_reason', 'TEXT')
  ensureColumn('flags', 'attempt_id', 'TEXT')
  ensureColumn('flags', 'created_at', 'TEXT')

  // Rebuild assessment_attempts if an older SQLite database lacks 'terminated_focus_lost' in status CHECK.
  const attemptsTableSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'assessment_attempts'"
  ).get()?.sql || ''
  if (attemptsTableSql && !attemptsTableSql.includes('terminated_focus_lost')) {
    db.pragma('foreign_keys = OFF')
    db.transaction(() => {
      db.exec(`
        CREATE TABLE assessment_attempts_new (
          id TEXT PRIMARY KEY,
          assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
          mentee_id TEXT NOT NULL REFERENCES mentees(id) ON DELETE CASCADE,
          answers_json TEXT NOT NULL,
          score TEXT NOT NULL,
          grading_status TEXT NOT NULL DEFAULT 'Graded',
          earned_points REAL NOT NULL DEFAULT 0,
          max_points REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('in_progress', 'submitted', 'expired', 'terminated_focus_lost')),
          termination_reason TEXT,
          started_at TEXT,
          expires_at TEXT,
          draft_answers_json TEXT NOT NULL DEFAULT '{}',
          question_order_json TEXT NOT NULL DEFAULT '[]',
          option_orders_json TEXT NOT NULL DEFAULT '{}',
          last_saved_at TEXT,
          submitted_at TEXT NOT NULL
        );
        INSERT INTO assessment_attempts_new (
          id, assessment_id, mentee_id, answers_json, score, grading_status, earned_points, max_points,
          status, termination_reason, started_at, expires_at, draft_answers_json, question_order_json,
          option_orders_json, last_saved_at, submitted_at
        )
        SELECT
          id, assessment_id, mentee_id, answers_json, score, grading_status, earned_points, max_points,
          status, termination_reason, started_at, expires_at, draft_answers_json, question_order_json,
          option_orders_json, last_saved_at, submitted_at
        FROM assessment_attempts;
        DROP TABLE assessment_attempts;
        ALTER TABLE assessment_attempts_new RENAME TO assessment_attempts;
        CREATE INDEX IF NOT EXISTS assessment_attempts_lookup_idx
          ON assessment_attempts (assessment_id, mentee_id, submitted_at);
      `)
    })()
    db.pragma('foreign_keys = ON')
  }

  const menteesTableSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mentees'"
  ).get()?.sql || ''
  if (menteesTableSql && !menteesTableSql.includes('organisation_id')) {
    db.pragma('foreign_keys = OFF')
    db.transaction(() => {
      db.exec(`
        CREATE TABLE mentees_new (
          id TEXT PRIMARY KEY,
          organisation_id TEXT NOT NULL DEFAULT 'ORG-DEFAULT',
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          UNIQUE (organisation_id, email)
        );
        INSERT INTO mentees_new (id, organisation_id, name, email)
        SELECT id, 'ORG-DEFAULT', name, email FROM mentees;
        DROP TABLE mentees;
        ALTER TABLE mentees_new RENAME TO mentees;
      `)
    })()
    db.pragma('foreign_keys = ON')
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS questions_org_idx ON questions (organisation_id, created_at);
    CREATE INDEX IF NOT EXISTS answers_org_idx ON answers (organisation_id, submitted_at);
    CREATE INDEX IF NOT EXISTS flags_org_idx ON flags (organisation_id, id);
    CREATE INDEX IF NOT EXISTS assessments_org_idx ON assessments (organisation_id, created_at);
    CREATE INDEX IF NOT EXISTS audit_logs_org_idx ON audit_logs (organisation_id, created_at);
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

function parseJson(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export function questionFromRow(row) {
  const config = parseJson(row.config_json, {})
  return {
    id: row.id,
    organisationId: row.organisation_id || 'ORG-DEFAULT',
    type: row.type || 'mcq',
    prompt: row.prompt,
    options: parseJson(row.options_json, []),
    correctAnswer: row.correct_answer,
    correctAnswers: Array.isArray(config.correctAnswers) ? config.correctAnswers : [],
    partialCredit: Boolean(config.partialCredit),
    acceptedAnswers: Array.isArray(config.acceptedAnswers) ? config.acceptedAnswers : [],
    instructions: typeof config.instructions === 'string' ? config.instructions : '',
    points: Number(row.points ?? 1),
    difficulty: row.difficulty || 'Medium',
    tags: parseJson(row.tags_json, []),
    rubric: parseJson(row.rubric_json, []),
    status: row.status,
    createdAt: row.created_at,
  }
}

export function answerFromRow(row) {
  return {
    id: row.id,
    organisationId: row.organisation_id || 'ORG-DEFAULT',
    attemptId: row.attempt_id || null,
    student: row.student,
    initials: row.initials,
    question: row.assessment,
    answer: row.answer,
    score: row.score,
    earnedPoints: row.earned_points ?? null,
    maxPoints: row.max_points ?? null,
    items: parseJson(row.items_json, []),
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
    organisationId: row.organisation_id || 'ORG-DEFAULT',
    attemptId: row.attempt_id || null,
    student: row.student,
    initials: row.initials,
    assessment: row.assessment,
    signal: row.signal,
    detail: row.detail,
    level: row.level,
    reviewNote: row.review_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at || null,
  }
}

export function securityEventFromRow(row) {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    assessmentId: row.assessment_id,
    menteeId: row.mentee_id,
    eventType: row.event_type,
    detail: row.detail,
    clientTimestamp: row.client_timestamp || null,
    serverTimestamp: row.server_timestamp,
  }
}

export function auditLogFromRow(row) {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    detail: parseJson(row.detail_json, {}),
    createdAt: row.created_at,
  }
}

export function menteeFromRow(row) {
  return {
    id: row.id,
    organisationId: row.organisation_id || 'ORG-DEFAULT',
    name: row.name,
    email: row.email,
  }
}

export function slugifyOrgName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workspace'
}

export function uniqueSlugForOrg(db, name) {
  const base = slugifyOrgName(name)
  let candidate = base
  let suffix = 2
  while (db.prepare('SELECT 1 FROM organisations WHERE slug = ?').get(candidate)) {
    candidate = `${base}-${suffix}`
    suffix++
  }
  return candidate
}

export function assessmentFromRow(db, row) {
  const grants = db.prepare(`
    SELECT id, mentee_id AS menteeId, extra_attempts AS extraAttempts, reason, granted_by AS grantedBy, created_at AS createdAt
    FROM extra_attempt_grants
    WHERE assessment_id = ?
    ORDER BY created_at DESC
  `).all(row.id)
  return {
    id: row.id,
    organisationId: row.organisation_id || 'ORG-DEFAULT',
    title: row.title,
    description: row.description,
    maxAttempts: row.max_attempts,
    timeLimitMinutes: row.time_limit_minutes ?? null,
    availableFrom: row.available_from || null,
    availableUntil: row.available_until || null,
    shuffleQuestions: Boolean(row.shuffle_questions),
    shuffleOptions: Boolean(row.shuffle_options),
    navigationMode: row.navigation_mode || 'free',
    feedbackPolicy: row.feedback_policy || 'immediate',
    resultsReleased: Boolean(row.results_released),
    securityMode: row.security_mode || 'standard',
    requireFullscreen: Boolean(row.require_fullscreen),
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
    extraAttemptGrants: grants,
  }
}

export function memberFromRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    organisationId: row.organisation_id,
    name: row.name,
    initials: initialsFor(row.name),
    email: row.email,
    role: row.role,
    status: row.status,
    joined: row.joined_at,
    joinedAt: row.joined_at,
  }
}

export function getInvitationState(row) {
  if (row.revoked) return 'Revoked'
  if (new Date(row.expires_at ?? row.expires).getTime() <= Date.now()) return 'Expired'
  if (row.uses >= row.max_uses) return 'Exhausted'
  return 'Active'
}

export function invitationFromRow(row) {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    type: row.type,
    email: row.email,
    role: row.role,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    uses: row.uses,
    revoked: Boolean(row.revoked),
    state: getInvitationState(row),
  }
}

export function ensureWorkspaceBootstrap(db, {
  adminEmail,
  adminName = 'Administrator',
  passwordHash = null,
  orgName = 'Muna Workspace',
  orgSlug = 'muna-workspace',
} = {}) {
  return db.transaction(() => {
    const now = new Date().toISOString()
    let organisation = db.prepare('SELECT * FROM organisations ORDER BY created_at ASC LIMIT 1').get()
    if (!organisation) {
      const orgId = 'ORG-DEFAULT'
      db.prepare(`
        INSERT INTO organisations (id, slug, name, created_at)
        VALUES (?, ?, ?, ?)
      `).run(orgId, orgSlug, orgName, now)
      organisation = db.prepare('SELECT * FROM organisations WHERE id = ?').get(orgId)
    }

    const storedAdmin = !adminEmail
      ? db.prepare('SELECT name, email, password_hash FROM admin_account WHERE id = 1').get()
      : null
    const email = String(adminEmail || storedAdmin?.email || '').trim().toLowerCase()
    const name = String(adminName || storedAdmin?.name || 'Administrator').trim() || 'Administrator'
    const resolvedHash = passwordHash || storedAdmin?.password_hash || null

    if (!email) {
      return { organisation, ownerUser: null, ownerMembership: null }
    }

    let ownerUser = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email)
    if (!ownerUser) {
      const userId = `U-${randomUUID().slice(0, 8).toUpperCase()}`
      db.prepare(`
        INSERT INTO users (id, email, name, password_hash, email_verified_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, email, name, resolvedHash, now, now)
      ownerUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    } else if (!ownerUser.password_hash && resolvedHash) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(resolvedHash, ownerUser.id)
      ownerUser = db.prepare('SELECT * FROM users WHERE id = ?').get(ownerUser.id)
    }

    let ownerMembership = db.prepare(`
      SELECT * FROM memberships WHERE user_id = ? AND organisation_id = ?
    `).get(ownerUser.id, organisation.id)
    if (!ownerMembership) {
      const membershipId = `MEM-${randomUUID().slice(0, 8).toUpperCase()}`
      db.prepare(`
        INSERT INTO memberships (id, user_id, organisation_id, role, status, joined_at)
        VALUES (?, ?, ?, 'Owner', 'Active', ?)
      `).run(membershipId, ownerUser.id, organisation.id, now)
      ownerMembership = db.prepare('SELECT * FROM memberships WHERE id = ?').get(membershipId)
    }

    return { organisation, ownerUser, ownerMembership }
  })()
}
