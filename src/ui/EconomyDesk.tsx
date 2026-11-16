import { signed, usePlayerView } from './hooks'
import { DeskTabs, PanelShell, TabHost } from './panel'

/**
 * The Economy desk: run the country's cities and upgrades, money, trade, business, government and people.
 * Its tabs are listed in the registry (src/ui/registry.ts): add one there and it shows up here, in the jump window and in the keys.
 */
export function EconomyDesk() {
  const view = usePlayerView()
  if (!view) return null
  const { player, econ } = view
  return (
    <PanelShell title="Economy" kicker={`${player.name} · ${signed(econ.netCapital)} money, ${signed(econ.netFood)} food a month`} panel="economy" wide tabs={<DeskTabs desk="economy" />}>
      <TabHost desk="economy" />
    </PanelShell>
  )
}
