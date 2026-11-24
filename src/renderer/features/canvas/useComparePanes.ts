// Zwei Hälften des Fassungsvergleichs, je ein eigener Motor, aber eine Kamera: Zoomen, Ziehen und Scrollen in einer
// Hälfte bewegen beide gleich. Beim Öffnen passt der Vergleich die aktuelle Fassung in der Breite ein, oben
// angesetzt; wechselt man links die Fassung, bleibt die Stelle stehen. Der Zeiger erscheint als Ring in der anderen
// Hälfte an derselben Stelle.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { tileBaseUrl } from "../../../shared/ipc.ts";
import { clamp, panBy, zoomAt, type Camera, type Point, type Viewport, type WorldRect } from "./engine/camera.ts";
import { createEngine, type Engine, type FitOptions } from "./engine/engine.ts";
import { placeOverlay } from "./engine/overlay.ts";
import { sheetRect, type Sheet } from "./version-compare.ts";

declare global {
  interface Window {
    /** Nur zum Prüfen von außen: Kameras und Bilder beider Hälften. */
    __compare?: { facts(): { cameras: Camera[]; viewports: Viewport[]; images: number[]; settled: boolean; ready: boolean } };
  }
}

type Pane = { root: RefObject<HTMLDivElement | null>; gl: RefObject<HTMLDivElement | null>; ghost: RefObject<HTMLDivElement | null> };

export type ComparePanes = {
  ready: boolean;
  /** Wieder wie beim Öffnen: aktuelle Fassung in der Breite, oben angesetzt. */
  reset(): void;
  zoomBy(factor: number): void;
  /** Ein Stück nach oben (−1) oder unten (+1), wie Pfeiltasten. */
  scroll(dir: number): void;
  /** Beide Hälften fahren zu dieser Stelle (Weltmaß des Vergleichs), etwa zu einem Bereich oder einer Anmerkung. */
  show(rect: WorldRect, opts?: FitOptions): void;
};

/** Höhe der Beschriftung oben in jeder Hälfte samt Abstand, in Bildschirmpixeln. */
const LABEL_SPACE = 40;

const pairKey = (s: Sheet) => `${s.path}|${s.tiles?.key ?? "-"}`;

