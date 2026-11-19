import { useMemo, useState } from 'react'
import { DEFENSE_TEXT, DOCTRINES, MW } from '../data/missileWar'
import { MISSILES } from '../data/missiles'
import { clockOf, isLive } from '../engine/calendar'
import { freeUnits } from '../engine/deployment'
import { enemiesOf } from '../engine/helpers'
import { launchSite, missileKinds, missileStock } from '../engine/missiles'
import { raidForecast } from '../engine/missileForecast'
import { batteryLevel, doctrineOf, interceptorCap, interceptorsOf, launchersSeen, ledgerOf, mobileLevel, radarLevel, siteDown, trucePair } from '../engine/missileWar'
import type { Doctrine, GameState, Nation, RegionId, StrikeAim } from '../engine/types'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { Pips } from './bits'
import { usePlayerView } from './hooks'
import { MissileSection } from './MissileSection'
import { NuclearCard } from './NuclearCard'
import { ALERT_COLOR, flightsFor, lookColor, stageOf, type Incoming, type Palette } from './missileFx'
import { raidReach, nextSteps, salvoLine, warStatus, type Step } from './missileWarText'
import { missileName } from './missileText'
import { OrderButton } from './panel'

const { map } = getWorld()
const nameOf = (game: GameState, id: string) => game.nations[id]?.name ?? id
const palette = (): Palette => (useGame.getState().settings.ui.palette === 'colorblind' ? 'colorblind' : 'standard')

/** The ladder: five rungs, the world's tension on it, and what the rung means. */
export function TensionLadder({ game }: { game: GameState }) {
  const st = warStatus(game, game.nations[game.playerId])
  return (
    <div className="space-y-1.5" data-rung={st.rung} role="img" aria-label={`Missile war tension ${Math.round(st.tension)} of 100: ${st.rungName}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[15px] font-semibold">{st.rungName}</div>
        <div className="text-[13px] text-white/70 tabular-nums">tension {Math.round(st.tension)} / 100</div>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {MW.ladder.map((r, i) => (
          <div key={r.name} className="space-y-0.5">
            <div className={`h-2 rounded-full ${i <= st.rung ? '' : 'bg-white/12'}`} style={i <= st.rung ? { background: i >= 3 ? ALERT_COLOR[palette()] : i === 2 ? '#ffd60a' : '#64d2ff' } : undefined} />
            <div className={`text-[10px] leading-tight ${i === st.rung ? 'text-white font-semibold' : 'text-white/50'}`}>{r.name}</div>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-white/65">{MW.ladder[st.rung].blurb}</p>
    </div>
  )
}

/** One salvo's journey: launch, flight, intercept, impact, with the days left. */
export function SalvoTimeline({ game, flight, mine }: { game: GameState; flight: Incoming; mine: 'incoming' | 'outgoing' }) {
  const now = clockOf(game)
  const st = stageOf(flight, now)
  const color = lookColor(flight.kind, palette())
  const steps = ['Launch', 'In flight', 'Intercept', 'Impact'] as const
  const at = st.stage === 'launch' ? 0 : st.stage === 'impact' ? 3 : st.progress > 0.66 ? 2 : 1
  const victim = nameOf(game, game.regions[flight.target]?.owner ?? '')
  return (
    <div className="inset-card p-3 space-y-2" data-flight={flight.id} data-stage={st.stage}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-3 w-3 rounded-full shrink-0" style={{ background: color }} aria-hidden />
          <span className="text-[14px] font-semibold truncate">
            {flight.count} {missileName(flight.kind, flight.count)} {mine === 'incoming' ? `from ${nameOf(game, flight.from)}` : `at ${map.regions[flight.target]?.name ?? flight.target}`}
          </span>
        </div>
        <div className="text-[13px] tabular-nums text-white/80">{st.left === 0 ? 'lands today' : `lands in ${st.left} day${st.left === 1 ? '' : 's'}`}</div>
      </div>
      <div className="relative h-2 rounded-full bg-white/12 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(st.progress * 100)}>
        <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${Math.max(4, st.progress * 100)}%`, background: color }} />
      </div>
      <ol className="grid grid-cols-4 gap-1 text-[11px]">
        {steps.map((s, i) => (
          <li key={s} className={`rounded-md border px-1.5 py-1 text-center ${i === at ? 'border-white/40 bg-white/18 font-semibold text-white' : i < at ? 'border-white/10 bg-white/8 text-white/70' : 'border-white/10 text-white/45'}`}>
            {s}
          </li>
        ))}
      </ol>
      <p className="text-[12px] text-white/65">
        {mine === 'incoming' ? `Aimed at ${map.regions[flight.target]?.name}${victim === nameOf(game, game.playerId) ? ', one of your countries' : `, held by ${victim}`}.` : 'Your salvo. It cannot be recalled.'}
        {flight.scrambled ? ' Fighters are scrambled against it.' : ''}
      </p>
    </div>
  )
}

