/** Apply additive column, constraint, and tenant-index migrations for existing databases. */
export function runMigrations(db) {
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
  ensureColumn('assessments', 'seb_config_key', 'TEXT')
  ensureColumn('assessments', 'seb_browser_exam_key', 'TEXT')
  ensureColumn('assessment_attempts', 'termination_reason', 'TEXT')
  ensureColumn('flags', 'attempt_id', 'TEXT')
  ensureColumn('flags', 'created_at', 'TEXT')

  // Rebuild assessments if an older SQLite database lacks 'seb' in security_mode CHECK.
  const assessmentsTableSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'assessments'"
  ).get()?.sql || ''
  if (assessmentsTableSql && !assessmentsTableSql.includes("'seb'")) {
    db.pragma('foreign_keys = OFF')
    db.transaction(() => {
      db.exec(`
        CREATE TABLE assessments_new (
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
          security_mode TEXT NOT NULL DEFAULT 'standard' CHECK (security_mode IN ('standard', 'strict_web', 'seb')),
          require_fullscreen INTEGER NOT NULL DEFAULT 0 CHECK (require_fullscreen IN (0, 1)),
          seb_config_key TEXT,
          seb_browser_exam_key TEXT,
          status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Published', 'Paused')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO assessments_new (
          id, organisation_id, title, description, max_attempts, time_limit_minutes,
          available_from, available_until, shuffle_questions, shuffle_options, navigation_mode,
          feedback_policy, results_released, security_mode, require_fullscreen,
          seb_config_key, seb_browser_exam_key, status, created_at, updated_at
        )
        SELECT
          id, organisation_id, title, description, max_attempts, time_limit_minutes,
          available_from, available_until, shuffle_questions, shuffle_options, navigation_mode,
          feedback_policy, results_released, security_mode, require_fullscreen,
          seb_config_key, seb_browser_exam_key, status, created_at, updated_at
        FROM assessments;
        DROP TABLE assessments;
        ALTER TABLE assessments_new RENAME TO assessments;
      `)
    })()
    db.pragma('foreign_keys = ON')
  }

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
}
