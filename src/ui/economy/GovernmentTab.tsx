import { ELECTION, GOVERNMENTS, GOVERNMENT_TYPES, REFORM } from '../../data/government'
import { EMPIRE_RULES } from '../../data/empire'
import { LAW_SPECS } from '../../data/unitTypes'
import { lawConflict, lawSlots, tierOf } from '../../engine/empire'
import { electionNeed } from '../../engine/people'
import { monthsToElection } from '../../engine/politics'
import type { LawId } from '../../engine/types'
import { usePlayerView } from '../hooks'
import { OrderButton } from '../panel'
import { Card } from './parts'

/** The form of government and the laws. Spending on the people is in the Budget and People tabs. */
export function GovernmentTab() {
  const view = usePlayerView()!
  const { game, player } = view
  const gov = GOVERNMENTS[player.government]
  const election = monthsToElection(game, player.id)
  const need = Math.round(electionNeed(player, ELECTION.needed))
  const slots = lawSlots(player)

  return (
    <section className="econ-grid">
      <Card title={gov.name} hint={gov.blurb} right={<span className="chip">Your government</span>}>
        {election !== null && (
          <p className="text-[14px]">
            Next election in {election} months. You need stability of at least {need}% to win it (now {Math.round(player.stability)}%). Pensions and housing lower the bar; unemployment raises it.
          </p>
        )}
        <div className="grid gap-2">
          {GOVERNMENT_TYPES.filter((g) => g !== player.government).map((g) => (
            <div key={g} className="rounded-xl bg-white/5 p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold">{GOVERNMENTS[g].name}</div>
                <div className="text-[13px] text-white/70">{GOVERNMENTS[g].blurb}</div>
              </div>
              <OrderButton
                order={{ type: 'setGovernment', nationId: player.id, government: g }}
                label="Change"
                cost={`${REFORM.cost} influence`}
                effect={`Stability -${REFORM.turmoil} at once`}
                className="shrink-0"
              />
            </div>
          ))}
        </div>
      </Card>

      <div className="space-y-2.5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-semibold">Laws</h3>
            <p className="text-[13px] text-white/70">
              A law costs influence to pass and takes effect at once. Each one in force costs {EMPIRE_RULES.lawUpkeep} influence a month to uphold, and repealing costs {EMPIRE_RULES.repealCost}. Some laws cannot stand together.
            </p>
          </div>
          <span className={`chip shrink-0 ${player.laws.length >= slots ? 'text-[#ffd60a]' : ''}`} title={`A ${tierOf(player).name} has room for ${slots} laws. A bigger empire has room for more.`}>
            Laws {player.laws.length} of {slots}
          </span>
        </div>
        {(Object.keys(LAW_SPECS) as LawId[]).filter((law) => !LAW_SPECS[law].retired).map((law) => {
          const active = player.laws.includes(law)
          const clash = active ? null : lawConflict(player, law)
          return (
            <div key={law} className="inset-card p-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[16px] font-semibold tracking-tight">{LAW_SPECS[law].name}</span>
                {active ? (
                  <OrderButton order={{ type: 'repealLaw', nationId: player.id, law }} label="Repeal" cost={`${EMPIRE_RULES.repealCost} influence`} />
                ) : (
                  <OrderButton order={{ type: 'enactLaw', nationId: player.id, law }} label="Pass" cost={`${LAW_SPECS[law].cost} influence`} tone="btn-primary" />
                )}
              </div>
              <p className="text-[13px] text-white/70 mt-1.5">
                {active ? 'In force. ' : ''}
                {LAW_SPECS[law].description}
                {clash && <span className="block text-[#ffb340] mt-1">Cannot stand beside {LAW_SPECS[clash].name}.</span>}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

