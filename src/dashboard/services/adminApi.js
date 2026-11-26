let activeOrganisationId = ''

export function setActiveOrganisationId(organisationId) {
  activeOrganisationId = organisationId || ''
}

export function getActiveOrganisationId() {
  return activeOrganisationId
}

async function apiRequest(path, { method = 'GET', body, csrfToken, organisationId } = {}) {
  const headers = {}
  const orgId = organisationId !== undefined ? organisationId : activeOrganisationId
  if (orgId) headers['X-Organisation-Id'] = orgId
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) {
    const error = new Error(payload.error || 'The request could not be completed.')
    error.status = response.status
    error.payload = payload
    throw error
  }
  return payload
}

let csrfTokenRequest

export function requestCsrfToken() {
  if (!csrfTokenRequest) {
    csrfTokenRequest = apiRequest('/auth/csrf').catch((error) => {
      csrfTokenRequest = null
      throw error
    })
  }
  return csrfTokenRequest
}

export function cacheCsrfToken(token) {
  csrfTokenRequest = Promise.resolve({ csrfToken: token })
}

export function clearCsrfTokenCache() {
  csrfTokenRequest = null
}

export async function loadDashboardData() {
  const [questions, answers, flags, summary, mentees, assessments, membersData, invitationsData] = await Promise.all([
    apiRequest('/questions'),
    apiRequest('/answers'),
    apiRequest('/flags'),
    apiRequest('/dashboard/summary'),
    apiRequest('/mentees'),
    apiRequest('/assessments'),
    apiRequest('/members'),
    apiRequest('/invitations'),
  ])
  return {
    questions: questions.questions,
    answers: answers.answers,
    flags: flags.flags,
    summary,
    mentees: mentees.mentees,
    assessments: assessments.assessments,
    organisation: membersData.organisation,
    members: membersData.members,
    invitations: invitationsData.invitations,
    pagination: {
      questions: questions.pagination,
      answers: answers.pagination,
      flags: flags.pagination,
      mentees: mentees.pagination,
      assessments: assessments.pagination,
    },
  }
}

export function loadResourcePage(resource, page = 1) {
  return apiRequest(`/${resource}?page=${encodeURIComponent(page)}`)
}

export default apiRequest
