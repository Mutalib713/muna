# Phase 0 — Auth Slice (mapped to PRD)

Scope: identity, organisation model, tenant isolation, and the mentor sign-up/sign-in flow. This is the auth portion of PRD Phase 0 (section 14). Adjacent Phase 0 items (TypeScript, routing, design system) are noted but out of scope here.

## 1. Gap: current vs PRD

| PRD requires | Current state |
| :--- | :--- |
| Multi-role accounts (owner/admin/mentor/mentee) | One env-based admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) |
| Mentor sign-up + email verification (FR-01) | `/signup` is a stub |
| Organisation creation on sign-up (FR-01) | No `organisations` table |
| Invitation-based mentee join (FR-02, FR-03) | Invitations are demo-only local state |
| Tenant isolation (FR-10) | No org scoping anywhere |

## 2. Data model (new tables)

- **users** — `id`, `email` (unique, lowercased), `password_hash`, `name`, `email_verified_at`, timestamps.
- **organisations** — `id`, `slug` (unique), `name`, timestamps.
- **memberships** — `id`, `user_id`, `organisation_id`, `role` (`owner`/`admin`/`mentor`/`mentee`), `status` (`active`/`suspended`), timestamps. Unique on `(user_id, organisation_id)`.
- **invitations** — `id`, `organisation_id`, `role`, `email` (nullable), `token_hash`, `created_by`, `expires_at`, `max_uses`, `uses`, `revoked`, timestamps.
- **email_verification_tokens** — `token_hash`, `user_id`, `expires_at`.

Every tenant-owned record carries `organisation_id` (PRD §12). Sessions already use the SQLite store.

## 3. API surface

**Auth**
- `POST /api/auth/signup` — mentor: creates user + org + owner membership atomically.
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/csrf` — extend existing.
- `POST /api/auth/verify-email`, `POST /api/auth/resend-verification`.

**Organisations**
- `GET /api/organisations` — list the user's memberships.
- `POST /api/organisations` — create an additional org (owner membership).

**Invitations** (PRD §5)
- `POST /api/organisations/:id/invitations`, `GET .../invitations`, `DELETE .../invitations/:id`.
- `POST /api/invitations/:token/accept` — validate token, expiry, uses, existing membership, org status; create membership idempotently.

**Members**
- `GET /api/organisations/:id/members`, `PATCH .../members/:userId` (role/status).

## 4. Frontend flows

- `/signup` — mentor: name, email, password, org name → creates account + org.
- `/login` — real auth (replace stub).
- `/verify-email` — token page.
- `/o/:slug` — org-scoped workspace (replaces the single-admin `#/dashboard`).
- Invitation accept flow — preview org + inviter, then accept.

## 5. Security (PRD §5, §8)

- Invitation tokens: `randomBytes(32)`, stored **hashed**, single-use when email-specific, rate-limited.
- Email verification required before org is usable (FR-01).
- CSRF, session security, rate limiting — already present; extend to signup/invite.
- MFA for admins — defer ("where possible" in PRD).

## 6. Tenant isolation (FR-10)

- Middleware resolves the current org (slug/header) and verifies membership + role on every request.
- All data queries scoped by `organisation_id`; never trust a client-supplied org id.
- Automated tests prove one org cannot read/mutate another's data.

## 7. Migration path

- Keep the existing single-admin login working during transition.
- Add the new tables; migrate the dashboard to be org-scoped.
- `ADMIN_EMAIL`/`ADMIN_PASSWORD` becomes a bootstrap seed for the first org owner, then is removed.

## 8. Build order

1. Tables + migrations (users, organisations, memberships).
2. Signup + login + email verification (FR-01).
3. Org-scoped middleware + tenant isolation tests (FR-10).
4. Invitations + mentee join (FR-02, FR-03).
5. Migrate dashboard to `/o/:slug`; retire single-admin login.

## 9. Decisions (with recommendations)

| Decision | Recommendation |
| :--- | :--- |
| TypeScript now or later | Later — keep JS for this slice; TS is a separate Phase 0 item |
| SQLite vs PostgreSQL | SQLite now, design schema for PG migration (PRD allows stepping stone) |
| Email provider | Resend (simple API, free tier) or SMTP; pick before step 2 |
| Managed auth vs self-hosted | Self-hosted sessions (already built); revisit if MFA becomes required |
| MFA for admins | Defer |

## 10. Acceptance criteria (PRD exit condition)

> "A mentor can sign up and create an isolated organisation; automated authorization tests pass."

- A mentor signs up, verifies email, and owns a new org with a unique slug.
- A second org cannot read or mutate the first org's data (automated test).
- Invitations are rejected when expired, revoked, exhausted, or malformed (FR-02).
- Duplicate invitation acceptance is idempotent (FR-03).
