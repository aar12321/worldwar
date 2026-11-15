/**
 * Calls `fn` every `ms`, from a worker when the browser has them, so the calls keep coming while the page is hidden.
 * Returns a function that stops it.
 */
export function startTicker(fn: () => void, ms: number): () => void {
  if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
    try {
      const worker = new Worker(new URL('./ticker.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = () => fn()
      worker.postMessage(ms)
      return () => worker.terminate()
    } catch {
      /* fall back to the page's own timer */
    }
  }
  const timer = setInterval(fn, ms)
  return () => clearInterval(timer)
}
