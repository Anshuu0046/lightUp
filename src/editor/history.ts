import { useCallback, useRef, useState } from 'react'
import { type Action, apply, type Project } from './model'

const LIMIT = 100

/**
 * The project plus undo/redo. `commit` records a step; during a drag, `begin` once and then
 * `live` for every move, so the whole drag undoes in one step.
 */
export function useHistory(initial: Project) {
  const [state, setState] = useState({ past: [] as Project[], present: initial, future: [] as Project[] })
  const dragging = useRef(false)

  const commit = useCallback((a: Action) => setState(s => {
    const next = apply(s.present, a)
    return next === s.present ? s : { past: [...s.past, s.present].slice(-LIMIT), present: next, future: [] }
  }), [])
  const begin = useCallback(() => { if (!dragging.current) { dragging.current = true; setState(s => ({ past: [...s.past, s.present].slice(-LIMIT), present: s.present, future: [] })) } }, [])
  const live = useCallback((a: Action) => setState(s => ({ ...s, present: apply(s.present, a) })), [])
  const end = useCallback(() => { dragging.current = false }, [])
  const undo = useCallback(() => setState(s => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s)), [])
  const redo = useCallback(() => setState(s => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s)), [])
  /** replaces the document without an undo step (opening a saved project) */
  const reset = useCallback((p: Project) => setState({ past: [], present: p, future: [] }), [])

  return { project: state.present, canUndo: state.past.length > 0, canRedo: state.future.length > 0, commit, begin, live, end, undo, redo, reset }
}
