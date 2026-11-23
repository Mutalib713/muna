# MUNA 🧠

A mentor-led assessment platform with interactive question types and secure exam delivery.

> **Muna**: make assessment creation expressive and easy for mentors, while making exam rules explicit, enforceable on the server, and honest about the limits of browser-only lockdown.

## What it does

- **Mentors** create an organisation workspace, invite mentees, build interactive assessments, and grade submissions.
- **Mentees** join via invitation, see assigned assessments, and complete them under configurable rules.
- **Question types**: multiple choice, multi-select, true/false, short answer, long-form theory, and freehand drawing (first-class, not just an upload).
- **Attempt rules**: 3 attempts by default, configurable time limits, availability windows, randomisation, and server-enforced attempt counting.
- **Secure mode**: layered standard web controls (focus-loss detection, autosave, server-side grading) plus an optional Safe Exam Browser (SEB) mode for high-stakes exams.

## Tech stack

| Layer    | Choice                                                |
| :------- | :---------------------------------------------------- |
| Frontend | React 19 + Vite + TypeScript                          |
| Backend  | REST/typed RPC API with server-enforced authorization |
| Database | PostgreSQL (tenant-aware, transactional attempts)     |
| Storage  | Private object storage for drawings & media           |
| Identity | Secure sessions, email verification, MFA for admins   |

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # production build
npm run lint     # lint the codebase
```

## Admin dashboard and API

The admin dashboard is available at `#/dashboard`. Its Express API enforces admin sessions server-side and stores questions, assessments, assignments, review decisions, integrity follow-ups, sessions, and audit history in SQLite.

1. Install dependencies with `npm install`.
2. Run `npm run setup` in an interactive terminal. It prompts for the single admin email, display name, and a password without echoing it, then creates a local `.env` and random session secret. Use 14-72 UTF-8 bytes for the password.
3. Start the frontend and API together with `npm run dev`.

The SQLite database is created at `data/muna.sqlite`. `.env` and `data/` are ignored by Git. Seeded submissions, mentees, integrity signals, members, and invitations are sample records; student-facing submission, membership, and signal-generation services are not included yet. Assessment maximum attempts default to 3 and can be set from 1 to 3; assessment configuration is saved server-side, but learner attempt creation and counting are not part of this admin workflow.

For production, build with `npm run build`, then run `npm start` with `NODE_ENV=production` and deployment-managed `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `SESSION_SECRET` values. Serve the app over HTTPS. If behind a reverse proxy, set `HOST=0.0.0.0`, configure `TRUST_PROXY_HOPS` to the exact trusted proxy count, and ensure the proxy preserves the external host and protocol while sanitizing forwarded headers. The backend includes rate-limited sign-in, HttpOnly/SameSite cookies, CSRF validation, and server-side authorization on admin APIs.

Run backend tests with `npm test`.

## Roadmap

| Phase | Focus                                                   |
| :---- | :------------------------------------------------------ |
| 0     | Foundation: auth, organisations, tenant isolation      |
| 1     | Core assessment: builder, MCQ, theory, attempts, timer |
| 2     | Rich interaction: drawing canvas, rubrics, reports     |
| 3     | Secure web mode: focus-loss policy, autosave, audit    |
| 4     | SEB pilot                                               |
| 5     | Scale & polish                                          |

## Docs

The full product definition lives in [`docs/PRD.md`](docs/PRD.md): requirements, architecture, threat model and phased delivery.

## Security honesty 🤝

No web-only solution can guarantee cheating is impossible. Muna uses precise language: _secure assessment mode_, not _cheat-proof_. Focus-loss events are recorded and reviewed by mentors, never silently judged.
