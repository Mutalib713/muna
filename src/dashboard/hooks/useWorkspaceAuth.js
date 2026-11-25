import { useEffect, useState } from 'react'
import apiRequest, {
  cacheCsrfToken,
  clearCsrfTokenCache,
  loadDashboardData,
  requestCsrfToken,
  setActiveOrganisationId,
} from '../services/adminApi'

const STAFF_ROLES = ['Owner', 'Admin', 'Mentor']

/** Manage admin session, CSRF tokens, login/setup forms, and active organisation state. */
export function useWorkspaceAuth(orgSlug = '', { applyDashboardData, clearDomainState }) {
  const [authStatus, setAuthStatus] = useState('checking')
  const [admin, setAdmin] = useState(null)
  const [organisations, setOrganisations] = useState([])
  const [activeOrg, setActiveOrg] = useState(null)
  const [devVerifyToken, setDevVerifyToken] = useState('')
  const [csrfToken, setCsrfToken] = useState('')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [setupForm, setSetupForm] = useState({ name: '', email: '', password: '', confirmPassword: '', setupCode: '' })
  const [setupError, setSetupError] = useState('')
  const [setupLoading, setSetupLoading] = useState(false)
  const [apiError, setApiError] = useState('')

  function clearWorkspaceState() {
    setAdmin(null)
    setOrganisations([])
    setActiveOrg(null)
    setActiveOrganisationId('')
    clearDomainState()
  }

  function handleApiError(error) {
    if (error.status === 401) {
      clearWorkspaceState()
      setAuthStatus('unauthenticated')
      clearCsrfTokenCache()
      requestCsrfToken()
        .then(({ csrfToken: token }) => setCsrfToken(token))
        .catch((refreshError) => setApiError(refreshError.message))
    } else if (error.payload?.emailVerificationRequired) {
      setAuthStatus('verification-required')
    }
    setApiError(error.message)
  }

  async function withAuth(task) {
    try {
      return await task()
    } catch (error) {
      if (error.status === 401 || error.payload?.emailVerificationRequired) handleApiError(error)
      throw error
    }
  }

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        const [{ csrfToken: token }, { setupRequired }] = await Promise.all([
          requestCsrfToken(),
          apiRequest('/auth/status'),
        ])
        if (!active) return
        setCsrfToken(token)
        if (setupRequired && !orgSlug) {
          setAuthStatus('setup-required')
          return
        }
        try {
          const me = await apiRequest('/auth/me')
          if (!active) return
          const user = me.user
          const orgList = me.organisations || []
          setAdmin(user)
          setOrganisations(orgList)
          if (!user.emailVerified) {
            setAuthStatus('verification-required')
            return
          }
          const matchedOrg = orgSlug
            ? orgList.find((org) => org.slug === orgSlug)
            : (me.organisation || orgList.find((org) => STAFF_ROLES.includes(org.role)) || orgList[0])
          if (!matchedOrg) {
            setApiError('You do not have access to this organisation.')
            setAuthStatus('unauthenticated')
            return
          }
          if (!STAFF_ROLES.includes(matchedOrg.role)) {
            if (matchedOrg.menteeId) {
              window.location.assign(`/#/learner/${encodeURIComponent(matchedOrg.menteeId)}`)
              return
            }
            setApiError('This workspace requires an Owner, Admin, or Mentor role.')
            setAuthStatus('unauthenticated')
            return
          }
          setActiveOrg(matchedOrg)
          setActiveOrganisationId(matchedOrg.id)
          const data = await loadDashboardData()
          if (!active) return
          applyDashboardData(data)
          setAuthStatus('authenticated')
        } catch (error) {
          if (error.status === 401) {
            setAuthStatus('unauthenticated')
            return
          }
          if (error.payload?.emailVerificationRequired) {
            setAuthStatus('verification-required')
            return
          }
          throw error
        }
      } catch (error) {
        if (active) {
          setApiError(error.message)
          setAuthStatus('unauthenticated')
        }
      }
    }
    initialize()
    return () => { active = false }
  }, [orgSlug, applyDashboardData])

  async function selectOrganisation(nextOrgId) {
    setApiError('')
    const { organisation, organisations: nextOrgs } = await apiRequest('/organisations/switch', {
      method: 'POST',
      body: { organisationId: nextOrgId },
      csrfToken,
    })
    setOrganisations(nextOrgs)
    setActiveOrg(organisation)
    setActiveOrganisationId(organisation.id)
    if (orgSlug) window.history.pushState({}, '', `/o/${encodeURIComponent(organisation.slug)}`)
    applyDashboardData(await loadDashboardData())
  }

  async function createOrganisation(name) {
    const { organisation } = await apiRequest('/organisations', { method: 'POST', body: { name }, csrfToken })
    const { organisations: nextOrgs } = await apiRequest('/organisations')
    setOrganisations(nextOrgs)
    setActiveOrg(organisation)
    setActiveOrganisationId(organisation.id)
    if (orgSlug) window.history.pushState({}, '', `/o/${encodeURIComponent(organisation.slug)}`)
    applyDashboardData(await loadDashboardData())
  }

  async function handleResendVerification() {
    setApiError('')
    try {
      const data = await apiRequest('/auth/resend-verification', { method: 'POST', csrfToken })
      if (data.verificationToken) setDevVerifyToken(data.verificationToken)
      setApiError('Verification email re-issued. Verify your email before opening the workspace.')
    } catch (error) {
      setApiError(error.message)
    }
  }

  async function handleLogin(event) {
    event.preventDefault()
    setLoginLoading(true)
    setLoginError('')
    setApiError('')
    try {
      const { user, organisation, organisations: orgList = [], csrfToken: token } = await apiRequest('/auth/login', {
        method: 'POST',
        body: { email: loginEmail, password: loginPassword },
        csrfToken,
      })
      cacheCsrfToken(token)
      setCsrfToken(token)
      setAdmin(user)
      setOrganisations(orgList)
      setLoginPassword('')
      if (!user.emailVerified) {
        setAuthStatus('verification-required')
        return
      }
      const targetOrg = orgSlug ? orgList.find((org) => org.slug === orgSlug) : (organisation || orgList[0])
      if (!targetOrg) {
        setLoginError('You do not have access to this organisation.')
        return
      }
      if (!STAFF_ROLES.includes(targetOrg.role)) {
        if (targetOrg.menteeId) {
          window.location.assign(`/#/learner/${encodeURIComponent(targetOrg.menteeId)}`)
          return
        }
        setLoginError('Workspace access requires an Owner, Admin, or Mentor role.')
        return
      }
      setActiveOrg(targetOrg)
      setActiveOrganisationId(targetOrg.id)
      applyDashboardData(await loadDashboardData())
      setAuthStatus('authenticated')
    } catch (error) {
      setLoginError(error.message)
    } finally {
      setLoginLoading(false)
    }
  }

  async function handleSetup(event) {
    event.preventDefault()
    setSetupLoading(true)
    setSetupError('')
    setApiError('')
    try {
      const { user, organisation, organisations: orgList = [], csrfToken: token } = await apiRequest('/auth/setup', {
        method: 'POST',
        body: setupForm,
        csrfToken,
      })
      cacheCsrfToken(token)
      setCsrfToken(token)
      setAdmin(user)
      setOrganisations(orgList)
      setActiveOrg(organisation)
      if (organisation?.id) setActiveOrganisationId(organisation.id)
      applyDashboardData(await loadDashboardData())
      setSetupForm({ name: '', email: '', password: '', confirmPassword: '', setupCode: '' })
      setAuthStatus('authenticated')
    } catch (error) {
      setSetupError(error.message)
    } finally {
      setSetupLoading(false)
    }
  }

  async function handleLogout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST', csrfToken })
      clearWorkspaceState()
      setAuthStatus('unauthenticated')
      clearCsrfTokenCache()
      const { csrfToken: token } = await requestCsrfToken()
      setCsrfToken(token)
    } catch (error) {
      handleApiError(error)
    }
  }

  return {
    authStatus,
    admin,
    organisations,
    activeOrg,
    devVerifyToken,
    csrfToken,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    loginError,
    loginLoading,
    setupForm,
    setSetupForm,
    setSetupError,
    setupError,
    setupLoading,
    apiError,
    setApiError,
    handleApiError,
    withAuth,
    handleLogin,
    handleSetup,
    handleLogout,
    handleResendVerification,
    selectOrganisation,
    createOrganisation,
  }
}
