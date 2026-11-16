/**
 * What the effects need to know about the camera: where a point on or above the globe lands on the screen, whether it faces us, and how
 * many pixels one world unit (the globe's radius is 100) is. The real implementation reads the three.js camera without allocating; the
 * test one is a plain orthographic view so effects can run without a browser.
 */
export const GLOBE_R = 100
const RAD = Math.PI / 180

export interface Pt {
  x: number
  y: number
  /** True when the point is on the side of the globe we can see (and inside the screen margin). */
  vis: boolean
}

export const newPt = (): Pt => ({ x: 0, y: 0, vis: false })

export interface View {
  w: number
  h: number
  /** Pixels per world unit at the globe's surface, near the middle of the screen. */
  pxPerUnit: number
  /** Globe centre on screen, for flattening marks that lie on the ground. */
  cx: number
  cy: number
  /** Position of a point given as a vector with length r (world units). */
  projectXYZ(x: number, y: number, z: number, out: Pt): void
  /** Bumps whenever the camera moved, so static layers know to redraw. */
  stamp: number
}

/** three-globe's own convention for latitude and longitude, so overlays line up with the polygons. */
export function llToXYZ(lat: number, lng: number, r: number, out: Float64Array | number[], o = 0) {
  const phi = (90 - lat) * RAD
  const theta = (90 - lng) * RAD
  const s = Math.sin(phi)
  out[o] = r * s * Math.cos(theta)
  out[o + 1] = r * Math.cos(phi)
  out[o + 2] = r * s * Math.sin(theta)
}

const tmp = new Float64Array(3)

export function project(view: View, lat: number, lng: number, alt: number, out: Pt) {
  llToXYZ(lat, lng, GLOBE_R * (1 + alt), tmp)
  view.projectXYZ(tmp[0], tmp[1], tmp[2], out)
}

/** Interface of the pieces of the three.js camera that are read. Declared here so this file imports nothing. */
export interface CameraLike {
  position: { x: number; y: number; z: number; length(): number }
  fov: number
  matrixWorldInverse: { elements: ArrayLike<number> }
  projectionMatrix: { elements: ArrayLike<number> }
}

/** A view over a three.js perspective camera. One object reused for every frame: `update` refreshes it. */
export class ThreeView implements View {
  w = 1
  h = 1
  pxPerUnit = 4
  cx = 0
  cy = 0
  stamp = 0
  private cam: CameraLike | null = null
  private px = 0
  private py = 0
  private pz = 0
  private last = ''

  update(cam: CameraLike, w: number, h: number) {
    this.cam = cam
    this.w = w
    this.h = h
    this.px = cam.position.x
    this.py = cam.position.y
    this.pz = cam.position.z
    const dist = cam.position.length()
    const tanHalf = Math.tan((cam.fov * RAD) / 2)
    this.pxPerUnit = h / 2 / (tanHalf * Math.max(1, dist - GLOBE_R))
    const key = `${this.px.toFixed(2)},${this.py.toFixed(2)},${this.pz.toFixed(2)},${w},${h}`
    if (key !== this.last) {
      this.last = key
      this.stamp++
    }
    const o = { x: 0, y: 0, vis: false }
    this.projectXYZ(0, 0, 0, o)
    this.cx = o.x
    this.cy = o.y
  }

  projectXYZ(x: number, y: number, z: number, out: Pt) {
    const cam = this.cam
    if (!cam) {
      out.vis = false
      return
    }
    const m = cam.matrixWorldInverse.elements
    const p = cam.projectionMatrix.elements
    const vx = m[0] * x + m[4] * y + m[8] * z + m[12]
    const vy = m[1] * x + m[5] * y + m[9] * z + m[13]
    const vz = m[2] * x + m[6] * y + m[10] * z + m[14]
    const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15]
    if (cw <= 0.0001) {
      out.vis = false
      return
    }
    const cxn = (p[0] * vx + p[4] * vy + p[8] * vz + p[12]) / cw
    const cyn = (p[1] * vx + p[5] * vy + p[9] * vz + p[13]) / cw
    out.x = (cxn * 0.5 + 0.5) * this.w
    out.y = (-cyn * 0.5 + 0.5) * this.h
    // Facing: a point is on the near side of the horizon when it is on our side of the plane through the globe's rim.
    const near = x * this.px + y * this.py + z * this.pz > GLOBE_R * GLOBE_R * 0.985
    out.vis = near && out.x > -80 && out.x < this.w + 80 && out.y > -80 && out.y < this.h + 80
  }
}

/** A flat, camera-straight view centred on a point of the globe. Used by tests and the headless perf harness. */
export class OrthoView implements View {
  w: number
  h: number
  pxPerUnit: number
  cx: number
  cy: number
  stamp = 1
  private ax = 0
  private ay = 0
  private az = 1
  private ux = 0
  private uy = 1
  private uz = 0
  private rx = 1
  private ry = 0
  private rz = 0

  constructor(w = 1440, h = 900, lat = 20, lng = 0, pxPerUnit = 4) {
    this.w = w
    this.h = h
    this.pxPerUnit = pxPerUnit
    this.cx = w / 2
    this.cy = h / 2
    this.look(lat, lng)
  }

  look(lat: number, lng: number) {
    const t = new Float64Array(3)
    llToXYZ(lat, lng, 1, t)
    this.ax = t[0]
    this.ay = t[1]
    this.az = t[2]
    // Right = up x forward, up is the globe's y axis, orthogonalised.
    let rx = -this.az
    let ry = 0
    let rz = this.ax
    const rl = Math.hypot(rx, ry, rz) || 1
    rx /= rl
    ry /= rl
    rz /= rl
    this.rx = rx
    this.ry = ry
    this.rz = rz
    this.ux = this.ay * rz - this.az * ry
    this.uy = this.az * rx - this.ax * rz
    this.uz = this.ax * ry - this.ay * rx
    this.stamp++
  }

  projectXYZ(x: number, y: number, z: number, out: Pt) {
    out.x = this.cx + (x * this.rx + y * this.ry + z * this.rz) * this.pxPerUnit
    out.y = this.cy - (x * this.ux + y * this.uy + z * this.uz) * this.pxPerUnit
    const depth = x * this.ax + y * this.ay + z * this.az
    out.vis = depth > GLOBE_R * GLOBE_R * 0.001 && depth / Math.hypot(x, y, z) > 0.02 && out.x > -80 && out.x < this.w + 80 && out.y > -80 && out.y < this.h + 80
  }
}
