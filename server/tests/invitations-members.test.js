import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootstrapAdmin, createTestContext } from './helpers.js'

test('members and invitations persist, validate hashed tokens, and handle acceptance idempotently', async () => {
  const { db, agent } = createTestContext({
    orgName: 'Bright Minds',
    orgSlug: 'bright-minds',
  })
  const adminClient = agent()
  const inviteeClient = agent()

  assert.equal((await inviteeClient.get('/api/members')).status, 401)
  assert.equal((await inviteeClient.get('/api/invitations')).status, 401)

  const setupRes = await bootstrapAdmin(adminClient, { name: 'Alex Owner', email: 'owner@example.test' })
  assert.equal(setupRes.status, 200)
  const csrfToken = setupRes.body.csrfToken

  const initialMembers = await adminClient.get('/api/members')
  assert.equal(initialMembers.status, 200)
  assert.equal(initialMembers.body.organisation.name, 'Bright Minds')
  assert.equal(initialMembers.body.members.length, 1)
  const ownerMember = initialMembers.body.members[0]
  assert.equal(ownerMember.role, 'Owner')
  assert.equal(ownerMember.email, 'owner@example.test')

  // Owner cannot be modified or removed
  assert.equal((await adminClient.patch(`/api/members/${ownerMember.id}`).set('X-CSRF-Token', csrfToken).send({ role: 'Mentor' })).status, 403)
  assert.equal((await adminClient.delete(`/api/members/${ownerMember.id}`).set('X-CSRF-Token', csrfToken)).status, 403)

  // Create reusable code invite (maxUses = 2)
  const codeInviteRes = await adminClient.post('/api/invitations')
    .set('X-CSRF-Token', csrfToken)
    .send({ type: 'code', role: 'Mentee', days: 7, maxUses: 2 })
  assert.equal(codeInviteRes.status, 201)
  const codeInvite = codeInviteRes.body.invitation
  assert.ok(codeInvite.token.startsWith('MUNA-'))
  assert.equal(codeInvite.state, 'Active')

  // Admin list never leaks token or token_hash
  const listedInvites = await adminClient.get('/api/invitations')
  assert.equal(listedInvites.status, 200)
  assert.equal(listedInvites.body.invitations.length, 1)
  assert.equal(listedInvites.body.invitations[0].token, undefined)
  assert.equal(listedInvites.body.invitations[0].token_hash, undefined)

  // Public preview works without admin session
  const preview = await inviteeClient.get(`/api/invitations/${codeInvite.token}`)
  assert.equal(preview.status, 200)
  assert.equal(preview.body.invitation.organisationName, 'Bright Minds')
  assert.equal(preview.body.invitation.role, 'Mentee')

  // Public accept requires CSRF and validates inputs
  const inviteeCsrfRes = await inviteeClient.get('/api/auth/csrf')
  const inviteeCsrf = inviteeCsrfRes.body.csrfToken

  const accept1 = await inviteeClient.post(`/api/invitations/${codeInvite.token}/accept`)
    .set('X-CSRF-Token', inviteeCsrf)
    .send({ name: 'Ada Lovelace', email: 'ada@example.test', password: 'password-1234' })
  assert.equal(accept1.status, 201)
  assert.equal(accept1.body.alreadyMember, false)
  assert.equal(accept1.body.member.role, 'Mentee')
  assert.ok(accept1.body.menteeId)

  // Duplicate acceptance is idempotent and does not consume a second use
  const duplicateBadPw = await inviteeClient.post(`/api/invitations/${codeInvite.token}/accept`)
    .set('X-CSRF-Token', inviteeCsrf)
    .send({ name: 'Ada Lovelace', email: 'ada@example.test', password: 'wrong-password' })
  assert.equal(duplicateBadPw.status, 401)

  const duplicateOk = await inviteeClient.post(`/api/invitations/${codeInvite.token}/accept`)
    .set('X-CSRF-Token', inviteeCsrf)
    .send({ name: 'Ada Lovelace', email: 'ada@example.test', password: 'password-1234' })
  assert.equal(duplicateOk.status, 200)
  assert.equal(duplicateOk.body.alreadyMember, true)

  // Second user consumes the 2nd and final use
  const accept2 = await inviteeClient.post(`/api/invitations/${codeInvite.token}/accept`)
    .set('X-CSRF-Token', inviteeCsrf)
    .send({ name: 'Grace Hopper', email: 'grace@example.test', password: 'password-1234' })
  assert.equal(accept2.status, 201)

  // Exhausted code is rejected
  const exhausted = await inviteeClient.post(`/api/invitations/${codeInvite.token}/accept`)
    .set('X-CSRF-Token', inviteeCsrf)
    .send({ name: 'Alan Turing', email: 'alan@example.test', password: 'password-1234' })
  assert.equal(exhausted.status, 410)

  // Email-specific invite rejects mismatched email and accepts matching email
  const emailInviteRes = await adminClient.post('/api/invitations')
    .set('X-CSRF-Token', csrfToken)
    .send({ type: 'email', email: 'mentor@example.test', role: 'Mentor', days: 7 })
  assert.equal(emailInviteRes.status, 201)
  const emailToken = emailInviteRes.body.invitation.token

  const wrongEmail = await inviteeClient.post(`/api/invitations/${emailToken}/accept`)
    .set('X-CSRF-Token', inviteeCsrf)
    .send({ name: 'Wrong User', email: 'other@example.test', password: 'password-1234' })
  assert.equal(wrongEmail.status, 403)

  const rightEmail = await inviteeClient.post(`/api/invitations/${emailToken}/accept`)
    .set('X-CSRF-Token', inviteeCsrf)
    .send({ name: 'Dana Mentor', email: 'mentor@example.test', password: 'password-1234' })
  assert.equal(rightEmail.status, 201)
  assert.equal(rightEmail.body.member.role, 'Mentor')

  // Revoked and expired invites are rejected
  const revokeInviteRes = await adminClient.post('/api/invitations')
    .set('X-CSRF-Token', csrfToken)
    .send({ type: 'code', role: 'Mentee', days: 7, maxUses: 5 })
  const revokeId = revokeInviteRes.body.invitation.id
  const revokeToken = revokeInviteRes.body.invitation.token
  const revoked = await adminClient.delete(`/api/invitations/${revokeId}`).set('X-CSRF-Token', csrfToken)
  assert.equal(revoked.status, 200)
  assert.equal(revoked.body.invitation.state, 'Revoked')
  assert.equal((await inviteeClient.get(`/api/invitations/${revokeToken}`)).status, 410)

  const expiredInviteRes = await adminClient.post('/api/invitations')
    .set('X-CSRF-Token', csrfToken)
    .send({ type: 'code', role: 'Mentee', days: 7, maxUses: 5 })
  const expiredId = expiredInviteRes.body.invitation.id
  const expiredToken = expiredInviteRes.body.invitation.token
  db.prepare('UPDATE invitations SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', expiredId)
  assert.equal((await inviteeClient.get(`/api/invitations/${expiredToken}`)).status, 410)

  // Admin can update role, suspend/restore, and remove members, plus mentees roster synced
  const membersAfter = await adminClient.get('/api/members')
  assert.equal(membersAfter.body.members.length, 4)
  const mentorMember = membersAfter.body.members.find((m) => m.email === 'mentor@example.test')
  const updatedRole = await adminClient.patch(`/api/members/${mentorMember.id}`)
    .set('X-CSRF-Token', csrfToken)
    .send({ role: 'Admin', status: 'Suspended' })
  assert.equal(updatedRole.status, 200)
  assert.equal(updatedRole.body.member.role, 'Admin')
  assert.equal(updatedRole.body.member.status, 'Suspended')

  const removed = await adminClient.delete(`/api/members/${mentorMember.id}`).set('X-CSRF-Token', csrfToken)
  assert.equal(removed.status, 200)
  const membersFinal = await adminClient.get('/api/members')
  assert.equal(membersFinal.body.members.length, 3)

  const menteesList = await adminClient.get('/api/mentees')
  assert.ok(menteesList.body.mentees.some((m) => m.email === 'ada@example.test'))
  assert.ok(menteesList.body.mentees.some((m) => m.email === 'grace@example.test'))

  db.close()
})
