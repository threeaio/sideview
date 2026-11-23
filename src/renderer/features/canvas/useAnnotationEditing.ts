// Rechtecke und Anmerkungen: ziehen, beschriften, auswählen, ändern, löschen. Auswahl, Entwurf und
// Notizfeld sind Zustand der Oberfläche; gespeichert wird über den Service, der Hauptprozess meldet
// danach den neuen Stand der Fläche.

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isPoint, type Annotation, type AnnotationDone, type CanvasState, type Rect } from "../../../shared/contracts.ts";
import type { NewAnnotationInput } from "../../../shared/ipc.ts";
import { canvasKeys, canvasService } from "./canvas-service.ts";
import type { History } from "./useHistory.ts";
import { useT } from "../../shared/i18n.tsx";
import type { Point, WorldRect } from "./engine/camera.ts";
import { contains, imageToWorld, itemAt, worldToImage } from "./engine/geometry.ts";
import type { Draft } from "./engine/input.ts";


/** Gesagtes ans Ende einer Notiz, mit einem Leerzeichen dazwischen. */
const joinNote = (note: string, text: string) => (note.trim() ? `${note.trimEnd()} ${text}` : text);

/**
 * Gespeicherte Anmerkung in den Stand der Fläche, ohne auf das Ereignis des Hauptprozesses zu warten. Das kommt
 * erst nach der Antwort an; bis dahin sprang ein verschobener Rahmen sonst kurz an die alte Stelle zurück, und ein
 * schneller Griff an die Kante traf die leere Fläche (check-drop, 22.11.).
 */
const withAnnotation = (s: CanvasState | undefined, a: Annotation): CanvasState | undefined =>
  s && { ...s, annotations: s.annotations.some((x) => x.id === a.id) ? s.annotations.map((x) => (x.id === a.id ? a : x)) : [...s.annotations, a] };

/** Offenes Notizfeld: zu einem neu gezogenen Rechteck oder zu einer vorhandenen Anmerkung. */
export type Editor = ({ kind: "new"; draft: Draft } | { kind: "edit"; id: string }) & { text: string; voiced?: boolean };

