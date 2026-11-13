import { useGame } from '../store'
import { Modal } from './Modal'
import { SHORTCUTS } from './SidePanels'

const TURN = [
  { title: 'Read the Briefing', body: 'Your advisor lists what needs you this month, most urgent first. Every item has a button that takes you to the fix.' },
  { title: 'Give your orders', body: 'Upgrades, training, weapons, laws, declaring war and attacks happen the moment you press the button. Research, taxes, the draft and offers to other nations take effect when the month ends.' },
  { title: 'Press Next turn', body: 'Every other nation moves, income arrives, units finish training, and attacks on you play out. A monthly report shows what changed.' },
]

const TERMS: [string, string][] = [
  ['Money', 'Comes from taxes, factories and ports. Pays for upgrades, units, their upkeep and your wars.'],
  ['Food', 'Farms grow it; people and soldiers eat it. Run out and your military fights 30% weaker.'],
  ['Influence', 'Political capital. You spend it to declare war, pass laws, sign treaties and put down rebels.'],
  ['Research', 'Universities produce it. You spend it on technologies that unlock units and make them stronger.'],
  ['Stability', 'How content your people are. High taxes, hunger, debt and long wars lower it. Below 30% rebels rise.'],
  ['Division', 'One unit. Infantry, tanks, planes and warships each have attack and defense numbers, and battles use exactly those.'],
  ['Defense Line', 'How much resistance a country has left. Each battle you win pushes it down. At zero the country is yours. It heals in months nobody attacks.'],
  ['Force size', 'How much of your military you send: a probe, the main force, or all in. What you send fights at half strength at home until the month ends.'],
  ['Stance', 'How you fight. Assault is balanced. Blitz breaks the line faster and costs more. Siege is slow, saves lives, and shuts their factories.'],
  ['War bill', 'Every war costs money every month. A small country can fight three wars at once, a big empire more.'],
  ['Settling', 'A conquered country gives about 40% of its output at first and reaches 100% after six months.'],
  ['Oil, steel, goods', 'Oil fuels tanks, planes and warships. Steel builds them. Goods keep your people content. Buy what you lack on the Market in Economy.'],
  ['Cities', 'Each country has cities. Grow them for workers and give each a focus that boosts the whole country.'],
  ['Business', 'Six private sectors grow on their own. Lower business tax, calm people and new technology make them grow faster.'],
  ['Bonds and credit', 'Borrow with bonds and pay interest. A nation in the red for 3 months with debt defaults, and nobody lends to it for two years.'],
  ['Budget', 'Four shares of tax money: Military, Education, Health, Infrastructure. Leaning one way means leaning away from the rest.'],
  ['Puppet state', 'Win a war big enough and you can make the loser a puppet: it keeps its land, pays you 12% of its income, and counts as half a country.'],
]

export function Help() {
  const open = useGame((s) => s.helpOpen)
  const setHelp = useGame((s) => s.setHelp)
  const game = useGame((s) => s.game)
  const online = useGame((s) => s.online?.status === 'playing')
  if (!open || !game) return null
  const total = Object.keys(game.regions).length
  return (
    <Modal
      title="How the game works"
      kicker="Worlds of Others"
      onClose={() => setHelp(false)}
      footer={
        <button className="btn btn-primary px-5 py-2.5 text-[15px]" data-autofocus onClick={() => setHelp(false)}>
          Got it
        </button>
      }
    >
      <p className="text-[15px] text-white/85">
        You run a country, one month at a time. <strong>To win</strong>, hold the whole world: all {total} countries yours or puppets of yours. It is a long game. A war needs a reason, so build a case, use your agencies and answer the crises in the news. You lose if your nation is wiped out.
      </p>
      <h3 className="text-[16px] font-semibold mt-5 mb-2">A turn</h3>
      <ol className="space-y-3">
        {TURN.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="flex-none w-7 h-7 rounded-full bg-[#0a84ff] text-white text-[14px] font-semibold flex items-center justify-center">{i + 1}</span>
            <div>
              <div className="text-[15px] font-semibold">{s.title}</div>
              <p className="text-[14px] text-white/80">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {online && (
        <p className="mt-3 text-[14px] text-white/80 rounded-xl bg-[#0a84ff]/15 border border-[#0a84ff]/40 px-3 py-2.5">
          <strong>Playing with friends.</strong> Everyone plans the same month at once. Press <strong>Ready</strong> when you are done (press it again to keep planning). The month moves on when everyone is ready or the timer ends. Attacks are planned now and play out at month end, so nobody wins by clicking faster.
        </p>
      )}
      <h3 className="text-[16px] font-semibold mt-5 mb-2">Words you will see</h3>
      <dl className="space-y-2">
        {TERMS.map(([term, meaning]) => (
          <div key={term} className="grid grid-cols-[110px_1fr] gap-3 text-[14px]">
            <dt className="font-semibold">{term}</dt>
            <dd className="text-white/80">{meaning}</dd>
          </div>
        ))}
      </dl>
      <h3 className="text-[16px] font-semibold mt-5 mb-1">Keys</h3>
      <p className="text-[14px] text-white/75">{SHORTCUTS}</p>
    </Modal>
  )
}
