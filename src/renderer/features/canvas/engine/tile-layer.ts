// Kachelpyramiden auf der GPU (three.js). Übernommen aus dem Flächen-Test (spikes/surface, Variante B),
// dort in Electron gemessen: 120 Bilder pro Sekunde ohne Ausfall.
// Lädt nur die sichtbaren Kacheln der Stufe, die zu Zoom × Pixeldichte passt. Bis sie da sind, zeichnet sie
// feinere oder gröbere geladene Kacheln, darunter liegt immer eine kleine Grundstufe: keine Löcher.
// Beim Vergrößern bikubisch (Catmull-Rom), beim Verkleinern die Hardware (trilinear mit Mipmaps).

import * as THREE from "three";
import type { TileManifest } from "../../../../shared/contracts.ts";
import { clamp, type Camera, type Viewport } from "./camera.ts";
import { imageRadiusPx } from "./image-corners.ts";

export type Pyramid = {
  id: string;
  /** Lage und Größe in Welteinheiten */
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
  manifest: TileManifest;
  /** Zahl der Halbierungen der Grundstufe, die immer geladen bleibt */
  baseK: number;
};

type TileState = "idle" | "loading" | "decoded" | "ready" | "failed";
type Tile = {
  key: string;
  pyr: Pyramid;
  k: number;
  level: number;
  col: number;
  row: number;
  url: string;
  state: TileState;
  prio: number;
  wantedFrame: number;
  drawnFrame: number;
  decodedFrame: number;
  reqId: number;
  pinned: boolean;
  ctrl: AbortController | null;
  bitmap: ImageBitmap | null;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null;
  bytes: number;
};

const PLANE = new THREE.PlaneGeometry(1, 1);
/** Grundstufe: die feinste Stufe, deren Bild ganz in 2048 px passt. */
const BASE_MAX_PX = 2048;
/** An inneren Kanten ein halbes Texel weiter zeichnen; die Überlappung der Kacheln liefert die Pixel. */
const SEAM = 0.5;
const DECODED_TTL_FRAMES = 180;
const MAX_TEXTURES = 192;
const CONCURRENCY = 6;
const UPLOAD_BUDGET_MS = 6;

const VERT = /* glsl */ `
uniform mat3 uvTransform;
varying vec2 vUv;
varying vec2 vWorld;
void main() {
  vUv = (uvTransform * vec3(uv, 1.0)).xy;
  vWorld = (modelMatrix * vec4(position, 1.0)).xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// Runde Ecken: Abstand zum abgerundeten Rechteck des ganzen Bildes, Kante über eine Pixelbreite geglättet.
const FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec4 item;
uniform float radius;
varying vec2 vUv;
varying vec2 vWorld;
float w0(float f) { return f * (-0.5 + f * (1.0 - 0.5 * f)); }
float w1(float f) { return 1.0 + f * f * (-2.5 + 1.5 * f); }
float w2(float f) { return f * (0.5 + f * (2.0 - 1.5 * f)); }
float w3(float f) { return f * f * (-0.5 + 0.5 * f); }
void main() {
  vec2 size = vec2(textureSize(map, 0));
  vec2 p = vUv * size;
  vec2 fw = fwidth(p);
  vec4 color;
  if (max(fw.x, fw.y) >= 0.999) {
    color = texture2D(map, vUv);
  } else {
    p -= 0.5;
    vec2 i = floor(p);
    vec2 f = p - i;
    vec4 wx = vec4(w0(f.x), w1(f.x), w2(f.x), w3(f.x));
    vec4 wy = vec4(w0(f.y), w1(f.y), w2(f.y), w3(f.y));
    ivec2 base = ivec2(i) - 1;
    ivec2 hi = ivec2(size) - 1;
    color = vec4(0.0);
    for (int y = 0; y < 4; y++) {
      vec4 row = vec4(0.0);
      for (int x = 0; x < 4; x++) {
        row += texelFetch(map, clamp(base + ivec2(x, y), ivec2(0), hi), 0) * wx[x];
      }
      color += row * wy[y];
    }
    color = clamp(color, 0.0, 1.0);
  }
  vec2 center = (item.xy + item.zw) * 0.5;
  vec2 extent = abs(item.zw - item.xy) * 0.5;
  vec2 q = abs(vWorld - center) - extent + radius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  float aa = max(fwidth(d), 1e-6);
  color.a *= 1.0 - smoothstep(-aa, 0.0, d);
  gl_FragColor = linearToOutputTexel(color);
}`;

