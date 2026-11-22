# MUNA
## Product Requirements Document
A mentor-led assessment platform with interactive question types and secure exam delivery

| Document | Detail |
| :--- | :--- |
| **Version** | 1.0 — Research-backed product definition |
| **Prepared** | 22 November 2026 |
| **Repository** | github.com/nonydev27/muna |
| **Status** | Proposed product direction; implementation not yet specified |

### Product principle
Make assessment creation expressive and easy for mentors, while making exam rules explicit, enforceable on the server, and honest about the limits of browser-only lockdown.

---

## 1. Executive summary
Muna is a multi-organisation assessment platform. Mentors create an account, establish or join an organisation workspace, invite mentees through controlled invitation links or codes, build interactive assessments, and review learner submissions. Mentees join an organisation, see assessments assigned to them, and complete them under configurable rules.

The product combines a question authoring studio, organisation and membership management, assessment delivery, grading, attempt management, and a layered secure-exam mode. The initial product should support multiple-choice, short/long text, and freehand drawing responses, with an extensible question model for later question types.

The requested default is three attempts. Each assessment can define a time limit, availability window, randomisation, navigation policy, feedback release, and security profile. Browser focus loss can trigger an immediate server-recorded termination policy in standard web mode, but only a dedicated lockdown browser such as Safe Exam Browser can provide operating-system-level restrictions.

Success means mentors can publish a useful assessment without technical help, mentees can join and complete it reliably, and organisations can trust that permissions, attempts, grading and security events are recorded consistently.

---

## 2. Repository review and implications
The supplied repository was inspected at github.com/nonydev27/muna. At review time, README.md describes the standard React + Vite starter template. package.json identifies a Vite application using React 19, with dev/build/lint/preview scripts and no listed backend, database, authentication, routing, or assessment dependencies. src/App.jsx is still the default Vite counter/demo screen.

**Implication**: treat the repository as an early frontend scaffold, not an existing assessment product. This PRD therefore defines the product and recommended architecture rather than assuming existing backend decisions. Preserve React + Vite if desired, but introduce a real API, identity layer, database, storage, and server-enforced authorization before building production assessment flows.

| Observed | Current state | PRD implication |
| :--- | :--- | :--- |
| **Frontend** | React 19 + Vite | Keep as UI foundation if team prefers |
| **Application screen** | Default Vite demo | No established product UX to preserve |
| **Backend/auth/data** | Not present in inspected package/entry files | Select and implement deliberately |
| **Assessment/security** | No evidence in inspected files | Design as first-class domains, not UI-only features |

---

## 3. Product vision, goals and non-goals

### Vision
A trusted digital space where mentors can assess understanding through more than conventional quizzes, and learners can demonstrate knowledge through selected response, written reasoning and visual work.

### Goals
- Allow a mentor to create an organisation workspace and invite mentees securely.
- Provide a guided assessment builder with reusable questions and question banks.
- Support MCQ, short answer, long-form theory and drawing responses in the first release.
- Apply three attempts by default, with clear per-assessment configuration and server-side enforcement.
- Provide reliable autosave, timed delivery, grading, review and audit history.
- Offer standard web security controls plus an optional SEB-compatible high-security mode.

### Non-goals for MVP
- Guaranteeing that cheating is impossible or that a browser website can prevent all external assistance.
- Remote webcam proctoring, biometric identification or AI emotion/attention detection.
- A full learning-management system with courses, lessons, attendance and payments.
- Native mobile apps or a custom operating-system-level secure browser.
- Real-time collaborative drawing or live multiplayer examinations.

---

## 4. Users, roles and permissions

| Role | Core permissions |
| :--- | :--- |
| **Platform operator** | Manage platform health, abuse reports, organisation status and platform-wide configuration; no routine access to learner answers. |
| **Organisation owner/admin** | Manage organisation profile, mentors, membership, invitations, policies and organisation-level reporting. |
| **Mentor** | Create/edit/publish assessments, assign them to mentees/groups, grade responses, review attempts and view permitted reports. |
| **Mentee** | Join via invitation, view assigned assessments, take available assessments, review results when released. |

A user may belong to more than one organisation. Membership role and permissions are scoped to each organisation. A mentor in Organisation A must not automatically gain access to Organisation B. Mentee membership should be revocable, and assessment records should retain an auditable association with the organisation that owned the assessment.

---

## 5. Organisation and invitation model

### Organisation identity
Each organisation receives a permanent unique slug and a public join address, for example `muna.app/o/bright-minds`. A custom subdomain such as `bright-minds.muna.app` may be supported later. A unique slug is recommended for MVP; custom domains introduce DNS verification, certificate provisioning, tenant routing and support overhead.

