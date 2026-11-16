import { create } from 'zustand'
import type { CardRef } from './presenceLayer'

const KEY = 'worldwar.presenceLayer'
const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

/** The military picture on the globe: whether it is on, and which badge's card is open. A per-viewer convenience, so it lives in the browser. */
interface PresenceUi {
  show: boolean
  card: CardRef | null
  setShow(on: boolean): void
  open(card: CardRef): void
  close(): void
}

export const usePresenceUi = create<PresenceUi>((set) => ({
  show: read(),
  card: null,
  setShow(on) {
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off')
    } catch {
      /* private window: the choice lasts for this visit */
    }
    set((st) => ({ show: on, card: on ? st.card : null }))
  },
  open(card) {
    set({ card })
  },
  close() {
    set({ card: null })
  },
}))
