import { useMemo, useState } from 'react'
import { LABS, NODES, NODE_IDS, SAMPLE_NAMES, type NodeId, type SampleKind } from '../../../data/space'
import { spaceProblem } from '../../../engine/space'
import { Pips } from '../../bits'
import { Bar } from '../../kit'
import { OrderButton } from '../../panel'
import { usePlayerView } from '../../hooks'
import { Card } from '../parts'
import { Chip, Search } from './shared'
import { money, spaceOrder } from './words'

const GROUPS = ['Rockets', 'Life support', 'Mining', 'Spillover'] as const
const GROUP_BLURB: Record<(typeof GROUPS)[number], string> = {
  Rockets: 'Cheaper, safer and faster launches.',
  'Life support': 'Keep crews alive and bases cheap to run.',
  Mining: 'Make the mines possible, and richer.',
  Spillover: 'Things learned in space that pay off at home: output, medicine, new technologies.',
}

/** Samples come home from the flights; the labs turn them into discoveries. */
export function LabsSection() {
  const view = usePlayerView()!
  const { player, game, econ } = view
  const sp = player.space
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const shown = useMemo(() => NODE_IDS.filter((id) => !query || `${NODES[id].name} ${NODES[id].blurb} ${NODES[id].says} ${NODES[id].group}`.toLowerCase().includes(query)), [query])
  const samples = Object.entries(sp?.samples ?? {}).filter(([, v]) => (v ?? 0) > 0)
  const labs = sp?.labs ?? 0
  return (
    <>
      <Card title="Space labs" hint="The labs study what your flights bring back. Each bench works on one discovery at a time: it costs money every month, research once, and some of the samples. More lab levels open harder discoveries and more benches.">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <Pips value={labs} max={LABS.max} />
            <div className="text-[13px] text-white/70">{labs === 0 ? 'No labs yet' : `Level ${labs}: ${labs} bench${labs === 1 ? '' : 'es'}, research ×${LABS.speed[labs]}`} · upkeep {LABS.upkeep[labs]} a month</div>
          </div>
          <OrderButton
            order={spaceOrder(player, { kind: 'lab' })}
            label={sp?.labBuild ? 'Being built' : labs >= LABS.max ? 'Complete' : `Raise to level ${labs + 1}`}
            cost={labs < LABS.max ? `${LABS.cost[labs + 1]} money, ${LABS.tp[labs + 1]} research` : undefined}
            tone="btn-primary"
          />
        </div>
        {sp?.labBuild && <Bar value={sp.labBuild.progress / LABS.months[labs + 1]} label="Lab progress" color="#bf5af2" />}
        <div className="text-[13px] text-white/70">Scientists are staffed at {Math.round(econ.coverage.scientists * 100)}%: research speed ×{econ.researchStaff.toFixed(2)}.</div>
      </Card>

      <Card title="Samples" hint="Brought home by probes, landers and crews. A discovery uses some of them up.">
        {samples.length ? (
          <div className="flex flex-wrap gap-1.5">
            {samples.map(([k, v]) => (
              <Chip key={k} tone="good">
                {SAMPLE_NAMES[k as SampleKind]} · {v}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-white/60">None yet. Lunar probes bring regolith, asteroid missions bring metal, Mars and the outer planets bring soil, ice and exotica.</p>
        )}
      </Card>

      {(sp?.research.length ?? 0) > 0 && (
        <Card title="On the benches" hint="Work in progress.">
          <ul className="space-y-2.5">
            {sp!.research.map((r) => (
              <li key={r.node} className="space-y-1">
                <div className="flex justify-between gap-2 text-[14px]">
                  <span className="font-semibold">{NODES[r.node].name}</span>
                  <span className="text-[12px] text-white/70">{Math.max(0, Math.ceil((NODES[r.node].months - r.progress) / LABS.speed[labs])).toFixed(0)} months left</span>
                </div>
                <Bar value={r.progress / NODES[r.node].months} label={`${NODES[r.node].name} progress`} color="#bf5af2" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="span-all">
        <Search value={q} onChange={setQ} label="Search discoveries" />
      </div>
      {GROUPS.map((g) => {
        const ids = shown.filter((id) => NODES[id].group === g)
        if (!ids.length) return null
        return (
          <div key={g} className="span-all space-y-2">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight pt-1">{g}</h2>
              <p className="text-[12px] text-white/60">{GROUP_BLURB[g]}</p>
            </div>
            <div className="econ-grid">
              {ids.map((id) => (
                <NodeCard key={id} id={id} workforce={econ.workforce} turn={game.turn} />
              ))}
            </div>
          </div>
        )
      })}
      {shown.length === 0 && <p className="span-all text-[13px] text-white/60">No discovery matches.</p>}
    </>
  )
}

function NodeCard({ id, workforce }: { id: NodeId; workforce: number; turn: number }) {
  const { player, game } = usePlayerView()!
  const spec = NODES[id]
  const sp = player.space
  const done = sp?.discoveries.includes(id)
  const working = sp?.research.some((r) => r.node === id)
  const action = { kind: 'research', node: id } as const
  const problem = done || working ? null : spaceProblem(game, player, action, workforce)
  const samples = Object.entries(spec.samples ?? {})
  return (
    <div className={`inset-card p-3.5 space-y-2 ${done ? 'ring-1 ring-[#30d158]/30' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight">{spec.name}</h3>
          <p className="text-[13px] text-white/70">{spec.blurb}</p>
        </div>
        <Chip tone={done ? 'good' : working ? 'warn' : undefined}>{done ? 'Discovered' : working ? 'On a bench' : `Lab ${spec.lab}`}</Chip>
      </div>
      <p className="text-[13px] text-[#6eeb8a]">{spec.says}</p>
      <div className="flex flex-wrap gap-1.5">
        <Chip>{spec.months} months</Chip>
        <Chip>{money(spec.money)} money</Chip>
        <Chip>{spec.tp} research</Chip>
        {samples.map(([k, v]) => (
          <Chip key={k}>
            {v} {SAMPLE_NAMES[k as SampleKind].toLowerCase()}
          </Chip>
        ))}
        {spec.requires.map((r) => (
          <Chip key={r} tone={sp?.discoveries.includes(r) ? 'good' : 'warn'}>
            after {NODES[r].name.toLowerCase()}
          </Chip>
        ))}
      </div>
      {!done && !working && <OrderButton order={spaceOrder(player, action)} label="Research it" cost={`${spec.tp} research`} tone={problem ? '' : 'btn-primary'} />}
    </div>
  )
}