export function useAnnotationEditing(state: CanvasState | null, history: History) {
  const { t } = useT();
  const name = state?.name ?? "";
  const queryClient = useQueryClient();
  const applied = (a: Annotation) => queryClient.setQueryData<CanvasState>(canvasKeys.detail(name), (s) => withAnnotation(s, a));
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<Draft | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  /** Gesichertes Rechteck, bis der neue Stand der Fläche da ist; so blinkt es nicht. */
  const [saving, setSaving] = useState<(Draft & { id?: string }) | null>(null);
  /** Rahmen, dessen Größe oder Lage gerade geändert wird, in Welteinheiten; bleibt bis zum neuen Stand. */
  const [adjusting, setAdjusting] = useState<{ id: string; rect: WorldRect; saved?: Rect } | null>(null);

  // Zwischenstände erst aufgeben, wenn der angezeigte Stand sie enthält. TanStack Query meldet neue Daten erst im
  // nächsten Takt (setTimeout 0); fiele der Zwischenstand mit der Antwort weg, stünde ein Bild lang der alte Stand
  // da: Der Rahmen sprang zurück, und ein schneller Griff an die Kante traf die leere Fläche (check-drop, 22./23.11.).
  useEffect(() => {
    if (adjusting?.saved) {
      const now = state?.annotations.find((a) => a.id === adjusting.id);
      if (!now || now.rect.every((v, i) => v === adjusting.saved![i])) setAdjusting(null);
    }
    if (saving?.id && state?.annotations.some((a) => a.id === saving.id)) setSaving(null);
  }, [state, adjusting, saving]);

  // Andere Fläche: Auswahl und Entwurf gehören zur alten.
  useEffect(() => {
    setSelected(null);
    setDrawing(null);
    setEditor(null);
  }, [name]);

  const add = useMutation({
    mutationFn: (input: NewAnnotationInput) => canvasService.addAnnotation(name, input),
    onSuccess: (a) => {
      applied(a);
      setSaving((s) => (s ? { ...s, id: a.id } : s));
    },
    onError: () => setSaving(null),
  });
  const update = useMutation({ mutationFn: ({ id, note }: { id: string; note: string }) => canvasService.updateAnnotation(name, id, { note }), onSuccess: applied });
  const mark = useMutation({
    mutationFn: ({ id, done }: { id: string; done: Pick<AnnotationDone, "by" | "reply"> | null }) => canvasService.updateAnnotation(name, id, { done }),
    onSuccess: applied,
  });
  const reshape = useMutation({
    mutationFn: ({ id, rect }: { id: string; rect: Rect }) => canvasService.updateAnnotation(name, id, { rect }),
    onSuccess: (a) => {
      applied(a);
      setAdjusting((cur) => (cur?.id === a.id ? { ...cur, saved: a.rect } : cur));
    },
    onError: () => setAdjusting(null),
  });
  const remove = useMutation({ mutationFn: (id: string) => canvasService.removeAnnotation(name, id) });
  const restore = useMutation({
    mutationFn: ({ annotation, index }: { annotation: Annotation; index: number }) => canvasService.restoreAnnotation(name, annotation, index),
  });

  /**
   * Sichert das offene Notizfeld. Das Versprechen erfüllt sich, wenn die Notiz gespeichert ist.
   * `spoken`: zuletzt Gesagtes, das noch angehängt wird (Diktat mit Schlüsselwort am Ende, eine Äußerung).
   */
  const commit = async (spoken?: string) => {
    if (!editor || !state) return;
    setEditor(null);
    const text = spoken ? joinNote(editor.text, spoken) : editor.text;
    const voiced = editor.voiced || Boolean(spoken);
    if (editor.kind === "new") {
      // Ein Punkt ohne Notiz war meist ein Klick daneben; er bleibt nicht liegen.
      if (isPointDraft(editor.draft) && !text.trim()) return;
      const item = state.items.find((i) => i.id === editor.draft.itemId);
      if (item) {
        setSaving(editor.draft);
        await add.mutateAsync({ itemId: item.id, rect: worldToImage(item, editor.draft.rect), note: text, source: voiced ? "voice" : "text" }).catch(() => {});
      }
    } else {
      const current = state.annotations.find((a) => a.id === editor.id);
      if (current && current.note !== text.trim()) await update.mutateAsync({ id: editor.id, note: text }).catch(() => {});
    }
  };

  /**
   * Oberste Anmerkung unter dem Punkt; bei verschachtelten die kleinste. Punkte und erledigte (ihr Rahmen ist
   * ausgeblendet) wählt man an ihrer Nummer, nicht über die Fläche.
   */
  const annotationAt = (p: Point) => {
    if (!state) return null;
    const hits = state.annotations.filter((a) => {
      if (a.done || isPoint(a.rect)) return false;
      const item = state.items.find((i) => i.id === a.itemId);
      return item !== undefined && contains(imageToWorld(item, a.rect), p);
    });
    hits.sort((a, b) => a.rect[2] * a.rect[3] - b.rect[2] * b.rect[3]);
    return hits[0] ?? null;
  };

  return {
    /** Anmerkung unter dem Weltpunkt, oder null. */
    annotationAt,
    selected,
    drawing,
    editor,
    saving,
    adjusting,
    /** Größe oder Lage eines Rahmens ändert sich gerade (Griffe). */
    adjust: (id: string, rect: WorldRect) => setAdjusting({ id, rect }),
    /** Griff losgelassen: neuen Rahmen in Bildpixeln sichern. */
    async settle(id: string, rect: WorldRect) {
      const a = state?.annotations.find((x) => x.id === id);
      const item = a && state?.items.find((i) => i.id === a.itemId);
      if (!a || !item) return setAdjusting(null);
      const next = worldToImage(item, rect);
      if (next.every((v, i) => v === a.rect[i])) return setAdjusting(null);
      await reshape.mutateAsync({ id, rect: next }).catch(() => setAdjusting(null));
    },
    /** Während des Ziehens. Ein offenes Notizfeld wird vorher gesichert. */
    draft(d: Draft | null) {
      if (d && editor) void commit();
      setSelected(null);
      setDrawing(d);
    },
    /** Griffe am Entwurf, solange das Notizfeld offen ist. */
    reshapeDraft: (rect: WorldRect) => setEditor((e) => (e?.kind === "new" ? { ...e, draft: { ...e.draft, rect } } : e)),
    drawn(d: Draft) {
      setDrawing(null);
      setEditor({ kind: "new", draft: d, text: "" });
    },
    /**
     * Antippen im Werkzeug Markieren (oder bei offenem Notizfeld). Offenes Notizfeld: sichern. Auf einer Anmerkung:
     * wählen. Sonst auf einem Bild (22.11., „Notiz als Punkt“): ein Punkt mit Notizfeld.
     */
    tap(p: Point) {
      if (editor) {
        void commit();
        return;
      }
      const hit = annotationAt(p);
      if (hit) return setSelected(hit.id);
      setSelected(null);
      const item = state ? itemAt(state.items.filter((i) => i.tiles), p) : null;
      if (item) setEditor({ kind: "new", draft: { itemId: item.id, rect: { x: p.x, y: p.y, w: 0, h: 0 } }, text: "" });
    },
    select: (id: string | null) => {
      if (editor) void commit();
      setSelected(id);
    },
    edit(id: string) {
      const a = state?.annotations.find((x) => x.id === id);
      if (!a) return;
      setSelected(id);
      setEditor({ kind: "edit", id, text: a.note });
    },
    type: (text: string) => setEditor((e) => (e ? { ...e, text } : e)),
    /** Diktat: Gesagtes ans Ende der Notiz. */
    append: (text: string) => setEditor((e) => (e ? { ...e, text: joinNote(e.text, text), voiced: true } : e)),
    commit,
    cancel: () => setEditor(null),
    /** Erledigt (von Hand) oder wieder offen; Cmd+Z nimmt es zurück. */
    setDone(id: string, done: boolean) {
      const a = state?.annotations.find((x) => x.id === id);
      if (!a || Boolean(a.done) === done) return;
      const before = a.done ? { by: a.done.by, reply: a.done.reply } : null;
      const apply = (value: Pick<AnnotationDone, "by" | "reply"> | null) => mark.mutateAsync({ id, done: value });
      void apply(done ? { by: "user" } : null);
      history.push({ label: t(done ? "history.done" : "history.reopened"), undo: () => apply(before), redo: () => apply(done ? { by: "user" } : null) });
    },
    remove(id: string) {
      const index = state?.annotations.findIndex((a) => a.id === id) ?? -1;
      const annotation = state?.annotations[index];
      remove.mutate(id);
      // Rückgängig bringt sie mit ihrer Nummer zurück und wählt sie wieder aus.
      if (annotation)
        history.push({
          label: t("history.annotationDeleted", { n: index + 1 }),
          toast: true,
          undo: async () => {
            await restore.mutateAsync({ annotation, index });
            setSelected(annotation.id);
          },
          redo: () => remove.mutateAsync(annotation.id),
        });
      if (selected === id) setSelected(null);
      if (editor?.kind === "edit" && editor.id === id) setEditor(null);
    },
  };
}

export type AnnotationEditing = ReturnType<typeof useAnnotationEditing>;

/** Entwurf ohne Fläche: ein Punkt. */
export const isPointDraft = (d: Draft) => d.rect.w === 0 && d.rect.h === 0;
