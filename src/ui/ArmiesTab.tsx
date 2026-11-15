import { useGame } from '../store'
import { LIVE } from '../data/live'
import { dominantUnit, incomingArmies } from '../engine/armies'
import { clockOf } from '../engine/calendar'
import { formatDivisions, totalUnits } from '../engine/helpers'
import type { Army, GameState } from '../engine/types'
import { getWorld } from '../map/world'
import { battleLine } from './battleText'
import { armyStatus, showArmy } from './armyText'
import { UnitIcon } from './icons'
import { OrderButton } from './panel'

/** One army: who it is, where it is going, when it gets there, and what can be done about it. */
export function ArmyRow({ army, game, compact = false }: { army: Army; game: GameState; compact?: boolean }) {
  const { map } = getWorld()
  const now = clockOf(game)
  const mine = army.nationId === game.playerId
  const owner = game.nations[army.nationId]
  const progress = army.phase === 'outbound' ? Math.min(1, Math.max(0, (now - army.start) / Math.max(1, army.end - army.start))) : army.phase === 'returning' ? 1 - Math.min(1, Math.max(0, (now - army.start) / Math.max(1, army.end - army.start))) : 1
  const selectArmy = useGame((s) => s.selectArmy)
  const picked = useGame((s) => s.selectedArmy === army.id)
  const unit = dominantUnit(army.units)
  const divisions = totalUnits(army.units)
  return (
    <div className={`rounded-xl border ${picked ? 'border-white/50' : 'border-white/10'} bg-white/6 ${compact ? 'p-2' : 'p-3'} space-y-1.5`}>
      <button
        className="w-full text-left flex items-center gap-2.5"
        onClick={() => {
          selectArmy(army.id)
          showArmy(army, now)
        }}
        title="Show on the globe"
      >
        <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: owner?.color ?? '#888' }}>
          <UnitIcon unit={unit} size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold truncate">
            {mine ? 'Your army' : owner?.name ?? 'An army'} → {map.regions[army.target]?.name ?? army.target}
          </span>
          <span className="block text-[12px] text-white/70 truncate">
            {formatDivisions(divisions)} divisions · {armyStatus(army, now)}
          </span>
        </span>
      </button>
      <div className="h-1 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
        <div className={`h-full ${mine ? 'bg-[#0a84ff]' : 'bg-[#ff453a]'}`} style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      {mine && army.phase === 'outbound' && <OrderButton order={{ type: 'recall', nationId: game.playerId, armyId: army.id }} label="Recall" tone="btn-quiet" effect="Turns back and marches home." />}
    </div>
  )
}

/**
 * The game while it has an army the lists below would show (one of the player's own, or one marching on the player's
 * countries), otherwise nothing. Those armies move every day; with none, a day changes nothing the lists show.
 */
const gameWithArmies = (s: { game: GameState | null }) => {
  const g = s.game
  return g && (g.armies ?? []).some((a) => a.nationId === g.playerId || (a.phase === 'outbound' && g.regions[a.target]?.owner === g.playerId)) ? g : null
}

