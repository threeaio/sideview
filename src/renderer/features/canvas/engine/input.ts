// Eingaben auf dem Canvas, ohne React. Trackpad: zwei Finger verschieben die Ansicht, Spreizen zoomt (kommt als
// Mausrad mit Strg). Maus: Rad verschiebt, Cmd oder Strg mit Rad zoomt. Leertaste oder mittlere Taste und Ziehen
// verschiebt die Ansicht, in jedem Werkzeug.
// Werkzeug Markieren: Ziehen zieht einen Rahmen auf, auch neben einem Bild; er gehört zu dem Bild, das er am meisten
// überdeckt, und endet an dessen Rand. Werkzeug Auswählen: Ziehen auf einem Bild oder einer Gruppe verschiebt,
// ins Leere zieht ein Auswahlrechteck auf, Shift fügt hinzu (5.11.: Variante A).
// Am rechten Rand einer Gruppe zieht Ziehen ihre Breite (20.11.).
// Elemente mit `data-surface-ui` (Beschriftungen, Notizfeld) bedienen sich selbst.

import { clamp, screenToWorld, type Point, type WorldRect } from "./camera.ts";
import type { Engine } from "./engine.ts";
import { rectFromPoints } from "./geometry.ts";
import type { ArrangeHit } from "../arrange-core.ts";

export type Draft = { itemId: string; rect: WorldRect };

export type InputHandlers = {
  /** Aktuelles Werkzeug. */
  tool(): "select" | "mark";
  /** Werkzeug Auswählen: Bild oder Gruppe unter dem Weltpunkt. */
  hit(p: Point): ArrangeHit | null;
  onMoveStart(hit: ArrangeHit, add: boolean, pointer: Point): void;
  /** Verschiebung seit dem Anfang und Zeiger, in Welteinheiten. */
  onMove(dx: number, dy: number, pointer: Point): void;
  /** Doppelklick, als Weltpunkt: hinzoomen. */
  onDoubleTap(p: Point): void;
  onMoveEnd(cancelled: boolean): void;
  /** Auswahlrechteck; null, wenn es abgebrochen wurde. */
  onMarquee(rect: WorldRect | null, add: boolean): void;
  onMarqueeEnd(): void;
  /** Bild unter dem Weltpunkt, oder null. */
  imageAt(p: Point): { id: string; rect: WorldRect } | null;
  /** Bild, das das Rechteck am meisten überdeckt, oder null. */
  imageUnder(r: WorldRect): { id: string; rect: WorldRect } | null;
  /** Ein Rechteck wird gezogen; null, wenn es abgebrochen wurde. */
  onDraft(draft: Draft | null): void;
  /** Rechteck fertig gezogen. */
  onDrawn(draft: Draft): void;
  /** Antippen ohne Ziehen, als Weltpunkt; `add` mit Shift. */
  onTap(p: Point, add: boolean): void;
};

/** Ab so vielen Bildschirmpixeln wird aus Antippen ein Ziehen. */
const DRAG_THRESHOLD = 4;
/** Kleinere Rechtecke gelten als versehentlich. */
const MIN_RECT = 6;

type Intent = "pan" | "draw" | "move" | "resize" | "marquee";
type Gesture = {
  pointerId: number;
  mode: "pending" | Intent;
  intent: Intent;
  hit: ArrangeHit | null;
  add: boolean;
  start: Point;
  last: Point;
  item: { id: string; rect: WorldRect } | null;
  origin: Point;
};

