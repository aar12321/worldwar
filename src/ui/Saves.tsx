import { useRef, useState } from 'react'
import { SLOT_COUNT, peekSlot, useGame } from '../store'

const when = (t: number) => (t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

/** The autosave's state, three save slots, and a way to keep a game as a file or open one from a file. */
export function Saves() {
  const savedAt = useGame((s) => s.savedAt)
  const failed = useGame((s) => s.saveFailed)
  const online = useGame((s) => !!s.online)
  const saveSlot = useGame((s) => s.saveSlot)
  const loadSlot = useGame((s) => s.loadSlot)
  const exportSave = useGame((s) => s.exportSave)
  const importSave = useGame((s) => s.importSave)
  const toast = useGame((s) => s.toast)
  const [, bump] = useState(0)
  const file = useRef<HTMLInputElement>(null)
  if (online) return <p className="text-[13px] text-white/60">Online games are kept by the host, not on this device.</p>

  const download = () => {
    const text = exportSave()
    if (!text) return
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a')
    const g = useGame.getState().game
    a.href = url
    a.download = `worlds-of-others-${(g?.nations[g.playerId]?.name ?? 'game').toLowerCase().replace(/\W+/g, '-')}-turn-${g?.turn ?? 0}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const pick = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 20_000_000) {
      toast('That file is too big to be a save.', 'error')
      return
    }
    importSave(await f.text())
    if (file.current) file.current.value = ''
  }

  return (
    <div className="space-y-2.5">
      <div className="label pt-2">Saves</div>
      <p className={`text-[13px] ${failed ? 'text-[#ff8a84]' : 'text-white/65'}`}>
        {failed ? 'The last save failed: storage is full or blocked. Export the game to keep it.' : savedAt ? `The game saved itself at ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.` : 'The game saves itself after you stop clicking.'}
      </p>
      {Array.from({ length: SLOT_COUNT }, (_, i) => i + 1).map((slot) => {
        const info = peekSlot(slot)
        return (
          <div key={slot} className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2">
            <div className="min-w-0 text-[13px]">
              <div className="font-semibold">Slot {slot}</div>
              <div className="text-white/65 truncate">{info ? `${info.nation} · ${info.live ? 'Live' : 'Turns'} · ${info.date} · saved ${when(info.savedAt)}` : 'Empty'}</div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                className="btn btn-quiet px-3 py-1.5 text-[13px]"
                onClick={() => {
                  saveSlot(slot)
                  bump((n) => n + 1)
                }}
              >
                Save
              </button>
              <button className="btn btn-quiet px-3 py-1.5 text-[13px]" disabled={!info} onClick={() => loadSlot(slot)}>
                Load
              </button>
            </div>
          </div>
        )
      })}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-quiet py-2 text-[13px]" onClick={download}>
          Export to a file
        </button>
        <button className="btn btn-quiet py-2 text-[13px]" onClick={() => file.current?.click()}>
          Import a file
        </button>
        <input ref={file} type="file" accept="application/json,.json" className="hidden" aria-label="Import a save file" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
    </div>
  )
}
