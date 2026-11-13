import { COMPANIES, COMPANY_BY_ID, STOCKS } from '../../data/companies'
import { SECTORS } from '../../data/business'
import { homeOwner, portfolio, shareOfCountry, stake } from '../../engine/stocks'
import { useGame } from '../../store'
import { fmt, signed, usePlayerView } from '../hooks'
import { OrderButton } from '../panel'
import { Card } from './parts'

const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0)

/** The world exchange: companies from around the world, with prices that follow their home economies. */
export function StocksTab() {
  const view = usePlayerView()!
  const openDiplomacy = useGame((s) => s.openDiplomacy)
  const { game, player } = view
  const st = game.stocks
  const mine = portfolio(game, player.id)
  const rows = COMPANIES.filter((c) => st.price[c.id] !== undefined)
    .map((c) => {
      const owner = homeOwner(game, c.id)
      return { c, owner, price: st.price[c.id], change: pct(st.price[c.id], st.last[c.id]), held: stake(game, player.id, c.id), alive: !!owner && game.nations[owner]?.alive }
    })
    .sort((a, b) => b.held - a.held || b.price - a.price)
  const mood = st.mood <= -0.04 ? 'Panic' : st.mood >= 0.03 ? 'Rally' : 'Calm'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <div className="inset-card py-2.5">
          <div className="label">World index</div>
          <div className="text-[20px] font-semibold tabular-nums">{fmt(st.index, 0)}</div>
        </div>
        <div className="inset-card py-2.5">
          <div className="label">Mood</div>
          <div className={`text-[20px] font-semibold ${mood === 'Panic' ? 'text-[#ff6961]' : mood === 'Rally' ? 'text-[#6eeb8a]' : ''}`}>{mood}</div>
        </div>
        <div className="inset-card py-2.5">
          <div className="label">Your shares</div>
          <div className="text-[20px] font-semibold tabular-nums">{fmt(mine.value, 0)}</div>
        </div>
        <div className="inset-card py-2.5">
          <div className="label">Dividends a month</div>
          <div className="text-[20px] font-semibold tabular-nums text-[#6eeb8a]">{signed(mine.dividends)}</div>
        </div>
      </div>
      <p className="text-[13px] text-white/70">
        Each company follows the economy of the country it is based in: its business growth, stability and taxes, and trouble from war or crises. Shares pay a dividend. Owning a tenth or more of a country's companies makes it fond of you. In a war with their country, your shares there are seized. A trade costs a {STOCKS.fee * 100}% fee, and no nation may own more than {STOCKS.maxStake} of {STOCKS.float} shares.
      </p>
      <Card title="Companies" hint="Prices move each month. Buy where the home country is growing and calm.">
        <ul className="divide-y divide-white/10">
          {rows.map(({ c, owner, price, change, held, alive }) => {
            const country = owner ? game.nations[owner] : null
            const share = owner ? shareOfCountry(game, player.id, owner) : 0
            return (
              <li key={c.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold truncate">{c.name}</div>
                  <div className="text-[12px] text-white/70">
                    {SECTORS[c.sector].name} ·{' '}
                    {country ? (
                      <button className="underline decoration-white/30 hover:decoration-white" onClick={() => owner && openDiplomacy(owner)}>
                        {country.name}
                      </button>
                    ) : (
                      'gone'
                    )}
                    {held > 0 ? ` · you hold ${held}` : ''}
                    {share >= 0.1 ? ` · ${Math.round(share * 100)}% of their companies` : ''}
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <div className="text-[16px] font-semibold">{fmt(price, 2)}</div>
                  <div className={`text-[12px] ${change >= 0 ? 'text-[#6eeb8a]' : 'text-[#ff6961]'}`}>
                    {change >= 0 ? '+' : ''}
                    {change.toFixed(1)}%
                  </div>
                </div>
                {alive && (
                  <div className="flex gap-1.5">
                    {[10, 50, 200].map((n) => (
                      <OrderButton key={`b${n}`} order={{ type: 'buyShares', nationId: player.id, company: c.id, shares: n }} label={`Buy ${n}`} cost={`${fmt(price * n * (1 + STOCKS.fee), 0)}`} />
                    ))}
                    {held > 0 && <OrderButton order={{ type: 'sellShares', nationId: player.id, company: c.id, shares: held }} label={`Sell all ${held}`} cost={`+${fmt(price * held * (1 - STOCKS.fee), 0)}`} tone="btn-quiet" />}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Card>
      <p className="text-[12px] text-white/55">All companies are made up. {COMPANY_BY_ID.nimbus.name} and the rest only follow how their home countries do in this game.</p>
    </div>
  )
}
