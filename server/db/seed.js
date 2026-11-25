function submittedAt(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString()
}

/** Seed initial sample records on an empty workspace database. */
export function seedDefaultData(db) {
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
}
