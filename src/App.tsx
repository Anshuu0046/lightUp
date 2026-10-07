import { lazy, Suspense, useEffect, useState } from 'react'
import LiveApp from './live/LiveApp'
import Landing from './landing/Landing'
import { cloudEnabled, useAccount } from './cloud/supabase'
import './home.css'

const Editor = lazy(() => import('./editor/Editor'))
const Admin = lazy(() => import('./admin/Admin'))
const Login = lazy(() => import('./cloud/Login'))

export type Route = 'home' | 'live' | 'edit' | 'admin' | 'login'
const routeOf = (): Route => { const r = location.hash.slice(2).split('?')[0]; return r === 'live' || r === 'edit' || r === 'admin' || r === 'login' ? r : 'home' }
export const go = (r: Route) => { location.hash = r === 'home' ? '' : `/${r}` }

export default function App() {
  const [route, setRoute] = useState<Route>(routeOf)
  const { session } = useAccount()
  // back from Google sign-in: carry on to the page that was asked for
  useEffect(() => { if (!session) return; try { const n = sessionStorage.getItem('lightup-next'); if (n) { sessionStorage.removeItem('lightup-next'); location.replace(`#/${n}`) } } catch { /* private mode */ } }, [session])
  useEffect(() => { const on = () => setRoute(routeOf()); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on) }, [])
  if (route === 'live') return <Gate route={route}><LiveApp /></Gate>
  if (route === 'admin') return <Suspense fallback={<div className="home-loading">Opening the admin panel…</div>}><Admin /></Suspense>
  if (route === 'edit') return <Gate route={route}><Suspense fallback={<div className="home-loading">Opening the editor…</div>}><Editor /></Suspense></Gate>
  if (route === 'login') return <Suspense fallback={<div className="home-loading" />}><Login /></Suspense>
  return <Landing />
}

/**
 * The studio and the editor are for signed-in people: anyone else is sent to the sign-in page and brought back afterwards.
 * Where accounts aren't set up (no Supabase keys), nothing is gated, so the app still works fully on the device.
 */
function Gate({ route, children }: { route: Route; children: React.ReactNode }) {
  const { session, profile, loading } = useAccount()
  const blocked = cloudEnabled && !loading && !session
  useEffect(() => { if (blocked) location.replace(`#/login?next=${route}`) }, [blocked, route])
  if (!cloudEnabled) return <>{children}</>
  if (loading || blocked) return <div className="home-loading" />
  if (profile?.banned) return <div className="home-loading">This account has been suspended.</div>
  return <>{children}</>
}