const intersect = (a: WorldRect, b: WorldRect): WorldRect => {
  const x0 = clamp(a.x, b.x, b.x + b.w);
  const y0 = clamp(a.y, b.y, b.y + b.h);
  const x1 = clamp(a.x + a.w, b.x, b.x + b.w);
  const y1 = clamp(a.y + a.h, b.y, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

export function attachInput(host: HTMLElement, engine: Engine, h: InputHandlers): () => void {
  let space = false;
  let g: Gesture | null = null;

  const local = (e: MouseEvent): Point => {
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const ownUi = (t: EventTarget | null) => t instanceof Element && t.closest("[data-surface-ui]") !== null;
  const setMode = () => {
    host.dataset.mode = g && g.mode !== "pending" ? g.mode : space ? "space" : "idle";
  };
  /** Rahmen bis zum Zeiger, auf sein Bild begrenzt. Begann er neben einem Bild, zählt das meistüberdeckte. */
  const drawn = (gesture: Gesture, p: Point): Draft | null => {
    const raw = rectFromPoints(gesture.origin, screenToWorld(engine.camera(), p));
    const item = gesture.item ?? h.imageUnder(raw);
    return item ? { itemId: item.id, rect: intersect(raw, item.rect) } : null;
  };

  const onWheel = (e: WheelEvent) => {
    if (ownUi(e.target)) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? engine.viewport().h : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      // Spreizen liefert kleine, feine Schritte, höchstens 10 Prozent je Ereignis; ein Mausrad große Rasten,
      // die je um gut 20 Prozent zoomen.
      const step = Math.abs(dy) >= 50 ? Math.sign(dy) * 20 : clamp(dy, -10, 10);
      engine.zoomAt(local(e), Math.exp(-step / 100));
    } else {
      engine.panBy(-dx, -dy);
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (ownUi(e.target) || g) return;
    if (e.button !== 0 && e.button !== 1) return;
    engine.stop();
    const p = local(e);
    const origin = screenToWorld(engine.camera(), p);
    const pan = e.button === 1 || space;
    // Shift und Ziehen zieht in jedem Werkzeug einen Rahmen (5.11.); Shift-Klick wählt dazu.
    const mark = h.tool() === "mark" || (e.button === 0 && e.shiftKey);
    const hit = pan || mark ? null : h.hit(origin);
    const intent: Intent = pan ? "pan" : mark ? "draw" : hit?.kind === "edge" ? "resize" : hit ? "move" : "marquee";
    const item = intent === "draw" ? h.imageAt(origin) : null;
    g = { pointerId: e.pointerId, mode: pan ? "pan" : "pending", intent, hit, add: e.shiftKey, start: p, last: p, item, origin };
    host.setPointerCapture(e.pointerId);
    e.preventDefault();
    setMode();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!g) {
      // Für den Zeiger: im Werkzeug Auswählen zeigt er, ob unter ihm etwas zum Verschieben liegt.
      if (!ownUi(e.target) && h.tool() === "select") {
        const hit = h.hit(screenToWorld(engine.camera(), local(e)));
        host.dataset.over = hit?.kind === "edge" ? "edge" : hit ? "item" : "stage";
      }
      return;
    }
    if (e.pointerId !== g.pointerId) return;
    const p = local(e);
    if (g.mode === "pending") {
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < DRAG_THRESHOLD) return;
      g.mode = g.intent;
      setMode();
      if ((g.mode === "move" || g.mode === "resize") && g.hit) h.onMoveStart(g.hit, g.add, g.origin);
    }
    if (g.mode === "pan") {
      engine.panBy(p.x - g.last.x, p.y - g.last.y);
      g.last = p;
    } else if (g.mode === "move" || g.mode === "resize") {
      const w = screenToWorld(engine.camera(), p);
      h.onMove(w.x - g.origin.x, w.y - g.origin.y, w);
    } else if (g.mode === "marquee") {
      h.onMarquee(rectFromPoints(g.origin, screenToWorld(engine.camera(), p)), g.add);
    } else {
      h.onDraft(drawn(g, p));
    }
  };

  const finish = (e: PointerEvent, cancelled: boolean) => {
    if (!g || e.pointerId !== g.pointerId) return;
    const gesture = g;
    g = null;
    if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
    setMode();
    if (gesture.mode === "move" || gesture.mode === "resize") return h.onMoveEnd(cancelled);
    if (gesture.mode === "marquee") {
      if (cancelled) h.onMarquee(null, gesture.add);
      return h.onMarqueeEnd();
    }
    if (cancelled) {
      if (gesture.mode === "draw") h.onDraft(null);
      return;
    }
    const p = local(e);
    if (gesture.mode === "pending") {
      h.onTap(screenToWorld(engine.camera(), p), gesture.add);
    } else if (gesture.mode === "draw") {
      const d = drawn(gesture, p);
      const z = engine.camera().z;
      if (d && d.rect.w * z >= MIN_RECT && d.rect.h * z >= MIN_RECT) h.onDrawn(d);
      else h.onDraft(null);
    }
  };
  const onPointerUp = (e: PointerEvent) => finish(e, false);
  const onPointerCancel = (e: PointerEvent) => finish(e, true);

  /** Esc während einer Geste: alles zurück, nichts wird abgelegt oder gezogen. */
  const cancel = () => {
    if (!g) return;
    const gesture = g;
    g = null;
    if (host.hasPointerCapture(gesture.pointerId)) host.releasePointerCapture(gesture.pointerId);
    setMode();
    if (gesture.mode === "move" || gesture.mode === "resize") h.onMoveEnd(true);
    else if (gesture.mode === "marquee") {
      h.onMarquee(null, gesture.add);
      h.onMarqueeEnd();
    } else if (gesture.mode === "draw") h.onDraft(null);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && g) {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.code !== "Space" || isTyping()) return;
    e.preventDefault();
    if (!space) {
      space = true;
      setMode();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code !== "Space") return;
    space = false;
    setMode();
  };
  const onBlur = () => {
    space = false;
    setMode();
  };

  const onDoubleClick = (e: MouseEvent) => {
    if (ownUi(e.target) || space) return;
    h.onDoubleTap(screenToWorld(engine.camera(), local(e)));
  };

  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("dblclick", onDoubleClick);
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  setMode();

  return () => {
    host.removeEventListener("wheel", onWheel);
    host.removeEventListener("dblclick", onDoubleClick);
    host.removeEventListener("pointerdown", onPointerDown);
    host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("pointerup", onPointerUp);
    host.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  };
}
