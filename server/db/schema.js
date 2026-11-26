/** Create the initial SQLite schema and indexes if they do not exist. */
export function applySchema(db) {
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
      security_mode TEXT NOT NULL DEFAULT 'standard' CHECK (security_mode IN ('standard', 'strict_web', 'seb')),
      require_fullscreen INTEGER NOT NULL DEFAULT 0 CHECK (require_fullscreen IN (0, 1)),
      seb_config_key TEXT,
      seb_browser_exam_key TEXT,
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
}
