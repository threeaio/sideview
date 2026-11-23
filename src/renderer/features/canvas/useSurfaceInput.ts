// Zeiger, Rad und Tasten an Motor, Anmerkungen und Anordnen binden. Tastenkürzel nur, solange kein Textfeld den
// Fokus hat: Cmd+Plus und Cmd+Minus zoomen, Cmd+0 zeigt 100 Prozent, Shift+1 alles, Shift+2 die Auswahl,
// Enter beschriftet die Auswahl, Entf oder Rückschritt löscht sie (Anmerkung, Bilder oder Gruppe), Esc hebt sie
// auf, Cmd+G gruppiert die gewählten Bilder, Cmd+Shift+G löst die gewählte Gruppe auf. Doppelklick auf Bild oder Gruppe zoomt hin. Cmd+Z kommt über
// das Menü „Bearbeiten“ (useHistory).

import { useEffect, useRef, type RefObject } from "react";
import type { CanvasState } from "../../../shared/contracts.ts";
import type { Engine } from "./engine/engine.ts";
import { contentBounds, imageToWorld, itemAt, itemWorldRect, largestOverlap } from "./engine/geometry.ts";
import { attachInput, isTyping } from "./engine/input.ts";
import { hitArrange } from "./arrange-core.ts";
import { showGroup, toggleItem } from "./navigation.ts";
import { groupArea } from "../../../shared/groups.ts";
import type { AnnotationEditing } from "./useAnnotationEditing.ts";
import type { Arrange } from "./useArrange.ts";
import type { Tool } from "./useTool.ts";

const KEY_ZOOM = 1.25;

export function useSurfaceInput(
  host: RefObject<HTMLDivElement | null>,
  engine: Engine | null,
  state: CanvasState | null,
  editing: AnnotationEditing,
  arrange: Arrange,
  tool: Tool,
) {
  // Die Handler leben länger als ein Rendern; sie lesen immer den neuesten Stand.
  const latest = useRef({ state, editing, arrange, tool });
  latest.current = { state, editing, arrange, tool };

  useEffect(() => {
    if (!engine || !host.current) return;
    return attachInput(host.current, engine, {
      imageAt(p) {
        const items = latest.current.state?.items.filter((i) => i.tiles) ?? [];
        const item = itemAt(items, p);
        return item ? { id: item.id, rect: itemWorldRect(item) } : null;
      },
      imageUnder(r) {
        const item = largestOverlap(latest.current.state?.items.filter((i) => i.tiles) ?? [], r);
        return item ? { id: item.id, rect: itemWorldRect(item) } : null;
      },
      onDraft: (d) => {
        if (d) latest.current.arrange.clear();
        latest.current.editing.draft(d);
      },
      onDrawn: (d) => latest.current.editing.drawn(d),
      tool: () => latest.current.tool,
      hit: (p) => (latest.current.state ? hitArrange(latest.current.state, p, engine.camera().z) : null),
      onTap(p, add) {
        const { editing: ed, arrange: ar, tool: t } = latest.current;
        // Offenes Notizfeld: ein Klick daneben sichert es, wie bisher.
        if (ed.editor || t === "mark") {
          ar.clear();
          return ed.tap(p);
        }
        const note = ed.annotationAt(p);
        if (note) {
          ar.clear();
          return ed.select(note.id);
        }
        ed.select(null);
        ar.tap(latest.current.state ? hitArrange(latest.current.state, p, engine.camera().z) : null, add);
      },
      onMoveStart(hit, add, pointer) {
        latest.current.editing.select(null);
        latest.current.arrange.startMove(hit, add, pointer);
      },
      onMove: (dx, dy, pointer) => latest.current.arrange.move(dx, dy, pointer),
      onDoubleTap(p) {
        const s = latest.current.state;
        const hit = s ? hitArrange(s, p, engine.camera().z) : null;
        if (!s || !hit) return;
        if (hit.kind === "item") {
          const item = s.items.find((i) => i.id === hit.id);
          if (item) toggleItem(engine, item);
        } else {
          const group = s.groups.find((g) => g.id === hit.id);
          const area = group && groupArea(group, s.items);
          // Doppelklick auf den Namen über der Fläche benennt um, auf die Fläche zoomt hin.
          if (group && area && p.y < area.y) latest.current.arrange.startRename(group.id);
          else if (group) showGroup(engine, group, s.items);
        }
      },
      onMoveEnd: (cancelled) => latest.current.arrange.endMove(cancelled),
      onMarquee(rect, add) {
        if (rect) latest.current.editing.select(null);
        latest.current.arrange.marqueeTo(rect, add);
      },
      onMarqueeEnd: () => latest.current.arrange.marqueeEnd(),
    });
  }, [engine, host]);

  useEffect(() => {
    if (!engine) return;
    const onKey = (e: KeyboardEvent) => {
      // Schon erledigt, etwa Enter im Notizfeld: Bis das Ereignis hier ankommt, ist das Feld oft schon weg.
      if (e.defaultPrevented || isTyping()) return;
      const { state: s, editing: ed, arrange: ar } = latest.current;
      const vp = engine.viewport();
      const center = { x: vp.w / 2, y: vp.h / 2 };
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        engine.zoomAt(center, KEY_ZOOM);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        engine.zoomAt(center, 1 / KEY_ZOOM);
      } else if (mod && !e.shiftKey && e.code === "KeyG" && ar.selection?.kind === "items") {
        e.preventDefault();
        ar.groupSelected();
      } else if (mod && e.shiftKey && e.code === "KeyG" && ar.selection?.kind === "group") {
        e.preventDefault();
        ar.ungroupSelected();
      } else if (mod && e.key === "0") {
        e.preventDefault();
        engine.zoomAt(center, 1 / engine.camera().z);
      } else if (mod || e.altKey) {
        return;
      } else if (e.shiftKey && e.code === "Digit1") {
        const bounds = s ? contentBounds(s.items, s.groups) : null;
        if (bounds) void engine.fit(bounds, { padding: 64, maxZoom: 1 });
      } else if (e.shiftKey && e.code === "Digit2") {
        const a = s?.annotations.find((x) => x.id === ed.selected);
        const item = a && s?.items.find((i) => i.id === a.itemId);
        if (a && item) void engine.fit(imageToWorld(item, a.rect), { padding: 96, maxZoom: 4 });
      } else if (e.key === "Escape") {
        if (ed.editor) ed.cancel();
        else ed.select(null);
        ar.clear();
      } else if ((e.key === "Delete" || e.key === "Backspace") && ar.selection) {
        e.preventDefault();
        void ar.removeSelected();
      } else if ((e.key === "Delete" || e.key === "Backspace") && ed.selected) {
        e.preventDefault();
        ed.remove(ed.selected);
      } else if (e.key === "Enter" && ed.selected) {
        e.preventDefault();
        ed.edit(ed.selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);
}
