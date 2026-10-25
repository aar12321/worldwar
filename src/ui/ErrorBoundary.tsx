import { Component, type ErrorInfo, type ReactNode } from 'react'
import { SAVE_KEYS } from '../store'

interface State {
  failed: boolean
}

/** Keeps a render error from leaving a black screen, and lets the player drop a save that keeps crashing. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Worlds of Others crashed', error, info.componentStack)
  }

  private reload = (deleteSave: boolean) => {
    if (deleteSave) {
      try {
        for (const key of SAVE_KEYS) localStorage.removeItem(key)
      } catch {
        /* storage may be unavailable */
      }
    }
    window.location.reload()
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <h1 className="text-[28px] font-semibold tracking-tight">Something went wrong</h1>
        <p className="max-w-md text-[15px] text-white/65">The game hit an error. Reload to carry on from your last save. If it keeps happening, delete the save and start again.</p>
        <div className="flex gap-3">
          <button className="btn btn-primary px-5 py-2.5" onClick={() => this.reload(false)} autoFocus>
            Reload
          </button>
          <button className="btn btn-red px-5 py-2.5" onClick={() => this.reload(true)}>
            Delete save and reload
          </button>
        </div>
      </div>
    )
  }
}
