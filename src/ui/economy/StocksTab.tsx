import { DIRECTIVES, SPECIALTY, STOCKS, TIERS } from '../../data/companies'
import { SECTORS } from '../../data/business'
import { companiesOf, describeDirective, directiveOf, homeOwner, portfolio, stake, stakeShare, strengthOf, tierOf, tradeValue } from '../../engine/stocks'
import type { Directive } from '../../engine/types'
import { useGame } from '../../store'
import { fmt, signed, usePlayerView } from '../hooks'
import { OrderButton } from '../panel'
import { Card } from './parts'

const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : 0)
const DIRECTIVE_IDS = Object.keys(DIRECTIVES) as Directive[]

/** A bar from none to all of a company, with a tick where each kind of say begins. */
function StakeBar({ share }: { share: number }) {
  return (
    <div className="pt-1 pb-4">
      <div className="relative h-2.5 rounded-full bg-white/10">
        <div className="absolute inset-y-0 left-0 rounded-full bg-[#6eeb8a]" style={{ width: `${Math.min(100, share * 100)}%` }} />
        {TIERS.map((t) => (
          <div key={t.name} className="absolute inset-y-[-3px] w-px bg-white/50" style={{ left: `${t.at * 100}%` }}>
            <span className="absolute top-[15px] -translate-x-1/2 text-[10px] leading-none text-white/55 whitespace-nowrap">{Math.round(t.at * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Companies in the countries you hold: buy a share of them, take a seat on the board, and tell them what to do. */
export function StocksTab() {
  const view = usePlayerView()!
  const openDiplomacy = useGame((s) => s.openDiplomacy)
  const { game, player } = view
  const st = game.stocks
  const mine = portfolio(game, player.id)
  const ids = companiesOf(game, player.id).sort((a, b) => stake(game, player.id, b) - stake(game, player.id, a) || a.localeCompare(b))
  const abroad = Object.keys(st.meta)
    .filter((id) => homeOwner(game, id) !== player.id)
    .sort((a, b) => st.meta[a].name.localeCompare(st.meta[b].name))
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
        You can only invest in companies in countries you hold, and a very developed country has no more than two. Buy shares to take a stake: {Math.round(TIERS[0].at * 100)}% makes you an investor, {Math.round(TIERS[1].at * 100)}% gets you a board seat, {Math.round(TIERS[2].at * 100)}% is control. With a board seat you can tell the company what to do, and it does that for the nation. Big trades move the price against you, and a trade costs a {STOCKS.fee * 100}% fee. If another nation takes the country, it takes your shares too.
      </p>
      {ids.length === 0 && (
        <Card title="Companies in your territory" hint="None of the countries you hold are developed enough to have a company. Take a developed country, and its companies come with it." />
      )}
      {ids.map((id) => {
        const info = st.meta[id]
        const price = st.price[id]
        const held = stake(game, player.id, id)
        const share = stakeShare(game, player.id, id)
        const tier = tierOf(share)
        const strength = strengthOf(share)
        const directive = directiveOf(game, id)
        const change = pct(price, st.last[id])
        const buyTo = (at: number) => Math.min(STOCKS.float - held, Math.ceil(at * STOCKS.float - 1e-9) - held)
        return (
          <Card
            key={id}
            title={info.name}
            hint={`${SECTORS[info.sector].name} · based in ${info.country}`}
            right={
              <div className="text-right tabular-nums shrink-0">
                <div className="text-[16px] font-semibold">{fmt(price, 2)}</div>
                <div className={`text-[12px] ${change >= 0 ? 'text-[#6eeb8a]' : 'text-[#ff6961]'}`}>
                  {change >= 0 ? '+' : ''}
                  {change.toFixed(1)}%
                </div>
              </div>
            }
          >
            <div className="text-[13px]">
              You hold <strong>{(share * 100).toFixed(share < 0.1 && share > 0 ? 1 : 0)}%</strong> · {held} of {STOCKS.float} shares · worth {fmt(held * price, 0)}
              {tier >= 0 && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[12px]">{TIERS[tier].name}</span>}
            </div>
            <StakeBar share={share} />
            <p className="text-[12px] text-white/65">{tier >= 0 ? TIERS[tier].blurb : `At ${Math.round(TIERS[0].at * 100)}% you are an investor; at ${Math.round(TIERS[1].at * 100)}% you get a board seat and a say.`}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {[50, 100].map((n) => (
                <OrderButton key={n} order={{ type: 'buyShares', nationId: player.id, company: id, shares: n }} label={`Buy ${n / 10}%`} cost={fmt(tradeValue(game, id, n, 'buy'), 0)} />
              ))}
              {[1, 2].map((i) => {
                const n = buyTo(TIERS[i].at)
                return held / STOCKS.float >= TIERS[i].at || n < 1 ? null : (
                  <OrderButton
                    key={i}
                    order={{ type: 'buyShares', nationId: player.id, company: id, shares: n }}
                    label={i === 1 ? 'To a board seat' : 'To control'}
                    cost={fmt(tradeValue(game, id, n, 'buy'), 0)}
                    effect={`Buy ${n} shares to reach ${Math.round(TIERS[i].at * 100)}%.`}
                  />
                )
              })}
              {held > 0 && <OrderButton order={{ type: 'sellShares', nationId: player.id, company: id, shares: Math.max(1, Math.min(held, 100)) }} label={`Sell ${Math.min(held, 100) / 10}%`} cost={`+${fmt(tradeValue(game, id, Math.min(held, 100), 'sell'), 0)}`} tone="btn-quiet" />}
              {held > 100 && <OrderButton order={{ type: 'sellShares', nationId: player.id, company: id, shares: held }} label="Sell all" cost={`+${fmt(tradeValue(game, id, held, 'sell'), 0)}`} tone="btn-quiet" />}
            </div>
            <div className="pt-1">
              <div className="label mb-1.5">What it does {strength > 0 ? `(${strength === 0.5 ? 'half' : strength === 1 ? 'full' : 'a quarter more than full'} strength)` : ''}</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                {DIRECTIVE_IDS.map((d) => (
                  <OrderButton
                    key={d}
                    order={{ type: 'setDirective', nationId: player.id, company: id, directive: d }}
                    label={d === 'focus' ? `Specialize: ${SPECIALTY[info.sector].name}` : DIRECTIVES[d].name}
                    cost={directive === d && (strength > 0 || d === 'payout') ? 'in force' : undefined}
                    effect={describeDirective(game, id, d, Math.max(share, TIERS[1].at))}
                    className={directive === d && (strength > 0 || d === 'payout') ? 'outline outline-2 -outline-offset-2 outline-[#6eeb8a]' : ''}
                  />
                ))}
              </div>
              {strength <= 0 && held > 0 && <p className="text-[12px] text-white/60 mt-1.5">Until you hold {Math.round(TIERS[1].at * 100)}%, it just pays dividends.</p>}
            </div>
          </Card>
        )
      })}
      {abroad.length > 0 && (
        <details className="inset-card p-3.5">
          <summary className="cursor-pointer text-[15px] font-semibold">Companies in other countries ({abroad.length})</summary>
          <p className="text-[13px] text-white/70 mt-1.5">You cannot buy these. Take the country, and its companies are yours to invest in.</p>
          <ul className="divide-y divide-white/10 mt-2">
            {abroad.map((id) => {
              const info = st.meta[id]
              const owner = homeOwner(game, id)
              const change = pct(st.price[id], st.last[id])
              return (
                <li key={id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium truncate">{info.name}</div>
                    <div className="text-[12px] text-white/65">
                      {SECTORS[info.sector].name} · {info.country}
                      {owner && owner !== info.home && (
                        <>
                          {' · held by '}
                          <button className="underline decoration-white/30 hover:decoration-white" onClick={() => openDiplomacy(owner)}>
                            {game.nations[owner]?.name ?? owner}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right tabular-nums text-[13px] shrink-0">
                    {fmt(st.price[id], 2)}
                    <span className={`ml-2 ${change >= 0 ? 'text-[#6eeb8a]' : 'text-[#ff6961]'}`}>
                      {change >= 0 ? '+' : ''}
                      {change.toFixed(1)}%
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </details>
      )}
      <p className="text-[12px] text-white/55">All companies are made up. They only follow how their home countries do in this game.</p>
    </div>
  )
}
