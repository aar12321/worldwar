import { THREAT } from '../data/coalition'
import { worldReaction } from '../engine/coalition'
import { RESOLUTIONS } from '../data/empire'
import { hasPact, isAllied } from '../engine/helpers'
import { getWorld } from '../map/world'
import { useGame } from '../store'
import { usePlayerView } from './hooks'
import { Card } from './economy/parts'
import { Bar } from './kit'
import { OrderButton } from './panel'

const LEVEL_COLOR = ['#30d158', '#ffd60a', '#ff9f0a', '#ff6a3d', '#ff453a']

/**
 * The World reaction panel: how alarmed the world is by your size, which nations are drawing together, what is coming, and what you
 * can do about it. It reads the same numbers the rivals act on, so nothing in it is hidden from you.
 */
export function WorldReaction() {
  const view = usePlayerView()!
  const openDiplomacy = useGame((s) => s.openDiplomacy)
  const { game, player } = view
  const { map } = getWorld()
  const r = worldReaction(game, map, player.id)
  const name = (id: string) => game.nations[id]?.name ?? id
  const level = r.threat.level
  const color = LEVEL_COLOR[level]
  const where = (id: string) => map.regions[id]?.name ?? id
  const pactTargets = [...new Set([...r.persuadable, ...r.wary.filter((w) => w.neighbor).map((w) => w.id)])].filter((id) => !hasPact(game, id, player.id) && !isAllied(game, id, player.id)).slice(0, 3)
  const biggest = r.plan?.members[0] ?? r.blocs[0]?.bloc.leader
  const hasCouncil = player.tier >= 4

  return (
    <Card title="World reaction" hint="How the rest of the world takes your rise, and what it is about to do." right={<span className="chip" style={{ color }}>{r.threat.levelName}</span>}>
      <div className="space-y-1" data-testid="threat">
        <div className="flex items-baseline justify-between text-[14px]">
          <span>Threat you pose</span>
          <span className="tabular-nums font-semibold" style={{ color }}>
            {Math.round(r.threat.score)} of 100
          </span>
        </div>
        <Bar value={r.threat.score / 100} color={color} label="Threat you pose to the world" />
        <div className="flex justify-between text-[11px] text-white/45 tabular-nums" aria-hidden>
          {THREAT.levelNames.map((n, i) => (
            <span key={n} style={{ color: i === level ? color : undefined }} className={i === level ? 'font-semibold' : ''}>
              {THREAT.levels[i]}
            </span>
          ))}
        </div>
        <details className="text-[13px] text-white/75">
          <summary className="cursor-pointer text-white/80">Where it comes from</summary>
          <div className="mt-1 rounded-xl bg-white/5 divide-y divide-white/8">
            {r.threat.parts.length === 0 && <div className="px-3 py-1.5 text-white/60">Nothing yet: you are not large enough to alarm anyone.</div>}
            {r.threat.parts.map((p) => (
              <div key={p.label} className="flex justify-between gap-3 px-3 py-1.5">
                <span className="text-white/75">{p.label}</span>
                <span className="tabular-nums">+{p.value}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[12px] text-white/60">The bigger your tier, the more of this turns into action: {THREAT.ramp.map((x, i) => `${['Nation', 'Regional', 'Great', 'Superpower', 'Hegemon'][i]} ${Math.round(x * 100)}%`).join(', ')}.</p>
        </details>
      </div>

      <p className="text-[13px] text-white/75" data-testid="stance">
        {r.stanceText}
      </p>

      <div className="space-y-1.5" data-testid="coming">
        <h4 className="text-[14px] font-semibold">What is coming</h4>
        {r.plan ? (
          <div className="rounded-xl border border-[#ff453a]/50 bg-[#ff453a]/10 p-3 space-y-1">
            <p className="text-[14px] font-semibold text-[#ff8a84]">
              {r.plan.members.length} rivals plan to strike together {r.plan.monthsLeft === 0 ? 'this month' : `in ${r.plan.monthsLeft} month${r.plan.monthsLeft === 1 ? '' : 's'}`}
            </p>
            <p className="text-[13px] text-white/85">{r.plan.members.map(name).join(', ')}.</p>
            <p className="text-[13px] text-white/75">
              They will open fronts against your weakest borders ({r.plan.focus.map(where).join(', ')}) in the same month{game.settings.mode === 'live' ? `, on the same day (${r.plan.date})` : ''}. They have a reason on paper and a treaty between them.
            </p>
          </div>
        ) : r.stance === 'coordinated' && r.threat.pressure >= 0.3 && player.tier >= 3 ? (
          <p className="text-[13px] text-[#ffb340]">Hard rivals are weighing a joint strike. When they agree on one it is announced here with at least two months of warning.</p>
        ) : r.stance === 'coordinated' && player.tier < 3 ? (
          <p className="text-[13px] text-white/65">Joint strikes begin once you are a Great power (10 countries).</p>
        ) : (
          <p className="text-[13px] text-white/65">{r.stance === 'none' ? 'No joint action is planned. Easy rivals only judge you by their own dealings.' : 'No joint strike is being planned.'}</p>
        )}
        {r.atWar.length > 0 && <p className="text-[13px] text-white/75">At war with {r.atWar.map(name).join(', ')}.</p>}
        {r.sanctioners.length > 0 && <p className="text-[13px] text-white/75">{r.sanctioners.length} nation{r.sanctioners.length === 1 ? '' : 's'} {r.sanctioners.length === 1 ? 'is' : 'are'} sanctioning you.</p>}
      </div>

      <div className="space-y-1.5" data-testid="drawing">
        <h4 className="text-[14px] font-semibold">Drawing together</h4>
        {r.blocs.length === 0 && r.wary.length === 0 ? (
          <p className="text-[13px] text-white/65">No bloc has formed against you, and no neighbor is turning hostile.</p>
        ) : (
          <div className="rounded-xl bg-white/5 divide-y divide-white/8 text-[13px]">
            {r.blocs.map(({ bloc, hostile }) => (
              <div key={bloc.leader} className="px-3 py-1.5">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{bloc.name}</span>
                  <span className="text-white/65 tabular-nums">{bloc.members.length} nations</span>
                </div>
                <div className="text-white/65">{bloc.members.map(name).join(', ')}</div>
                <div className="text-[#ffb340]">Hostile to you: {hostile.map(name).join(', ')}</div>
              </div>
            ))}
            {r.wary.slice(0, 4).map((w) => (
              <div key={w.id} className="flex justify-between gap-3 px-3 py-1.5">
                <span>
                  {name(w.id)} <span className="text-white/55">· {w.neighbor ? 'your neighbor' : 'abroad'}</span>
                </span>
                <span className="tabular-nums text-[#ff8a84]">opinion {w.opinion}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5" data-testid="remedies">
        <h4 className="text-[14px] font-semibold">What you can do</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <button className="btn btn-quiet text-left px-3 py-2 text-[13px]" onClick={() => openDiplomacy(biggest ?? null)}>
            <span className="block font-semibold">Open the Diplomacy desk</span>
            <span className="block text-white/65">Talk to the nations that are turning on you.</span>
          </button>
          {pactTargets.map((id) => (
            <OrderButton key={id} order={{ type: 'propose', nationId: player.id, target: id, proposal: { kind: 'pact' } }} label={`Offer ${name(id)} a pact`} cost="15 influence" effect="A non-aggression pact: it cannot join a strike on you while it stands." />
          ))}
          {hasCouncil && <OrderButton order={{ type: 'resolution', nationId: player.id, kind: 'recognition' }} label="Council: recognize your borders" cost={`${RESOLUTIONS.recognition.cost} influence`} effect="Your reputation for aggression falls by 25, and so does the threat." />}
          {biggest && game.nations[biggest]?.alive && !game.sanctions.some((x) => x.from === player.id && x.to === biggest && x.until >= game.turn) && !isAllied(game, biggest, player.id) && (
            <OrderButton order={{ type: 'imposeSanctions', nationId: player.id, target: biggest }} label={`Sanction ${name(biggest)}`} cost="15 influence" effect="Weakens their trade, but gives them a reason for war and costs you 3 reputation." />
          )}
        </div>
        <ul className="text-[12px] text-white/65 list-disc pl-5 space-y-0.5">
          <li>Aid: answer a crisis with aid or mediation (Diplomacy desk) to earn friends who will not join a strike.</li>
          <li>Reputation: starting wars without a reason raises your threat. Reasons for war and peace lower it as the months pass.</li>
          <li>Defense: reinforce the borders named above, and raise an Interceptor Shield and Barracks there.</li>
        </ul>
      </div>
    </Card>
  )
}