### Invitation workflow
- An organisation admin or authorised mentor chooses Invite mentees and creates an invitation.
- Invitation can target a specific email address, a group, or be a reusable join code with expiry and usage limits.
- The invite record stores organisation, intended role, creator, expiry, maximum uses, current uses and revocation state.
- The recipient authenticates or creates an account, previews the organisation name and inviter, then explicitly accepts.
- Server validates token, expiry, usage limit, existing membership and organisation status before creating membership.
- Admin can revoke outstanding invitations and remove or suspend members.

Invitation tokens must be cryptographically random, single-use when email-specific, stored hashed where practical, rate-limited, and never treated as proof of identity by themselves. Public organisation discovery should not expose private member lists.

---

## 6. Assessment authoring and question types
The builder should separate assessment-level settings from question content. Mentors can create a draft, add/reorder questions, preview the learner experience, configure grading, publish, assign, pause or archive.

| Question type | Learner interaction | Grading approach |
| :--- | :--- | :--- |
| **Multiple choice (single)** | Choose one option | Automatic exact-match grading |
| **Multiple select** | Choose one or more options | Automatic; configurable all-or-nothing or partial credit |
| **Short answer** | One or a few lines of text | Manual initially; optional exact/accepted-answer rules |
| **Theory / long response** | Rich text or plain text response | Manual rubric-based grading |
| **Drawing / diagram** | Canvas with pen, eraser, colour, undo/redo; submit image/vector snapshot | Manual rubric; optional annotations |
| **True/false** | Choose one of two options | Automatic |

Drawing should be treated as a first-class response, not an uploaded attachment alone. Save strokes or a compact vector representation where feasible, plus a rendered preview. Provide touch, mouse and stylus support. Offer keyboard alternatives where possible, such as shape/label tools and text descriptions, so the task is not inaccessible to learners who cannot draw.

### Builder requirements
- Question bank with tags, topic, difficulty, points and reuse across assessments.
- Question-level marks, required/optional flag, instructions, media attachment and grading rubric.
- Question ordering: fixed, shuffled, or random draw from a tagged pool.
- Preview as mentee; validate missing marks, empty options, missing correct answers and unsupported combinations.
- Autosave drafts and show save status; support duplicate question and bulk reorder.
- Version published assessments. Editing a live assessment must not silently mutate an attempt already in progress.

---

## 7. Assessment configuration and attempt rules

| Setting | MVP behaviour |
| :--- | :--- |
| **Attempts** | Default maximum: 3 per mentee per assessment. Mentor can configure 1–3 initially; changes apply prospectively and are audit logged. |
| **Time limit** | Optional duration, enforced using server timestamps. Client countdown is display only. |
| **Availability** | Start/end date and time; server rejects early/late starts. |
| **Navigation** | Allow free navigation or enforce sequential progression; configure whether answers can be changed. |
| **Question order** | Fixed, shuffled per attempt, or random from a pool. |
| **Feedback** | Release score, correct answers and mentor comments immediately, after deadline, or manually. |
| **Submission** | Manual submit; auto-submit at time expiry; policy for interrupted sessions. |
| **Resume** | Configurable. Standard mode can resume if allowed; high-security mode may require mentor approval after a disconnect. |

Attempt counting must be transactional and server-side. Creating an attempt should atomically reserve one of the permitted attempts. Refreshing, reconnecting or opening another tab must not create a second active attempt. The product must clearly explain what consumes an attempt. Recommended default: an attempt is consumed when the learner confirms Start, not when they merely open the assessment page.

For a strict tab-switch rule, the first confirmed visibility-loss event should trigger the configured violation action. Recommended default for strict exams: lock the attempt immediately, submit the last server-acknowledged answers, record the event, and mark the attempt as 'terminated — focus lost' for mentor review. Do not silently delete the attempt or label it cheating without evidence.

---

## 8. Secure assessment and anti-cheating design
Security must be layered. No web-only solution can guarantee a student is unable to inspect downloaded HTML, JavaScript, network traffic or browser memory. Obfuscation, disabling right-click, blocking keyboard shortcuts and DevTools detection are deterrents only; they are not security boundaries.

