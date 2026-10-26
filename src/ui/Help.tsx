import { useGame } from '../store'
import { Modal } from './Modal'

const STEPS = [
  { title: 'Build up your country', body: 'Open Country and buy upgrades. Factories bring money, farms bring food, universities bring research, barracks let you train more at once. Upgrades work the moment you buy them.' },
  { title: 'Train and upgrade your military', body: 'Open Military. Train units, drill them, and buy weapon levels. Every bonus shows in the attack and defense numbers, and those are the numbers battles use.' },
  { title: 'Declare war, then attack', body: 'Click a neighboring country and press Declare war. Then press Attack. Your whole military fights, and you watch each round. Win and you take the whole country. You can attack once a turn.' },
  { title: 'Press Next turn', body: 'Nothing moves until you do. Rivals act, the month ends, income arrives, and any attacks on you play out. Treaties, research, and tax changes settle then too.' },
]

export function Help() {
  const open = useGame((s) => s.helpOpen)
  const setHelp = useGame((s) => s.setHelp)
  const game = useGame((s) => s.game)
  if (!open || !game) return null
  const goal = game.settings.victoryShare
  return (
    <Modal
      title="How to play"
      kicker="Worlds of Others"
      onClose={() => setHelp(false)}
      footer={
        <button className="btn btn-primary px-5 py-2.5 text-[15px]" data-autofocus onClick={() => setHelp(false)}>
          Start playing
        </button>
      }
    >
      <ol className="space-y-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="flex-none w-8 h-8 rounded-full bg-[#0a84ff] text-white font-semibold flex items-center justify-center">{i + 1}</span>
            <div>
              <div className="text-[17px] font-semibold">{s.title}</div>
              <p className="text-[15px] text-white/80 mt-0.5">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-[15px] text-white/80">
        <strong>To win:</strong> take {goal <= 0.25 ? 3 : goal >= 0.6 ? 12 : 6} countries outside your own, or lead {Math.round(goal * 100)}% of the world's people. You lose if your nation is wiped out.
      </p>
      <p className="mt-2 text-[14px] text-white/65">Shortcuts: Enter for next turn, C country, M military, T research, D diplomacy, L news, ? for this help.</p>
    </Modal>
  )
}
