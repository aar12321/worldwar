import { MATERIALS } from '../../data/deposits'
import { MARKET } from '../../data/unitTypes'
import { sanctionersOf } from '../../engine/helpers'
import { MARKET_GOODS, marketPrices, marketValue, tradeRoom } from '../../engine/trade'
import type { TradeResource } from '../../engine/types'
import { getWorld } from '../../map/world'
import { useGame } from '../../store'
import { signed, usePlayerView } from '../hooks'
import { OrderButton } from '../panel'
import { Card } from './parts'

const NOTES: Record<string, string> = {
  food: 'Feeds your people and soldiers.',
  oil: 'Tanks, planes and warships burn it every month. With none they fight at 60%.',
  steel: 'Tanks, artillery, planes and warships are built from it.',
  goods: 'What your people buy. When it runs out they grow restless.',
}

/** The world market: buy and sell food and materials at a price that follows what is scarce. */
export function MarketTab() {
  const view = usePlayerView()!
  const issueOrder = useGame((s) => s.issueOrder)
  const { game, player, econ } = view
  const { map } = getWorld()
  const prices = marketPrices(game)
  const room = tradeRoom(game, map, player.id)
  const sanctioned = sanctionersOf(game, player.id)
  const net: Record<string, number> = { food: econ.netFood, oil: econ.netOil, steel: econ.steelProduction, goods: econ.netGoods }
  const stock = (r: TradeResource) => player.resources[r as 'food']

  const toggleAuto = (r: TradeResource) => {
    const on = player.autoBuy.includes(r)
    issueOrder({ type: 'setAutoBuy', nationId: player.id, resources: on ? player.autoBuy.filter((x) => x !== r) : [...player.autoBuy, r] })
  }

  return (
    <section className="econ-grid">
      <Card title="World market" hint="Prices rise when the world is short of something. The market keeps a small cut of every trade, and each nation can only move so much a month. Ports raise it.">
        <div className="flex items-center justify-between text-[14px]">
          <span>Trade room this month</span>
          <span className="font-semibold tabular-nums">
            {room.toFixed(0)} of {econ.tradeCapacity.toFixed(0)}
          </span>
        </div>
        <div className="h-2 rounded-full bg-white/12 overflow-hidden" role="img" aria-label={`${room.toFixed(0)} of ${econ.tradeCapacity.toFixed(0)} left`}>
          <div className="h-full bg-[#64d2ff]" style={{ width: `${Math.min(100, (room / Math.max(1, econ.tradeCapacity)) * 100)}%` }} />
        </div>
        {sanctioned.length > 0 && <p className="text-[13px] text-[#ff8a84]">Sanctioned by {sanctioned.map((id) => game.nations[id]?.name).join(', ')}. Your room is cut.</p>}
        <p className="text-[13px] text-white/65">The market keeps {Math.round((player.laws.includes('free_trade') ? MATERIALS.freeTradeSpread : MATERIALS.spread) * 100)}% of each trade.</p>
      </Card>

      {MARKET_GOODS.map((r) => {
        const have = stock(r)
        const per = net[r] ?? 0
        const buy = (amount: number) => ({ type: 'marketBuy' as const, nationId: player.id, resource: r, amount })
        const sell = (amount: number) => ({ type: 'marketSell' as const, nationId: player.id, resource: r, amount })
        return (
          <Card key={r} title={MARKET[r].name} hint={NOTES[r]} right={<span className="text-[13px] text-white/75 tabular-nums">price {prices[r].toFixed(2)}</span>}>
            <div className="flex items-baseline justify-between text-[14px]">
              <span>
                You have <strong className="tabular-nums">{have.toFixed(0)}</strong>
              </span>
              <span className={`tabular-nums ${per < 0 ? 'text-[#ff8a84]' : 'text-white/75'}`}>{signed(per)} a month</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <OrderButton order={buy(5)} label="Buy 5" cost={`${marketValue(game, player, r, 5, 'buy', prices).toFixed(0)} money`} tone="btn-primary" />
              <OrderButton order={buy(20)} label="Buy 20" cost={`${marketValue(game, player, r, 20, 'buy', prices).toFixed(0)} money`} tone="btn-primary" />
              <OrderButton order={sell(5)} label="Sell 5" cost={`+${marketValue(game, player, r, 5, 'sell', prices).toFixed(0)} money`} />
              <OrderButton order={sell(20)} label="Sell 20" cost={`+${marketValue(game, player, r, 20, 'sell', prices).toFixed(0)} money`} />
            </div>
            {r !== 'steel' && (
              <label className="flex items-center justify-between gap-3 text-[14px]">
                <span>
                  Buy it automatically when I run short
                  <span className="block text-[12px] text-white/65">Keeps about {MATERIALS.autoBuyMonths} months in stock. Never spends your last 15 money.</span>
                </span>
                <input type="checkbox" checked={player.autoBuy.includes(r)} onChange={() => toggleAuto(r)} aria-label={`Buy ${MARKET[r].name} automatically`} />
              </label>
            )}
          </Card>
        )
      })}
    </section>
  )
}
