import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import LiveApp from './live/LiveApp'

/** If anything in the app throws, show a way out instead of a black screen */
class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.error('Light Up crashed', error) }
  render() {
    if (!this.state.failed) return this.props.children
    return <main style={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24, font: '15px Manrope Variable, system-ui', color: '#f6f2ec' }}>
      <div><h1 style={{ font: '400 40px Instrument Serif, Georgia, serif', margin: '0 0 10px' }}>Something went wrong</h1>
        <p style={{ color: '#a59fae', margin: '0 0 22px' }}>Your camera has been released. Reload to try again.</p>
        <button onClick={() => location.reload()} style={{ padding: '13px 26px', borderRadius: 999, border: 0, background: '#f6f2ec', color: '#121016', font: '700 14px Manrope Variable, system-ui', cursor: 'pointer' }}>Reload</button></div>
    </main>
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><Guard><LiveApp /></Guard></StrictMode>)
