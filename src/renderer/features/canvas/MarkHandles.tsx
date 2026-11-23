// Ändern eines ausgewählten Rahmens. Kanten und Ecken: unsichtbare Zonen, nur der Zeiger zeigt die Richtung;
// Kanten auf ganzer Länge ohne die Ecken. Sichtbar ist nur der Griff zum Verschieben: an der Nummer ziehen, wie einen Frame in Figma an seinem
// Namen. Oben links sitzt die Nummer; dort ändern die Kanten oben und links die Größe.
// Während des Ziehens zeigt der Rahmen den neuen Stand, gesichert wird beim Loslassen.
// Auch bei offenem Notizfeld, gleich nach dem Aufziehen (22.11.: die Griffe kamen nicht wie erwartet).

import { useRef } from "react";
import type { WorldRect } from "./engine/camera.ts";
import type { Engine } from "./engine/engine.ts";
import { worldAttrs } from "./engine/overlay.ts";
import { reshapeRect, type Handle } from "./engine/reshape.ts";
import type { AnnotationEditing } from "./useAnnotationEditing.ts";

/** Was mit dem gezogenen Rahmen passiert: zeigen während des Ziehens, übernehmen beim Loslassen. */
export type ReshapeTarget = { move(rect: WorldRect): void; done(rect: WorldRect): void };

/** Griffe einer gesicherten Anmerkung: zeigen über `adjust`, sichern über `settle`. */
export const annotationTarget = (id: string, editing: AnnotationEditing): ReshapeTarget => ({
  move: (rect) => editing.adjust(id, rect),
  done: (rect) => void editing.settle(id, rect),
});

/** Griffe am Entwurf mit offenem Notizfeld: der Entwurf selbst ändert sich, gesichert wird mit der Notiz. */
export const draftTarget = (editing: AnnotationEditing): ReshapeTarget => ({ move: editing.reshapeDraft, done: editing.reshapeDraft });

const EDGES = ["n", "s", "e", "w"] as const;
const CORNERS = ["ne", "se", "sw"] as const;
/** Kleinster Rahmen in Bildschirmpixeln. */
const MIN_PX = 12;
/** Ab so vielen Pixeln wird aus einem Klick auf die Nummer ein Verschieben. */
const DRAG_THRESHOLD = 3;

type Drag = { handle: Handle; x: number; y: number; start: WorldRect; last: WorldRect; moved: boolean };

/** Zeigergesten für einen Griff. Ein Klick ohne Bewegung bleibt ein Klick (wichtig für die Nummer). */
export function useReshape(rect: WorldRect, bounds: WorldRect, engine: Engine, target: ReshapeTarget) {
  const drag = useRef<Drag | null>(null);
  return (handle: Handle) => ({
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      e.stopPropagation();
      // Kein Fokuswechsel: ein offenes Notizfeld bleibt zum Weitertippen.
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { handle, x: e.clientX, y: e.clientY, start: rect, last: rect, moved: false };
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return;
      d.moved = true;
      const z = engine.camera().z;
      d.last = reshapeRect(d.start, d.handle, (e.clientX - d.x) / z, (e.clientY - d.y) / z, bounds, MIN_PX / z);
      target.move(d.last);
    },
    onPointerUp(e: React.PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (d.moved) target.done(d.last);
    },
    onPointerCancel() {
      if (drag.current?.moved) target.done(drag.current.start);
      drag.current = null;
    },
  });
}

export function MarkHandles({ rect, bounds, engine, target }: { rect: WorldRect; bounds: WorldRect; engine: Engine; target: ReshapeTarget }) {
  const handlers = useReshape(rect, bounds, engine, target);
  return (
    <div className="mark-handles" {...worldAttrs(rect)}>
      {EDGES.map((h) => (
        <div key={h} className="mark-edge" data-surface-ui data-handle={h} {...handlers(h)} />
      ))}
      {CORNERS.map((h) => (
        <div key={h} className="mark-corner" data-surface-ui data-handle={h} {...handlers(h)} />
      ))}
    </div>
  );
}
