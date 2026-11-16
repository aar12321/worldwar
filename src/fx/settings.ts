import { create } from 'zustand'
import { sanitizeFxSetting, type FxSetting, type Tier } from './quality'

/**
 * The player's effects choices, kept on this device (not in a save): the quality setting, and whether the camera follows the action.
 * The tier Auto has settled on lives here too, so the Settings desk can show it.
 */
const KEY = 'worldwar.fx.v1'

interface Stored {
  quality: FxSetting
  follow: boolean
}

function load(): Stored {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (raw) {
      const j = JSON.parse(raw) as Partial<Stored>
      return { quality: sanitizeFxSetting(j.quality), follow: j.follow !== false }
    }
  } catch {
    // Private windows and blocked storage: the defaults stand.
  }
  return { quality: 'auto', follow: true }
}

interface FxPrefs extends Stored {
  /** The tier Auto has chosen right now. */
  autoTier: Tier
  setQuality(q: FxSetting): void
  setFollow(f: boolean): void
  setAutoTier(t: Tier): void
}

const save = (s: Stored) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Not saved; the choice still holds for this visit.
  }
}

export const useFxPrefs = create<FxPrefs>((set, get) => ({
  ...load(),
  autoTier: 'high',
  setQuality(quality) {
    set({ quality })
    save({ quality, follow: get().follow })
  },
  setFollow(follow) {
    set({ follow })
    save({ quality: get().quality, follow })
  },
  setAutoTier(autoTier) {
    set({ autoTier })
  },
}))