### 8.1 Standard web mode
- Enter full-screen on user action and detect exit where supported; do not describe full-screen as a secure kiosk.
- Listen to document `visibilitychange` and record hidden/visible transitions with server timestamps. The Page Visibility API reports when a document becomes hidden, including tab switches, minimisation and app switching on mobile.
- Use window blur/focus as a secondary signal only; blur alone can be triggered by benign browser or OS interactions.
- On strict profile, lock/submit when the page becomes hidden. The server decides the final state; client events are evidence signals, not trusted authority.
- Disable copy/paste and context menu only where justified by assessment policy; do not rely on these to protect content.
- Avoid sending correct answers or answer keys to the client before release. Grade objective questions on the server.
- Use per-user, per-attempt authorization; rate-limit APIs; prevent replay and duplicate submissions; validate all input server-side.
- Autosave responses frequently and on navigation; show save confirmation and recover safely after network loss.
- Use randomized option order, question pools and per-learner variants to reduce answer sharing.

### 8.2 Safe Exam Browser (SEB) mode
For higher-stakes assessments, Muna should integrate with Safe Exam Browser rather than attempting to recreate an OS lockdown in JavaScript. SEB is a dedicated kiosk/browser application that can restrict access to other applications and system functions, use exam-specific encrypted configuration, and load a web-based assessment system. The Muna server should verify the expected SEB exam configuration/version through a supported integration mechanism before allowing the attempt.
- Offer a pre-exam compatibility check and clear installation/setup instructions.
- Generate or distribute an exam-specific SEB configuration only after the mentor publishes the assessment.
- Require SEB mode for the assessment when selected; reject unsupported browser sessions.
- Do not claim that SEB makes external devices, collusion or all forms of cheating impossible.
- Provide a fallback process for accessibility accommodations, managed devices and technical failures.

### 8.3 Threat model and controls
| Threat | Recommended mitigation | Residual limitation |
| :--- | :--- | :--- |
| **Tab/app switching** | Visibility event; strict policy locks attempt; SEB for high stakes | Web event may be missed if browser/device crashes or is manipulated |
| **Inspecting source / DevTools** | Never ship secrets or answer keys; server-side grading; minimise client data | Client code delivered to browser can be inspected |
| **API tampering** | Server validation, authz on every request, schema validation, rate limits | Requires secure implementation and testing |
| **Sharing answers** | Question pools, randomisation, variants, delayed feedback | Learners can still communicate externally |
| **Multiple accounts** | Email verification, invite binding, risk signals and admin review | Identity proofing is not guaranteed |
| **Network interruption** | Autosave, idempotent writes, reconnect policy, server timer | Cannot guarantee uninterrupted service |
| **Cross-organisation access** | Tenant-scoped authorization and data isolation tests | A coding flaw can still cause data exposure |
| **Screenshots / second device** | SEB restrictions where supported; question design and invigilation policy | A website cannot prevent a second camera/device |

Security language in the UI must be precise: use 'secure assessment mode' or 'lockdown controls enabled', not 'cheat-proof'. Distinguish a recorded security event from a confirmed integrity violation.

---

## 9. Learner assessment experience
- Mentee dashboard lists upcoming, available, in-progress, submitted and past assessments.
- Assessment briefing shows mentor/organisation, duration, allowed attempts remaining, rules, question types, availability and security mode.
- A readiness check verifies browser support, connection, full-screen capability and SEB presence if required.
- Before starting, show a clear confirmation: starting consumes one attempt; leaving the assessment may terminate it under strict rules.
- During attempt: visible timer, question navigator, saved/pending state, accessible controls and clear submit action.
- On submit: show confirmation and receipt with submission time and attempt number.
- Results are hidden until the mentor's release policy permits them.

For fairness, provide a short practice assessment that demonstrates the focus-loss rule and drawing interface before a real graded assessment.

---

## 10. Mentor workspace and reporting
- Organisation dashboard: mentees, active assessments, drafts, upcoming deadlines and recent submissions.
- Assessment analytics: participation, completion, score distribution, question-level performance and attempt usage.
- Manual grading queue for theory and drawing responses, with rubric, points, comments and saved grading progress.
- Per-mentee history: attempts, status, scores, timestamps and security-event timeline.
- Export results to CSV; restrict exports to authorised roles and log export actions.
- Mentor can grant an extra attempt with a required reason; the change is auditable.

Reports should avoid ranking learners by default. Use cohort summaries and item analysis to help mentors identify topics needing further teaching.

---

## 11. Functional requirements and acceptance criteria