export function basePyramid(id: string, rect: { x: number; y: number; w: number; h: number }, url: string, manifest: TileManifest): Pyramid {
  let baseK = 0;
  while (baseK < manifest.maxLevel) {
    const lev = manifest.levels[manifest.maxLevel - baseK]!;
    if (Math.max(lev.width, lev.height) <= BASE_MAX_PX) break;
    baseK++;
  }
  return { id, ...rect, url, manifest, baseK };
}

const signature = (p: Pyramid) => `${p.id}|${p.manifest.key}|${p.x}|${p.y}|${p.w}|${p.h}`;
const sameImage = (a: Pyramid, b: Pyramid) => a.id === b.id && a.manifest.key === b.manifest.key && a.w === b.w && a.h === b.h;

/** Kachel an die neue Lage ihres Bildes setzen: Netz verschieben, Bildrechteck für die runden Ecken nachführen. */
function relocate(e: Tile, pyr: Pyramid) {
  const dx = pyr.x - e.pyr.x;
  const dy = pyr.y - e.pyr.y;
  e.pyr = pyr;
  if (!e.mesh) return;
  e.mesh.position.x += dx;
  e.mesh.position.y -= dy;
  e.mesh.updateMatrix();
  e.mesh.material.uniforms.item!.value.set(pyr.x, -pyr.y, pyr.x + pyr.w, -(pyr.y + pyr.h));
}

