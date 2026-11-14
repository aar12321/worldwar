const KEYS = 'Esc: close. B briefing, E economy, M military, W wars, D diplomacy, R research, N news, A War Room for the selected country, ? help.'

/** The keys, as they work in this kind of game. */
export const shortcutsFor = (live: boolean) => (live ? `Space: play or pause. 1, 2, 3: speed. ${KEYS}` : `Enter: next turn. ${KEYS}`)
