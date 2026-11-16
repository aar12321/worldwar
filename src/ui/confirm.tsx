import { useState } from 'react'
import { useGame } from '../store'
import type { PendingConfirm } from './confirmRules'
import { Modal } from './Modal'

/** The dialog that asks. Shown over everything while a confirmation is waiting. */
export function ConfirmDialog() {
  const c = useGame((s) => s.confirm)
  return c ? <Ask key={c.title} c={c} /> : null
}

function Ask({ c }: { c: PendingConfirm }) {
  const close = useGame((s) => s.closeConfirm)
  // A grave choice needs a deliberate tick before the button works.
  const [understood, setUnderstood] = useState(false)
  const locked = !!c.require && !understood
  return (
    <Modal
      title={c.title}
      onClose={close}
      tone={c.require ? '#ff453a' : undefined}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn btn-quiet" onClick={close} data-autofocus>
            Cancel
          </button>
          <button
            className={`btn ${c.danger ? 'btn-red' : 'btn-primary'}`}
            disabled={locked}
            title={locked ? 'Tick the box above first' : undefined}
            onClick={() => {
              const run = c.run
              close()
              run()
            }}
          >
            {c.label}
          </button>
        </div>
      }
    >
      {c.warning && (
        <p className="mb-3 rounded-xl border border-[#ff453a]/60 bg-[#ff453a]/15 px-3 py-2 text-[14px] font-semibold text-[#ff8a84]" role="alert">
          {c.warning}
        </p>
      )}
      <p className="text-[15px] text-white/85">{c.text}</p>
      {c.points && (
        <ul className="mt-3 space-y-2 text-[14px] text-white/80 list-disc pl-5 marker:text-[#ff453a]">
          {c.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {c.require && (
        <label className="mt-4 flex items-start gap-2.5 rounded-xl bg-white/6 px-3 py-2.5 text-[14px] text-white/90 cursor-pointer">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <span>{c.require}</span>
        </label>
      )}
    </Modal>
  )
}
