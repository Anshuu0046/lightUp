import { useState } from 'react'
import { LogOut, Shield, UserRound } from 'lucide-react'
import { cloudEnabled, signOut, useAccount } from './supabase'
import { AuthForm } from './Login'
import './cloud.css'

/** Sign-in / account menu. Renders nothing when accounts aren't configured. */
export function AccountButton() {
  const { session, profile, loading, isAdmin } = useAccount()
  const [open, setOpen] = useState(false)
  if (!cloudEnabled || loading) return null
  // the sign-in page brings you back here afterwards
  const here = location.hash.slice(2).split('?')[0]
  if (!session) return <a className="cl-btn" href={`#/login${here ? `?next=${here}` : ''}`}><UserRound size={15} /> Sign in</a>
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

/** Sign-in as a pop-up, for places that shouldn't leave the page (saving to the cloud from the editor, the admin panel) */
export function SignIn({ onClose }: { onClose: () => void }) {
  return <div className="cl-back" onMouseDown={onClose}>
    <div className="cl-modal" onMouseDown={e => e.stopPropagation()}><AuthForm onDone={onClose} /></div>
  </div>
}
