/**
 * Fixed-size pools, so the animation layer never allocates while it runs.
 *
 * `Pool` hands out preallocated objects and takes them back. `ParticleStore` keeps particles in typed arrays (struct of arrays) in a
 * ring: when the live cap is reached the oldest particle is overwritten, which is exactly "oldest dropped first".
 */
export class Pool<T> {
  private free: T[] = []
  readonly all: T[] = []
  /** How many times an object was handed out again after being returned. A reused pool proves nothing leaks. */
  reused = 0
  private returned = new Set<T>()

  readonly capacity: number

  constructor(make: () => T, capacity: number) {
    this.capacity = capacity
    for (let i = 0; i < capacity; i++) {
      const item = make()
      this.all.push(item)
      this.free.push(item)
    }
  }

  get live() {
    return this.capacity - this.free.length
  }

  acquire(): T | null {
    const item = this.free.pop()
    if (item === undefined) return null
    if (this.returned.delete(item)) this.reused++
    return item
  }

  release(item: T) {
    this.returned.add(item)
    this.free.push(item)
  }
}

export const PARTICLE_CAPACITY = 300

export class ParticleStore {
  readonly capacity: number
  readonly alive: Uint8Array
  readonly lat: Float32Array
  readonly lng: Float32Array
  readonly alt: Float32Array
  /** Offset from the anchor, in world units (globe radius 100), and its velocity in units per second. */
  readonly ox: Float32Array
  readonly oy: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  readonly age: Float32Array
  readonly life: Float32Array
  readonly size0: Float32Array
  readonly size1: Float32Array
  readonly rot: Float32Array
  readonly vrot: Float32Array
  readonly alpha: Float32Array
  readonly sprite: Uint8Array
  readonly color: Uint8Array
  readonly frame: Uint8Array
  readonly additive: Uint8Array
  /** Next slot to write. The slot it points at is the oldest particle, so it is the one overwritten when the store is full. */
  private cursor = 0
  /** Live cap: lower tiers use fewer slots of the same arrays. */
  limit: number
  count = 0
  /** Totals, for the tests and the harness. */
  spawned = 0
  dropped = 0

  constructor(capacity = PARTICLE_CAPACITY) {
    this.capacity = capacity
    this.limit = capacity
    const f = () => new Float32Array(capacity)
    const u = () => new Uint8Array(capacity)
    this.alive = u()
    this.lat = f()
    this.lng = f()
    this.alt = f()
    this.ox = f()
    this.oy = f()
    this.vx = f()
    this.vy = f()
    this.age = f()
    this.life = f()
    this.size0 = f()
    this.size1 = f()
    this.rot = f()
    this.vrot = f()
    this.alpha = f()
    this.sprite = u()
    this.color = u()
    this.frame = u()
    this.additive = u()
  }

  setLimit(limit: number) {
    this.limit = Math.max(0, Math.min(this.capacity, Math.floor(limit)))
    if (this.cursor >= this.limit) this.cursor = 0
    for (let i = this.limit; i < this.capacity; i++) {
      if (this.alive[i]) {
        this.alive[i] = 0
        this.count--
      }
    }
  }

  /** Starts a particle. Returns its slot, or -1 when no slots are allowed (quality off or reduced motion). */
  spawn(lat: number, lng: number, alt: number, vx: number, vy: number, life: number, size0: number, size1: number, alpha: number, sprite: number, color: number, frame: number, additive: boolean, rot = 0, vrot = 0): number {
    if (this.limit === 0) return -1
    const i = this.cursor
    this.cursor = (this.cursor + 1) % this.limit
    if (this.alive[i]) this.dropped++
    else {
      this.alive[i] = 1
      this.count++
    }
    this.spawned++
    this.lat[i] = lat
    this.lng[i] = lng
    this.alt[i] = alt
    this.ox[i] = 0
    this.oy[i] = 0
    this.vx[i] = vx
    this.vy[i] = vy
    this.age[i] = 0
    this.life[i] = life
    this.size0[i] = size0
    this.size1[i] = size1
    this.alpha[i] = alpha
    this.sprite[i] = sprite
    this.color[i] = color
    this.frame[i] = frame
    this.additive[i] = additive ? 1 : 0
    this.rot[i] = rot
    this.vrot[i] = vrot
    return i
  }

  /** Moves and ages every live particle. Seconds. */
  update(dt: number) {
    const drag = Math.max(0, 1 - 1.4 * dt)
    for (let i = 0; i < this.limit; i++) {
      if (!this.alive[i]) continue
      const a = (this.age[i] += dt)
      if (a >= this.life[i]) {
        this.alive[i] = 0
        this.count--
        continue
      }
      this.vx[i] *= drag
      this.vy[i] *= drag
      this.ox[i] += this.vx[i] * dt
      this.oy[i] += this.vy[i] * dt
      this.rot[i] += this.vrot[i] * dt
    }
  }

  clear() {
    this.alive.fill(0)
    this.count = 0
    this.cursor = 0
  }
}
