// HTML-Ebene über der Leinwand: Elemente mit Weltkoordinaten werden je Animationsschritt auf den
// Bildschirm gesetzt, auf Gerätepixel gerundet, damit dünne Linien scharf bleiben.
//   data-wx, data-wy   Lage (Pflicht für Rechtecke und Anker)
//   data-ww, data-wh   Breite und Höhe; nur data-ww setzt nur die Breite
//   data-lw, data-lh   Größe, nach der data-size gesetzt wird: s, m oder l (wie viel eine Beschriftung zeigt)
//   data-nw            Breite des Bildes, zu dem ein Rahmen gehört: ist das Bild auf dem Schirm schmaler als NEAR,
//                      bekommt das Element data-far (Rahmen und Nummern weichen der Marke mit der Zahl)
//   data-obstacle      Nummern weichen diesem Element aus (die Marke eines Bildes)
//   data-room, data-need  Platz über einem Bild (Weltmaß) und Bedarf (Bildschirmpixel): reicht er nicht, data-tight
//   data-round         Rahmen eines Bildes: Ecken wie die Bilder im Shader (image-corners.ts)
//   data-scrim         Rahmen, der alles außerhalb abdunkelt (Schatten mit Spread): --scrim reicht in jedem Bild bis
//                      zum fernsten Rand des Sichtfensters, auch wenn der Rahmen während einer Fahrt weit draußen liegt
//   data-attach        gehört zu einem Rechteck (data-rx, data-ry, data-rw, data-rh) und bleibt im Sichtfenster:
//                      "label" hängt darüber und bleibt am oberen Rand, solange das Rechteck zu sehen ist;
//                      "editor" hängt darunter, sonst darüber, sonst an den Rand geschoben, aber immer ganz im Bild.

import type { Camera, WorldRect } from "./camera.ts";
import { GROUP_PAD_TOP } from "../../../../shared/groups.ts";
import { imageRadiusPx } from "./image-corners.ts";
import { attachedPosition, noteOffset, scrimSpread, type Attach } from "./placement.ts";

/** Grenzen in Bildschirmpixeln: darunter klein (nur das Rechteck), bis dahin mittel (nur die Nummer). */
const SIZE_SMALL = 40;
const SIZE_MEDIUM = 160;
/** Ab dieser Bildbreite auf dem Schirm zeigen sich Rahmen und Nummern der Anmerkungen. */
const NEAR = 480;
/** Abstand zwischen Nummern, die auf dieselbe Stelle fallen und deshalb nebeneinander rücken. */
const PIN_GAP = 4;
/** Versatz der Beschriftung aus canvas.css (`.mark-label { translate }`). */
const LABEL_SHIFT = { x: -14, y: 20 };

export const worldAttrs = (r: WorldRect) => ({ "data-wx": r.x, "data-wy": r.y, "data-ww": r.w, "data-wh": r.h });
export const anchorAttrs = (x: number, y: number) => ({ "data-wx": x, "data-wy": y });
export const sizeAttrs = (r: WorldRect) => ({ "data-lw": r.w, "data-lh": r.h });
/** Platz über einem Bild in Canvas-Einheiten: Rand oben in einer Gruppe, zugleich kleiner als der Abstand der Reihen. */
const TITLE_ROOM = GROUP_PAD_TOP;
/** Höhe der Marke über dem Bild in Bildschirmpixeln: Abstand 8, Pille 26, je Blatt des Stapels 8 (canvas.css). */
const titleNeed = (sheets: number) => 8 + 26 + sheets * 8;
/** Marke über dem Bild: passt sie bei diesem Zoom nicht mehr hinein, bekommt sie data-tight und rückt auf das Bild. */
export const titleRoomAttrs = (sheets: number) => ({ "data-room": TITLE_ROOM, "data-need": titleNeed(sheets) });
export const attachAttrs = (r: WorldRect, attach: Attach) => ({ "data-attach": attach, "data-rx": r.x, "data-ry": r.y, "data-rw": r.w, "data-rh": r.h });

function setSize(el: HTMLElement, cam: Camera) {
  const d = el.dataset;
  if (d.nw !== undefined) {
    const far = Number(d.nw) * cam.z < NEAR;
    if (far !== (d.far !== undefined)) el.toggleAttribute("data-far", far);
  }
  if (d.lw === undefined) return;
  const s = Math.max(Number(d.lw), Number(d.lh)) * cam.z;
  const size = s < SIZE_SMALL ? "s" : s < SIZE_MEDIUM ? "m" : "l";
  if (d.size !== size) d.size = size;
}

/** Elemente dieser Ebene. Was unter einem anderen Element mit `data-camera` liegt (etwa einer Hälfte des
 *  Fassungsvergleichs), gehört zu dessen eigener Kamera und wird hier nicht gesetzt. */