/** Everything about armies for the Military desk: yours, the ones marching on you, and the fights you have had. */
export function ArmiesTab() {
  const game = useGame(gameWithArmies)
  // The fights are worded from these alone, and they do not change from day to day.
  const nations = useGame((s) => s.game?.nations)
  const playerId = useGame((s) => s.game?.playerId)
  const recent = useGame((s) => s.recentBattles)
  const openBattle = useGame((s) => s.openBattle)
  if (!nations || !playerId) return null
  const yours = game ? (game.armies ?? []).filter((a) => a.nationId === playerId) : []
  const coming = game ? incomingArmies(game, playerId).filter((a) => a.nationId !== playerId) : []
  return (
    <div className="space-y-4">
      <section className="inset-card p-3.5 space-y-2.5">
        <div className="text-[16px] font-semibold">Your armies</div>
        {yours.length === 0 && <p className="text-[14px] text-white/70">None in the field. Open the War Room on a country you are at war with and launch an army: it marches for days, fights when it arrives, and comes home.</p>}
        {game && yours.map((a) => <ArmyRow key={a.id} army={a} game={game} />)}
      </section>
      <section className="inset-card p-3.5 space-y-2.5">
        <div className="text-[16px] font-semibold">Marching on you</div>
        {coming.length === 0 && <p className="text-[14px] text-white/70">No enemy army is on its way to your countries.</p>}
        {game && coming.map((a) => <ArmyRow key={a.id} army={a} game={game} />)}
      </section>
      <section className="inset-card p-3.5 space-y-2.5">
        <div className="text-[16px] font-semibold">Recent battles</div>
        {recent.length === 0 && <p className="text-[14px] text-white/70">No fights yet.</p>}
        {recent.map((b) => {
          const line = battleLine(b, { nations }, playerId)
          return (
            <div key={b.id} className="flex items-center justify-between gap-3 text-[14px]">
              <span className={line.good ? 'text-[#6eeb8a]' : 'text-[#ff8a84]'}>{line.text}</span>
              <button className="btn btn-quiet shrink-0" onClick={() => openBattle(b.id)}>
                Watch
              </button>
            </div>
          )
        })}
      </section>
      <p className="text-[12px] text-white/55">A month is about {Math.round((LIVE.msPerDay * 30) / 1000)} seconds at normal speed. Armies take {Math.min(...Object.values(LIVE.travel).map((t) => t.min))} to {Math.max(...Object.values(LIVE.travel).map((t) => t.max))} days to arrive, by land, sea lane, fleet or air.</p>
    </div>
  )
}

/** A small panel over the globe with your armies and the ones marching on you, so you can react without opening a desk. */
export function ArmiesDock() {
  const game = useGame(gameWithArmies)
  const panel = useGame((s) => s.panel)
  if (!game || panel !== 'none') return null
  const yours = (game.armies ?? []).filter((a) => a.nationId === game.playerId)
  const coming = incomingArmies(game, game.playerId).filter((a) => a.nationId !== game.playerId)
  if (yours.length === 0 && coming.length === 0) return null
  return (
    <div className="armies-dock surface rounded-2xl p-2.5 space-y-1.5" role="region" aria-label="Armies">
      {coming.slice(0, 3).map((a) => (
        <ArmyRow key={a.id} army={a} game={game} compact />
      ))}
      {yours.slice(0, 4).map((a) => (
        <ArmyRow key={a.id} army={a} game={game} compact />
      ))}
      {Math.max(0, coming.length - 3) + Math.max(0, yours.length - 4) > 0 && (
        <div className="text-[12px] text-white/65 px-1">{Math.max(0, coming.length - 3) + Math.max(0, yours.length - 4)} more in Military › Armies</div>
      )}
    </div>
  )
}

/** The selected army, with its details. */
export function ArmyCard() {
  // Its progress moves every day, but with no army picked there is nothing to move.
  const game = useGame((s) => (s.selectedArmy ? s.game : null))
  const id = useGame((s) => s.selectedArmy)
  const select = useGame((s) => s.selectArmy)
  const army = game?.armies?.find((a) => a.id === id)
  if (!game || !army) return null
  return (
    <div className="army-card country-card surface rounded-2xl p-3.5 space-y-2" style={{ opacity: 1 }}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[16px] font-semibold">{game.nations[army.nationId]?.name ?? 'An army'}</div>
        <button className="btn btn-quiet" onClick={() => select(null)} aria-label="Close">
          Close
        </button>
      </div>
      <ArmyRow army={army} game={game} />
      <div className="text-[13px] text-white/75 grid grid-cols-3 gap-1">
        {(Object.entries(army.units) as [keyof Army['units'], number][])
          .filter(([, n]) => n >= 0.05)
          .map(([k, n]) => (
            <span key={k} className="flex items-center gap-1.5">
              <UnitIcon unit={k} size={14} />
              {formatDivisions(n)}
            </span>
          ))}
      </div>
    </div>
  )
}
