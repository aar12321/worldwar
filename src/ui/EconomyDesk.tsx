import { signed, usePlayerView } from './hooks'
import { useGame, type EconomyTab } from '../store'
import { BudgetTab } from './economy/BudgetTab'
import { BusinessTab } from './economy/BusinessTab'
import { CountryTab } from './economy/CountryTab'
import { GovernmentTab } from './economy/GovernmentTab'
import { MarketTab } from './economy/MarketTab'
import { StocksTab } from './economy/StocksTab'
import { PeopleTab } from './economy/PeopleTab'
import { BankTab } from './economy/BankTab'
import { ProjectsTab } from './economy/ProjectsTab'
import { SpaceTab } from './economy/SpaceTab'
import { PanelShell, Tabs } from './panel'

const TABS = [
  ['country', 'Country'],
  ['people', 'People'],
  ['budget', 'Budget'],
  ['bank', 'Bank'],
  ['business', 'Business'],
  ['projects', 'Projects'],
  ['space', 'Space'],
  ['market', 'Market'],
  ['stocks', 'Stocks'],
  ['government', 'Government'],
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
        {tab === 'people' && <PeopleTab />}
        {tab === 'budget' && <BudgetTab />}
        {tab === 'bank' && <BankTab />}
        {tab === 'business' && <BusinessTab />}
        {tab === 'projects' && <ProjectsTab />}
        {tab === 'space' && <SpaceTab />}
        {tab === 'market' && <MarketTab />}
        {tab === 'stocks' && <StocksTab />}
        {tab === 'government' && <GovernmentTab />}
      </div>
    </PanelShell>
  )
}