| ID | Requirement | Acceptance criteria |
| :--- | :--- | :--- |
| **FR-01** | A mentor can register, verify email and create an organisation. | Organisation slug is unique; owner membership is created atomically. |
| **FR-02** | An authorised mentor/admin can invite mentees. | Expired, revoked, exhausted and malformed invitations are rejected server-side. |
| **FR-03** | A mentee can join an organisation using a valid invitation. | Membership is created once; duplicate acceptance is idempotent. |
| **FR-04** | A mentor can create and publish an assessment. | Draft validation blocks invalid questions and missing grading configuration. |
| **FR-05** | Builder supports MCQ, multi-select, theory, short answer and drawing. | Each question type can be previewed and saved/reloaded without data loss. |
| **FR-06** | Assessment supports three attempts by default. | Fourth start is rejected by the server; concurrent start requests cannot exceed the limit. |
| **FR-07** | Assessment can have a duration and availability window. | Server rejects out-of-window starts and submits at expiry. |
| **FR-08** | Strict web mode records focus loss and applies configured action. | Hidden event is logged and server transitions attempt according to policy. |
| **FR-09** | Mentor can grade manual responses and release results. | Only authorised mentor can grade; all changes are timestamped. |
| **FR-10** | Tenant data is isolated. | Automated tests prove one organisation cannot read or mutate another's data. |
| **FR-11** | Learner answers autosave. | Network interruption does not silently erase last acknowledged answer. |
| **FR-12** | SEB-required assessment rejects ordinary browser. | A valid configured SEB session is verified before attempt start. |

---

## 12. Recommended technical architecture
Recommended baseline, subject to team familiarity: React + Vite frontend (existing scaffold), TypeScript, a backend API, PostgreSQL relational database, object storage for drawing/media assets, and a managed identity provider or carefully implemented authentication service. Keep security-sensitive decisions in the backend.

| Layer | Recommendation / responsibility |
| :--- | :--- |
| **Frontend** | React + TypeScript; accessible component system; question renderer and builder; no trusted grading logic. |
| **API** | REST or typed RPC service; authentication, organisation membership, invitations, assessment lifecycle, attempt orchestration, grading and audit. |
| **Database** | PostgreSQL; relational tenant model; transactions for attempt creation/submission; tenant-aware indexes and constraints. |
| **Identity** | Managed auth or secure server sessions; email verification; MFA for organisation admins/mentors where possible. |
| **Storage** | Private object storage for drawing snapshots and media; short-lived signed URLs after authorization. |
| **Realtime** | Optional WebSocket/SSE for live status and mentor monitoring; not required for core attempt integrity. |
| **Observability** | Structured logs, error tracking, security-event audit, metrics and alerting. Avoid logging answer content unnecessarily. |

A practical data model includes `users`, `organisations`, `memberships`, `invitations`, `assessments`, `assessment_versions`, `questions`, `question_options`, `assignments`, `attempts`, `responses`, `grading_rubrics`, `grades`, `security_events`, and `audit_logs`. Every tenant-owned record must carry an organisation scope or be reachable only through an explicitly scoped parent. Do not trust an organisation_id supplied by the browser without checking the authenticated user's membership and role.

For storage, keep drawings and uploads private by default. Store object ownership and tenant association in the database; object key prefixes alone are not authorization. Generate signed download URLs only after checking permission.

---

## 13. Privacy, accessibility and operational requirements
- Collect the minimum personal information required; do not require webcam, microphone or biometric data for MVP.
- Publish a privacy notice explaining what focus/visibility events are recorded, why, retention period and who can view them.
- Provide a learner-facing explanation before the assessment begins; obtain consent where legally required.
- Define retention and deletion rules for attempts, drawings, audit logs and inactive accounts.
- Use HTTPS, secure cookies, CSRF protection where applicable, content security policy, dependency scanning, backups and tested restore procedures.
- Target WCAG 2.2 AA: keyboard navigation, visible focus, labels, contrast, error identification, screen-reader support and accessible time-limit accommodations.
- Drawing tasks need non-drawing alternatives or accommodations where the learning objective permits.
- Support low-bandwidth usage: compressed media, autosave, resilient navigation and clear connection state.
- Do not automatically penalise a learner solely because of one focus event. Define the consequence in advance, record the signal, allow mentor review and provide an appeal/technical-incident workflow.

---

## 14. MVP scope and phased delivery

