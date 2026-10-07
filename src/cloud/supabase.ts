import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

/**
 * Accounts and cloud features are optional: with no Supabase keys the app runs fully on the device.
 * Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example) to switch them on.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null
export const cloudEnabled = !!supabase

export type Profile = { id: string; email: string | null; name: string | null; role: 'user' | 'admin'; banned: boolean; created_at: string; last_seen: string | null }

/** The signed-in user and their profile, kept up to date */
export function useAccount() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(cloudEnabled)
  useEffect(() => {
    if (!supabase) return
    const sb = supabase
    const load = async (s: Session | null) => {
      setSession(s)
      if (!s) { setProfile(null); setLoading(false); return }
      const { data } = await sb.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
      setProfile(data as Profile | null); setLoading(false)
      sb.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', s.user.id).then(() => {})
    }
    sb.auth.getSession().then(({ data }) => load(data.session))
    const { data } = sb.auth.onAuthStateChange((_e, s) => { load(s) })
    return () => data.subscription.unsubscribe()
  }, [])
  return { session, profile, loading, isAdmin: profile?.role === 'admin' && !profile.banned }
}

/** Step 1 of signing in: email a 6-digit code (works in the browser and the desktop app alike) */
export async function sendCode(email: string) {
  if (!supabase) throw new Error('Accounts aren’t set up.')
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
  if (error) throw new Error(error.message)
}
/** Step 2: check the code */
export async function verifyCode(email: string, token: string) {
  if (!supabase) throw new Error('Accounts aren’t set up.')
  const { error } = await supabase.auth.verifyOtp({ email, token: token.trim(), type: 'email' })
  if (error) throw new Error(error.message.includes('expired') ? 'That code has expired. Send a new one.' : 'That code didn’t match. Check it and try again.')
}
export const signOut = () => supabase?.auth.signOut()

/** Records a usage event for the admin dashboard (signed-in users only; never blocks the app) */
export function track(type: string, meta: Record<string, unknown> = {}) {
  if (!supabase) return
  supabase.auth.getSession().then(({ data }) => { if (data.session) supabase!.from('events').insert({ type, meta }).then(() => {}) })
}
