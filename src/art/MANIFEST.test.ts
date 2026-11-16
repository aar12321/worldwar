import { describe, expect, it } from 'vitest'
import { ART_CLIPS, artClip, frameRect, loadArt } from './MANIFEST'

describe('art manifest', () => {
  it('has unique ids and every clip fits its atlas grid', () => {
    expect(new Set(ART_CLIPS.map((a) => a.id)).size).toBe(ART_CLIPS.length)
    for (const a of ART_CLIPS) expect(a.start + a.frames).toBeLessThanOrEqual(a.cols * a.rows)
  })

  it('computes frame rectangles and degrades to null without a DOM', async () => {
    const clip = artClip('blast.ballistic')!
    expect(frameRect(clip, 0, 1024, 512)).toEqual({ sx: 0, sy: 128, sw: 128, sh: 128 })
    expect(frameRect(clip, 99, 1024, 512).sx).toBe(7 * 128)
    expect(await loadArt('nope')).toBeNull()
    expect(await loadArt('blast.cruise')).toBeNull()
  })
})
