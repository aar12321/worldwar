import { CAMPAIGNS, LEVEL_NAMES, MAX_LEVEL, SOCIAL, SOCIAL_RULES, describeEffect, powerOf } from '../../../data/society'
import { validateOrder } from '../../../engine/orders'
import { campaignPrice, socialCost } from '../../../engine/society'
import type { CampaignId, Order, SocialId } from '../../../engine/types'
import { getWorld } from '../../../map/world'
import { useGame } from '../../../store'
import { confirmFor } from '../../confirmRules'
import { fmt, usePlayerView } from '../../hooks'
import { Bar, LevelPicker } from '../../kit'
import { OrderButton } from '../../panel'
import { speak } from '../../plain'

/** What an effect does, one line each: green when it helps, amber when it is the price of the help. */
export function EffectLines({ lines }: { lines: { text: string; good: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px]">
      {lines.map((l) => (
        <li key={l.text} className={l.good ? 'text-[#6eeb8a]' : 'text-[#ffb340]'}>
          {l.text}
        </li>
      ))}
    </ul>
  )
}

/** One program for the people: its level, what it costs, what it does and how far that has phased in. */
export function PolicyCard({ id }: { id: SocialId }) {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const askConfirm = useGame((s) => s.askConfirm)
  const { game, player, econ, orders } = view
  const { map } = getWorld()
  const spec = SOCIAL[id]
  const state = player.social?.[id]
  const level = state?.level ?? 0
  const strength = state?.strength ?? 0
  const monthly = econ.society.byPolicy[id] ?? 0
  const setTo = (to: number): Order => ({ type: 'setSocial', nationId: player.id, policy: id, level: to })
  const problem = (to: number) => (to === level ? null : validateOrder(game, map, setTo(to), orders))
  const go = (to: number) => {
    const order = setTo(to)
    const ask = confirmFor(game, map, order)
    if (ask) askConfirm({ ...ask, run: () => void issueOrder(order) })
    else issueOrder(order)
  }
  const shown = level > 0 ? level : 1
  const next = level < MAX_LEVEL ? level + 1 : null
  const phasing = Math.abs(strength - level) > 0.02
  const here = player.social?.[id]?.changed === game.turn
  return (
    <div className={`inset-card p-3.5 space-y-2 ${level > 0 ? 'ring-1 ring-[#0a84ff]/30' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight">{spec.name}</h3>
          <p className="text-[13px] text-white/70">{spec.blurb}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[12px] font-semibold text-[#9fd0ff]">{LEVEL_NAMES[level]}</div>
          {monthly > 0 && <div className="text-[12px] text-white/70 tabular-nums">−{fmt(monthly, 1)} a month</div>}
        </div>
      </div>
      <LevelPicker label={`${spec.name} level`} levels={[...LEVEL_NAMES]} value={level} onChange={go} disabled={(i) => (problem(i) ? speak(problem(i) as string) : null)} />
      <div className="text-[12px] text-white/60">{level > 0 ? `${LEVEL_NAMES[level]} does:` : 'Even a Pilot would do:'}</div>
      <EffectLines lines={describeEffect(spec.effects, powerOf(shown))} />
      {phasing && (
        <div className="space-y-1">
          <div className="flex justify-between text-[12px] text-white/70">
            <span>{strength < level ? 'Phasing in' : 'Fading out'}</span>
            <span className="tabular-nums">{level > 0 ? `${Math.round((Math.min(strength, level) / level) * 100)}%` : `${Math.round(strength * 100)}% left`}</span>
          </div>
          <Bar value={level > 0 ? strength / level : strength / MAX_LEVEL} color={strength < level ? '#0a84ff' : '#ff9f0a'} label={`${spec.name} effect`} />
        </div>
      )}
      <p className="text-[12px] text-white/60">
        {here
          ? 'Changed this month. It can change again next month.'
          : next
            ? `To reach ${LEVEL_NAMES[next]}: ${socialCost(player, id, next)} influence, then ${fmt(spec.cost * next * econ.workforce, 1)} money a month.`
            : 'The highest level. Cutting it costs stability.'}
        {level > 0 && !here && ` Cutting a level costs ${SOCIAL_RULES.cutStability} stability.`}
      </p>
    </div>
  )
}

/** One campaign: a one-off bill for a burst of effect that fades, with a long wait before the next. */
export function CampaignCard({ id }: { id: CampaignId }) {
  const view = usePlayerView()!
  const { game, player } = view
  const spec = CAMPAIGNS[id]
  const c = player.campaigns?.[id]
  const price = campaignPrice(game, player, id)
  const running = !!c && c.left > 0
  const waiting = !!c && c.left === 0 && c.cooldown > 0
  const lines = describeEffect(spec.effects)
  const instant = [spec.instant?.stability ? { text: `Stability +${spec.instant.stability} at once`, good: true } : null, spec.instant?.epidemic ? { text: `A running epidemic eases ${Math.round(spec.instant.epidemic * 100)}% at once`, good: true } : null].filter((x): x is { text: string; good: boolean } => !!x)
  return (
    <div className={`inset-card p-3.5 space-y-2 ${running ? 'ring-1 ring-[#30d158]/40' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight">{spec.name}</h3>
          <p className="text-[13px] text-white/70">{spec.blurb}</p>
        </div>
        {running && <span className="chip text-[#6eeb8a]">Running</span>}
      </div>
      <EffectLines lines={[...instant, ...lines]} />
      <p className="text-[12px] text-white/60">
        For {spec.months} months. Can run again {spec.cooldown} months after it starts.
      </p>
      {running ? (
        <div className="space-y-1">
          <div className="flex justify-between text-[12px] text-white/70">
            <span>{c.left} month{c.left === 1 ? '' : 's'} left</span>
            <span>ready again in {c.cooldown}</span>
          </div>
          <Bar value={c.left / spec.months} color="#30d158" label={`${spec.name} time left`} />
        </div>
      ) : waiting ? (
        <p className="text-[13px] text-white/70">Ready again in {c.cooldown} month{c.cooldown === 1 ? '' : 's'}.</p>
      ) : (
        <OrderButton order={{ type: 'campaign', nationId: player.id, campaign: id }} label="Run it" cost={`${price} money`} tone="btn-primary" />
      )}
    </div>
  )
}
