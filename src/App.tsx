import { lazy, Suspense, useEffect, useState } from 'react'
import LiveApp from './live/LiveApp'
import Landing from './landing/Landing'
import './home.css'

const Editor = lazy(() => import('./editor/Editor'))
const Admin = lazy(() => import('./admin/Admin'))
const Login = lazy(() => import('./cloud/Login'))

export type Route = 'home' | 'live' | 'edit' | 'admin' | 'login'
const routeOf = (): Route => { const r = location.hash.slice(2).split('?')[0]; return r === 'live' || r === 'edit' || r === 'admin' || r === 'login' ? r : 'home' }
export const go = (r: Route) => { location.hash = r === 'home' ? '' : `/${r}` }

export default function App() {
  const [route, setRoute] = useState<Route>(routeOf)
  useEffect(() => { const on = () => setRoute(routeOf()); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on) }, [])
  if (route === 'live') return <LiveApp />
  if (route === 'admin') return <Suspense fallback={<div className="home-loading">Opening the admin panel…</div>}><Admin /></Suspense>
  if (route === 'edit') return <Suspense fallback={<div className="home-loading">Opening the editor…</div>}><Editor /></Suspense>
  if (route === 'login') return <Suspense fallback={<div className="home-loading" />}><Login /></Suspense>
  return <Landing />
}
