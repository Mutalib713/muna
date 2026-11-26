import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [memberships, setMemberships] = useState([])
  const [activeOrgId, setActiveOrgId] = useState(() => {
    try {
      return localStorage.getItem('muna.activeOrgId') || null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(isSupabaseConfigured)

  const fetchMemberships = useCallback(async (userId) => {
    if (!supabase || !userId) {
      setMemberships([])
      return []
    }
    const { data, error } = await supabase
      .from('memberships')
      .select('id, role, status, organisation_id, organisations ( id, name, slug, status )')
      .eq('user_id', userId)
      .eq('status', 'active')

    if (error) {
      console.error('Failed to load memberships:', error.message)
      return []
    }

    const list = data || []
    setMemberships(list)

    if (list.length > 0) {
      setActiveOrgId((prev) => {
        const stillValid = prev && list.some((m) => m.organisation_id === prev)
        const nextId = stillValid ? prev : list[0].organisation_id
        try {
          localStorage.setItem('muna.activeOrgId', nextId)
        } catch {
          // ignore storage errors
        }
        return nextId
      })
    }
    return list
  }, [])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    let mounted = true

    supabase.auth.getSession().then(async ({ data: { session: initialSession } }) => {
      if (!mounted) return
      setSession(initialSession)
      setUser(initialSession?.user ?? null)
      if (initialSession?.user) {
        await fetchMemberships(initialSession.user.id)
      }
      if (mounted) setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(
      async (_event, nextSession) => {
        if (!mounted) return
        setSession(nextSession)
        setUser(nextSession?.user ?? null)
        if (nextSession?.user) {
          await fetchMemberships(nextSession.user.id)
        } else {
          setMemberships([])
          setActiveOrgId(null)
        }
      },
    )

    return () => {
      mounted = false
      subscription.subscription.unsubscribe()
    }
  }, [fetchMemberships])

  const selectOrganisation = useCallback((orgId) => {
    setActiveOrgId(orgId)
    try {
      localStorage.setItem('muna.activeOrgId', orgId)
    } catch {
      // ignore storage errors
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setMemberships([])
    setActiveOrgId(null)
    try {
      localStorage.removeItem('muna.activeOrgId')
    } catch {
      // ignore storage errors
    }
  }, [])

  const activeMembership =
    memberships.find((m) => m.organisation_id === activeOrgId) || memberships[0] || null

  const value = {
    isConfigured: isSupabaseConfigured,
    loading,
    session,
    user,
    memberships,
    activeMembership,
    activeOrganisation: activeMembership?.organisations || null,
    selectOrganisation,
    refreshMemberships: () => (user ? fetchMemberships(user.id) : Promise.resolve([])),
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
