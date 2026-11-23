# MUNA 🧠

A mentor-led assessment platform with interactive question types and secure exam delivery.

> **Muna** — make assessment creation expressive and easy for mentors, while making exam rules explicit, enforceable on the server, and honest about the limits of browser-only lockdown.

## What it does

- **Mentors** create an organisation workspace, invite mentees, build interactive assessments, and grade submissions.
- **Mentees** join via invitation, see assigned assessments, and complete them under configurable rules.
- **Question types** — multiple choice, multi-select, true/false, short answer, long-form theory, and freehand drawing (first-class, not just an upload).
- **Attempt rules** — 3 attempts by default, configurable time limits, availability windows, randomisation, and server-enforced attempt counting.
- **Secure mode** — layered standard web controls (focus-loss detection, autosave, server-side grading) plus an optional Safe Exam Browser (SEB) mode for high-stakes exams.

## Tech stack

| Layer | Choice |
| :--- | :--- |
| Frontend | React 19 + Vite + TypeScript |
| Backend | REST/typed RPC API with server-enforced authorization |
| Database | PostgreSQL (tenant-aware, transactional attempts) |
| Storage | Private object storage for drawings & media |
| Identity | Secure sessions, email verification, MFA for admins |

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # production build
npm run lint     # lint the codebase
```

## Roadmap

| Phase | Focus |
| :--- | :--- |
| 0 | Foundation — auth, organisations, tenant isolation |
| 1 | Core assessment — builder, MCQ, theory, attempts, timer |
| 2 | Rich interaction — drawing canvas, rubrics, reports |
| 3 | Secure web mode — focus-loss policy, autosave, audit |
| 4 | SEB pilot |
| 5 | Scale & polish |

## Docs

The full product definition lives in [`docs/PRD.md`](docs/PRD.md) — requirements, architecture, threat model and phased delivery.

## Security honesty 🤝

No web-only solution can guarantee cheating is impossible. Muna uses precise language: *secure assessment mode*, not *cheat-proof*. Focus-loss events are recorded and reviewed by mentors — never silently judged.