| Phase | Scope | Exit condition |
| :--- | :--- | :--- |
| **0 — Foundation** | Repository setup, TypeScript, routing, design system, auth, organisation model, database and tenant isolation. | A mentor can sign up and create an isolated organisation; automated authorization tests pass. |
| **1 — Core assessment** | Invitation flow, mentee membership, builder, MCQ, theory, attempts, timer, assignment and submission. | A mentor can publish and assign an assessment; mentee can join and complete it. |
| **2 — Rich interaction** | Drawing canvas, short answer, rubric grading, question bank, reports and exports. | Manual and objective grading work end-to-end. |
| **3 — Secure web mode** | Full-screen prompt, visibility detection, server-side event log, strict termination, autosave and audit view. | Focus-loss policy is testable, transparent and robust to reconnects. |
| **4 — SEB pilot** | SEB configuration, compatibility validation, exam launch flow and support documentation. | Pilot on supported desktop platforms; unsupported clients fail safely. |
| **5 — Scale and polish** | Custom domains, advanced analytics, organisation branding, question pools and expanded question types. | Operational, security and usability targets are met. |

Recommended MVP: phases 0–2 plus a clearly labelled standard-web security profile. Do not make SEB a blocker for proving the assessment workflow, but architect the exam launch and session verification so SEB can be added without rebuilding attempts.

---

## 15. Risks, decisions and open questions

| Decision / risk | Recommendation |
| :--- | :--- |
| **What does 'unique org or domain' mean?** | MVP: unique organisation slug and join URL; custom subdomains later. |
| **Does switching browser always close the work?** | Offer configurable strict policy. In standard web mode, hidden event triggers server-side lock/submit; state this is best-effort detection. SEB mode for stronger lockdown. |
| **Three attempts fixed or configurable?** | Default to 3; allow mentor to choose 1–3 for MVP and grant audited extra attempts. |
| **Can mentees join multiple organisations?** | Yes, with separate memberships and clear organisation context. |
| **Can mentors belong to multiple organisations?** | Yes, role is scoped per organisation. |
| **Who grades theory and drawings?** | Manual grading and rubrics in MVP; AI assistance only later and never as sole authority without explicit policy. |
| **What if internet drops?** | Autosave and recover according to policy; timer remains server-based; no automatic extra attempt unless mentor grants it. |
| **Can students use phones?** | Support ordinary mobile web for practice/low-stakes assessments; define device support per security profile. Do not promise equivalent lockdown on every mobile browser. |

---

## 16. Success metrics
- **Activation**: percentage of new mentors who create an organisation and publish their first assessment.
- **Invitation conversion**: invite acceptance rate and median time from invite to join.
- **Assessment completion**: start-to-submit completion rate, excluding documented technical incidents.
- **Reliability**: response autosave success rate, duplicate submission rate and data-loss incidents.
- **Authoring efficiency**: median time to create and publish a 10-question assessment.
- **Grading efficiency**: median time to grade a manual response and release results.
- **Security operations**: focus-loss events, false-positive reviews, unauthorised API attempts and tenant-isolation test coverage.
- **Accessibility**: completion success across keyboard-only and screen-reader testing.
- Avoid optimising for the raw number of blocked focus events. That can incentivise overly aggressive rules and punish legitimate interruptions.

---

## 17. Research sources
- **Safe Exam Browser — About / architecture and features**  
  [safeexambrowser.org/about_overview_en.html](https://www.safeexambrowser.org/about_overview_en.html)  
  Official overview describing kiosk application, browser component, encrypted exam configurations, URL filtering and supported platform differences.
- **MoodleDocs — Safe Exam Browser**  
  [docs.moodle.org/503/en/Safe_exam_browser](https://docs.moodle.org/503/en/Safe_exam_browser)  
  Explains that SEB must be installed on the learner device and offers stronger restrictions than browser-only JavaScript security.
- **MDN — Page Visibility API**  
  [developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)  
  Documents visibility state changes when tabs are switched, windows minimised or apps switched.
- **MDN — visibilitychange event**  
  [developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event)  
  Documents the event's behaviour and that hidden is the last reliably observable lifecycle transition.
- **OWASP — Multi-Tenant Security Cheat Sheet**  
  [cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)  
  Guidance on tenant context, authorization, storage isolation, logging and preventing cross-tenant leakage.
- **W3C — WCAG 2.2**  
  [w3.org/TR/WCAG22](https://www.w3.org/TR/WCAG22/)  
  Accessibility requirements and success criteria for web content.

**Repository evidence reviewed**: `README.md`, `package.json`, `src/App.jsx` and `src/main.jsx` from the supplied GitHub repository.  
Repository review is a snapshot, not a full security audit or complete file-by-file code review.

**Research note**: Product recommendations are based on the sources above and the repository files inspected on 22 November 2026.  
Confirm current SEB integration APIs, supported platforms and legal/privacy requirements during technical discovery before implementation.