export function useComparePanes(panes: [Pane, Pane], sheets: [Sheet, Sheet], width: number): ComparePanes {
  const [engines, setEngines] = useState<[Engine, Engine] | null>(null);
  const [ready, setReady] = useState(false);
  const insets = useRef({ top: 0, bottom: 0 });
  const readyRef = useRef(false);
  readyRef.current = ready;

  useEffect(() => {
    const [a, b] = panes;
    if (!a.gl.current || !b.gl.current) return;
    const root = getComputedStyle(document.documentElement);
    insets.current = { top: parseFloat(root.getPropertyValue("--bar-height")) || 0, bottom: parseFloat(root.getPropertyValue("--toolbar-clear")) || 0 };
    const pair = [a, b].map((p) => {
      const e = createEngine(p.gl.current!, { insetTop: insets.current.top, insetBottom: insets.current.bottom });
      const off = e.onFrame((cam) => p.root.current && placeOverlay(p.root.current, cam, window.devicePixelRatio || 1, insets.current.top, insets.current.bottom));
      return { e, off };
    });
    const both: [Engine, Engine] = [pair[0]!.e, pair[1]!.e];
    window.__compare = {
      facts: () => ({ cameras: both.map((e) => e.camera()), viewports: both.map((e) => e.viewport()), images: both.map((e) => e.status().images), settled: both.every((e) => e.settled()), ready: readyRef.current }),
    };
    setEngines(both);
    return () => {
      for (const { e, off } of pair) {
        off();
        e.dispose();
      }
      delete window.__compare;
      setEngines(null);
    };
    // Die Refs bleiben dieselben, solange der Vergleich offen ist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Was beim Öffnen gezeigt wird; die aktuelle Fassung rechts gibt Breite und Anfang vor.
  const home = (e: Engine): Camera => {
    const rect = sheetRect(sheets[1], width);
    const tall = rect.h > rect.w * 0.9;
    const opts: FitOptions = { padding: 32, maxZoom: 1, top: tall };
    const cam = e.fitTarget(rect, opts);
    // Platz über dem Bild für die Beschriftung der Hälfte (.compare__label), sonst läge sie auf der Bildecke.
    return tall ? { ...cam, y: cam.y - LABEL_SPACE / cam.z } : cam;
  };
  const homeRef = useRef(home);
  homeRef.current = home;

  const keys = sheets.map(pairKey).join("||");
  useEffect(() => {
    if (!engines) return;
    let live = true;
    const loads = engines.map((e, k) => {
      const s = sheets[k]!;
      return e.setImages(s.tiles ? [{ id: `${k}:${s.path}`, rect: sheetRect(s, width), url: tileBaseUrl(s.tiles.key), manifest: s.tiles }] : []);
    });
    void Promise.all(loads).then(() => {
      if (!live || readyRef.current) return;
      const cam = homeRef.current(engines[1]);
      for (const e of engines) e.jumpTo(cam);
      requestAnimationFrame(() => live && setReady(true));
    });
    return () => {
      live = false;
    };
    // sheets und width stecken in keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engines, keys]);

  // Eingaben in beiden Hälften, auf eine gemeinsame Kamera.
  useEffect(() => {
    if (!engines) return;
    const set = (cam: Camera) => {
      for (const e of engines) e.jumpTo(cam);
    };
    const fly = (cam: Camera) => {
      for (const e of engines) void e.flyTo(cam);
    };
    const offs = panes.map((pane, k) => {
      const host = pane.root.current;
      const other = panes[1 - k]!.ghost.current;
      if (!host) return () => {};
      const local = (e: MouseEvent): Point => {
        const r = host.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      const own = (t: EventTarget | null) => t instanceof Element && t.closest("[data-compare-ui]") !== null;
      let drag: { id: number; last: Point } | null = null;

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? host.clientHeight : 1;
        const cam = engines[0].camera();
        if (e.ctrlKey || e.metaKey) {
          // Wie auf dem Canvas: Spreizen in feinen Schritten, ein Mausrad in Rasten von gut 20 Prozent.
          const dy = e.deltaY * unit;
          const step = Math.abs(dy) >= 50 ? Math.sign(dy) * 20 : clamp(dy, -10, 10);
          set(zoomAt(cam, local(e), Math.exp(-step / 100)));
        } else set(panBy(cam, -e.deltaX * unit, -e.deltaY * unit));
      };
      const onDown = (e: PointerEvent) => {
        if (own(e.target) || drag || (e.button !== 0 && e.button !== 1)) return;
        for (const en of engines) en.stop();
        drag = { id: e.pointerId, last: local(e) };
        host.setPointerCapture(e.pointerId);
        host.dataset.dragging = "";
        e.preventDefault();
      };
      const onMove = (e: PointerEvent) => {
        const p = local(e);
        if (other) {
          other.style.translate = `${p.x}px ${p.y}px`;
          other.dataset.on = "";
        }
        if (!drag || e.pointerId !== drag.id) return;
        set(panBy(engines[0].camera(), p.x - drag.last.x, p.y - drag.last.y));
        drag.last = p;
      };
      const onUp = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.id) return;
        drag = null;
        if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
        delete host.dataset.dragging;
      };
      const onLeave = () => {
        if (other) delete other.dataset.on;
      };
      const onDouble = (e: MouseEvent) => {
        if (own(e.target)) return;
        fly(zoomAt(engines[0].camera(), local(e), 2));
      };
      host.addEventListener("wheel", onWheel, { passive: false });
      host.addEventListener("pointerdown", onDown);
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerup", onUp);
      host.addEventListener("pointercancel", onUp);
      host.addEventListener("pointerleave", onLeave);
      host.addEventListener("dblclick", onDouble);
      return () => {
        host.removeEventListener("wheel", onWheel);
        host.removeEventListener("pointerdown", onDown);
        host.removeEventListener("pointermove", onMove);
        host.removeEventListener("pointerup", onUp);
        host.removeEventListener("pointercancel", onUp);
        host.removeEventListener("pointerleave", onLeave);
        host.removeEventListener("dblclick", onDouble);
      };
    });
    return () => offs.forEach((off) => off());
  }, [engines, panes]);

  // Nach jedem Rendern die Beschriftungen setzen, sonst stünden neue bis zum nächsten Bild falsch.
  useLayoutEffect(() => {
    if (!engines) return;
    engines.forEach((e, k) => {
      const root = panes[k]!.root.current;
      if (root) placeOverlay(root, e.camera(), window.devicePixelRatio || 1, insets.current.top, insets.current.bottom);
    });
  });

  return {
    ready,
    reset() {
      if (!engines) return;
      const cam = home(engines[1]);
      for (const e of engines) void e.flyTo(cam);
    },
    zoomBy(factor) {
      if (!engines) return;
      const vp = engines[0].viewport();
      const cam = zoomAt(engines[0].camera(), { x: vp.w / 2, y: vp.h / 2 }, factor);
      for (const e of engines) void e.flyTo(cam);
    },
    scroll(dir) {
      if (!engines) return;
      const cam = panBy(engines[0].camera(), 0, -dir * engines[0].viewport().h * 0.6);
      for (const e of engines) void e.flyTo(cam);
    },
    show(rect, opts = { padding: 48, maxZoom: 2 }) {
      if (!engines) return;
      const cam = engines[1].fitTarget(rect, opts);
      for (const e of engines) void e.flyTo(cam);
    },
  };
}
