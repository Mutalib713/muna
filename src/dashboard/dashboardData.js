// Org-plane demo records. Questions, answers and flags are now loaded from
// the admin API (see services/adminApi.js); members and invitations remain
// local until the backend exposes organisation endpoints.

// Learners here mirror the names used in answers and integrity flags so the
// demo world stays consistent across views.
export const initialMembers = [
  { id: 'M-001', name: 'Alex Morgan', initials: 'AM', email: 'alex@brightminds.edu', role: 'Owner', status: 'Active', joined: 'Sep 2, 2026' },
  { id: 'M-002', name: 'Dana Whitfield', initials: 'DW', email: 'dana@brightminds.edu', role: 'Mentor', status: 'Active', joined: 'Sep 14, 2026' },
  { id: 'M-003', name: 'Sarah Osei', initials: 'SO', email: 'sarah@brightminds.edu', role: 'Mentor', status: 'Active', joined: 'Oct 1, 2026' },
  { id: 'M-004', name: 'Amara Okafor', initials: 'AO', email: 'amara@brightminds.edu', role: 'Mentee', status: 'Active', joined: 'Oct 5, 2026' },
  { id: 'M-005', name: 'Daniel Mensah', initials: 'DM', email: 'daniel@brightminds.edu', role: 'Mentee', status: 'Active', joined: 'Oct 5, 2026' },
  { id: 'M-006', name: 'Sofia Chen', initials: 'SC', email: 'sofia@brightminds.edu', role: 'Mentee', status: 'Active', joined: 'Oct 12, 2026' },
  { id: 'M-007', name: 'Kwame Boateng', initials: 'KB', email: 'kwame@brightminds.edu', role: 'Mentee', status: 'Active', joined: 'Oct 12, 2026' },
  { id: 'M-008', name: 'Priya Patel', initials: 'PP', email: 'priya@brightminds.edu', role: 'Mentee', status: 'Active', joined: 'Oct 19, 2026' },
  { id: 'M-009', name: 'Jordan Lee', initials: 'JL', email: 'jordan@brightminds.edu', role: 'Mentee', status: 'Active', joined: 'Nov 2, 2026' },
  { id: 'M-010', name: 'Fatima Yusuf', initials: 'FY', email: 'fatima@brightminds.edu', role: 'Mentee', status: 'Active', joined: 'Nov 2, 2026' },
  { id: 'M-011', name: 'Ethan Williams', initials: 'EW', email: 'ethan@brightminds.edu', role: 'Mentee', status: 'Suspended', joined: 'Nov 9, 2026' },
]

// Invitation records modelled on PRD §5: organisation, intended role,
// expiry, max uses, current uses and revocation state.
export const initialInvitations = [
  { id: 'INV-7F3K2M', type: 'code', email: null, role: 'Mentee', created: 'Nov 20, 2026', expires: '2026-11-27', maxUses: 10, uses: 4, revoked: false },
  { id: 'INV-K9QX4B', type: 'email', email: 'amelia.cole@brightminds.edu', role: 'Mentee', created: 'Nov 22, 2026', expires: '2026-11-29', maxUses: 1, uses: 0, revoked: false },
  { id: 'INV-M2WL8C', type: 'code', email: null, role: 'Mentor', created: 'Nov 10, 2026', expires: '2026-11-17', maxUses: 5, uses: 2, revoked: false },
  { id: 'INV-P8TR5N', type: 'code', email: null, role: 'Mentee', created: 'Nov 12, 2026', expires: '2026-12-12', maxUses: 3, uses: 3, revoked: false },
  { id: 'INV-R4YY6D', type: 'email', email: 'noah.b@brightminds.edu', role: 'Mentee', created: 'Nov 15, 2026', expires: '2026-11-22', maxUses: 1, uses: 0, revoked: true },
]

// Single source of truth for invitation state, used by the shell (nav badge)
// and the Invitations view (status pills). Revoked wins over everything.
export function getInvitationState(invite) {
  if (invite.revoked) return 'Revoked'
  if (new Date(`${invite.expires}T23:59:59`) < new Date()) return 'Expired'
  if (invite.uses >= invite.maxUses) return 'Exhausted'
  return 'Active'
}
