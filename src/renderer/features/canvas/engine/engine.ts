// Motor der Fläche: WebGL-Leinwand mit Kachelebene und Kamera. Zeichnet nur, solange sich etwas bewegt
// oder Kacheln ankommen; danach ruht die Schleife. Die HTML-Ebene darüber hängt sich mit onFrame an
// und liest im selben Animationsschritt denselben Kamerastand.

import * as THREE from "three";
import type { TileManifest } from "../../../../shared/contracts.ts";
import { EASE_IN_OUT, clamp, fitRect, fitWidthTop, flightMs, panBy, zoomAt, zoomPath, type Camera, type Point, type Viewport, type WorldRect } from "./camera.ts";
import { TileLayer, basePyramid } from "./tile-layer.ts";

export type SurfaceImage = { id: string; rect: WorldRect; url: string; manifest: TileManifest };
export type FrameListener = (cam: Camera, vp: Viewport) => void;
/** `insetRight`: so viele Pixel rechts verdeckt eine offene Liste; das Ziel landet in der freien Fläche daneben. */
/** `top`: nur nach der Breite einpassen und oben ansetzen (für lange Seiten). */
export type FitOptions = { padding?: number; maxZoom?: number; animate?: boolean; insetRight?: number; top?: boolean };

export type Engine = {
  /** Setzt die Bilder; erfüllt sich, sobald die Grundstufe neuer Bilder geladen ist. */
  setImages(images: SurfaceImage[]): Promise<void>;
  camera(): Camera;
  viewport(): Viewport;
  jumpTo(cam: Camera): void;
  /** Fahrt im Bogen; false, wenn sie unterbrochen wurde. */
  flyTo(cam: Camera): Promise<boolean>;
  fit(rect: WorldRect, opts?: FitOptions): Promise<boolean>;
  /** Wohin fit fahren würde, ohne zu fahren. */
  fitTarget(rect: WorldRect, opts?: FitOptions): Camera;
  zoomAt(p: Point, factor: number): void;
  panBy(dx: number, dy: number): void;
  /** Hält eine laufende Fahrt an, etwa weil der Nutzer selbst zoomt. */
  stop(): void;
  onFrame(cb: FrameListener): () => void;
  /** Ein neues Bild anfordern, etwa weil sich die HTML-Ebene geändert hat. */
  redraw(): void;
  /** Alle sichtbaren Kacheln in der passenden Stufe geladen und keine Fahrt im Gang. */
  settled(): boolean;
  /** Für Prüfungen: Fahrt im Gang, Zahl der Bilder. */
  status(): { flying: boolean; images: number };
  dispose(): void;
};

type Flight = { path: ReturnType<typeof zoomPath>; to: Camera; start: number; duration: number; resolve: (done: boolean) => void };

/** `insetTop`: so viele Pixel oben verdeckt die schwebende Kopfzeile, `insetBottom` unten die Werkzeugleiste;
 * Einpassen lässt beide frei. */
