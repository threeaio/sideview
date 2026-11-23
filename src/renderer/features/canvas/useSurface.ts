// Hook der Fläche: Motor anlegen und abbauen, Bilder setzen, auf Claudes Wunsch alles zeigen und auf
// einen Bereich fahren, die HTML-Ebene im Takt der Kamera nachführen.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { CanvasState, ImageItem } from "../../../shared/contracts.ts";
import { tileBaseUrl } from "../../../shared/ipc.ts";
import type { Camera, Viewport } from "./engine/camera.ts";
import { createEngine, type Engine, type SurfaceImage } from "./engine/engine.ts";
import { contentBounds, findRegion, imageToWorld, itemWorldRect } from "./engine/geometry.ts";
import { placeOverlay } from "./engine/overlay.ts";
import type { ShowRequest } from "./useCanvas.ts";

declare global {
  interface Window {
    /** Nur zum Prüfen von außen: Kamerastand und ob alles scharf ist. */
    __surface?: { facts(): { camera: Camera; viewport: Viewport; settled: boolean; flying: boolean; images: number; mode: string | undefined }; jumpTo(cam: Camera): void; place(): void };
  }
}

/** Pause zwischen Übersicht und Fahrt, damit das Auge die Übersicht erst erfasst. */
const OVERVIEW_PAUSE_MS = 280;

const imagesOf = (items: ImageItem[]): SurfaceImage[] =>
  items.flatMap((item) => (item.tiles ? [{ id: item.id, rect: itemWorldRect(item), url: tileBaseUrl(item.tiles.key), manifest: item.tiles }] : []));

/** Ändert sich nur, wenn Bilder dazukommen, wegfallen oder wandern, nicht bei neuen Anmerkungen. */
const imagesKey = (state: CanvasState | null) =>
  state ? `${state.name}|${state.items.map((i) => `${i.id}:${i.tiles?.key ?? "-"}:${i.x}:${i.y}:${i.scale}`).join(",")}` : "";

export function useSurface(
  host: RefObject<HTMLDivElement | null>,
  glHost: RefObject<HTMLDivElement | null>,
  overlay: RefObject<HTMLDivElement | null>,
  state: CanvasState | null,
  show: ShowRequest | null,
) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [readyKey, setReadyKey] = useState("");
  const stateRef = useRef(state);
  stateRef.current = state;
  const shownKey = useRef("");
  /** Von der schwebenden Kopfzeile verdeckt (Token --bar-height), unten von der Werkzeugleiste (--toolbar-clear). */
  const insetTop = useRef(0);
  const insetBottom = useRef(0);

  useEffect(() => {
    if (!glHost.current) return;
    const root = getComputedStyle(document.documentElement);
    insetTop.current = parseFloat(root.getPropertyValue("--bar-height")) || 0;
    insetBottom.current = parseFloat(root.getPropertyValue("--toolbar-clear")) || 0;
    const e = createEngine(glHost.current, { insetTop: insetTop.current, insetBottom: insetBottom.current });
    const off = e.onFrame((cam) => {
      if (host.current) placeOverlay(host.current, cam, window.devicePixelRatio || 1, insetTop.current, insetBottom.current);
    });
    window.__surface = { facts: () => ({ camera: e.camera(), viewport: e.viewport(), settled: e.settled(), ...e.status(), mode: host.current?.dataset.mode }), jumpTo: (cam) => e.jumpTo(cam), place: () => host.current && placeOverlay(host.current, e.camera(), window.devicePixelRatio || 1, insetTop.current, insetBottom.current) };
    setEngine(e);
    return () => {
      off();
      e.dispose();
      delete window.__surface;
      setEngine(null);
    };
  }, [host, glHost, overlay]);

  // Ein Canvas erscheint (aus der Startansicht, beim Start der App oder als Wechsel): Fläche ausblenden, bis die
  // Kamera steht. Sonst stünden kurz die neuen Beschriftungen über den alten Bildern, und beim ersten Canvas blitzte
  // die erste Seite riesig auf, mit der Kamera auf Zoom 1 (23.11., sein Befund im Film; Prüfung check:open).
  const shownName = useRef<string | null>(null);
  const name = state?.name ?? null;
  useLayoutEffect(() => {
    if (name && name !== shownName.current) host.current?.setAttribute("data-switching", "");
    shownName.current = name;
  }, [name, host]);

  const key = imagesKey(state);
  useEffect(() => {
    if (!engine || !stateRef.current) return;
    let live = true;
    void engine.setImages(imagesOf(stateRef.current.items)).then(() => {
      if (live) setReadyKey(key);
    });
    return () => {
      live = false;
    };
  }, [engine, key]);

  // Einmal je Öffnen durch Claude: Übersicht, dann im Bogen auf den genannten Bereich.
  useEffect(() => {
    const current = stateRef.current;
    if (!engine || !current || readyKey !== key) return;
    const want = `${current.name}#${show?.nonce ?? 0}`;
    if (shownKey.current === want) return;
    const bounds = contentBounds(current.items, current.groups);
    if (bounds) void engine.fit(bounds, { animate: false, padding: 64, maxZoom: 1 });
    // Steht: weich wieder einblenden (CSS-Übergang auf opacity).
    requestAnimationFrame(() => host.current?.removeAttribute("data-switching"));
    const hit = show?.region ? findRegion(current.items, show.region) : null;
    if (!hit) {
      shownKey.current = want;
      return;
    }
    // Erst als gezeigt merken, wenn die Fahrt beginnt: Wird der Effekt vorher abgeräumt, beginnt er von vorn.
    const timer = setTimeout(() => {
      shownKey.current = want;
      void engine.fit(imageToWorld(hit.item, hit.region.rect), { padding: 48, maxZoom: 2 });
    }, OVERVIEW_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [engine, readyKey, key, show]);

  // Nach jedem Rendern die HTML-Ebene setzen, sonst stünde ein neues Rechteck bis zum nächsten Bild falsch.
  useLayoutEffect(() => {
    if (engine && host.current) placeOverlay(host.current, engine.camera(), window.devicePixelRatio || 1, insetTop.current, insetBottom.current);
  });

  return engine;
}
