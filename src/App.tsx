import { lazy, Suspense, useEffect, useState } from 'react'
import { Clapperboard, Video } from 'lucide-react'
import LiveApp from './live/LiveApp'
import './home.css'

const Editor = lazy(() => import('./editor/Editor'))

export type Route = 'home' | 'live' | 'edit'
const routeOf = (): Route => { const r = location.hash.slice(2).split('?')[0]; return r === 'live' || r === 'edit' ? r : 'home' }
export const go = (r: Route) => { location.hash = r === 'home' ? '' : `/${r}` }

export default function App() {
  const [route, setRoute] = useState<Route>(routeOf)
  useEffect(() => { const on = () => setRoute(routeOf()); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on) }, [])
  if (route === 'live') return <LiveApp />
  if (route === 'edit') return <Suspense fallback={<div className="home-loading">Opening the editor…</div>}><Editor /></Suspense>
  return <Home />
}

function Home() {
  return <main className="home">
    <div className="home-glow" aria-hidden />
    <header className="home-brand"><span className="home-ring" /> Light Up</header>
    <h1>Everything a creator needs, <em>in one place</em>.</h1>
    <p>Light yourself like a studio, then edit, caption and export your video, all on your own device.</p>
    <div className="home-choices">
      <a href="#/live" className="choice">
        <span className="choice-art art-live"><Video size={22} /></span>
        <b>Go live</b>
        <small>Realistic ring light, window light or a bulb in your hand, for recording or for Zoom, Teams and OBS.</small>
      </a>
      <a href="#/edit" className="choice">
        <span className="choice-art art-edit"><Clapperboard size={22} /></span>
        <b>Edit a video</b>
        <small>Trim, arrange and layer clips, photos and music on a timeline, then export an MP4.</small>
      </a>
    </div>
  </main>
}