export function createEngine(host: HTMLElement, { insetTop = 0, insetBottom = 0 }: { insetTop?: number; insetBottom?: number } = {}): Engine {
  const canvas = document.createElement("canvas");
  canvas.className = "surface__canvas";
  host.prepend(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  // Die Kacheln sind sRGB und werden ohne Umrechnung gezeigt, wie der Browser Bilder zeigt.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const scene = new THREE.Scene();
  const cam3 = new THREE.OrthographicCamera(0, 1, 0, -1, 0.1, 10);
  cam3.position.z = 1;

  let cam: Camera = { x: 0, y: 0, z: 1 };
  let vp: Viewport = { w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) };
  let dpr = window.devicePixelRatio || 1;
  let flight: Flight | null = null;
  let dirty = true;
  let raf = 0;
  let disposed = false;
  let imageCount = 0;
  const listeners = new Set<FrameListener>();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const schedule = () => {
    if (!raf && !disposed) raf = requestAnimationFrame(frame);
  };
  const tiles = new TileLayer(renderer, scene, schedule);

  function frame(now: number) {
    raf = 0;
    let moved = false;
    if (flight) {
      const t = clamp((now - flight.start) / flight.duration, 0, 1);
      cam = t >= 1 ? { ...flight.to } : flight.path.at(EASE_IN_OUT(t));
      moved = true;
      if (t >= 1) {
        const done = flight;
        flight = null;
        done.resolve(true);
      }
    }
    const changed = tiles.update(cam, vp, dpr, flight?.to ?? null);
    if (moved || changed || dirty) {
      cam3.left = cam.x;
      cam3.right = cam.x + vp.w / cam.z;
      cam3.top = -cam.y;
      cam3.bottom = -(cam.y + vp.h / cam.z);
      cam3.updateProjectionMatrix();
      renderer.render(scene, cam3);
      for (const cb of listeners) cb(cam, vp);
      dirty = false;
    }
    if (flight || moved || changed || tiles.pending()) schedule();
  }

  /** Sofort zeichnen, im selben Animationsschritt; sonst blitzt beim Ändern der Größe die leere Leinwand auf. */
  const drawNow = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    dirty = true;
    frame(performance.now());
  };

  const resize = () => {
    vp = { w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) };
    dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(dpr);
    renderer.setSize(vp.w, vp.h, false);
    drawNow();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  // Wandert das Fenster auf einen Bildschirm mit anderer Pixeldichte, ändert sich die Größe nicht, die Schärfe schon.
  let dprQuery: MediaQueryList | null = null;
  const watchDpr = () => {
    dprQuery?.removeEventListener("change", onDpr);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener("change", onDpr);
  };
  const onDpr = () => {
    watchDpr();
    resize();
  };
  watchDpr();
  resize();

  canvas.addEventListener("webglcontextlost", (e) => {
    if (disposed) return; // gewollt freigegeben, siehe dispose()
    e.preventDefault();
    console.warn("WebGL-Kontext verloren");
  });

  const stop = () => {
    if (!flight) return;
    const f = flight;
    flight = null;
    f.resolve(false);
  };

  const jumpTo = (next: Camera) => {
    stop();
    cam = { ...next };
    dirty = true;
    schedule();
  };

  const flyTo = (to: Camera): Promise<boolean> => {
    stop();
    if (reducedMotion.matches) {
      jumpTo(to);
      return Promise.resolve(true);
    }
    const path = zoomPath(cam, to, vp);
    return new Promise((resolve) => {
      flight = { path, to: { ...to }, start: performance.now(), duration: flightMs(path.length), resolve };
      schedule();
    });
  };

  function fitTarget(rect: WorldRect, { padding, maxZoom, insetRight = 0, top = false }: FitOptions = {}): Camera {
    const free = (top ? fitWidthTop : fitRect)(rect, { w: Math.max(1, vp.w - insetRight), h: Math.max(1, vp.h - insetTop - insetBottom) }, { padding, maxZoom });
    return { ...free, y: free.y - insetTop / free.z };
  }

  return {
    async setImages(images) {
      imageCount = images.length;
      const loaded = tiles.setPyramids(images.map((img) => basePyramid(img.id, img.rect, img.url, img.manifest)));
      dirty = true;
      schedule();
      await loaded;
      dirty = true;
      schedule();
    },
    camera: () => ({ ...cam }),
    viewport: () => ({ ...vp }),
    jumpTo,
    flyTo,
    fitTarget,
    fit(rect, opts = {}) {
      const target = fitTarget(rect, opts);
      if (opts.animate ?? true) return flyTo(target);
      jumpTo(target);
      return Promise.resolve(true);
    },
    zoomAt(p, factor) {
      stop();
      cam = zoomAt(cam, p, factor);
      dirty = true;
      schedule();
    },
    panBy(dx, dy) {
      stop();
      cam = panBy(cam, dx, dy);
      dirty = true;
      schedule();
    },
    stop,
    onFrame(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    redraw() {
      dirty = true;
      schedule();
    },
    settled: () => !flight && tiles.sharp(cam, vp, dpr),
    status: () => ({ flying: flight !== null, images: imageCount }),
    dispose() {
      disposed = true;
      stop();
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      dprQuery?.removeEventListener("change", onDpr);
      listeners.clear();
      tiles.dispose();
      renderer.dispose();
      // dispose() gibt den WebGL-Kontext nicht frei, er bliebe bis zur Speicherbereinigung offen. Jeder geöffnete
      // Vergleich baut zwei Engines; ab etwa 16 offenen Kontexten verwirft Chromium den ältesten, womöglich den der Fläche.
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
