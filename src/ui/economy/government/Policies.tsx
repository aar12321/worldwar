import { GROUP_SPECS, PIPELINE, POLICY_AREAS, POLICY_SPECS, type Bill, type PolicyAreaId } from '../../../data/civics'
import { currentOption, draftSpeed, passChance } from '../../../engine/civics'
import { usePlayerView } from '../../hooks'
import { Bar } from '../../kit'
import { OrderButton } from '../../panel'
import { Card } from '../parts'
import { effectWords, groupWords } from './words'

const STAGES = ['Drafting', 'Vote', 'Phasing in'] as const

/** Bills in the pipeline (drafting, then the vote, then phasing in) and every policy area with its options. */
export function PoliciesSection() {
  const { player } = usePlayerView()!
  const bills = player.civics?.bills ?? []
  const phasing = POLICY_AREAS.filter((a) => (player.civics?.policies[a]?.phase ?? 1) < 1)
  const body = PIPELINE.body[player.government] ?? 'The council'
  return (
    <>
      <Card
        title="Policy pipeline"
        hint={`A policy is drafted by its ministry (faster with a good minister and enough economists), then ${body} votes a month later. You can lobby with influence before the vote. A passed policy phases in over ${PIPELINE.phaseMonths} months. At most ${PIPELINE.maxBills} bills at once.`}
        right={<span className="chip shrink-0">{bills.length} of {PIPELINE.maxBills}</span>}
      >
        <ol className="flex gap-1.5 text-[12px]" aria-label="Stages">
          {STAGES.map((st, i) => (
            <li key={st} className="flex-1 rounded-lg bg-white/6 px-2 py-1.5 text-center">
              <span className="text-white/50">{i + 1}.</span> {st}
            </li>
          ))}
        </ol>
        {bills.length === 0 && phasing.length === 0 && <p className="text-[13px] text-white/60">Nothing in the pipeline. Draft a policy below.</p>}
        {bills.map((b) => (
          <BillRow key={b.id} b={b} />
        ))}
        {phasing.map((a) => {
          const p = player.civics!.policies[a]!
          return (
            <div key={a} className="rounded-xl bg-white/5 p-3 space-y-1.5">
              <div className="flex justify-between gap-2 text-[14px]">
                <span className="font-semibold">{POLICY_SPECS[a].name}: {POLICY_SPECS[a].options[p.option]?.name}</span>
                <span className="chip">Phasing in</span>
              </div>
              <Bar value={p.phase} color="#30d158" label={`${Math.round(p.phase * 100)}% in force`} />
              <div className="text-[12px] text-white/60">{Math.round(p.phase * 100)}% in force · full in {Math.ceil((1 - p.phase) * PIPELINE.phaseMonths)} months</div>
            </div>
          )
        })}
      </Card>
      {POLICY_AREAS.map((a) => (
        <AreaCard key={a} area={a} />
      ))}
    </>
  )
}

function BillRow({ b }: { b: Bill }) {
  const { game, player } = usePlayerView()!
  const spec = POLICY_SPECS[b.area]
  const chance = passChance(game, player, b)
  const drafting = b.stage === 'drafting'
  const speed = draftSpeed(player, b.area)
  return (
    <div className="rounded-xl bg-white/5 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">{spec.name}: {spec.options[b.option]?.name}</div>
          <div className="text-[12px] text-white/60">
            {drafting ? `Drafting: about ${Math.max(1, Math.ceil(b.left / speed))} month${Math.max(1, Math.ceil(b.left / speed)) === 1 ? '' : 's'} left, then the vote` : `${PIPELINE.body[player.government] ?? 'The council'} votes at the end of this month`}
          </div>
        </div>
        <span className={`chip shrink-0 ${chance < 0.5 ? 'text-[#ffb340]' : ''}`}>{Math.round(chance * 100)}% to pass</span>
      </div>
      <Bar value={drafting ? 1 - b.left / Math.max(0.01, b.total) : 1} color={drafting ? '#0a84ff' : '#ffd60a'} label={drafting ? 'Drafting progress' : 'Ready for the vote'} />
      <div className="flex flex-wrap gap-2">
        <OrderButton
          order={{ type: 'civics', nationId: player.id, action: { kind: 'lobby', bill: b.id } }}
          label={`Lobby (${b.lobby}/${PIPELINE.lobbyMax})`}
          cost={`${PIPELINE.lobbyCost} influence`}
          effect={`+${Math.round(PIPELINE.lobbyChance * 100)}% to pass`}
        />
        <OrderButton order={{ type: 'civics', nationId: player.id, action: { kind: 'withdraw', bill: b.id } }} label="Withdraw" effect="The influence spent is lost" />
      </div>
    </div>
  )
}

function AreaCard({ area }: { area: PolicyAreaId }) {
  const { game, player } = usePlayerView()!
  const spec = POLICY_SPECS[area]
  const now = currentOption(player, area)
  const inForce = player.civics?.policies[area]
  const pending = player.civics?.bills.find((b) => b.area === area)
  const months = Math.ceil(spec.draftMonths / draftSpeed(player, area)) + PIPELINE.voteMonths
  return (
    <Card title={spec.name} hint={spec.blurb} right={<span className="chip shrink-0">{spec.options[now]?.name}</span>}>
      <div className="grid gap-2">
        {Object.entries(spec.options).map(([id, o]) => {
          const current = id === now
          const words = effectWords(o.effects)
          const groups = groupWords(o.groups)
          return (
            <div key={id} className={`rounded-xl p-3 space-y-1.5 ${current ? 'bg-[#0a84ff]/15 ring-1 ring-[#0a84ff]/40' : 'bg-white/5'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">{o.name}</div>
                  <div className="text-[13px] text-white/70">{o.blurb}</div>
                </div>
                {current ? (
                  <span className="chip shrink-0">{inForce && inForce.phase < 1 ? `${Math.round(inForce.phase * 100)}% in` : 'In force'}</span>
                ) : (
                  <OrderButton
                    order={{ type: 'civics', nationId: player.id, action: { kind: 'draft', area, option: id } }}
                    label="Draft"
                    cost={`${spec.cost} influence`}
                    effect={pending ? undefined : `About ${months} months to the vote, ${Math.round(passChance(game, player, { area, option: id, lobby: 0 }) * 100)}% to pass now`}
                    className="shrink-0"
                  />
                )}
              </div>
              {words.length > 0 && <div className="text-[12px] text-white/80">{words.join(' · ')}</div>}
              {groups.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {groups.map((g) => (
                    <span key={g.id} className="rounded-full px-2 py-0.5 text-[11px] bg-white/8" style={{ color: g.value > 0 ? '#6eeb8a' : '#ff8a84' }} title={GROUP_SPECS[g.id].blurb}>
                      {g.text}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
