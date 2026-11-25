// Single source of truth for invitation state, used by the shell (nav badge)
// and the Invitations view (status pills). Revoked wins over everything.
export function getInvitationState(invite) {
  if (invite.state) return invite.state
  if (invite.revoked) return 'Revoked'
  const expiresAt = invite.expiresAt || (invite.expires ? `${invite.expires}T23:59:59` : null)
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return 'Expired'
  if (invite.uses >= invite.maxUses) return 'Exhausted'
  return 'Active'
}
