import { BANKING } from '../../data/banking'
import { SECTORS, SECTOR_IDS } from '../../data/business'
import { TIERS, tierSpec } from '../../data/empire'
import { empireCount, tierFor, tierOf } from '../../engine/empire'
import { fundReturn, newBondRate } from '../../engine/bank'
import type { SectorId } from '../../engine/types'
import { useGame } from '../../store'
import { signed, usePlayerView } from '../hooks'
import { Pending, StatTile, Tiles } from '../kit'
import { pct } from '../format'
import { OrderButton } from '../panel'
import { Card, Line, SliderRow } from './parts'

const TERMS = [
  [12, '1 year'],
  [36, '3 years'],
  [60, '5 years'],
] as const

/** The central bank, the currency, what the state owes and what it has saved. */
export function BankTab() {
  const view = usePlayerView()!
  const setPrograms = useGame((s) => s.setPrograms)
  const { game, player, econ } = view
  const spec = tierOf(player)
  // The tier is set at the month end (updateTiers), so land taken this month counts from then: say so rather than seem stuck.
  const count = empireCount(game, player.id)
  const coming = tierFor(count, player.tier ?? 1)
  const sizeNote = `Your empire counts ${count} ${count === 1 ? 'country' : 'countries'}.${coming > spec.id ? ` From the month end you are a ${tierSpec(coming).name}.` : ''}`
  const opensAt = (has: (t: (typeof TIERS)[number]) => boolean) => {
    const t = TIERS.find(has)
    return t ? `${t.name} (${t.countries})` : ''
  }
  const b = player.bank
  const world = game.worldStats
  const range = spec.rate
  const rate = view.pendingRate
  const credit = econ.credit
  const war = game.wars.some((k) => k.split('|').includes(player.id))
  const printed = b.printed
  const reserve = world.reserve === player.id
  const bond = (amount: number, term: number, warBond = false) => ({ type: 'issueBonds' as const, nationId: player.id, amount, term, ...(warBond ? { war: true } : {}) })
  const repay = (amount: number) => ({ type: 'repayDebt' as const, nationId: player.id, amount })
  const warRoom = Math.max(0, spec.warBondCap * Math.max(10, econ.gross) - b.warBonds)

  return (
    <section className="econ-grid">
      <Tiles>
        <StatTile label="Inflation" value={`${b.inflation.toFixed(1)}%`} tone={b.inflation > 10 ? 'bad' : b.inflation > 5 ? 'warn' : undefined} sub={`world ${world.inflation.toFixed(1)}%`} />
        <StatTile label="Interest rate" value={`${(range ? rate : world.rate).toFixed(0)}%`} sub={range ? `you set it (${range[0]} to ${range[1]})` : "the world's rate"} />
        <StatTile label="Currency" value={b.currency.toFixed(2)} sub={b.currency < 0.9 ? 'weak: cheap exports' : b.currency > 1.1 ? 'strong' : 'steady'} tone={b.currency < 0.8 ? 'bad' : undefined} />
        <StatTile label="You owe" value={player.debt.toFixed(0)} tone={player.debt > 0 ? 'warn' : undefined} sub={`${player.bonds.length} bond${player.bonds.length === 1 ? '' : 's'}`} />
        <StatTile label="Credit rating" value={credit.rating} tone={credit.locked || credit.rating === 'D' || credit.rating === 'CCC' ? 'bad' : undefined} sub={`can borrow ${credit.room.toFixed(0)}`} />
        <StatTile label="Wealth fund" value={b.fund.toFixed(0)} sub={spec.wealthFund ? `${(fundReturn(game) * 1200).toFixed(1)}% a year` : 'needs a Great power'} />
      </Tiles>

      <Card title="Central bank" hint="A higher rate cools prices and weakens business; a lower one does the opposite." right={<Pending show={Math.abs(rate - b.rate) > 1e-9} />}>
        {range ? (
          <SliderRow label="Interest rate" value={rate} min={range[0]} max={range[1]} step={1} onChange={(v) => setPrograms({}, v)} format={(v) => `${v.toFixed(0)}%`} neutral={BANKING.neutralRate} hint={`4% is neutral. Each point above cools prices ${BANKING.rateInflation} points and trims business growth; each point below warms them. A ${spec.name} may set ${range[0]} to ${range[1]}%.`} />
        ) : (
          <p className="text-[13px] text-white/70">A {spec.name} borrows at the world's rate, {world.rate.toFixed(1)}%. A Regional power (4 countries) runs its own central bank.</p>
        )}
        <div className="text-[14px] space-y-1">
          <Line k="Real income kept" v={pct(econ.realIncome, 1)} warn={econ.realIncome < 0.97} />
          {reserve && <Line k="Reserve currency income" v={signed(econ.seigniorage)} />}
        </div>
        {b.inflation > BANKING.inflationCalm && <p className="text-[13px] text-[#ffb340]">Inflation above {BANKING.inflationCalm}% costs stability and credit, and eats into what people earn.</p>}
      </Card>

      <Card title="Print money" hint="Money now, inflation after. A burst nets a little; printing every month does not pay for itself.">
        <div className="grid grid-cols-3 gap-2">
          {BANKING.printSteps.map((share) => (
            <OrderButton key={share} order={{ type: 'printMoney', nationId: player.id, share }} label={`${Math.round(share * 100)}%`} effect={`${Math.round(share * econ.gross)} money now, then inflation`} />
          ))}
        </div>
        <p className="text-[13px] text-white/70">
          A {spec.name} may print up to {Math.round(spec.printCap * 100)}% of a month's income each month; its money is trusted {spec.credibility <= 0.6 ? 'a great deal' : spec.credibility <= 1 ? 'well' : 'little'} ({Math.round(printed * 100)}% used this month).
        </p>
      </Card>

      <Card title="Bonds" hint="Borrow for a fixed time at today's rate. When a bond comes due it is rolled over if lenders still lend, or paid from the treasury.">
        <div className="grid grid-cols-3 gap-2">
          {TERMS.filter(([m]) => spec.bondTerms.includes(m)).map(([months, name]) => (
            <OrderButton key={months} order={bond(100, months)} label={`Borrow 100 · ${name}`} effect={`Sold at ${(newBondRate(game, { ...player, bank: { ...b, rate } }, credit.rate) * 100).toFixed(2)}% a month`} />
          ))}
        </div>
        {player.bonds.length > 0 ? (
          <div className="rounded-xl bg-white/5 divide-y divide-white/8 text-[13px]">
            {[...player.bonds]
              .sort((a, c) => a.due - c.due)
              .map((bd) => (
                <div key={bd.id} className="flex justify-between gap-3 px-3 py-1.5">
                  <span>
                    {bd.amount.toFixed(0)} {bd.war ? 'war bonds' : 'bond'} at {(bd.rate * 100).toFixed(2)}% a month
                  </span>
                  <span className={`tabular-nums ${bd.due - game.turn <= 3 ? 'text-[#ffd60a]' : 'text-white/70'}`}>due in {Math.max(0, bd.due - game.turn)} mo</span>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-[13px] text-white/70">You owe nothing.</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <OrderButton order={repay(Math.min(50, player.debt))} label="Repay 50" effect="Pays the dearest bond first" />
          <OrderButton order={repay(player.debt)} label="Repay all" cost={`${player.debt.toFixed(0)} money`} />
        </div>
        {!war && b.warBonds <= 0 && <p className="text-[12px] text-white/60">War bonds, at a patriotic {(BANKING.warBondRate * 100).toFixed(2)}% a month, can be sold only while you are at war.</p>}
        {credit.locked && <p className="text-[13px] text-[#ff8a84]">You defaulted recently, so nobody will lend to you.</p>}
        {player.debt > 0 && econ.netCapital < 0 && <p className="text-[13px] text-[#ff8a84]">You spend more than you earn while in debt. Three months in the red means default: half of every bond is written off.</p>}
      </Card>

      {(war || b.warBonds > 0) && (
        <Card title="War bonds" hint="People lend to their country in wartime at a patriotic rate. Each issue calms the streets a little.">
          <div className="text-[14px] space-y-1">
            <Line k="Sold so far this war" v={b.warBonds.toFixed(0)} />
            <Line k="Room left" v={war ? warRoom.toFixed(0) : 'at war only'} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <OrderButton order={bond(Math.max(20, Math.floor(econ.gross * 0.5)), BANKING.warBondTerm, true)} label="Sell war bonds" effect={`${(BANKING.warBondRate * 100).toFixed(2)}% a month for ${BANKING.warBondTerm} months, +${BANKING.warBondStability} stability`} />
          </div>
        </Card>
      )}

      {spec.directedCredit && (
        <Card title="Directed credit" hint="Tell the banks which sector to lend to: it grows faster, but prices rise a little and bad loans cost money while the country is shaky." right={<Pending show={view.pendingPrograms.creditSector !== player.programs.creditSector} />}>
          <div className="grid grid-cols-2 gap-1.5">
            <button className={`btn text-left px-2.5 py-2 text-[13px] ${view.pendingPrograms.creditSector === null ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setPrograms({ creditSector: null })}>
              No directed credit
            </button>
            {SECTOR_IDS.map((id: SectorId) => (
              <button key={id} className={`btn text-left px-2.5 py-2 text-[13px] ${view.pendingPrograms.creditSector === id ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setPrograms({ creditSector: id })}>
                {SECTORS[id].name}
              </button>
            ))}
          </div>
        </Card>
      )}

      {spec.wealthFund && (
        <Card title="Wealth fund" hint="Savings invested in the world. They earn the world's rate plus a share of the stock exchange's moves, and lift your credit. A conqueror takes part of it.">
          <div className="text-[14px] space-y-1">
            <Line k="Return this month" v={`${(fundReturn(game) * 100).toFixed(2)}%`} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <OrderButton order={{ type: 'wealthFund', nationId: player.id, amount: 100 }} label="Put in 100" />
            <OrderButton order={{ type: 'wealthFund', nationId: player.id, amount: 400 }} label="Put in 400" />
            <OrderButton order={{ type: 'wealthFund', nationId: player.id, amount: -Math.floor(b.fund * BANKING.fundWithdrawShare) }} label="Take out a quarter" effect={`${Math.round(BANKING.fundFee * 100)}% fee`} />
          </div>
        </Card>
      )}

      {(!spec.directedCredit || !spec.wealthFund) && (
        <Card title="Opens with a bigger empire" hint={`${sizeNote} The Empire desk lists everything each size opens.`}>
          <div className="text-[14px] space-y-1">
            {!spec.directedCredit && <Line k="Directed credit: steer bank lending to one sector" v={opensAt((t) => t.directedCredit)} />}
            {!spec.wealthFund && <Line k="Wealth fund: savings that earn the world's rate" v={opensAt((t) => t.wealthFund)} />}
          </div>
        </Card>
      )}

    </section>
  )
}
