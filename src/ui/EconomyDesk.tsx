import { signed, usePlayerView } from './hooks'
import { useGame, type EconomyTab } from '../store'
import { BudgetTab } from './economy/BudgetTab'
import { BusinessTab } from './economy/BusinessTab'
import { CountryTab } from './economy/CountryTab'
import { GovernmentTab } from './economy/GovernmentTab'
import { MarketTab } from './economy/MarketTab'
import { PeopleTab } from './economy/PeopleTab'
import { PanelShell, Tabs } from './panel'

const TABS = [
  ['country', 'Country'],
  ['budget', 'Budget'],
  ['market', 'Market'],
  ['business', 'Business'],
  ['government', 'Government'],
  ['people', 'People'],
] as const satisfies readonly (readonly [EconomyTab, string])[]

/** The Economy desk: run the country's cities and upgrades, money, trade, business, government and people. */
export function EconomyDesk() {
  const view = usePlayerView()
  const tab = useGame((s) => s.economyTab)
  const setTab = useGame((s) => s.setEconomyTab)
  if (!view) return null
  const { player, econ } = view
  return (
    <PanelShell
      title="Economy"
      kicker={`${player.name} · ${signed(econ.netCapital)} money, ${signed(econ.netFood)} food a month`}
      panel="economy"
      wide
      tabs={<Tabs value={tab} onChange={setTab} options={TABS} />}
    >
      <div>
        {tab === 'country' && <CountryTab />}
        {tab === 'budget' && <BudgetTab />}
        {tab === 'market' && <MarketTab />}
        {tab === 'business' && <BusinessTab />}
        {tab === 'government' && <GovernmentTab />}
        {tab === 'people' && <PeopleTab />}
      </div>
    </PanelShell>
  )
}
