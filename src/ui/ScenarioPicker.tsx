import { useEffect, useRef, useState } from 'react'
import { DIFFICULTY } from '../data/difficulty'
import { SCENARIOS, STANDARD_SCENARIO, scenarioGoalShort, type ScenarioDef } from '../data/scenarios'
import { getWorld } from '../map/world'
import { Modal } from './Modal'

/** Nation names for the cards, read from the map. */
const nationName = (id: string) => getWorld().map.regions[id]?.name ?? id

/** The scenario's one-line promise and what it asks, as a card the player can read at a glance. */
function Facts({ def }: { def: ScenarioDef }) {
  const std = def.id === STANDARD_SCENARIO
  return (
    <>
      <div className="scenario-facts" aria-label="At a glance">
        <span>
          <span className="label">Win</span>
          {scenarioGoalShort(def.goal)}
        </span>
        <span>
          <span className="label">Rivals</span>
          {std ? 'Your choice' : DIFFICULTY[def.recommended.difficulty].name}
        </span>
        <span>
          <span className="label">Play as</span>
          {std ? 'Any nation' : nationName(def.recommended.nation)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
      {def.tags.map((t) => (
        <span key={t} className="chip">
          {t}
        </span>
      ))}
      <span className="chip">{def.length}</span>
      </div>
    </>
  )
}

/**
 * Pick how the game starts. Each card says what is going on in plain words; the open one shows the whole briefing, how you win,
 * and who it suits. Choosing never locks the nation or the rival skill: the suggestion is a button, not a rule.
 */
export function ScenarioPicker({
  current,
  nation,
  onPick,
  onClose,
}: {
  current: string
  /** The nation picked on the setup screen, if any. */
  nation: string | null
  /** `playAs` is true when the player took the suggested nation and rivals too. */
  onPick: (def: ScenarioDef, playAs: boolean) => void
  onClose: () => void
}) {
  const [open, setOpen] = useState(current)
  const openCard = useRef<HTMLDivElement>(null)
  // The card that opens may be far down the list: bring it into view.
  useEffect(() => {
    openCard.current?.scrollIntoView?.({ block: 'nearest' })
  }, [open])
  const def = SCENARIOS.find((x) => x.id === open) ?? SCENARIOS[0]
  const suggested = nationName(def.recommended.nation)
  const isStandard = def.id === STANDARD_SCENARIO
  return (
    <Modal
      title="Choose a scenario"
      kicker="How the game starts"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn px-5 py-2.5 text-[15px]" onClick={onClose}>
            Cancel
          </button>
          {!isStandard && nation && nation !== def.recommended.nation && (
            <button className="btn px-5 py-2.5 text-[15px]" onClick={() => onPick(def, true)} data-testid="scenario-play-as">
              Use it, as {suggested} on {DIFFICULTY[def.recommended.difficulty].name}
            </button>
          )}
          <button className="btn btn-primary px-5 py-2.5 text-[15px]" data-autofocus onClick={() => onPick(def, false)} data-testid="scenario-use">
            {isStandard ? 'Standard game' : nation ? `Use ${def.title}` : `Use ${def.title}, as ${suggested}`}
          </button>
        </>
      }
    >
      <div className="scenario-grid" role="radiogroup" aria-label="Scenario">
        {SCENARIOS.map((x) => {
          const on = x.id === def.id
          return (
            <div key={x.id} ref={on ? openCard : undefined} className={`scenario-card ${on ? 'scenario-card-on' : ''}`}>
              <button role="radio" aria-checked={on} className="scenario-card-head" onClick={() => setOpen(x.id)}>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-[17px] font-semibold tracking-tight">{x.title}</span>
                  {x.id === current && <span className="chip chip-blue !py-0 text-[11px] shrink-0">Chosen</span>}
                </span>
                <span className="block text-[14px] text-white/80 leading-snug mt-0.5">{x.tagline}</span>
                <Facts def={x} />
              </button>
              {on && (
                <div className="scenario-card-body">
                  {x.briefing.map((para, i) => (
                    <p key={i} className="text-[14px] text-white/85 leading-snug">
                      {para}
                    </p>
                  ))}
                  <div className="inset-card p-3 text-[14px] leading-snug">
                    <div className="label mb-0.5">How you win</div>
                    {x.goalText}
                  </div>
                  <div className="text-[13px] text-white/75 leading-snug">
                    {x.id === STANDARD_SCENARIO ? 'Suits any nation.' : `Written for ${nationName(x.recommended.nation)}, with ${DIFFICULTY[x.recommended.difficulty].name} rivals. Any nation can play it.`}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