function own(root: HTMLElement, selector: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => {
    const cam = el.closest("[data-camera]");
    return !cam || cam === root || !root.contains(cam);
  });
}

export function placeOverlay(root: HTMLElement, cam: Camera, dpr: number, insetTop = 0, insetBottom = 0) {
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  const view = { w: root.clientWidth, h: root.clientHeight, top: insetTop, bottom: insetBottom };
  const toScreen = (x: number, y: number) => ({ x: (x - cam.x) * cam.z, y: (y - cam.y) * cam.z });

  // Erst die Größen setzen und messen, dann schreiben: so rechnet der Browser das Layout nur einmal.
  const attached = own(root, "[data-attach]");
  for (const el of attached) setSize(el, cam);
  const boxes = attached.map((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));
  // Notizkarten liegen frei neben der Nummer (position: absolute) und zählen nicht zur Beschriftung. Gemessen
  // werden auch verborgene (visibility), damit die Notiz beim Zeigen schon an der richtigen Stelle steht.
  const notes = attached.map((el) => el.querySelector<HTMLElement>(":scope > .mark-label__note"));
  const noteBoxes = notes.map((n) => (n ? { w: n.offsetWidth, h: n.offsetHeight } : null));

  for (const el of own(root, "[data-wx]")) {
    const d = el.dataset;
    const p = toScreen(Number(d.wx), Number(d.wy));
    if (d.ww !== undefined) el.style.width = `${snap(Number(d.ww) * cam.z)}px`;
    if (d.wh !== undefined) el.style.height = `${snap(Number(d.wh) * cam.z)}px`;
    setSize(el, cam);
    if (d.room !== undefined) {
      const tight = Number(d.room) * cam.z < Number(d.need);
      if (tight !== (d.tight !== undefined)) el.toggleAttribute("data-tight", tight);
    }
    if (d.round !== undefined) {
      const r = `${imageRadiusPx(Math.min(Number(d.ww), Number(d.wh)), cam.z)}px`;
      el.style.borderRadius = r;
      el.style.setProperty("--round", r);
    }
    if (d.scrim !== undefined) el.style.setProperty("--scrim", `${Math.ceil(scrimSpread(p, Number(d.ww) * cam.z, Number(d.wh) * cam.z, view))}px`);
    el.style.transform = `translate3d(${snap(p.x)}px, ${snap(p.y)}px, 0)`;
  }

  // Nummern, die auf dieselbe Stelle fallen, rücken in Reihenfolge nach rechts und auf eine Linie: aus 1, 2, 3
  // übereinander wird „1 2 3“. Der Marke eines Bildes weichen sie ebenso aus. Gerechnet wird in der Lage vor dem
  // CSS-`translate` der Beschriftung (LABEL_SHIFT), deshalb werden die Hindernisse um denselben Betrag verschoben.
  type Box = { x: number; y: number; w: number; h: number; pin: boolean };
  const origin = root.getBoundingClientRect();
  const pins: Box[] = own(root, "[data-obstacle]").flatMap((el) => {
    const b = el.getBoundingClientRect();
    return b.width > 0 ? [{ x: b.left - origin.left - LABEL_SHIFT.x, y: b.top - origin.top - LABEL_SHIFT.y, w: b.width, h: b.height, pin: false }] : [];
  });
  const marks = pins.map((o) => ({ x: o.x + LABEL_SHIFT.x, y: o.y + LABEL_SHIFT.y, w: o.w, h: o.h }));
  const hit = (q: Box) => pins.find((o) => q.x < o.x + o.w && o.x < q.x + q.w && q.y < o.y + o.h && o.y < q.y + q.h);
  attached.forEach((el, i) => {
    const d = el.dataset;
    const a = toScreen(Number(d.rx), Number(d.ry));
    const r = { x0: a.x, y0: a.y, x1: a.x + Number(d.rw) * cam.z, y1: a.y + Number(d.rh) * cam.z };
    const box = boxes[i]!;
    const p = attachedPosition(d.attach as Attach, r, box, view);
    if (d.attach === "label" && box.w > 0) {
      const q: Box = { ...p, ...box, pin: true };
      for (let n = 0, o = hit(q); n < 50 && o; n++, o = hit(q)) {
        q.x = o.x + o.w + PIN_GAP;
        if (o.pin) q.y = o.y;
      }
      pins.push(q);
      p.x = q.x;
      p.y = q.y;
      const note = notes[i];
      const nb = noteBoxes[i];
      if (note && nb && nb.w > 0) {
        const at = noteOffset({ x: p.x + LABEL_SHIFT.x, y: p.y + LABEL_SHIFT.y, ...box }, nb, view, marks);
        note.style.transform = `translate3d(${snap(at.x)}px, ${snap(at.y)}px, 0)`;
      }
    }
    el.style.transform = `translate3d(${snap(p.x)}px, ${snap(p.y)}px, 0)`;
  });
}
