import { existsSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import session from 'express-session'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { ensureWorkspaceBootstrap } from './db.js'
import { SQLiteSessionStore } from './sqlite-session-store.js'
import { createAuthMiddleware, requireAuth } from './middleware/auth.js'
import { registerAuthRoutes } from './routes/auth.js'
import {
  createMemberInvitationHandlers,
  registerActiveWorkspaceMemberRoutes,
  registerOrgScopedAdminRoutes,
  registerPublicInvitationRoutes,
} from './routes/invitations.js'
import { registerOrganisationRoutes } from './routes/organisations.js'
import { registerLearnerRoutes } from './routes/learner.js'
import { registerQuestionRoutes } from './routes/questions.js'
import { registerMenteeRoutes } from './routes/mentees.js'
import { registerAssessmentRoutes } from './routes/assessments.js'
import { registerReviewRoutes } from './routes/reviews.js'
import { registerReportRoutes } from './routes/reports.js'

const SESSION_TTL_MS = 8 * 60 * 60 * 1000

/** Compose the Express application with security middleware, auth, learner, and workspace routers. */
export function createApp({
  db,
  setupCode,
  sessionSecret,
  production = false,
  trustProxyHops = 0,
  distPath,
  orgName = 'Muna Workspace',
  orgSlug = 'muna-workspace',
  onVerificationEmail,
}) {
  const app = express()
  const router = express.Router()
  ensureWorkspaceBootstrap(db, { orgName, orgSlug })

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again in 15 minutes.' },
  })
  const inviteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many invitation checks. Try again in 15 minutes.' },
  })

  app.disable('x-powered-by')
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops)
  app.use(helmet({
    contentSecurityPolicy: production ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    } : false,
    strictTransportSecurity: production ? undefined : false,
  }))
  app.use(express.json({ limit: '512kb' }))
  app.use(session({
    name: 'muna.sid',
    secret: sessionSecret,
    store: new SQLiteSessionStore(db),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: production,
      maxAge: SESSION_TTL_MS,
      path: '/',
    },
  }))

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  const auth = createAuthMiddleware(db)
  const memberInviteHandlers = createMemberInvitationHandlers(db)

  registerAuthRoutes(router, {
    db,
    setupCode,
    production,
    orgName,
    orgSlug,
    authLimiter,
    onVerificationEmail,
  })
  registerPublicInvitationRoutes(router, { db, inviteLimiter })
  registerLearnerRoutes(router, { db, checkLearnerAccess: auth.checkLearnerAccess })
  registerOrganisationRoutes(router, { db, requireVerifiedEmail: auth.requireVerifiedEmail })
  registerOrgScopedAdminRoutes(router, { auth, handlers: memberInviteHandlers })

  router.use(requireAuth, auth.requireVerifiedEmail, auth.resolveOrgContext)

  registerQuestionRoutes(router, db)
  registerMenteeRoutes(router, db)
  registerAssessmentRoutes(router, db)
  registerReviewRoutes(router, db)
  registerReportRoutes(router, db)
  registerActiveWorkspaceMemberRoutes(router, { requireOrgAdmin: auth.requireOrgAdmin, handlers: memberInviteHandlers })

  app.use('/api', router)

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API route not found.' })
  })

  if (distPath && existsSync(path.join(distPath, 'index.html'))) {
    app.use(express.static(distPath, { index: false }))
    app.get(/.*/, (req, res) => res.sendFile(path.join(distPath, 'index.html')))
  }

  app.use((error, req, res, next) => {
    console.error('Request failed:', error)
    if (res.headersSent) {
      next(error)
      return
    }
    res.status(500).json({ error: 'An unexpected server error occurred.' })
  })

  return app
}