function StepRow({ step }: { step: Step }) {
  const openMilitary = useGame((s) => s.openMilitary)
  const tone = step.tone === 'urgent' ? 'border-[#ff453a]/70 bg-[#ff453a]/10' : 'border-white/10 bg-white/5'
  return (
    <li className={`rounded-xl border p-2.5 space-y-1.5 ${tone}`} data-step={step.id}>
      <p className="text-[13px] text-white/90">{step.text}</p>
      {step.order && <OrderButton order={step.order} label={stepLabel(step)} tone={step.tone === 'urgent' ? 'btn-red' : 'btn-primary'} className="w-full sm:w-auto" />}
      {step.go && !step.order && (
        <button
          className="btn btn-quiet px-3 py-1.5 text-[13px]"
          onClick={() => {
            if (step.go === 'strike') {
              // Missiles are fired here, in the strike planner of this tab: aim it at the step's country and bring it into view.
              if (step.target) useGame.setState({ selectedRegion: step.target })
              openMilitary('missiles')
              setTimeout(() => document.querySelector('[data-planner]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0)
            } else openMilitary(step.go === 'deploy' ? 'deploy' : step.go === 'war' ? 'wars' : step.go === 'program' ? 'program' : 'systems')
          }}
        >
          {step.go === 'strike' ? 'Open the strike planner' : step.go === 'deploy' ? 'Open Deployment' : 'Open the program'}
        </button>
      )}
    </li>
  )
}

const stepLabel = (s: Step): string =>
  s.order?.type === 'scramble' ? 'Scramble fighters' : s.order?.type === 'missileDefense' ? (s.order.item === 'radar' ? 'Build radar' : `Buy ${s.order.count ?? 1} interceptor rounds`) : s.order?.type === 'setDoctrine' ? 'Set doctrine: Retaliate' : s.order?.type === 'missileTruce' ? 'Offer a ceasefire' : 'Do it'

/** The concrete next steps in the missile war, with a button for each. Used by the Missile War tab and the missile program. */
export function NextSteps({ limit = 4 }: { limit?: number }) {
  const view = usePlayerView()
  if (!view) return null
  const { game, player } = view
  const steps = nextSteps(game, map, player, isLive(game), limit)
  const st = warStatus(game, player)
  return (
    <section className="space-y-2" aria-label="Next steps in the missile war" data-next-steps={steps.length}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Next steps</h3>
        <span className="text-[12px] text-white/65 tabular-nums">
          {st.rungName} · {st.incoming} incoming · {st.outgoing} outgoing · exchange {st.exchange === null ? 'n/a' : `${st.exchange.toFixed(1)} : 1`}
        </span>
      </div>
      {steps.length ? <ul className="space-y-2">{steps.map((s) => <StepRow key={s.id} step={s} />)}</ul> : <p className="text-[13px] text-white/70">Nothing urgent. Your defences are up and you have no war to fight with missiles.</p>}
    </section>
  )
}

function Bar({ value, max, color = '#64d2ff', label }: { value: number; max: number; color?: string; label: string }) {
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div className="h-2.5 rounded-full bg-white/12 overflow-hidden" role="img" aria-label={label}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${frac * 100}%`, background: color }} />
    </div>
  )
}

function DefenseCard({ game, player }: { game: GameState; player: Nation }) {
  const cap = interceptorCap(player)
  const stock = interceptorsOf(player)
  const radar = radarLevel(player)
  const bought = player.missileWar?.radar ?? 0
  const doctrine = doctrineOf(player)
  const mine = Object.values(game.regions).filter((r) => r.owner === player.id).sort((a, b) => b.population - a.population)
  const room = cap - stock
  return (
    <section className="inset-card p-3.5 space-y-3" aria-label="Defences" data-defense>
      <div>
        <h3 className="text-[15px] font-semibold">Defences</h3>
        <p className="text-[12px] text-white/65">Shield level {player.systems?.shield ?? 0}. {DEFENSE_TEXT.interceptors.blurb}</p>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-[13px]">
          <span>Interceptor rounds</span>
          <span className="tabular-nums" data-rounds={stock}>
            {stock} / {cap}
          </span>
        </div>
        <Bar value={stock} max={cap} label={`${stock} of ${cap} interceptor rounds`} color={stock < cap * 0.4 ? '#ff9f0a' : '#64d2ff'} />
        {cap > 0 && room > 0 && <OrderButton order={{ type: 'missileDefense', nationId: player.id, item: 'interceptors', count: Math.min(room, MW.roundsMaxOrder) }} label={`Refill ${Math.min(room, MW.roundsMaxOrder)} rounds`} cost={`${Math.min(room, MW.roundsMaxOrder) * MW.roundCost} money`} effect="They come back at half the store a month on their own." className="w-full" />}
        {cap === 0 && <p className="text-[12px] text-[#ffd60a]">No shield and no batteries: nothing to hold rounds. Raise a shield under Systems or post a battery.</p>}
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-[13px]">
          <span>Early-warning radar</span>
          <span className="tabular-nums">
            level {radar}
            {radar > bought ? ` (${radar - bought} from aircraft)` : ''}
          </span>
        </div>
        <Pips value={radar} max={MW.radarMax} />
        {bought < MW.radarMax && <OrderButton order={{ type: 'missileDefense', nationId: player.id, item: 'radar' }} label={`Radar level ${bought + 1}`} cost={`${MW.radarMoney[bought]} money`} effect={DEFENSE_TEXT.radar.blurb} className="w-full" />}
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between text-[13px]">
          <span>Air-defence batteries</span>
          <span className="tabular-nums">{Object.values(player.missileWar?.batteries ?? {}).reduce((a, b) => a + b, 0)} posted</span>
        </div>
        <p className="text-[12px] text-white/60">{DEFENSE_TEXT.battery.blurb}</p>
        <div className="flex flex-wrap gap-1.5">
          {mine.slice(0, 4).map((r) => (
            <OrderButton key={r.id} order={{ type: 'missileDefense', nationId: player.id, item: 'battery', regionId: r.id }} label={`${map.regions[r.id].name} (${batteryLevel(player, r.id)}/${MW.batteryMax})`} cost={`${MW.batteryMoney * (1 + batteryLevel(player, r.id))} money`} />
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-[13px]">
          <span>Mobile launchers</span>
          <span className="tabular-nums">level {mobileLevel(player)}</span>
        </div>
        {mobileLevel(player) < MW.mobileMax && <OrderButton order={{ type: 'missileDefense', nationId: player.id, item: 'mobile' }} label={`Mobile level ${mobileLevel(player) + 1}`} cost={`${MW.mobileMoney[mobileLevel(player)]} money`} effect={DEFENSE_TEXT.mobile.blurb} className="w-full" />}
      </div>
      <div className="space-y-1.5">
        <div className="text-[13px]">Doctrine</div>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {(Object.keys(DOCTRINES) as Doctrine[]).map((d) => (
            <OrderButton key={d} order={{ type: 'setDoctrine', nationId: player.id, doctrine: d }} label={DOCTRINES[d].name + (doctrine === d ? ' (set)' : '')} tone={doctrine === d ? 'btn-primary' : ''} effect={DOCTRINES[d].blurb} />
          ))}
        </div>
      </div>
    </section>
  )
}

function ArsenalCard({ game, player }: { game: GameState; player: Nation }) {
  const kinds = missileKinds(player)
  const foes = enemiesOf(game, player.id)
  const sites = Object.values(game.regions).filter((r) => r.owner === player.id && r.buildings.factory > 0)
  return (
    <section className="inset-card p-3.5 space-y-3" aria-label="Arsenal and launch sites" data-arsenal>
      <h3 className="text-[15px] font-semibold">Arsenal and launch sites</h3>
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <span key={k} className="chip" data-kind-stock={k}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: lookColor(k, palette()) }} aria-hidden /> {MISSILES[k].name.replace(' missile', '').replace(' rocket', '')} {missileStock(player, k)}
          </span>
        ))}
        {kinds.length === 0 && <span className="text-[13px] text-white/70">Nothing in store.</span>}
      </div>
      <ul className="space-y-1">
        {sites.slice(0, 6).map((r) => {
          const down = siteDown(game, player, r.id)
          const until = player.missileWar?.down?.[r.id]
          return (
            <li key={r.id} className="flex items-center justify-between gap-2 text-[13px]" data-site={r.id}>
              <span>{map.regions[r.id].name}</span>
              <span className={down ? 'text-[#ff9f0a]' : 'text-[#6eeb8a]'}>{down ? `shut until month ${(until ?? game.turn) + 1}` : 'open'}</span>
            </li>
          )
        })}
        {sites.length === 0 && <li className="text-[13px] text-[#ffd60a]">You have no launch site: missiles leave from a country with a factory.</li>}
      </ul>
      {foes.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[13px]">Scout the enemy launchers</div>
          <div className="flex flex-wrap gap-1.5">
            {foes.map((e) => (
              <OrderButton key={e} order={{ type: 'recon', nationId: player.id, target: e }} label={`${nameOf(game, e)}${launchersSeen(game, player, e) ? ' (found)' : ''}`} cost={`${MW.reconMoney} money`} effect="Shows where the launchers are for three months, so mobile launchers cannot hide from counterforce." />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/** A bomber raid on a chosen country, with its forecast: the chance each bomber division gets home and what it would do. */
export function RaidCard({ game, player, target }: { game: GameState; player: Nation; target: RegionId }) {
  const [aim, setAim] = useState<StrikeAim>('country')
  const [share, setShare] = useState(0.5)
  const view = usePlayerView()!
  const f = useMemo(() => raidForecast(game, map, player.id, target, aim, share), [game, player.id, target, aim, share])
  const why = raidReach(game, map, player, target)
  const free = freeUnits(game, player.id)
  return (
    <div className="inset-card p-3 space-y-2" data-raid>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold">Bomber raid</div>
          <p className="text-[12px] text-white/70">Strike aircraft fly out with fighter escorts. Enemy fighters and batteries shoot some down; stealth and escorts bring more home.</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[22px] font-semibold tabular-nums leading-none">{free.air.toFixed(1)}</div>
          <div className="label">bombers</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg overflow-hidden border border-white/15" role="group" aria-label="What to bomb">
          {(['country', 'site'] as const).map((a) => (
            <button key={a} className={`px-2.5 py-1.5 text-[13px] ${aim === a ? 'bg-[#0a84ff] text-white' : 'bg-white/6 text-white/80'}`} onClick={() => setAim(a)} aria-pressed={aim === a}>
              {a === 'country' ? 'The country' : 'Launch sites'}
            </button>
          ))}
        </div>
        <label className="text-[13px] text-white/80 flex items-center gap-2">
          Send
          <select className="field px-2 py-1 text-[13px]" value={share} onChange={(e) => setShare(+e.target.value)} aria-label="Share of bombers to send">
            {[0.25, 0.5, 0.75, 1].map((v) => (
              <option key={v} value={v}>
                {Math.round(v * 100)}%
              </option>
            ))}
          </select>
        </label>
      </div>
      {f && <p className="text-[12px] text-white/80" data-raid-forecast>{f.text}</p>}
      <OrderButton order={{ type: 'raid', nationId: player.id, target, aim, share }} label={aim === 'site' ? 'Raid the launch sites' : 'Raid the country'} cost={`${MW.raid.money} money`} effect={why ?? (isLive(view.game) ? 'Flies at once.' : 'Flies when the month ends.')} tone="btn-red" className="w-full" />
    </div>
  )
}

function Planner({ game, player }: { game: GameState; player: Nation }) {
  const foes = enemiesOf(game, player.id)
  const regions = Object.values(game.regions).filter((r) => foes.includes(r.owner)).sort((a, b) => (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : b.line - a.line))
  const [pick, setPick] = useState<string>('')
  // A country chosen elsewhere (on the map, or by a next step or the advisor) aims the planner, until you pick another here.
  const selected = useGame((s) => s.selectedRegion)
  const [aimed, setAimed] = useState<string | null>(selected)
  if (selected !== aimed) {
    setAimed(selected)
    if (selected && regions.some((r) => r.id === selected)) setPick(selected)
  }
  const target = regions.find((r) => r.id === pick)?.id ?? regions.find((r) => r.id === selected)?.id ?? regions[0]?.id
  const live = isLive(game)
  const view = usePlayerView()!
  if (!target) return <section className="inset-card p-3.5 text-[13px] text-white/70">You are not at war, so there is nothing to strike. Declare a war from the Wars tab.</section>
  return (
    <section className="space-y-2" aria-label="Strike planner" data-planner>
      <h3 className="text-[15px] font-semibold">Strike planner</h3>
      <label className="flex flex-wrap items-center gap-2 text-[13px]">
        Target
        <select className="field px-2 py-1.5 text-[14px]" value={target} onChange={(e) => setPick(e.target.value)} aria-label="Target country">
          {regions.slice(0, 60).map((r) => (
            <option key={r.id} value={r.id}>
              {map.regions[r.id].name} ({nameOf(game, r.owner)}, line {r.line.toFixed(1)})
            </option>
          ))}
        </select>
      </label>
      <MissileSection game={game} player={player} target={target} orders={view.orders} live={live} />
      <RaidCard game={game} player={player} target={target} />
      {/* The Superpower weapon is a missile too, so it is fired from here, never from the War Room. */}
      <NuclearCard target={target} />
    </section>
  )
}

/** The kill ledger: what you fired and what stopped it, the exchange and the last salvos. */
function LedgerCard({ game, player }: { game: GameState; player: Nation }) {
  const st = warStatus(game, player)
  const led = ledgerOf(player)
  const reports = (game.salvos ?? []).filter((r) => r.from === player.id || r.to === player.id).slice(-8).reverse()
  const names = (id: string) => (id === player.id ? 'You' : nameOf(game, id))
  return (
    <section className="inset-card p-3.5 space-y-3" aria-label="Kill ledger" data-ledger>
      <h3 className="text-[15px] font-semibold">Kill ledger</h3>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        {[
          ['Fired', `${led.fired}`],
          ['Got through', `${led.hits}`],
          ['Shot down', `${led.shotDown}`],
          ['Exchange', st.exchange === null ? 'n/a' : `${st.exchange.toFixed(1)} : 1`],
          ['Dealt (M dead)', led.killed.toFixed(1)],
          ['Taken (M dead)', led.lost.toFixed(1)],
          ['Line dealt', led.lineDealt.toFixed(1)],
          ['Line taken', led.lineTaken.toFixed(1)],
          ['Sites hit', `${led.sitesHit}`],
          ['Stock destroyed', led.stockDestroyed.toFixed(0)],
          ['Rounds spent', led.interceptorsSpent.toFixed(0)],
          ['Aircraft lost', led.aircraftLost.toFixed(1)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-white/6 py-1.5">
            <dt className="label">{k}</dt>
            <dd className="text-[15px] font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {reports.length ? (
        <ol className="space-y-1.5" aria-label="Recent salvos">
          {reports.map((r) => (
            <li key={r.id} className="text-[12px] text-white/80 leading-snug border-l-2 pl-2" style={{ borderColor: r.weapon === 'raid' ? '#ffb340' : lookColor(r.kind ?? 'cruise', palette()) }} data-salvo={r.id}>
              {salvoLine(r, names)}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[13px] text-white/70">No salvo has landed yet.</p>
      )}
    </section>
  )
}

function CeasefireCard({ game, player }: { game: GameState; player: Nation }) {
  const foes = enemiesOf(game, player.id).filter((e) => game.nations[e]?.alive)
  if (!foes.length) return null
  return (
    <section className="inset-card p-3.5 space-y-2" aria-label="Ceasefire" data-ceasefire>
      <h3 className="text-[15px] font-semibold">Ceasefire</h3>
      <p className="text-[12px] text-white/70">A missile ceasefire stops missiles, raids and warheads between two nations for {MW.truceMonths} months and cools the world. Armies keep fighting. Rivals accept when the tension is high or they are losing the exchange.</p>
      <div className="flex flex-wrap gap-1.5">
        {foes.map((e) => {
          const until = trucePair(game, player.id, e)
          return until !== null ? (
            <OrderButton key={e} order={{ type: 'missileTruce', nationId: player.id, target: e, lift: true }} label={`End with ${nameOf(game, e)}`} effect="Costs reputation." />
          ) : (
            <OrderButton key={e} order={{ type: 'missileTruce', nationId: player.id, target: e }} label={`Offer ${nameOf(game, e)}`} />
          )
        })}
      </div>
    </section>
  )
}

/** The Missile War desk: everything about the missile war in one place, with what to do next at the top. */
export function MissileWarTab() {
  const view = usePlayerView()
  if (!view) return null
  const { game, player } = view
  const live = isLive(game)
  const incoming = flightsFor(game, player.id, 'incoming')
  const outgoing = flightsFor(game, player.id, 'outgoing')
  return (
    <div className="space-y-3" data-missile-war>
      <p className="text-[13px] text-white/75">
        Missiles are a war of their own. Radar sees them coming, interceptors and batteries shoot them down until the store runs dry, decoys and big salvos burn the rounds, and counterforce strikes and raids go after the launchers. Every strike raises the world's tension.
      </p>
      <section className="inset-card p-3.5 space-y-3">
        <TensionLadder game={game} />
        <NextSteps limit={5} />
      </section>
      {live && (incoming.length > 0 || outgoing.length > 0) && (
        <section className="space-y-2" aria-label="Salvos in the air" data-salvos-air>
          <h3 className="text-[15px] font-semibold">In the air</h3>
          {incoming.map((f) => (
            <div key={f.id} className="space-y-1.5">
              <SalvoTimeline game={game} flight={f} mine="incoming" />
              {!f.scrambled && <OrderButton order={{ type: 'scramble', nationId: player.id, flightId: f.id }} label="Scramble fighters" cost={`${MW.scrambleMoney} money`} effect={`A scrambled wing counts ${MW.scrambleWing} times and stops ${Math.round(MW.scrambleStop * 100)}% more of this salvo.`} tone="btn-red" />}
            </div>
          ))}
          {outgoing.map((f) => (
            <SalvoTimeline key={f.id} game={game} flight={f} mine="outgoing" />
          ))}
        </section>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <DefenseCard game={game} player={player} />
        <div className="space-y-3">
          <ArsenalCard game={game} player={player} />
          <CeasefireCard game={game} player={player} />
        </div>
      </div>
      <LedgerCard game={game} player={player} />
      <Planner game={game} player={player} />
      {launchSiteHint(game, player)}
    </div>
  )
}

function launchSiteHint(game: GameState, player: Nation) {
  const foes = enemiesOf(game, player.id)
  const any = missileKinds(player)[0]
  if (!foes.length || !any) return null
  const reach = Object.values(game.regions).some((r) => foes.includes(r.owner) && launchSite(game, map, player.id, r.id, any))
  return reach ? null : <p className="text-[12px] text-[#ffd60a]">None of the enemy's countries is in reach of your launch sites with {missileName(any, 2)}.</p>
}

