# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.
You can also try [the experimental native React Compiler support in plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md#rust-react-compiler) by using `compiler: true` in the plugin options instead of using the Babel plugin.

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Admin dashboard and API

The admin dashboard is available at `#/dashboard`. Its Express API enforces admin sessions server-side and stores questions, assessments, assignments, review decisions, integrity follow-ups, sessions, and audit history in SQLite.

1. Install dependencies with `npm install`.
2. Run `npm run setup` in an interactive terminal. It prompts for the single admin email, display name, and a password without echoing it, then creates a local `.env` and random session secret. Use 14-72 UTF-8 bytes for the password.
3. Start the frontend and API together with `npm run dev`.

The SQLite database is created at `data/muna.sqlite`. `.env` and `data/` are ignored by Git. The database starts without seeded submissions, mentees, or integrity signals. Use the Mentees view to create students, assign assessments, and open the learner workflow at `#/learner/<mentee-id>`. Learner attempts are stored in SQLite and cannot exceed the assessment's 1–3 attempt limit.

For production, build with `npm run build`, then run `npm start` with `NODE_ENV=production` and deployment-managed `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `SESSION_SECRET` values. Serve the app over HTTPS. If behind a reverse proxy, set `HOST=0.0.0.0`, configure `TRUST_PROXY_HOPS` to the exact trusted proxy count, and ensure the proxy preserves the external host and protocol while sanitizing forwarded headers. The backend includes rate-limited sign-in, HttpOnly/SameSite cookies, CSRF validation, and server-side authorization on admin APIs.

Run backend tests with `npm test`.
