// Bilder und Gruppen anordnen: auswählen (Klick, Shift-Klick, Auswahlrechteck), verschieben (Gruppen sind Reihen,
// der Zeiger entscheidet über hinein und heraus, siehe arrange-core.ts), löschen, Gruppe auflösen. Jeder Schritt
// kommt in den Verlauf (Cmd+Z, Cmd+Shift+Z). Gespeichert wird über den Service.

import { useCallback, useEffect, useState } from "react";
import type { CanvasState, Layout } from "../../../shared/contracts.ts";
import { coveredBy, dropLayout, groupLayout, itemsInRect, nextGroupTitle, layoutOf, previewDrag, previewResize, reflowAfterRemove, resizeLayout, selectedItemIds, widthAt, type ArrangeHit, type Drag, type Selection } from "./arrange-core.ts";
import { groupWidth } from "../../../shared/layout.ts";
import { canvasService } from "./canvas-service.ts";
import type { Point, WorldRect } from "./engine/camera.ts";
import type { History } from "./useHistory.ts";
import { useT } from "../../shared/i18n.tsx";

const NONE = new Set<string>();

export function useArrange(state: CanvasState | null, history: History) {
  const name = state?.name ?? "";
  const { t, lang } = useT();
  const [selection, setSelection] = useState<Selection>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Ziehen am rechten Rand einer Gruppe: welche Gruppe, Breite und ob sich schon etwas bewegt hat. */
  const [resize, setResize] = useState<{ groupId: string; width: number; moved: boolean } | null>(null);
  /** Nach dem Loslassen: neue Anordnung zeigen, bis der neue Stand vom Hauptprozess da ist. */
  const [settling, setSettling] = useState<Layout | null>(null);
  const [marquee, setMarquee] = useState<{ rect: WorldRect; base: string[] } | null>(null);
  /** Gruppe, deren Name gerade bearbeitet wird. */
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    setSelection(null);
    setDrag(null);
    setResize(null);
    setMarquee(null);
    setRenaming(null);
  }, [name]);
  // Neuer Stand vom Hauptprozess: die Zwischenanzeige ist erledigt.
  useEffect(() => setSettling(null), [state]);

  const ids = state ? selectedItemIds(state, selection) : [];
  const clear = useCallback(() => setSelection(null), []);

  const apply = (layout: Layout) => canvasService.applyLayout(name, layout);
  /** Anordnung setzen und als Schritt merken. */
  const commit = (label: string, before: Layout, after: Layout) => {
    setSettling(after);
    void apply(after);
    history.push({ label, undo: () => apply(before), redo: () => apply(after) });
  };

  const preview = state && drag ? previewDrag(state, drag) : null;
  const shown = (() => {
    if (!state) return null;
    if (preview) return preview.view;
    if (resize) return previewResize(state, resize.groupId, resize.width);
    if (!settling) return state;
    const at = new Map(settling.items.map((p) => [p.id, p]));
    return { ...state, groups: settling.groups, items: state.items.map((i) => (at.has(i.id) ? { ...i, ...at.get(i.id)! } : i)) };
  })();

  const toggle = (id: string, add: boolean): Selection => {
    if (!add) return { kind: "items", ids: [id] };
    const current = selection?.kind === "items" ? selection.ids : [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    return next.length ? { kind: "items", ids: next } : null;
  };

  const removeSelected = async () => {
    if (!state || ids.length === 0) return;
    const group = selection?.kind === "group" ? state.groups.find((g) => g.id === selection.id) : null;
    const label = group ? t("history.groupDeleted", { name: group.title }) : t("history.imagesDeleted", { count: ids.length });
    const before = layoutOf(state);
    const after = reflowAfterRemove(state, ids);
    const gone = [...ids];
    setSelection(null);
    const data = await canvasService.removeItems(name, gone);
    await apply(after);
    history.push({
      label,
      toast: true,
      undo: async () => {
        await canvasService.restoreItems(name, data);
        await apply(before);
      },
      redo: async () => {
        await canvasService.removeItems(name, gone);
        await apply(after);
      },
    });
  };

  const ungroupSelected = () => {
    if (!state || selection?.kind !== "group") return;
    const group = state.groups.find((g) => g.id === selection.id);
    if (!group) return;
    const before = layoutOf(state);
    commit(t("history.ungrouped", { name: group.title }), before, { ...before, groups: before.groups.filter((g) => g.id !== group.id) });
    setSelection({ kind: "items", ids: group.itemIds });
  };

  /** Gewählte Bilder gruppieren (⌘G); die neue Gruppe ist gewählt, ihr Name gleich zum Überschreiben offen. */
  const groupSelected = () => {
    if (!state || selection?.kind !== "items" || ids.length === 0) return;
    const group = { id: crypto.randomUUID().slice(0, 8), title: nextGroupTitle(state.groups, lang) };
    commit(t("history.grouped", { count: ids.length }), layoutOf(state), groupLayout(state, ids, group));
    setSelection({ kind: "group", id: group.id });
    setRenaming(group.id);
  };

  /** Neuer Name; leer oder unverändert lässt alles, wie es ist. */
  const rename = (groupId: string, title: string) => {
    setRenaming(null);
    const clean = title.replace(/\s+/g, " ").trim();
    const group = state?.groups.find((g) => g.id === groupId) ?? settling?.groups.find((g) => g.id === groupId);
    if (!state || !group || !clean || clean === group.title) return;
    const before = settling ?? layoutOf(state);
    commit(`Gruppe „${clean}“ benannt`, before, { ...before, groups: before.groups.map((g) => (g.id === groupId ? { ...g, title: clean } : g)) });
  };

  return {
    selection,
    renaming,
    startRename: (groupId: string) => setRenaming(groupId),
    rename,
    cancelRename: () => setRenaming(null),
    groupSelected,
    selectedIds: ids,
    /** Stand, wie er gerade zu sehen ist: beim Ziehen mit Vorschau, nach dem Loslassen die neue Anordnung. */
    view: shown,
    /** Gruppe, deren Breite gerade gezogen wird. */
    resizing: resize?.groupId ?? null,
    /** Beim Ziehen: Zielgruppe hervorheben, ihre Fläche samt Lücke. */
    dropTarget: preview?.target?.groupId ?? null,
    areas: preview?.areas ?? {},
    slot: preview?.slot ?? null,
    /** Bilder unter einem gezogenen Bild: Ihr Beiwerk in der HTML-Ebene tritt zurück. */
    covered: preview && drag ? coveredBy(preview.view, drag.ids) : NONE,
    marquee: marquee?.rect ?? null,
    clear,
    /** Klick: Bild wählen (Shift fügt hinzu oder nimmt heraus), Gruppe wählen, ins Leere hebt auf. */
    tap(hit: ArrangeHit | null, add: boolean) {
      if (!hit) return add ? undefined : setSelection(null);
      setSelection(hit.kind === "item" ? toggle(hit.id, add) : { kind: "group", id: hit.id });
    },
    /** Ziehen beginnt: Ein Bild nimmt nur die gewählten Bilder mit (nie die ganze Gruppe), die Gruppe sich selbst. */
    startMove(hit: ArrangeHit, add: boolean, pointer: Point) {
      if (!state) return;
      if (hit.kind === "edge") {
        const group = state.groups.find((g) => g.id === hit.id);
        if (!group) return;
        setSelection({ kind: "group", id: hit.id });
        return setResize({ groupId: hit.id, width: groupWidth(group), moved: false });
      }
      let next: Selection = selection;
      if (hit.kind === "group") next = { kind: "group", id: hit.id };
      else if (selection?.kind !== "items" || !selection.ids.includes(hit.id)) next = add ? toggle(hit.id, true) : { kind: "items", ids: [hit.id] };
      setSelection(next);
      setDrag({ ids: selectedItemIds(state, next), group: next?.kind === "group" ? next.id : null, dx: 0, dy: 0, pointer });
    },
    move(dx: number, dy: number, pointer: Point) {
      if (resize && state) {
        const width = widthAt(state, resize.groupId, pointer.x);
        if (width !== null) setResize({ ...resize, width, moved: true });
        return;
      }
      setDrag((d) => (d ? { ...d, dx, dy, pointer } : d));
    },
    endMove(cancelled: boolean) {
      if (resize) {
        setResize(null);
        const group = state?.groups.find((g) => g.id === resize.groupId);
        if (!state || !group || cancelled || !resize.moved || resize.width === groupWidth(group)) return;
        commit(t(resize.width < groupWidth(group) ? "history.narrower" : "history.wider", { name: group.title }), layoutOf(state), resizeLayout(state, group.id, resize.width));
        return;
      }
      if (!state || !drag) return;
      setDrag(null);
      if (cancelled || (drag.dx === 0 && drag.dy === 0)) return;
      const label = drag.group ? t("history.groupMoved") : t("history.imagesMoved", { count: drag.ids.length });
      commit(label, layoutOf(state), dropLayout(state, drag));
    },
    marqueeTo(rect: WorldRect | null, add: boolean) {
      if (!state) return;
      if (!rect) return setMarquee(null);
      const base = marquee?.base ?? (add && selection?.kind === "items" ? selection.ids : []);
      setMarquee({ rect, base });
      const next = [...new Set([...base, ...itemsInRect(state.items, rect)])];
      setSelection(next.length ? { kind: "items", ids: next } : null);
    },
    marqueeEnd: () => setMarquee(null),
    removeSelected,
    ungroupSelected,
  };
}

export type Arrange = ReturnType<typeof useArrange>;
