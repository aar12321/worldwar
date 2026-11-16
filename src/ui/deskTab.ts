import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { useGame, type GameStore } from '../store'
import { allDesks, currentTab, type TabMemory } from './registry'

/** The tab of a desk, wherever the store keeps it. */
const tabMemory = (s: GameStore): TabMemory => ({ economyTab: s.economyTab, militaryTab: s.militaryTab, empireTab: s.empireTab, deskTabs: s.deskTabs })
export const useDeskTab = (desk: string): string | undefined => useGame((s) => currentTab(tabMemory(s), desk))

/** The lazy body of every registered tab, made once when the page loads so React keeps each one between renders. Keyed "desk:tab". */
export const tabBodies: Record<string, LazyExoticComponent<ComponentType>> = {}
for (const d of allDesks()) for (const t of d.tabs ?? []) if (t.load) tabBodies[`${d.id}:${t.id}`] = lazy(t.load)