export class TileLayer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private onSettled: () => void;
  private pyramids: Pyramid[] = [];
  private anisotropy: number;
  private tiles = new Map<string, Tile>();
  private loading = new Set<Tile>();
  private decoded = new Set<Tile>();
  private ready = new Set<Tile>();
  private drawn = new Set<Tile>();
  private wanted: Tile[] = [];
  private frame = 0;
  private disposed = false;
  /** Je Bild ein Radius-Uniform, das alle seine Kacheln teilen; update() setzt es je Bild neu. */
  private radii = new Map<string, { value: number }>();

  /** `onSettled` meldet, dass eine Kachel angekommen oder gescheitert ist: Zeit für ein neues Bild. */
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, onSettled: () => void) {
    this.renderer = renderer;
    this.scene = scene;
    this.onSettled = onSettled;
    this.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }

  /** k = Zahl der Halbierungen gegenüber dem Original; die Stufe hat mindestens so viele Texel wie Gerätepixel. */
  private kFor(pyr: Pyramid, devicePxPerWorld: number): number {
    const devicePxPerImagePx = devicePxPerWorld * (pyr.w / pyr.manifest.width);
    return clamp(Math.floor(-Math.log2(devicePxPerImagePx) + 1e-9), 0, pyr.manifest.maxLevel);
  }

  private level(pyr: Pyramid, k: number) {
    return pyr.manifest.levels[pyr.manifest.maxLevel - k]!;
  }

  private entry(pyr: Pyramid, k: number, col: number, row: number): Tile {
    const key = `${pyr.id}/${k}/${col}/${row}`;
    let e = this.tiles.get(key);
    if (!e) {
      const level = pyr.manifest.maxLevel - k;
      e = {
        key, pyr, k, level, col, row,
        url: `${pyr.url}/${level}/${col}_${row}.png`,
        state: "idle", prio: Infinity, wantedFrame: -1, drawnFrame: -1, decodedFrame: -1,
        reqId: 0, pinned: false, ctrl: null, bitmap: null, mesh: null, bytes: 0,
      };
      this.tiles.set(key, e);
    }
    return e;
  }

  private range(pyr: Pyramid, k: number, cam: Camera, vp: Viewport) {
    const lev = this.level(pyr, k);
    const ix0 = Math.max(cam.x, pyr.x);
    const iy0 = Math.max(cam.y, pyr.y);
    const ix1 = Math.min(cam.x + vp.w / cam.z, pyr.x + pyr.w);
    const iy1 = Math.min(cam.y + vp.h / cam.z, pyr.y + pyr.h);
    if (ix0 >= ix1 || iy0 >= iy1) return null;
    const sx = lev.width / pyr.w;
    const sy = lev.height / pyr.h;
    const T = pyr.manifest.tileSize;
    return {
      lev,
      c0: clamp(Math.floor(((ix0 - pyr.x) * sx) / T), 0, lev.cols - 1),
      c1: clamp(Math.floor(((ix1 - pyr.x) * sx - 1e-6) / T), 0, lev.cols - 1),
      r0: clamp(Math.floor(((iy0 - pyr.y) * sy) / T), 0, lev.rows - 1),
      r1: clamp(Math.floor(((iy1 - pyr.y) * sy - 1e-6) / T), 0, lev.rows - 1),
    };
  }

  private distance(pyr: Pyramid, lev: { width: number; height: number }, col: number, row: number, cam: Camera, vp: Viewport) {
    const T = pyr.manifest.tileSize;
    const tx = pyr.x + (col + 0.5) * T * (pyr.w / lev.width);
    const ty = pyr.y + (row + 0.5) * T * (pyr.h / lev.height);
    const hw = vp.w / cam.z / 2;
    const hh = vp.h / cam.z / 2;
    return Math.hypot(tx - (cam.x + hw), ty - (cam.y + hh)) / Math.hypot(hw, hh);
  }

  private want(e: Tile, prio: number) {
    if (e.wantedFrame !== this.frame) {
      e.wantedFrame = this.frame;
      e.prio = prio;
      this.wanted.push(e);
    } else if (prio < e.prio) e.prio = prio;
  }

  /**
   * Setzt die Bilder. Unveränderte behalten ihre Kacheln, weggefallene oder verschobene geben sie frei,
   * neue laden ihre Grundstufe. Das Versprechen erfüllt sich, sobald die Grundstufe der neuen Bilder da ist.
   */
  async setPyramids(next: Pyramid[]): Promise<void> {
    // Nur verschoben (gleiches Bild, gleiche Größe): Kacheln mitnehmen statt neu laden, sonst flackert jedes Verschieben.
    for (const e of this.tiles.values()) {
      const moved = next.find((p) => sameImage(p, e.pyr) && (p.x !== e.pyr.x || p.y !== e.pyr.y));
      if (moved) relocate(e, moved);
    }
    const keep = new Set(next.map(signature));
    for (const e of [...this.tiles.values()]) if (!keep.has(signature(e.pyr))) this.drop(e);
    const before = new Set(this.pyramids.map(signature));
    this.pyramids = next;
    // Bild für Bild zeichnen, in der Reihenfolge der Bilder: Sonst mischen sich die Kacheln zweier Bilder, die
    // übereinander liegen, nach Zoomstufe, und das obere wirkt wie in Streifen geschnitten (5.11.).
    for (const e of this.tiles.values()) if (e.mesh) e.mesh.renderOrder = this.renderOrder(e);
    const base: Tile[] = [];
    for (const pyr of next.filter((p) => !before.has(signature(p)))) {
      const lev = this.level(pyr, pyr.baseK);
      for (let r = 0; r < lev.rows; r++) {
        for (let c = 0; c < lev.cols; c++) {
          const e = this.entry(pyr, pyr.baseK, c, r);
          e.pinned = true;
          base.push(e);
        }
      }
    }
    await Promise.all(base.map((e) => (e.state === "idle" ? this.request(e) : undefined)));
    for (const e of base) if (e.state === "decoded" && this.tiles.get(e.key) === e) this.upload(e);
  }

  /**
   * Wartet eine geladene Kachel aufs Hochladen? Dann braucht es weitere Bilder. Kacheln, die noch unterwegs
   * sind, melden sich selbst über onSettled; dafür muss die Schleife nicht laufen.
   */
  /** Erst nach Bild (spätere oben), im Bild die Grundstufe unten und feinere Stufen darüber. */
  private renderOrder(e: Tile): number {
    const index = this.pyramids.findIndex((p) => p.id === e.pyr.id);
    return Math.max(0, index) * 100 + (e.pinned ? 0 : 1 + e.level);
  }

  pending(): boolean {
    for (const e of this.decoded) if (e.pinned || e.wantedFrame === this.frame) return true;
    return false;
  }

  private drop(e: Tile) {
    if (e.state === "loading") this.abort(e);
    if (e.state === "decoded") {
      e.bitmap?.close();
      e.bitmap = null;
      this.decoded.delete(e);
    }
    if (e.mesh) this.evict(e);
    this.drawn.delete(e);
    this.tiles.delete(e.key);
  }

  private request(e: Tile): Promise<void> {
    const id = ++e.reqId;
    e.state = "loading";
    e.ctrl = new AbortController();
    this.loading.add(e);
    return fetch(e.url, { signal: e.ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} für ${e.url}`);
        return res.blob();
      })
      .then((blob) => createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "default" }))
      .then(
        (bitmap) => {
          if (e.reqId !== id || e.state !== "loading" || this.disposed) {
            bitmap.close();
            return;
          }
          this.loading.delete(e);
          e.ctrl = null;
          e.bitmap = bitmap;
          e.state = "decoded";
          e.decodedFrame = this.frame;
          this.decoded.add(e);
          this.onSettled();
        },
        (err: Error) => {
          if (e.reqId !== id) return;
          this.loading.delete(e);
          e.ctrl = null;
          e.state = err.name === "AbortError" ? "idle" : "failed";
          if (e.state === "failed") console.warn("Kachel fehlgeschlagen:", e.url, err);
          this.onSettled();
        },
      );
  }

  private abort(e: Tile) {
    e.reqId++;
    e.ctrl?.abort();
    e.ctrl = null;
    e.state = "idle";
    this.loading.delete(e);
  }

  private upload(e: Tile) {
    const { pyr, col, row } = e;
    const lev = this.level(pyr, e.k);
    const T = pyr.manifest.tileSize;
    const OV = pyr.manifest.overlap;
    const bmp = e.bitmap!;
    const cx0 = col * T;
    const cx1 = Math.min((col + 1) * T, lev.width);
    const cy0 = row * T;
    const cy1 = Math.min((row + 1) * T, lev.height);
    const ovL = col > 0 ? OV : 0;
    const ovT = row > 0 ? OV : 0;
    const dx0 = cx0 - (col > 0 ? SEAM : 0);
    const dx1 = cx1 + (col < lev.cols - 1 ? SEAM : 0);
    const dy0 = cy0 - (row > 0 ? SEAM : 0);
    const dy1 = cy1 + (row < lev.rows - 1 ? SEAM : 0);
    const ox = cx0 - ovL;
    const oy = cy0 - ovT;
    const u0 = (dx0 - ox) / bmp.width;
    const u1 = (dx1 - ox) / bmp.width;
    const t0 = (dy0 - oy) / bmp.height;
    const t1 = (dy1 - oy) / bmp.height;

    const tex = new THREE.Texture(bmp);
    tex.flipY = false;
    // Filtern im gespeicherten sRGB-Wert, wie libvips die Stufen rechnet und wie der Browser Bilder zeigt.
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = this.anisotropy;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.offset.set(u0, t1);
    tex.repeat.set(u1 - u0, t0 - t1);
    tex.needsUpdate = true;
    this.renderer.initTexture(tex);
    e.bytes = bmp.width * bmp.height * 4 * (4 / 3);
    bmp.close();
    e.bitmap = null;
    tex.updateMatrix();

    let radius = this.radii.get(pyr.id);
    if (!radius) this.radii.set(pyr.id, (radius = { value: 0 }));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: tex },
        uvTransform: { value: tex.matrix },
        item: { value: new THREE.Vector4(pyr.x, -pyr.y, pyr.x + pyr.w, -(pyr.y + pyr.h)) },
        radius,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(PLANE, mat);
    const sx = pyr.w / lev.width;
    const sy = pyr.h / lev.height;
    const wx0 = pyr.x + dx0 * sx;
    const wx1 = pyr.x + dx1 * sx;
    const wy0 = pyr.y + dy0 * sy;
    const wy1 = pyr.y + dy1 * sy;
    mesh.position.set((wx0 + wx1) / 2, -(wy0 + wy1) / 2, 0);
    mesh.scale.set(wx1 - wx0, wy1 - wy0, 1);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = this.renderOrder(e);
    this.scene.add(mesh);
    e.mesh = mesh;
    e.state = "ready";
    this.decoded.delete(e);
    this.ready.add(e);
  }

  private evict(e: Tile) {
    if (!e.mesh) return;
    this.scene.remove(e.mesh);
    (e.mesh.material.uniforms.map!.value as THREE.Texture).dispose();
    e.mesh.material.dispose();
    e.mesh = null;
    e.bytes = 0;
    e.state = "idle";
    this.ready.delete(e);
    this.drawn.delete(e);
  }

  private collect(pyr: Pyramid, cam: Camera, vp: Viewport, dpr: number, prioBase: number) {
    const k = this.kFor(pyr, cam.z * dpr);
    const r = this.range(pyr, k, cam, vp);
    if (!r) return;
    for (let row = r.r0; row <= r.r1; row++) {
      for (let col = r.c0; col <= r.c1; col++) {
        this.want(this.entry(pyr, k, col, row), prioBase + 0.5 * this.distance(pyr, r.lev, col, row, cam, vp));
      }
    }
  }

  private collectDraw(pyr: Pyramid, cam: Camera, vp: Viewport, dpr: number, draw: Set<Tile>) {
    const baseRange = this.range(pyr, pyr.baseK, cam, vp);
    if (!baseRange) return;
    for (let row = baseRange.r0; row <= baseRange.r1; row++) {
      for (let col = baseRange.c0; col <= baseRange.c1; col++) {
        const e = this.tiles.get(`${pyr.id}/${pyr.baseK}/${col}/${row}`);
        if (e?.state === "ready") draw.add(e);
      }
    }
    const k = this.kFor(pyr, cam.z * dpr);
    const r = this.range(pyr, k, cam, vp);
    if (!r) return;
    for (let row = r.r0; row <= r.r1; row++) {
      for (let col = r.c0; col <= r.c1; col++) {
        const e = this.tiles.get(`${pyr.id}/${k}/${col}/${row}`);
        if (e?.state === "ready") {
          draw.add(e);
          continue;
        }
        if (k > 0) {
          const lev = this.level(pyr, k - 1);
          const kids: Tile[] = [];
          let complete = true;
          for (let rr = row * 2; rr <= Math.min(row * 2 + 1, lev.rows - 1) && complete; rr++) {
            for (let cc = col * 2; cc <= Math.min(col * 2 + 1, lev.cols - 1); cc++) {
              const kid = this.tiles.get(`${pyr.id}/${k - 1}/${cc}/${rr}`);
              if (kid?.state !== "ready") {
                complete = false;
                break;
              }
              kids.push(kid);
            }
          }
          if (complete) {
            for (const kid of kids) draw.add(kid);
            continue;
          }
        }
        for (let up = 1; k + up <= pyr.manifest.maxLevel; up++) {
          const a = this.tiles.get(`${pyr.id}/${k + up}/${col >> up}/${row >> up}`);
          if (a?.state === "ready") {
            draw.add(a);
            break;
          }
        }
      }
    }
  }

  private pump() {
    for (const e of [...this.loading]) if (e.wantedFrame !== this.frame && !e.pinned) this.abort(e);
    const free = CONCURRENCY - this.loading.size;
    if (free <= 0) return;
    const todo = this.wanted.filter((e) => e.state === "idle").sort((a, b) => a.prio - b.prio);
    for (let i = 0; i < Math.min(free, todo.length); i++) void this.request(todo[i]!);
  }

  private uploadSome(): number {
    // Grundstufe zuerst: sie ist das Netz unter allem anderen.
    const todo = [...this.decoded]
      .filter((e) => e.pinned || e.wantedFrame === this.frame)
      .sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : a.prio - b.prio));
    const deadline = performance.now() + UPLOAD_BUDGET_MS;
    let n = 0;
    for (const e of todo) {
      if (n > 0 && performance.now() > deadline) break;
      this.upload(e);
      n++;
    }
    for (const e of [...this.decoded]) {
      if (!e.pinned && e.wantedFrame !== this.frame && this.frame - e.decodedFrame > DECODED_TTL_FRAMES) {
        e.bitmap?.close();
        e.bitmap = null;
        e.state = "idle";
        this.decoded.delete(e);
      }
    }
    return n;
  }

  /**
   * Ein Bild weiter: Wunschliste, Anfragen, Hochladen, Sichtbarkeit. `target` = Ziel einer laufenden
   * Kamerafahrt, dessen Kacheln zuerst kommen. Gibt true zurück, wenn sich das Bild ändert.
   */
  update(cam: Camera, vp: Viewport, dpr: number, target: Camera | null): boolean {
    this.frame++;
    this.wanted = [];
    for (const pyr of this.pyramids) {
      const r = this.radii.get(pyr.id);
      if (r) r.value = imageRadiusPx(Math.min(pyr.w, pyr.h), cam.z) / cam.z;
    }
    if (target) for (const pyr of this.pyramids) this.collect(pyr, target, vp, dpr, 0);
    for (const pyr of this.pyramids) this.collect(pyr, cam, vp, dpr, 1);
    this.pump();
    const uploads = this.uploadSome();
    const draw = new Set<Tile>();
    for (const pyr of this.pyramids) this.collectDraw(pyr, cam, vp, dpr, draw);
    let changed = uploads > 0;
    for (const e of this.drawn) {
      if (!draw.has(e) && e.mesh) {
        e.mesh.visible = false;
        changed = true;
      }
    }
    for (const e of draw) {
      e.drawnFrame = this.frame;
      if (e.mesh && !e.mesh.visible) {
        e.mesh.visible = true;
        changed = true;
      }
    }
    this.drawn = draw;
    if (this.ready.size > MAX_TEXTURES) {
      const victims = [...this.ready]
        .filter((e) => !e.pinned && e.drawnFrame !== this.frame && e.wantedFrame !== this.frame)
        .sort((a, b) => a.drawnFrame - b.drawnFrame);
      for (const e of victims) {
        if (this.ready.size <= MAX_TEXTURES) break;
        this.evict(e);
      }
    }
    return changed;
  }

  /** Scharf = alle sichtbaren Kacheln der passenden Stufe sind auf der GPU. */
  sharp(cam: Camera, vp: Viewport, dpr: number): boolean {
    for (const pyr of this.pyramids) {
      const k = this.kFor(pyr, cam.z * dpr);
      const r = this.range(pyr, k, cam, vp);
      if (!r) continue;
      for (let row = r.r0; row <= r.r1; row++) {
        for (let col = r.c0; col <= r.c1; col++) {
          if (this.tiles.get(`${pyr.id}/${k}/${col}/${row}`)?.state !== "ready") return false;
        }
      }
    }
    return true;
  }

  dispose() {
    this.disposed = true;
    for (const e of [...this.loading]) this.abort(e);
    for (const e of [...this.ready]) this.evict(e);
    for (const e of this.decoded) e.bitmap?.close();
    this.decoded.clear();
    this.tiles.clear();
  }
}
