import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react'
import { cloudEnabled, confirmSignUp, sendCode, setPassword, signInWithGoogle, signInWithPassword, signOut, signUp, useAccount, verifyCode } from './supabase'
import { isNative } from '../native'
import { Bust } from '../landing/Bust'
import './login.css'

type Mode = 'signin' | 'signup'
/** form: email and password; code: the 6-digit code we emailed (to confirm a new account, or to sign in without a password); reset: choose a new password */
type Step = 'form' | 'code' | 'reset'
type CodeFor = 'signup' | 'signin' | 'forgot'

// the website can come back from Google; the desktop and Android apps can't receive that redirect
const googleWorks = !isNative && location.protocol.startsWith('http')

/** Sign in and create an account. Used by the full page and by the pop-up inside the editor. */
export function AuthForm({ start = 'signin', onDone }: { start?: Mode; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>(start)
  const [step, setStep] = useState<Step>('form')
  const [codeFor, setCodeFor] = useState<CodeFor>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPw] = useState('')
  const [code, setCode] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const run = async (f: () => Promise<void>) => { setBusy(true); setError(''); try { await f() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) } }
  const askCode = (why: CodeFor) => run(async () => {
    if (!email) throw new Error('Enter your email first.')
    await sendCode(email); setCodeFor(why); setCode(''); setStep('code')
    setNote(why === 'forgot' ? 'Enter the code to sign in, then choose a new password.' : '')
  })

  const submit = () => run(async () => {
    if (step === 'form' && mode === 'signin') { await signInWithPassword(email, password); onDone(); return }
    if (step === 'form') {
      if (password.length < 8) throw new Error('Use a password of at least 8 characters.')
      if (await signUp(email, password, name.trim())) { setCodeFor('signup'); setCode(''); setStep('code') } else onDone()
      return
    }
    if (step === 'code') {
      if (codeFor === 'signup') await confirmSignUp(email, code); else await verifyCode(email, code)
      if (codeFor === 'forgot') { setPw(''); setStep('reset') } else onDone()
      return
    }
    if (password.length < 8) throw new Error('Use a password of at least 8 characters.')
    await setPassword(password); onDone()
  })

  const switchMode = (m: Mode) => { setMode(m); setStep('form'); setError(''); setNote('') }
  const title = step === 'code' ? 'Check your email' : step === 'reset' ? 'Choose a new password' : mode === 'signin' ? 'Welcome back' : 'Create your account'
  const sub = step === 'code' ? `We sent a 6-digit code to ${email}.` : step === 'reset' ? 'You’re signed in. Pick a password for next time.'
    : mode === 'signin' ? 'Sign in to keep your projects in sync across your devices.' : 'Free. Save projects to the cloud and pick up on any device.'

  return <form className="auth" onSubmit={e => { e.preventDefault(); submit() }} noValidate>
    {step === 'form' && <div className="auth-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => switchMode('signin')}>Sign in</button>
      <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => switchMode('signup')}>Create account</button>
      <i style={{ transform: mode === 'signup' ? 'translateX(100%)' : 'none' }} aria-hidden />
    </div>}
    {step !== 'form' && <button type="button" className="auth-back" onClick={() => { setStep('form'); setError(''); setNote('') }}><ArrowLeft size={14} /> Back</button>}

    <h2>{title}</h2>
    <p className="auth-sub">{sub}</p>

    {step === 'form' && <>
      {googleWorks && <>
        <button type="button" className="auth-google" disabled={busy} onClick={() => run(() => signInWithGoogle(new URLSearchParams(location.hash.split('?')[1] ?? '').get('next') ?? ''))}><GoogleMark /> Continue with Google</button>
        <div className="auth-or"><span>or with email</span></div>
      </>}
      {mode === 'signup' && <label className="auth-field"><span>Your name</span><input value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="How should we call you?" /></label>}
      <label className="auth-field"><span>Email</span><input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" autoFocus /></label>
      <label className="auth-field"><span>Password {mode === 'signin' && <button type="button" className="auth-link" onClick={() => askCode('forgot')}>Forgot?</button>}</span>
        <div className="auth-pw">
          <input type={show ? 'text' : 'password'} required minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={e => setPw(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'} />
          <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
        {mode === 'signup' && password && <Strength pw={password} />}
      </label>
    </>}

    {step === 'code' && <label className="auth-field"><span>Code</span><input className="auth-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" autoFocus /></label>}
    {step === 'reset' && <label className="auth-field"><span>New password</span><div className="auth-pw">
      <input type={show ? 'text' : 'password'} value={password} onChange={e => setPw(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" autoFocus />
      <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
      {password && <Strength pw={password} />}</label>}

    {note && <p className="auth-note">{note}</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <button className="auth-submit" disabled={busy || (step === 'code' && code.length !== 6)}>
      {busy ? <span className="auth-spin" /> : <>{step === 'code' ? 'Continue' : step === 'reset' ? 'Save password' : mode === 'signin' ? 'Sign in' : 'Create account'} <ArrowRight size={16} /></>}
    </button>
    {step === 'form' && mode === 'signin' && <button type="button" className="auth-alt" disabled={busy} onClick={() => askCode('signin')}>Email me a sign-in code instead</button>}
    {step === 'code' && <button type="button" className="auth-alt" disabled={busy} onClick={() => codeFor === 'signup' ? run(async () => { await signUp(email, password, name.trim()); setNote('We sent a new code.') }) : askCode(codeFor)}>Send a new code</button>}
  </form>
}

function Strength({ pw }: { pw: string }) {
  const score = Math.min(4, (pw.length >= 8 ? 1 : 0) + (pw.length >= 12 ? 1 : 0) + (/[A-Z]/.test(pw) && /[a-z]/.test(pw) ? 1 : 0) + (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw) ? 1 : 0))
  return <div className="auth-strength" data-score={score} aria-live="polite"><i /><i /><i /><i /><small>{['Too short', 'Okay', 'Good', 'Strong', 'Very strong'][score]}</small></div>
}

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
}

/** #/login: the full sign-in page. ?next=live|edit|admin returns there afterwards; ?mode=signup opens on Create account. */
export default function LoginPage() {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const next = params.get('next') ?? ''
  const { session, profile, loading } = useAccount()
  const done = () => { location.hash = next ? `/${next}` : '' }
  // already signed in and sent here to get in: carry straight on
  useEffect(() => { if (session && next) location.replace(`#/${next}`) }, [session, next])
  const [hue, setHue] = useState(0)
  useEffect(() => { const t = setInterval(() => setHue(h => (h + 1) % LAMPS.length), 2400); return () => clearInterval(t) }, [])

  return <div className="login">
    <aside className="login-art" style={{ '--lamp': LAMPS[hue] } as React.CSSProperties}>
      <Bust light="rgb" id="login" color={LAMPS[hue]} cover />
      <div className="login-art-copy">
        <a className="login-brand" href="#"><span className="lbrand-ring" /> Light Up</a>
        <p className="login-line">Good light used to mean a ring light, a softbox and a spare room. <em>Now it’s a click.</em></p>
        <small>Your studio, your projects, on every device.</small>
      </div>
    </aside>
    <main className="login-main">
      <a className="login-home" href="#"><ArrowLeft size={14} /> Home</a>
      <div className="login-card">
        {!cloudEnabled ? <div className="auth">
          <h2>Accounts are almost here</h2>
          <p className="auth-sub">Everything in Light Up already works without one: your projects save on this device. Sign-in turns on as soon as accounts are set up for this site.</p>
          <a className="auth-submit" href="#/live">Open the studio <ArrowRight size={16} /></a>
        </div>
        : loading ? <div className="auth"><span className="auth-spin big" /></div>
        : session ? <div className="auth">
          <h2>You’re signed in</h2>
          <p className="auth-sub">as <b>{profile?.name || session.user.email}</b></p>
          <button className="auth-submit" onClick={done}>Continue <ArrowRight size={16} /></button>
          <button className="auth-alt" onClick={() => signOut()}>Sign out</button>
        </div>
        : <AuthForm start={params.get('mode') === 'signup' ? 'signup' : 'signin'} onDone={done} />}
      </div>
      <p className="login-fine">By continuing you agree to use Light Up kindly. Your videos stay on your device unless you save them to your account.</p>
    </main>
  </div>
}

const LAMPS = ['#9d6bff', '#ff5aa8', '#22c7ff', '#ff8a3d', '#3cf08a']
