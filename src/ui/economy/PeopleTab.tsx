import { enemiesOf } from '../../engine/helpers'
import { usePlayerView } from '../hooks'

/** What the people need, one gauge each, with one plain line on what to do about it. */
export function PeopleTab() {
  const view = usePlayerView()!
  const { game, player, econ } = view
  const gauges = [
    {
      label: 'Food',
      value: econ.foodConsumption > 0 ? (econ.foodProduction / econ.foodConsumption) * 80 : 100,
      status: player.foodShortage ? 'Starving' : econ.netFood < 0 ? 'Running down' : 'Fed',
      tip: econ.netFood < 0 ? 'Build farms or a farming city, lower the draft, or buy food on the market.' : 'Enough to eat.',
    },
    {
      label: 'Goods',
      value: econ.goodsUse > 0 ? (econ.goodsProduction / econ.goodsUse) * 80 : 100,
      status: player.goodsShortage ? 'Sold out' : econ.netGoods < 0 ? 'Running down' : 'Well supplied',
      tip: econ.netGoods < 0 ? 'Build factories, grow manufacturing, or buy goods on the market. With none, people grow restless.' : 'The shops are full.',
    },
    {
      label: 'Work',
      value: econ.laborRatio * 100,
      status: `${Math.round(econ.laborRatio * 100)}% of jobs filled`,
      tip: econ.laborRatio < 0.9 ? 'Factories and farms need workers. A high draft or too many buildings leaves them empty.' : 'Your buildings are fully staffed.',
    },
    {
      label: 'Pay',
      value: 100 - player.taxRate * 250,
      status: `${Math.round(player.taxRate * 100)}% tax`,
      tip: player.taxRate > 0.2 ? 'Taxes above 20% anger people.' : 'Taxes are bearable.',
    },
    {
      label: 'Peace',
      value: 100 - (player.warWeariness / 60) * 100,
      status: player.warWeariness > 25 ? 'War-weary' : player.warWeariness > 8 ? 'Tired of war' : 'Calm',
      tip: enemiesOf(game, player.id).length > 0 ? 'Every war and every lost soldier adds to this. Peace lets it fade.' : 'No wars. Weariness is fading.',
    },
    {
      label: 'Order',
      value: player.stability,
      status: `${Math.round(player.stability)}% stable`,
      tip: econ.occupied > 0 ? `${econ.occupied} conquered ${econ.occupied === 1 ? 'country is' : 'countries are'} still settling in. Hold them with troops and time.` : 'Below 30%, rebels may rise.',
    },
  ]
  return (
    <section className="econ-grid">
      <p className="text-[14px] text-white/70 span-all">You rule these people. When their needs go unmet, they work less and fight less, and in the end they rise up.</p>
      {gauges.map((g) => (
        <div key={g.label} className="inset-card p-3.5 space-y-1.5">
          <div className="flex items-baseline justify-between text-[15px]">
            <span className="font-semibold">{g.label}</span>
            <span className="text-white/80">{g.status}</span>
          </div>
          <div className="h-2.5 rounded-full bg-white/12 overflow-hidden" role="img" aria-label={`${g.label} ${Math.round(Math.max(0, Math.min(100, g.value)))} out of 100`}>
            <div className="h-full" style={{ width: `${Math.max(2, Math.min(100, g.value))}%`, background: g.value < 35 ? '#ff453a' : g.value < 60 ? '#ffd60a' : '#30d158' }} />
          </div>
          <p className="text-[13px] text-white/70">{g.tip}</p>
        </div>
      ))}
    </section>
  )
}
