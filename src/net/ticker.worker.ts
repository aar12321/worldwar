// Ticks for the host of an online game. A page's own timers slow to a crawl while it is hidden; a worker's keep going, so the
// game does not stall for everyone when the host looks at another tab.
let timer: ReturnType<typeof setInterval> | null = null
self.onmessage = (e: MessageEvent<number>) => {
  if (timer) clearInterval(timer)
  timer = e.data > 0 ? setInterval(() => self.postMessage(0), e.data) : null
}
