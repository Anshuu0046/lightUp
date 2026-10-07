import { useState } from 'react'
import { LogOut, Shield, UserRound } from 'lucide-react'
import { cloudEnabled, sendCode, signOut, useAccount, verifyCode } from './supabase'
import './cloud.css'

/** Sign-in / account menu. Renders nothing when accounts aren't configured. */
export function AccountButton() {
  const { session, profile, loading, isAdmin } = useAccount()
  const [open, setOpen] = useState(false)
  const [signing, setSigning] = useState(false)
  if (!cloudEnabled || loading) return null
  if (!session) return <>
    <button className="cl-btn" onClick={() => setSigning(true)}><UserRound size={15} /> Sign in</button>
    {signing && <SignIn onClose={() => setSigning(false)} />}
  </>
  const label = profile?.name || session.user.email || 'Account'
  return <div className="cl-account">
    <button className="cl-avatar" onClick={() => setOpen(o => !o)} aria-label="Account" aria-expanded={open}>{label.slice(0, 1).toUpperCase()}</button>
    {open && <div className="cl-menu" role="menu" onMouseLeave={() => setOpen(false)}>
      <div className="cl-menu-head"><b>{label}</b><small>{session.user.email}</small></div>
      {isAdmin && <a role="menuitem" href="#/admin"><Shield size={14} /> Admin panel</a>}
      <button role="menuitem" onClick={() => { signOut(); setOpen(false) }}><LogOut size={14} /> Sign out</button>
    </div>}
  </div>
}

export function SignIn({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (f: () => Promise<void>) => { setBusy(true); setError(''); try { await f() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) } }

  return <div className="cl-back" onMouseDown={onClose}>
    <form className="cl-modal" onMouseDown={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); run(async () => { if (step === 'email') { await sendCode(email); setStep('code') } else { await verifyCode(email, code); onClose() } }) }}>
      <h2>{step === 'email' ? 'Sign in' : 'Check your email'}</h2>
      <p>{step === 'email' ? 'Save projects to your account and open them on any device. We’ll email you a 6-digit code: no password needed.' : `We sent a code to ${email}. Enter it below.`}</p>
      {step === 'email'
        ? <input className="cl-input" type="email" required autoFocus placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
        : <input className="cl-input code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus placeholder="123456" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" />}
      {error && <p className="cl-error">{error}</p>}
      <button className="cl-btn primary block" disabled={busy}>{busy ? 'One moment…' : step === 'email' ? 'Email me a code' : 'Sign in'}</button>
      {step === 'code' && <button type="button" className="cl-btn block" onClick={() => { setStep('email'); setCode('') }}>Use a different email</button>}
      <button type="button" className="cl-btn block ghost" onClick={onClose}>Cancel</button>
    </form>
  </div>
}
