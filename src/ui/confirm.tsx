import { useGame } from '../store'
import { Modal } from './Modal'

/** The dialog that asks. Shown over everything while a confirmation is waiting. */
export function ConfirmDialog() {
  const c = useGame((s) => s.confirm)
  const close = useGame((s) => s.closeConfirm)
  if (!c) return null
  return (
    <Modal
      title={c.title}
      onClose={close}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn btn-quiet" onClick={close} data-autofocus>
            Cancel
          </button>
          <button
            className={`btn ${c.danger ? 'btn-red' : 'btn-primary'}`}
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
      <p className="text-[15px] text-white/85">{c.text}</p>
    </Modal>
  )
}
