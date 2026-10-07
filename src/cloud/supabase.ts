import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

/**
 * Accounts and cloud features are optional: with no Supabase keys the app runs fully on the device.
 * Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example) to switch them on.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, flowType: 'pkce' } }) : null
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
  if (error) throw new Error(friendly(error.message))
}
/** Step 2: check the code */
export async function verifyCode(email: string, token: string) {
  if (!supabase) throw new Error('Accounts aren’t set up.')
  const { error } = await supabase.auth.verifyOtp({ email, token: token.trim(), type: 'email' })
  if (error) throw new Error(friendly(error.message))
}
export const signOut = () => supabase?.auth.signOut()

/** Supabase's messages, in plain words */
function friendly(message: string) {
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match.'
  if (/already registered|already been registered/i.test(message)) return 'There’s already an account with this email. Sign in instead.'
  if (/email not confirmed/i.test(message)) return 'Confirm your email first: enter the code we sent you, or sign in with a code.'
  if (/password should be at least/i.test(message)) return 'Use a password of at least 8 characters.'
  if (/provider is not enabled|unsupported provider/i.test(message)) return 'Google sign-in isn’t switched on yet. Use your email instead.'
  if (/rate limit|too many/i.test(message)) return 'Too many tries. Wait a minute and try again.'
  if (/expired|invalid.*otp|token/i.test(message)) return 'That code didn’t work. Check it, or send a new one.'
  return message
}
function sb() { if (!supabase) throw new Error('Accounts aren’t set up.'); return supabase }

export async function signInWithPassword(email: string, password: string) {
  const { error } = await sb().auth.signInWithPassword({ email, password })
  if (error) throw new Error(friendly(error.message))
}
/** Creates the account. Returns true when the email still has to be confirmed with the 6-digit code that was sent. */
export async function signUp(email: string, password: string, name: string) {
  const { data, error } = await sb().auth.signUp({ email, password, options: { data: { full_name: name } } })
  if (error) throw new Error(friendly(error.message))
  // Supabase answers an existing, confirmed email with a user that has no identities instead of an error
  if (data.user && !data.user.identities?.length) throw new Error(friendly('already registered'))
  return !data.session
}
export async function confirmSignUp(email: string, token: string) {
  const { error } = await sb().auth.verifyOtp({ email, token: token.trim(), type: 'signup' })
  if (error) throw new Error(friendly(error.message))
}
export async function setPassword(password: string) {
  const { error } = await sb().auth.updateUser({ password })
  if (error) throw new Error(friendly(error.message))
}
/** Google, on the website only (the desktop and Android apps can't receive the redirect back) */
export async function signInWithGoogle() {
  const { error } = await sb().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } })
  if (error) throw new Error(friendly(error.message))
}

/** Records a usage event for the admin dashboard (signed-in users only; never blocks the app) */
export function track(type: string, meta: Record<string, unknown> = {}) {
  if (!supabase) return
  supabase.auth.getSession().then(({ data }) => { if (data.session) supabase!.from('events').insert({ type, meta }).then(() => {}) })
}
