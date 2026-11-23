import { useState, useRef, useEffect } from 'react'
import {
  PenTool,
  Eraser,
  RotateCcw,
  ShieldCheck,
  Eye,
  CheckCircle2,
  Clock,
  ArrowRight,
  Users,
  Award,
  Layers,
  HelpCircle,
  FileText,
  Lock
} from './icons.jsx'
import './App.css'

export default function App() {
  const [activeTab, setActiveTab] = useState('canvas')
  const [joinCode, setJoinCode] = useState('')
  const [joinStatus, setJoinStatus] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalType, setModalType] = useState('join') // 'join' | 'mentor'

  // Canvas interactive state
  const canvasRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [penColor, setPenColor] = useState('#0F5C8C')
  const [lineWidth, setLineWidth] = useState(3)
  const [isEraser, setIsEraser] = useState(false)
  const [strokeCount, setStrokeCount] = useState(0)

  // Question state
  const [theoryText, setTheoryText] = useState('')
  const [selectedMcq, setSelectedMcq] = useState([])
  const [shortAnswer, setShortAnswer] = useState('')
  const [tfSelection, setTfSelection] = useState(null)

  // Setup drawing context
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // Set display resolution to match bounding box
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * 2
    canvas.height = rect.height * 2
    ctx.scale(2, 2)
    ctx.strokeStyle = isEraser ? '#FFFFFF' : penColor
    ctx.lineWidth = isEraser ? 16 : lineWidth
  }, [activeTab, penColor, lineWidth, isEraser])

  const startDrawing = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    const clientX = e.clientX || (e.touches && e.touches[0].clientX)
    const clientY = e.clientY || (e.touches && e.touches[0].clientY)

    const x = clientX - rect.left
    const y = clientY - rect.top

    ctx.beginPath()
    ctx.moveTo(x, y)
    setIsDrawing(true)
  }

  const draw = (e) => {
    if (!isDrawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    const clientX = e.clientX || (e.touches && e.touches[0].clientX)
    const clientY = e.clientY || (e.touches && e.touches[0].clientY)

    const x = clientX - rect.left
    const y = clientY - rect.top

    ctx.strokeStyle = isEraser ? '#FFFFFF' : penColor
    ctx.lineWidth = isEraser ? 16 : lineWidth
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false)
      setStrokeCount((prev) => prev + 1)
    }
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setStrokeCount(0)
  }

  const handleJoinSubmit = (e) => {
    e.preventDefault()
    if (!joinCode.trim()) return

    // Simulate verification
    if (joinCode.toUpperCase().includes('MUNA') || joinCode.toUpperCase().includes('BRIGHT')) {
      setJoinStatus({
        valid: true,
        orgName: 'Bright Minds Academy',
        slug: 'bright-minds',
        assessments: 3
      })
    } else {
      setJoinStatus({
        valid: false,
        message: 'Invalid or expired invitation code. Please verify with your mentor.'
      })
    }
  }

  const toggleMcq = (id) => {
    setSelectedMcq((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  return (
    <div className="app-container">
      {/* Top Navigation */}
      <header className="navbar">
        <div className="content-wrap nav-content">
          <div className="brand-group">
            <div className="brand-icon-box">
              <ShieldCheck size={22} />
            </div>
            <div>
              <div className="brand-title">MUNA</div>
              <div className="brand-tag">Assessment Platform</div>
            </div>
          </div>

          <nav className="nav-links">
            <a href="#features" className="nav-link">Features</a>
            <a href="#studio" className="nav-link">Question Studio</a>
            <a href="#security" className="nav-link">Security Model</a>
            <a href="#workspaces" className="nav-link">Workspaces</a>
          </nav>

          <div className="nav-actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setModalType('join')
                setIsModalOpen(true)
              }}
            >
              Enter Code
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setModalType('mentor')
                setIsModalOpen(true)
              }}
            >
              Mentor Portal
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero-section">
        <div className="content-wrap">
          <div className="hero-pill">
            <span className="pill-dot"></span>
            Muna 1.0 · Research-Backed Exam Delivery
          </div>

          <h1 className="hero-title">
            Expressive assessments for mentors.{' '}
            <span className="hero-highlight">Enforceable security</span> on the web.
          </h1>

          <p className="hero-sub">
            Move past conventional text-only quizzes. Muna enables mentors to evaluate real understanding 
            using freehand drawing canvases, long-form rubric theory, and structured questions—backed 
            by server-enforced attempt rules and honest browser visibility tracking.
          </p>

          <div className="hero-cta-group">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => {
                setModalType('mentor')
                setIsModalOpen(true)
              }}
            >
              Create Organisation Workspace <ArrowRight size={18} />
            </button>
            <a href="#studio" className="btn btn-outline btn-lg">
              Explore Interactive Types
            </a>
          </div>

          {/* Trust Strip */}
          <div className="trust-bar">
            <div className="trust-item">
              <Clock size={18} />
              <span>3 Attempts by Default</span>
            </div>
            <div className="trust-item">
              <CheckCircle2 size={18} />
              <span>Real-Time Autosave</span>
            </div>
            <div className="trust-item">
              <Eye size={18} />
              <span>Page Visibility Auditing</span>
            </div>
            <div className="trust-item">
              <Lock size={18} />
              <span>Safe Exam Browser Ready</span>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Question Studio Showcase */}
      <section id="studio" className="showcase-section">
        <div className="content-wrap">
          <div className="section-header">
            <div className="section-badge">Live Interactive Preview</div>
            <h2 className="section-title">The First-Class Question Studio</h2>
            <p className="section-desc">
              Test Muna's core response types below. Every response format is natively rendered, 
              autosaved continuously, and tied to server-side rubrics.
            </p>
          </div>

          <div className="studio-card">
            {/* Studio Navigation Tabs */}
            <div className="studio-tabs">
              <button
                type="button"
                className={`studio-tab ${activeTab === 'canvas' ? 'active' : ''}`}
                onClick={() => setActiveTab('canvas')}
              >
                <PenTool size={16} /> Freehand Drawing
              </button>
              <button
                type="button"
                className={`studio-tab ${activeTab === 'theory' ? 'active' : ''}`}
                onClick={() => setActiveTab('theory')}
              >
                <FileText size={16} /> Theory & Rubric
              </button>
              <button
                type="button"
                className={`studio-tab ${activeTab === 'mcq' ? 'active' : ''}`}
                onClick={() => setActiveTab('mcq')}
              >
                <CheckCircle2 size={16} /> Multi-Select & MCQ
              </button>
              <button
                type="button"
                className={`studio-tab ${activeTab === 'short' ? 'active' : ''}`}
                onClick={() => setActiveTab('short')}
              >
                <HelpCircle size={16} /> Short Answer
              </button>
              <button
                type="button"
                className={`studio-tab ${activeTab === 'tf' ? 'active' : ''}`}
                onClick={() => setActiveTab('tf')}
              >
                <CheckCircle2 size={16} /> True / False
              </button>
            </div>

            {/* Studio Tab Content */}
            <div className="studio-panel">
              {/* TAB 1: CANVAS */}
              {activeTab === 'canvas' && (
                <div>
                  <div className="studio-meta-bar">
                    <div>
                      <div className="q-points-badge">Question 1 · 15 Points · Drawing Response</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                        Vector strokes captured: <strong>{strokeCount}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="q-prompt">
                    Draw an architectural state machine diagram showing an assessment attempt moving from 
                    <strong> Active</strong> to <strong> Submitted</strong> or <strong> Terminated</strong>.
                  </div>

                  <div className="canvas-wrapper">
                    <div className="canvas-toolbar">
                      <div className="tool-group">
                        <button
                          type="button"
                          className={`tool-btn ${!isEraser && penColor === '#0F5C8C' ? 'active' : ''}`}
                          onClick={() => {
                            setIsEraser(false)
                            setPenColor('#0F5C8C')
                          }}
                        >
                          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#0F5C8C' }}></span> Blue Pen
                        </button>
                        <button
                          type="button"
                          className={`tool-btn ${!isEraser && penColor === '#D2601A' ? 'active' : ''}`}
                          onClick={() => {
                            setIsEraser(false)
                            setPenColor('#D2601A')
                          }}
                        >
                          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#D2601A' }}></span> Accent Pen
                        </button>
                        <button
                          type="button"
                          className={`tool-btn ${isEraser ? 'active' : ''}`}
                          onClick={() => setIsEraser(true)}
                        >
                          <Eraser size={14} /> Eraser
                        </button>
                      </div>

                      <div className="tool-group">
                        <button
                          type="button"
                          className={`tool-btn ${!isEraser && lineWidth === 2 ? 'active' : ''}`}
                          onClick={() => {
                            setIsEraser(false)
                            setLineWidth(2)
                          }}
                        >
                          Fine
                        </button>
                        <button
                          type="button"
                          className={`tool-btn ${!isEraser && lineWidth === 4 ? 'active' : ''}`}
                          onClick={() => {
                            setIsEraser(false)
                            setLineWidth(4)
                          }}
                        >
                          Medium
                        </button>
                      </div>

                      <div className="tool-group">
                        <button type="button" className="tool-btn" onClick={clearCanvas}>
                          <RotateCcw size={14} /> Clear Canvas
                        </button>
                      </div>
                    </div>

                    <canvas
                      ref={canvasRef}
                      className="canvas-area"
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                    />

                    <div className="canvas-hint">
                      <span>Draw on the canvas above using touch or mouse.</span>
                      <span>Muna records strokes as vector data for mentor annotations.</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: THEORY */}
              {activeTab === 'theory' && (
                <div>
                  <div className="studio-meta-bar">
                    <div className="q-points-badge">Question 2 · 20 Points · Long-Form Theory</div>
                    <span style={{ fontSize: '12px', color: 'var(--support)', fontWeight: 600 }}>
                      ● Continuous Autosave Active
                    </span>
                  </div>

                  <div className="q-prompt">
                    Explain why client-side deterrents (such as disabling right-click or DevTools blocking) 
                    cannot serve as true security boundaries in a web-based examination platform.
                  </div>

                  <div className="theory-layout">
                    <div>
                      <textarea
                        className="theory-textarea"
                        placeholder="Write your explanation here..."
                        value={theoryText}
                        onChange={(e) => setTheoryText(e.target.value)}
                      />
                      <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--ink-muted)' }}>
                        Word count: {theoryText.trim() ? theoryText.trim().split(/\s+/).length : 0} words
                      </div>
                    </div>

                    <div className="rubric-box">
                      <div className="rubric-title">
                        <Award size={16} /> Mentor Grading Rubric
                      </div>
                      <div className="rubric-item">
                        <strong>Client Memory & Network Access (8 pts)</strong>
                        <span>Explains that code executed in a user's browser is fully inspectable by the user.</span>
                      </div>
                      <div className="rubric-item">
                        <strong>Server-Side Validation Authority (7 pts)</strong>
                        <span>Highlights that all answers, time checks, and limits must be evaluated server-side.</span>
                      </div>
                      <div className="rubric-item">
                        <strong>Clarity & Concrete Examples (5 pts)</strong>
                        <span>Provides clear, reasoned architectural arguments.</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: MCQ */}
              {activeTab === 'mcq' && (
                <div>
                  <div className="studio-meta-bar">
                    <div className="q-points-badge">Question 3 · 10 Points · Multiple Select (Partial Credit)</div>
                  </div>

                  <div className="q-prompt">
                    Which events are reliably captured by the standard W3C Page Visibility API? (Select all that apply)
                  </div>

                  <div className="options-list">
                    {[
                      { id: 'tab', text: 'Switching to another browser tab' },
                      { id: 'min', text: 'Minimizing the browser window' },
                      { id: 'mobile', text: 'Switching applications on a mobile device' },
                      { id: 'eye', text: 'Looking away from the physical webcam' }
                    ].map((opt) => (
                      <div
                        key={opt.id}
                        className={`option-item ${selectedMcq.includes(opt.id) ? 'selected' : ''}`}
                        onClick={() => toggleMcq(opt.id)}
                      >
                        <div className="option-marker">
                          {selectedMcq.includes(opt.id) ? '✓' : ''}
                        </div>
                        <div>{opt.text}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: '16px', fontSize: '13px', color: 'var(--ink2)' }}>
                    Selected: {selectedMcq.length} of 4 options.
                    {selectedMcq.includes('eye') && (
                      <span style={{ color: 'var(--accent2)', marginLeft: '8px' }}>
                        (Note: Webcam eye tracking is outside MVP scope and not handled by Page Visibility).
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: SHORT ANSWER */}
              {activeTab === 'short' && (
                <div>
                  <div className="studio-meta-bar">
                    <div className="q-points-badge">Question 4 · 5 Points · Short Answer Pattern</div>
                  </div>

                  <div className="q-prompt">
                    What dedicated kiosk application is supported by Muna for operating-system-level exam lockdown?
                  </div>

                  <div className="input-with-button">
                    <input
                      type="text"
                      className="clean-input"
                      placeholder="Type your answer here..."
                      value={shortAnswer}
                      onChange={(e) => setShortAnswer(e.target.value)}
                    />
                  </div>

                  {shortAnswer.trim() && (
                    <div style={{ marginTop: '14px', fontSize: '14px' }}>
                      {shortAnswer.toLowerCase().includes('safe exam') || shortAnswer.toLowerCase() === 'seb' ? (
                        <span style={{ color: 'var(--support)', fontWeight: 600 }}>
                          ✓ Exact match recognized: Safe Exam Browser (SEB)
                        </span>
                      ) : (
                        <span style={{ color: 'var(--ink2)' }}>
                          Typing answer... (Pattern evaluator tests alternative aliases like "SEB")
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 5: TRUE / FALSE */}
              {activeTab === 'tf' && (
                <div>
                  <div className="studio-meta-bar">
                    <div className="q-points-badge">Question 5 · 5 Points · True or False</div>
                  </div>

                  <div className="q-prompt">
                    Safe Exam Browser (SEB) operates merely as a standard browser extension and requires no local software installation.
                  </div>

                  <div className="options-list">
                    {[
                      { val: 'true', label: 'True' },
                      { val: 'false', label: 'False (Correct: SEB is a dedicated kiosk desktop software)' }
                    ].map((opt) => (
                      <div
                        key={opt.val}
                        className={`option-item ${tfSelection === opt.val ? 'selected' : ''}`}
                        onClick={() => setTfSelection(opt.val)}
                      >
                        <div className="option-marker">
                          {tfSelection === opt.val ? '✓' : ''}
                        </div>
                        <div>{opt.label}</div>
                      </div>
                    ))}
                  </div>

                  {tfSelection && (
                    <div style={{ marginTop: '14px', fontSize: '14px' }}>
                      {tfSelection === 'false' ? (
                        <span style={{ color: 'var(--support)', fontWeight: 600 }}>
                          ✓ Correct! Safe Exam Browser is an OS-level kiosk software application, not a browser plugin.
                        </span>
                      ) : (
                        <span style={{ color: 'var(--accent2)' }}>
                          Review: Web-only extensions cannot control system shortcuts or display kiosk windows.
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Transparent Security Architecture */}
      <section id="security" className="security-section">
        <div className="content-wrap">
          <div className="section-header">
            <div className="section-badge">PRD Section 8 Standard</div>
            <h2 className="section-title">Layered, Honest Exam Security</h2>
            <p className="section-desc">
              We never market deceptive "cheat-proof" illusions. Muna uses explicit server-side policies 
              and clear browser capability levels.
            </p>
          </div>

          <div className="security-grid">
            <div className="sec-card">
              <div className="sec-icon-box">
                <Eye size={24} />
              </div>
              <h3>Standard Web Mode</h3>
              <p>
                Runs in standard modern web browsers (Chrome, Firefox, Safari, Edge). Monitors visibility 
                lifecycle events without requiring software installation.
              </p>
              <ul className="sec-list">
                <li className="sec-list-item">
                  <CheckCircle2 size={16} />
                  <span>Full-screen request with exit detection</span>
                </li>
                <li className="sec-list-item">
                  <CheckCircle2 size={16} />
                  <span>Document visibilitychange event logged to server</span>
                </li>
                <li className="sec-list-item">
                  <CheckCircle2 size={16} />
                  <span>Strict focus-loss auto-submit policy (configurable)</span>
                </li>
                <li className="sec-list-item">
                  <CheckCircle2 size={16} />
                  <span>Answer keys never shipped to client bundle</span>
                </li>
              </ul>
            </div>

            <div className="sec-card">
              <div className="sec-icon-box">
                <Lock size={24} />
              </div>
              <h3>Safe Exam Browser (SEB)</h3>
              <p>
                For high-stakes examinations. Integrates with Safe Exam Browser to provide real OS-level 
                kiosk restrictions and application blocking.
              </p>
              <ul className="sec-list">
                <li className="sec-list-item">
                  <CheckCircle2 size={16} />
                  <span>Restricts secondary monitors and virtual machines</span>
                </li>
                <li className="sec-list-item">
                  <CheckCircle2 size={16} />
                  <span>Blocks screen recorders, Zoom, Discord, and Telegram</span>
                </li>
                <li className="sec-list-item">
                  <CheckCircle2 size={16} />
                  <span>Encrypted exam configuration verified by server</span>
                </li>
                <li className="sec-list-item">
                  <CheckCircle2 size={16} />
                  <span>Pre-exam device compatibility check</span>
                </li>
              </ul>
            </div>

            <div className="sec-card">
              <div className="sec-icon-box">
                <Layers size={24} />
              </div>
              <h3>Server-Side Attempt Engine</h3>
              <p>
                Integrity is enforced in the database transactions, not in volatile browser memory.
              </p>
              <ul className="sec-list">
                <li className="sec-list-item">
                  <CheckCircle2 size={16} />
                  <span>3 attempts maximum by default (per mentee/assessment)</span>
                </li>
                <li className="sec-list-item">
                  <CheckCircle2 size={16} />
                  <span>Server-authoritative timer (client is display-only)</span>
                </li>
                <li className="sec-list-item">
                  <CheckCircle2 size={16} />
                  <span>Idempotent autosaves protect against internet drops</span>
                </li>
                <li className="sec-list-item">
                  <CheckCircle2 size={16} />
                  <span>Auditable extra attempt grants by verified mentors</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Dual Workspaces (Mentors vs Mentees) */}
      <section id="workspaces" className="roles-section">
        <div className="content-wrap">
          <div className="section-header">
            <div className="section-badge">Role Architecture</div>
            <h2 className="section-title">Built for Mentors and Mentees</h2>
            <p className="section-desc">
              Organisations are isolated multi-tenant workspaces where educators create and learners succeed.
            </p>
          </div>

          <div className="roles-grid">
            <div className="role-card">
              <div className="role-badge">
                <Award size={14} /> For Educators & Mentors
              </div>
              <h3 className="role-title">The Mentor Workspace</h3>
              <p className="role-desc">
                Everything required to build, orchestrate, and evaluate assessments without technical hurdles.
              </p>

              <div className="role-features">
                <div className="role-feature-item">
                  <CheckCircle2 size={18} />
                  <span>Question Bank with topic tags and difficulty tiers</span>
                </div>
                <div className="role-feature-item">
                  <CheckCircle2 size={18} />
                  <span>Manual grading queue with rubric scoring and annotations</span>
                </div>
                <div className="role-feature-item">
                  <CheckCircle2 size={18} />
                  <span>Audit timeline of focus-loss events and submission receipts</span>
                </div>
                <div className="role-feature-item">
                  <CheckCircle2 size={18} />
                  <span>One-click CSV result exports and cohort item analysis</span>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setModalType('mentor')
                  setIsModalOpen(true)
                }}
              >
                Launch Mentor Studio
              </button>
            </div>

            <div className="role-card">
              <div className="role-badge">
                <Users size={14} /> For Students & Mentees
              </div>
              <h3 className="role-title">The Mentee Taking Experience</h3>
              <p className="role-desc">
                A calm, distraction-free environment designed to respect learner effort and accessibility.
              </p>

              <div className="role-features">
                <div className="role-feature-item">
                  <CheckCircle2 size={18} />
                  <span>Pre-exam device readiness check and explicit rules briefing</span>
                </div>
                <div className="role-feature-item">
                  <CheckCircle2 size={18} />
                  <span>Touch and stylus support for drawing calculations & diagrams</span>
                </div>
                <div className="role-feature-item">
                  <CheckCircle2 size={18} />
                  <span>Continuous autosave recovery during unexpected connection drops</span>
                </div>
                <div className="role-feature-item">
                  <CheckCircle2 size={18} />
                  <span>Instant submission receipts with cryptographic timestamp</span>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setModalType('join')
                  setIsModalOpen(true)
                }}
              >
                Join an Organisation
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Join Invitation Code Section */}
      <section className="cta-banner">
        <div className="content-wrap">
          <div className="cta-box">
            <h2>Ready to begin an assessment?</h2>
            <p>
              If your mentor provided an invitation code or organization link, enter it below to access your assigned assessments.
            </p>

            <form onSubmit={handleJoinSubmit} className="code-input-form">
              <input
                type="text"
                className="code-input"
                placeholder="e.g. BRIGHT-MINDS-2026"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
              />
              <button type="submit" className="btn btn-white">
                Verify Code <ArrowRight size={16} />
              </button>
            </form>

            {joinStatus && (
              <div style={{ marginTop: '20px', fontSize: '14px' }}>
                {joinStatus.valid ? (
                  <div style={{ background: 'rgba(255,255,255,0.15)', padding: '12px 20px', borderRadius: '8px', display: 'inline-block' }}>
                    ✓ <strong>{joinStatus.orgName}</strong> found! ({joinStatus.assessments} active assessments available).
                  </div>
                ) : (
                  <div style={{ background: 'rgba(220, 38, 38, 0.25)', padding: '12px 20px', borderRadius: '8px', display: 'inline-block' }}>
                    {joinStatus.message}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="content-wrap">
          <div className="footer-top">
            <div className="footer-brand">
              <div className="brand-group">
                <div className="brand-icon-box">
                  <ShieldCheck size={20} />
                </div>
                <div className="brand-title">MUNA</div>
              </div>
              <p>
                A mentor-led assessment platform with interactive question types and secure exam delivery.
              </p>
            </div>

            <div className="footer-links">
              <div className="footer-col">
                <h4>Platform</h4>
                <ul>
                  <li><a href="#features">Features</a></li>
                  <li><a href="#studio">Question Studio</a></li>
                  <li><a href="#security">Security Model</a></li>
                  <li><a href="#workspaces">Workspaces</a></li>
                </ul>
              </div>

              <div className="footer-col">
                <h4>Architecture</h4>
                <ul>
                  <li><a href="https://github.com/nonydev27/muna" target="_blank" rel="noreferrer">GitHub Repository</a></li>
                  <li><a href="https://github.com/nonydev27/muna/pull/1" target="_blank" rel="noreferrer">PR #1 (PRD Doc)</a></li>
                  <li><a href="https://www.safeexambrowser.org" target="_blank" rel="noreferrer">Safe Exam Browser</a></li>
                </ul>
              </div>
            </div>
          </div>

          <div className="footer-bottom">
            <div>Muna · Open-Source Educational Assessment Architecture</div>
            <div>Built with React 19 & Vite 8 · Based on Muna PRD v1.0</div>
          </div>
        </div>
      </footer>

      {/* Simple Accessible Modal for Actions */}
      {isModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '16px'
          }}
          onClick={() => setIsModalOpen(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '480px',
              width: '100%',
              padding: '32px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {modalType === 'join' ? (
              <>
                <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
                  Enter Organisation Join Code
                </h3>
                <p style={{ fontSize: '14px', color: 'var(--ink2)', marginBottom: '20px' }}>
                  Paste the unique invitation token or code provided by your mentor.
                </p>
                <form onSubmit={handleJoinSubmit}>
                  <input
                    type="text"
                    className="clean-input"
                    style={{ width: '100%', marginBottom: '16px' }}
                    placeholder="e.g. BRIGHT-MINDS-2026"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => setIsModalOpen(false)}
                    >
                      Close
                    </button>
                    <button type="submit" className="btn btn-primary">
                      Verify & Join
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
                  Mentor Workspace Login
                </h3>
                <p style={{ fontSize: '14px', color: 'var(--ink2)', marginBottom: '20px' }}>
                  Organisation admins and mentors manage assessments, question banks, and grading rubrics.
                </p>
                <div style={{ background: 'var(--field2)', padding: '16px', borderRadius: '8px', fontSize: '13px', color: 'var(--ink2)', marginBottom: '20px' }}>
                  <strong>Phase 0 & 1 Status:</strong> Database authentication is being configured. You can test question authoring in the <strong>Question Studio</strong> section right on this page!
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setIsModalOpen(false)}
                  >
                    Explore Studio
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
