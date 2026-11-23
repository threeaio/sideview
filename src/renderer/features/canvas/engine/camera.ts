// Kamera-Mathematik der Fläche. Reine Funktionen, ohne DOM.
// Kamera = { x, y, z }: x, y = Weltpunkt oben links im Sichtfenster, z = Bildschirmpixel (CSS) je Welteinheit.

export type Camera = { x: number; y: number; z: number };
export type Viewport = { w: number; h: number };
export type WorldRect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

export const MIN_ZOOM = 0.004;
export const MAX_ZOOM = 16;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const clampZoom = (z: number) => clamp(z, MIN_ZOOM, MAX_ZOOM);

export function centerOn(rect: WorldRect, z: number, vp: Viewport): Camera {
  return { x: rect.x + rect.w / 2 - vp.w / (2 * z), y: rect.y + rect.h / 2 - vp.h / (2 * z), z };
}

/** Kamera, die das Rechteck mit Rand ganz zeigt, höchstens bis maxZoom. */
export function fitRect(rect: WorldRect, vp: Viewport, { padding = 48, maxZoom = 4 } = {}): Camera {
  const w = Math.max(1, vp.w - 2 * padding);
  const h = Math.max(1, vp.h - 2 * padding);
  const z = clampZoom(Math.min(maxZoom, w / Math.max(1e-6, rect.w), h / Math.max(1e-6, rect.h)));
  return centerOn(rect, z, vp);
}

/** Kamera, die das Rechteck in voller Breite zeigt, oben angesetzt (lange Seiten von ihrem Anfang an), höchstens bis maxZoom. */
export function fitWidthTop(rect: WorldRect, vp: Viewport, { padding = 48, maxZoom = 4 } = {}): Camera {
  const z = clampZoom(Math.min(maxZoom, Math.max(1, vp.w - 2 * padding) / Math.max(1e-6, rect.w)));
  return { x: rect.x + rect.w / 2 - vp.w / (2 * z), y: rect.y - padding / z, z };
}

/** Steht die Kamera schon (fast) dort? Abweichung in Bildschirmpixeln und im Zoom. */
export function sameView(a: Camera, b: Camera, tolerancePx = 6): boolean {
  return Math.abs(a.z - b.z) / b.z < 0.02 && Math.abs(a.x - b.x) * b.z < tolerancePx && Math.abs(a.y - b.y) * b.z < tolerancePx;
}

export const screenToWorld = (cam: Camera, p: Point): Point => ({ x: cam.x + p.x / cam.z, y: cam.y + p.y / cam.z });
export const worldToScreen = (cam: Camera, p: Point): Point => ({ x: (p.x - cam.x) * cam.z, y: (p.y - cam.y) * cam.z });

/** Zoom um einen Bildschirmpunkt: Der Weltpunkt unter dem Zeiger bleibt, wo er ist. */
export function zoomAt(cam: Camera, p: Point, factor: number): Camera {
  const z = clampZoom(cam.z * factor);
  const world = screenToWorld(cam, p);
  return { x: world.x - p.x / z, y: world.y - p.y / z, z };
}

export const panBy = (cam: Camera, dx: number, dy: number): Camera => ({ x: cam.x - dx / cam.z, y: cam.y - dy / cam.z, z: cam.z });

/** cubic-bezier(x1, y1, x2, y2) wie in CSS, gelöst nach x. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solveX = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-7) return t;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 60 && hi - lo > 1e-7; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-7) return t;
      if (x > v) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sampleY(solveX(x)));
}

/** Weiche Kurve für Fahrten auf der Fläche: langsam los, schnell, langsam an. */
export const EASE_IN_OUT = cubicBezier(0.77, 0, 0.175, 1);

const cosh = (x: number) => (Math.exp(x) + Math.exp(-x)) / 2;
const sinh = (x: number) => (Math.exp(x) - Math.exp(-x)) / 2;
const tanh = (x: number) => {
  const e = Math.exp(2 * x);
  return (e - 1) / (e + 1);
};

/**
 * Fahrt im Bogen nach van Wijk und Nuij (2003): Bei weiten Wegen erst heraus, dann hinüber, dann hinein,
 * so dass das Auge den Zusammenhang behält. `length` misst den Weg, daraus folgt die Dauer.
 * Rechnet mit Mitte und sichtbarer Breite in Welteinheiten.
 */
export function zoomPath(from: Camera, to: Camera, vp: Viewport, rho = Math.SQRT2): { length: number; at: (t: number) => Camera } {
  const rho2 = rho * rho;
  const rho4 = rho2 * rho2;
  const w0 = vp.w / from.z;
  const w1 = vp.w / to.z;
  const ux0 = from.x + w0 / 2;
  const uy0 = from.y + vp.h / from.z / 2;
  const ux1 = to.x + w1 / 2;
  const uy1 = to.y + vp.h / to.z / 2;
  const dx = ux1 - ux0;
  const dy = uy1 - uy0;
  const d2 = dx * dx + dy * dy;
  const toCamera = (ux: number, uy: number, w: number): Camera => {
    const z = vp.w / w;
    return { x: ux - w / 2, y: uy - vp.h / z / 2, z };
  };

  if (d2 < 1e-12) {
    const S = Math.log(w1 / w0) / rho;
    return { length: Math.abs(S), at: (t) => toCamera(ux0, uy0, w0 * Math.exp(rho * t * S)) };
  }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
  const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (r1 - r0) / rho;
  const coshr0 = cosh(r0);
  return {
    length: Math.abs(S),
    at: (t) => {
      if (t >= 1) return { ...to };
      const s = t * S;
      const u = (w0 / (rho2 * d1)) * (coshr0 * tanh(rho * s + r0) - sinh(r0));
      return toCamera(ux0 + u * dx, uy0 + u * dy, (w0 * coshr0) / cosh(rho * s + r0));
    },
  };
}

/** Dauer einer Fahrt in ms: kurze Wege kurz, weite Wege länger, aber nie träge. */
export const flightMs = (length: number) => clamp(320 + 260 * length, 380, 1100);
